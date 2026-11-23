// MQTT-over-WSS transport (DEFAULT for the public site).
// Why: WebRTC/P2P is blocked outright in many networks and browsers. MQTT
// over secure WebSocket is ordinary HTTPS-shaped traffic and works anywhere.
// Bus: public EMQX broker (wss). Public game state travels in plaintext on
// the room topic — it contains no secrets by construction (publicState()).
// Private snapshots are ECDH + AES-GCM encrypted per player (see crypto.ts).
// The host's browser runs the authoritative HostEngine, exactly as in the
// PeerJS transport; if the host leaves, its MQTT last-will closes the room.
import mqtt, { MqttClient } from 'mqtt';
import { HostEngine, Pub, Priv } from './hostEngine';
import { generateKeys, deriveAesKey, encryptJson, decryptJson, KeySet } from './crypto';
import { makeRoomCode, MAX_PLAYERS } from '../../shared/logic';
import type { Net, Handlers } from './net';
import { getClientId } from './util';

// Order matters: the Eclipse broker serves WSS on port 443 (standard HTTPS
// port) — many networks/proxies block WebSockets on non-standard ports like
// 8084/8081, which is why those are only fallbacks.
const BROKERS = ['wss://mqtt.eclipseprojects.io:443/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
const topic = (code: string, part: string) => `ct1/${code}/${part}`;
const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';

function brokerList(): string[] {
  try {
    const custom = new URLSearchParams(location.search).get('broker');
    if (custom) return [custom];
  } catch { /* non-browser test env */ }
  return BROKERS;
}

function connect(extra: mqtt.IClientOptions): Promise<MqttClient> {
  const brokers = brokerList();
  return new Promise((resolve, reject) => {
    let settled = false;
    const tryBroker = (i: number) => {
      if (i >= brokers.length) { if (!settled) { settled = true; reject(new Error('bus unreachable')); } return; }
      const c = mqtt.connect(brokers[i], { connectTimeout: 8000, reconnectPeriod: 2000, ...extra });
      const to = setTimeout(() => { if (!settled) { c.end(true); tryBroker(i + 1); } }, 9000);
      c.on('connect', () => { if (!settled) { settled = true; clearTimeout(to); resolve(c); } });
      c.on('error', () => { /* retry handled by timeout / reconnectPeriod */ });
    };
    tryBroker(0);
  });
}

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
  let joinedFired = false;

  const fireJoinedOnce = (isH: boolean) => {
    if (!joinedFired) { joinedFired = true; h.onJoined(roomCode, myId, isH); }
  };

  /* ---------- HOST ---------- */
  async function startHost(name: string) {
    roomCode = makeRoomCode(); isHost = true;
    h.onStatus('Creating room…');
    myKeys = await generateKeys();
    client = await connect({ clientId: 'ct-h-' + myId + '-' + Math.random().toString(36).slice(2, 7),
      will: { topic: topic(roomCode, 'pub'), payload: Buffer.from(JSON.stringify({ type: 'hostGone' })), retain: true, qos: 1 } as any });
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
    });
    client.subscribe(topic(roomCode, 'in'), { qos: 1 });
    client.on('message', async (_t, payload) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (msg.type === 'join') {
        const pid = String(msg.clientId);
        const verdict = engine!.canAcceptJoin(pid);
        if (verdict !== 'ok') {
          client?.publish(topic(roomCode, 'p/' + pid),
            JSON.stringify({ type: 'error', msg: verdict === 'full' ? 'Room is full (8 players).' : 'Game already started — you cannot join now.' }), { qos: 1 });
          return;
        }
        try {
          const key = await deriveAesKey(myKeys!.pair.privateKey, msg.pubJwk);
          hostAes.set(pid, key);
        } catch { return; }
        engine!.addPlayer(pid, String(msg.name || 'Mouse'), false);
        client?.publish(topic(roomCode, 'p/' + pid),
          JSON.stringify({ type: 'joined', code: roomCode, playerId: pid, isHost: false, hostPubJwk: myKeys!.pubJwk }), { qos: 1 });
        engine!.broadcast();
      } else if (msg.type === 'intent' && msg.playerId) {
        if (msg.action === '__gone') { engine!.disconnect(String(msg.playerId)); return; }
        const p = engine!.state.players.find(x => x.id === msg.playerId);
        if (p) engine!.handle(p, msg);
      }
    });
    engine.addPlayer(myId, cleanName(name), true);
    fireJoinedOnce(true);
    engine.broadcast();
  }

  /* ---------- CLIENT ---------- */
  async function startClient(code: string, name: string) {
    roomCode = code.toUpperCase().trim(); isHost = false;
    h.onStatus('Connecting to room ' + roomCode + '…');
    myKeys = await generateKeys();
    const joinTimer = setTimeout(() => {
      if (!joinedFired) h.onError('Could not reach the host. Check the room code and that the host is still online, then try again.');
    }, 25000);
    client = await connect({ clientId: 'ct-c-' + myId + '-' + Math.random().toString(36).slice(2, 7),
      will: { topic: topic(roomCode, 'in'), payload: Buffer.from(JSON.stringify({ type: 'intent', playerId: myId, action: '__gone' })), qos: 1 } as any });
    client.subscribe(topic(roomCode, 'pub'), { qos: 1 });
    client.subscribe(topic(roomCode, 'p/' + myId), { qos: 1 });
    client.on('message', async (t, payload) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (t === topic(roomCode, 'pub')) {
        if (msg.type === 'state') h.onState(msg.data);
        else if (msg.type === 'hostGone') h.onError('The host left — the room has closed. 🏠');
        return;
      }
      // private topic
      if (msg.type === 'joined') {
        hostPubJwk = msg.hostPubJwk;
        try { aesKey = await deriveAesKey(myKeys!.pair.privateKey, hostPubJwk!); } catch { /* ignore */ }
        clearTimeout(joinTimer);
        fireJoinedOnce(false);
        return;
      }
      if (msg.type === 'error') { clearTimeout(joinTimer); h.onError(msg.msg); return; }
      if (msg.enc === 1 && aesKey) {
        try { const dec: any = await decryptJson(aesKey, msg); if (dec?.type === 'private') h.onPrivate(dec.data); } catch { /* ignore */ }
      }
    });
    client.publish(topic(roomCode, 'in'), JSON.stringify({ type: 'join', clientId: myId, name: cleanName(name), pubJwk: myKeys.pubJwk }), { qos: 1 });
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
    createRoom(name: string) { startHost(name).catch(() => h.onError('Could not reach the game network. Check your connection and try again.')); },
    joinRoom(code: string, name: string) { startClient(code, name).catch(() => h.onError('Could not reach the game network. Check your connection and try again.')); },
    startGame: () => intent('startGame'),
    beginNight: () => intent('beginNight'),
    ready: () => intent('ready'),
    readyVote: () => intent('readyVote'),
    nightAction: (kind, targetId) => intent(kind, { targetId }),
    chat: (text) => intent('chat', { text }),
    toVoting: () => intent('toVoting'),
    vote: (targetId) => intent('vote', { targetId }),
    playAgain: () => intent('playAgain'),
    leave() {
      try {
        if (engine) client?.publish(topic(roomCode, 'pub'), JSON.stringify({ type: 'hostGone' }), { retain: true, qos: 1 });
        client?.end(true);
      } catch { /* noop */ }
      engine = null; client = null;
    },
  };
}

export { MAX_PLAYERS };
