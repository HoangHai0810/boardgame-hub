// MQTT-over-WSS transport (DEFAULT for the public site).
// Why: WebRTC/P2P is blocked outright in many networks and browsers. MQTT
// over secure WebSocket is ordinary HTTPS-shaped traffic and works anywhere.
// Bus: public brokers (wss). Public game state travels in plaintext on the
// room topic — it contains no secrets by construction (publicState()).
// Private snapshots are ECDH + AES-GCM encrypted per player (see crypto.ts).
// The host's browser runs the authoritative HostEngine, exactly as in the
// PeerJS transport; if the host leaves, its MQTT last-will closes the room.
//
// Broker selection is deterministic PER ROOM (see brokers.ts, v27):
// the old parallel race could split one room across two brokers —
// separate MQTT universes — which hung joins on "connecting…" forever.
//
// Resilience (v25, from live-play reports):
// - If the chosen broker dies for THIS browser/network (1 of the PO's 4
//   browsers had exactly that: buttons silently dead), mqtt.js would loop
//   reconnecting to the same dead broker forever. After ~9s offline we now
//   tear the client down and RE-RACE all brokers; another one usually works.
// - Every (re)connect re-sends the guest join, so a connection that dropped
//   long enough for the broker to fire the leave-will rejoins seamlessly.
// - Each connection carries a random `conn` nonce baked into its leave-will.
//   The host only honours a __gone whose nonce matches the player's LATEST
//   join — so the stale will of a pre-F5 connection can no longer kick a
//   player who already refreshed and rejoined.
import mqtt, { MqttClient } from 'mqtt';
import { HostEngine, Pub, Priv } from './hostEngine';
import { generateKeys, deriveAesKey, encryptJson, decryptJson, KeySet } from './crypto';
import { makeRoomCode, MAX_PLAYERS } from '../../shared/logic';
import type { Net, Handlers } from './net';
import { getClientId } from './util';
import { brokerOrder, connectMqttSequential } from './brokers';

const topic = (code: string, part: string) => `ct1/${code}/${part}`;
const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
const nonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function createMqttNet(h: Handlers): Net {
  let client: MqttClient | null = null;
  let engine: HostEngine | null = null;
  let myId = getClientId();
  let roomCode = '';
  let isHost = false;
  let myKeys: KeySet | null = null;
  let hostPubJwk: JsonWebKey | null = null;
  let aesKey: CryptoKey | null = null; // client side: key shared with host
  const hostAes = new Map<string, CryptoKey>(); // host side: per-player keys
  const playerConn = new Map<string, string>(); // host side: latest conn nonce per player
  let joinedFired = false;
  let myName = '';
  let willConn = ''; // guest: nonce baked into the CURRENT client's will
  let makeExtra: (() => mqtt.IClientOptions) | null = null;
  let bindCurrent: (() => void) | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let order: string[] = [];
  let brokerIdx = 0;
  let failoverTimer: ReturnType<typeof setTimeout> | null = null;
  let failoverBusy = false;
  let left = false;

  const fireJoinedOnce = (isH: boolean) => {
    if (!joinedFired) { joinedFired = true; h.onJoined(roomCode, myId, isH); }
  };

  /* ----- connection lifecycle: surface status + broker failover ----- */
  function watchLifecycle(c: MqttClient) {
    c.on('connect', () => {
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      h.onStatus('NET_OK');
    });
    const lost = () => {
      h.onStatus('NET_LOST');
      if (failoverTimer || left) return;
      failoverTimer = setTimeout(() => {
        failoverTimer = null;
        if (left || !client || client.connected) return;
        void failover();
      }, 9000);
    };
    c.on('offline', lost);
    c.on('reconnect', () => h.onStatus('NET_LOST'));
  }

  async function failover() {
    if (failoverBusy || left || !makeExtra || !bindCurrent) return;
    failoverBusy = true;
    try {
      const old = client;
      try { old?.end(true); } catch { /* noop */ }
      const r = await connectMqttSequential(order, (brokerIdx + 1) % order.length, makeExtra());
      client = r.client; brokerIdx = r.idx;
      watchLifecycle(client);
      bindCurrent();
    } catch {
      h.onStatus('NET_LOST');
      if (!failoverTimer && !left) {
        failoverTimer = setTimeout(() => { failoverTimer = null; void failover(); }, 9000);
      }
    } finally { failoverBusy = false; }
  }

  /* ---------- HOST ---------- */
  function bindHost(c: MqttClient) {
    c.subscribe(topic(roomCode, 'in'), { qos: 1 });
    c.on('message', async (_t, payload) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (msg.type === 'join') {
        const pid = String(msg.clientId);
        playerConn.set(pid, String(msg.conn ?? ''));
        const verdict = engine!.canAcceptJoin(pid);
        if (verdict !== 'ok') {
          c.publish(topic(roomCode, 'p/' + pid),
            JSON.stringify({ type: 'error', msg: verdict === 'full' ? 'ROOM_FULL' : 'GAME_STARTED' }), { qos: 1 });
          return;
        }
        try {
          const key = await deriveAesKey(myKeys!.pair.privateKey, msg.pubJwk);
          hostAes.set(pid, key);
        } catch { return; }
        engine!.addPlayer(pid, String(msg.name || 'Mouse'), false);
        c.publish(topic(roomCode, 'p/' + pid),
          JSON.stringify({ type: 'joined', code: roomCode, playerId: pid, isHost: false, hostPubJwk: myKeys!.pubJwk }), { qos: 1 });
        engine!.broadcast();
      } else if (msg.type === 'intent' && msg.playerId) {
        if (msg.action === '__gone') {
          // Ignore a STALE will: if the player has since rejoined on a new
          // connection (F5 / failover), its nonce no longer matches.
          const known = playerConn.get(String(msg.playerId));
          if (msg.conn && known && msg.conn !== known) return;
          engine!.disconnect(String(msg.playerId));
          return;
        }
        const p = engine!.state.players.find(x => x.id === msg.playerId);
        if (p) engine!.handle(p, msg);
      }
    });
    // After a connection gap, push a fresh snapshot so nobody stays stale.
    c.on('connect', () => { try { engine?.broadcast(); } catch { /* noop */ } });
  }

  async function startHost(name: string) {
    roomCode = makeRoomCode(); isHost = true; joinedFired = false; left = false;
    myName = name;
    h.onStatus('STATUS_CREATING');
    myKeys = await generateKeys();
    engine = new HostEngine(roomCode, {
      sendPub: (pub) => {
        h.onState(pub); // host's own UI
        client?.publish(topic(roomCode, 'pub'), JSON.stringify({ type: 'state', data: pub }), { retain: true, qos: 1 });
      },
      sendPriv: (pid, priv) => {
        if (pid === myId) { h.onPrivate(priv); return; }
        const key = hostAes.get(pid);
        if (!key || !client) return; // key arrives with the join message
        encryptJson(key, { type: 'private', data: priv }).then(enc =>
          client?.publish(topic(roomCode, 'p/' + pid), JSON.stringify(enc), { qos: 1 }));
      },
      sendError: (pid, msg) => {
        if (pid === myId) { h.onError(msg); return; }
        client?.publish(topic(roomCode, 'p/' + pid), JSON.stringify({ type: 'error', msg }), { qos: 1 });
      },
    });
    makeExtra = () => ({ clientId: 'ct-h-' + myId + '-' + Math.random().toString(36).slice(2, 7),
      will: { topic: topic(roomCode, 'pub'), payload: JSON.stringify({ type: 'hostGone' }), retain: true, qos: 1 } as any });
    bindCurrent = () => { if (client) bindHost(client); };
    order = brokerOrder(roomCode);
    const rh = await connectMqttSequential(order, 0, makeExtra());
    client = rh.client; brokerIdx = rh.idx;
    watchLifecycle(client);
    bindCurrent();
    engine.addPlayer(myId, cleanName(name), true);
    fireJoinedOnce(true);
    engine.broadcast();
  }

  /* ---------- CLIENT ---------- */
  function bindGuest(c: MqttClient) {
    c.subscribe(topic(roomCode, 'pub'), { qos: 1 });
    c.subscribe(topic(roomCode, 'p/' + myId), { qos: 1 });
    c.on('message', async (t, payload) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (t === topic(roomCode, 'pub')) {
        if (msg.type === 'state') h.onState(msg.data);
        else if (msg.type === 'hostGone') h.onError('HOST_GONE');
        return;
      }
      // private topic
      if (msg.type === 'joined') {
        hostPubJwk = msg.hostPubJwk;
        try { aesKey = await deriveAesKey(myKeys!.pair.privateKey, hostPubJwk!); } catch { /* ignore */ }
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        fireJoinedOnce(false);
        return;
      }
      if (msg.type === 'error') { if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; } h.onError(msg.msg); return; }
      if (msg.enc === 1 && aesKey) {
        try { const dec: any = await decryptJson(aesKey, msg); if (dec?.type === 'private') h.onPrivate(dec.data); } catch { /* ignore */ }
      }
    });
    // (Re)join on EVERY transport connect: if the broker fired our
    // leave-will during a long drop, the host marked us gone — re-joining
    // with the current connection's nonce restores us seamlessly.
    const sendJoin = () => {
      c.publish(topic(roomCode, 'in'), JSON.stringify({
        type: 'join', clientId: myId, name: cleanName(myName), pubJwk: myKeys!.pubJwk, conn: willConn,
      }), { qos: 1 });
    };
    c.on('connect', sendJoin);
    if (c.connected) sendJoin();
  }

  async function startClient(code: string, name: string) {
    roomCode = code.toUpperCase().trim(); isHost = false; joinedFired = false; left = false;
    myName = name;
    h.onStatus('STATUS_CONNECTING:' + roomCode);
    myKeys = await generateKeys();
    joinTimer = setTimeout(() => {
      if (!joinedFired) h.onError('HOST_UNREACHABLE');
    }, 45000);
    makeExtra = () => {
      willConn = nonce();
      return { clientId: 'ct-c-' + myId + '-' + Math.random().toString(36).slice(2, 7),
        will: { topic: topic(roomCode, 'in'), payload: JSON.stringify({ type: 'intent', playerId: myId, action: '__gone', conn: willConn }), qos: 1 } as any };
    };
    bindCurrent = () => { if (client) bindGuest(client); };
    order = brokerOrder(roomCode);
    const rc = await connectMqttSequential(order, 0, makeExtra());
    client = rc.client; brokerIdx = rc.idx;
    watchLifecycle(client);
    bindCurrent();
  }

  const intent = (action: string, extra: object = {}) => {
    if (engine) {
      const me = engine.state.players.find(p => p.id === myId);
      if (me) engine.handle(me, { action, ...extra });
    } else {
      client?.publish(topic(roomCode, 'in'), JSON.stringify({ type: 'intent', playerId: myId, action, ...extra }), { qos: 1 });
    }
  };

  return {
    createRoom(name: string) { startHost(name).catch(() => h.onError('NET_UNREACHABLE')); },
    joinRoom(code: string, name: string) { startClient(code, name).catch(() => h.onError('NET_UNREACHABLE')); },
    startGame: () => intent('startGame'),
    beginNight: () => intent('beginNight'),
    ready: () => intent('ready'),
    readyVote: () => intent('readyVote'),
    nightAction: (kind, targetId) => intent(kind, { targetId }),
    chat: (text) => intent('chat', { text }),
    toVoting: () => intent('toVoting'),
    vote: (targetId) => intent('vote', { targetId }),
    playAgain: () => intent('playAgain'),
    kick: (targetId) => intent('kick', { targetId }),
    setDiscussion: (ms) => intent('setDiscussion', { ms }),
    leave() {
      left = true;
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      try {
        if (engine) {
          client?.publish(topic(roomCode, 'pub'), JSON.stringify({ type: 'hostGone' }), { retain: true, qos: 1 });
          client?.end(true);
        } else if (client?.connected) {
          // A graceful DISCONNECT discards the will, so announce the leave
          // explicitly first — otherwise the host keeps a ghost player.
          client.publish(topic(roomCode, 'in'), JSON.stringify({ type: 'intent', playerId: myId, action: '__gone', conn: willConn }), { qos: 1 });
          const c = client;
          setTimeout(() => { try { c.end(true); } catch { /* noop */ } }, 350);
        } else {
          client?.end(true);
        }
      } catch { /* noop */ }
      engine = null; client = null;
    },
  };
}

export { MAX_PLAYERS };
