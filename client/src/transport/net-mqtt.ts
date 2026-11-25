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
import { engineFor, EngineLike } from './engines';
import { generateKeys, deriveAesKey, encryptJson, decryptJson, KeySet } from './crypto';
import { makeRoomCode } from './util';
import type { Net, Handlers } from './net';
import { getClientId } from './util';
import { brokerOrder, connectMqttSequential, connectMqttParallel } from './brokers';
import type { EngineHooks } from '../games/cheese-thief/hostEngine';

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
const nonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const b64raw = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
const unb64raw = (b: string) => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function importRoomKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64raw(b64) as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function createMqttNet(h: Handlers, gameId = 'cheese-thief'): Net {
  // Platform rule: every game's rooms live under its own topic tree,
  // so two games can never share (or collide on) a room code.
  const topic = (code: string, part: string) => `ct1/${gameId}/${code}/${part}`;
  let client: MqttClient | null = null;
  let engine: EngineLike | null = null;
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
  let raceClients: MqttClient[] = []; // in-flight parallel join clients (ended on win/cancel)
  let order: string[] = [];
  let brokerIdx = 0;
  let failoverTimer: ReturnType<typeof setTimeout> | null = null;
  // Host migration (v28): the host continuously publishes an AES-GCM
  // encrypted snapshot of the whole engine state (key shared with every
  // player inside their private channel). If the host dies, the
  // longest-present guest restores it and takes over — the room survives
  // a host F5 / crash / dead phone.
  let roomKey: CryptoKey | null = null;
  let roomKeyB64 = '';
  let myEscrowKeyB64 = '';
  const pubKeys = new Map<string, JsonWebKey>();
  let lastPub: any | null = null;
  let lastStateAt = 0;
  let lastSnapAt = 0;
  let lastSnapPhase = '';
  let hostSince = 0;
  let starting = false; // a create/join walk is already in flight
  let attemptSeq = 0; // bumped by every create/join AND by cancelConnect
  let candidacy = false;
  let claimTimer: ReturnType<typeof setTimeout> | null = null;
  let latestSnap: any = null;
  const claimsSeen = new Map<string, number>();
  let migrating = false;
  let failoverBusy = false;
  let left = false;

  const fireJoinedOnce = (isH: boolean) => {
    if (!joinedFired) { joinedFired = true; starting = false; h.onJoined(roomCode, myId, isH); }
  };
  const notifyError = (m: string) => {
    starting = false;
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    h.onError(m);
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

  function makeHooks(): EngineHooks {
    return {
      sendPub: (pub) => {
        h.onState(pub); // host's own UI
        client?.publish(topic(roomCode, 'pub'), JSON.stringify({ type: 'state', data: pub }), { retain: true, qos: 1 });
        void maybeSnapshot(pub);
      },
      sendPriv: (pid, priv) => {
        // Every private snapshot carries the room escrow key: it is what
        // lets any player restore the room if this host dies.
        if (roomKeyB64) (priv as any).escrowKey = roomKeyB64;
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
    };
  }

  async function maybeSnapshot(pub: any) {
    if (!engine || !roomKey) return;
    const now = Date.now();
    if (now - lastSnapAt < 2500 && pub.phase === lastSnapPhase) return;
    lastSnapAt = now; lastSnapPhase = pub.phase;
    try {
      const data = JSON.stringify({ v: 1, state: engine.state, pubKeys: Object.fromEntries(pubKeys), savedAt: now });
      const enc = await encryptJson(roomKey, { type: 'snapshot', data });
      client?.publish(topic(roomCode, 'snap'), JSON.stringify(enc), { retain: true, qos: 1 });
    } catch { /* escrow is best-effort */ }
  }

  /* ---------- HOST ---------- */
  function bindHost(c: MqttClient) {
    c.subscribe(topic(roomCode, 'in'), { qos: 1 });
    c.subscribe(topic(roomCode, 'claim'), { qos: 1 });
    c.on('message', async (_t, payload) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (_t === topic(roomCode, 'claim')) {
        // A successor was elected while I was unreachable: stand down and
        // rejoin my own room as a guest rather than fight over it.
        if (msg.by && msg.by !== myId && (+msg.ts || 0) > hostSince && engine && !migrating) void standDown();
        return;
      }
      if (msg.type === 'join') {
        const pid = String(msg.clientId);
        playerConn.set(pid, String(msg.conn ?? ''));
        if (msg.pubJwk) pubKeys.set(pid, msg.pubJwk);
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
        const p = engine!.state.players.find((x: any) => x.id === msg.playerId);
        if (p) engine!.handle(p, msg);
      }
    });
    // After a connection gap, push a fresh snapshot so nobody stays stale.
    c.on('connect', () => { try { engine?.broadcast(); } catch { /* noop */ } });
  }

  async function startHost(name: string, att: number) {
    roomCode = makeRoomCode(); isHost = true; joinedFired = false; left = false;
    myName = name;
    h.onStatus('STATUS_CREATING');
    myKeys = await generateKeys();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    roomKeyB64 = b64raw(rawKey);
    roomKey = await importRoomKey(roomKeyB64);
    hostSince = Date.now();
    const Ctor = engineFor(gameId);
    if (!Ctor) { h.onError('GAME_NOT_SUPPORTED'); return; }
    engine = new Ctor(roomCode, makeHooks());
    makeExtra = () => ({ clientId: 'ct-h-' + myId + '-' + Math.random().toString(36).slice(2, 7),
      will: { topic: topic(roomCode, 'pub'), payload: JSON.stringify({ type: 'hostGone' }), retain: true, qos: 1 } as any });
    bindCurrent = () => { if (client) bindHost(client); };
    order = brokerOrder(roomCode);
    const rh = await connectMqttSequential(order, 0, makeExtra());
    if (att !== attemptSeq) { try { rh.client.end(true); } catch { /* noop */ } return; } // cancelled mid-walk
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
    // (Re)join on EVERY transport connect: if the broker fired our
    // leave-will during a long drop, the host marked us gone — re-joining
    // with the current connection's nonce restores us seamlessly.
    const sendJoin = () => {
      c.publish(topic(roomCode, 'in'), JSON.stringify({
        type: 'join', clientId: myId, name: cleanName(myName), pubJwk: myKeys!.pubJwk, conn: willConn,
      }), { qos: 1 });
    };
    c.on('message', async (t, payload, packet) => {
      let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (t === topic(roomCode, 'claim')) {
        if (msg.by && msg.by !== myId) {
          claimsSeen.set(String(msg.by), +msg.ts || 0);
          // Someone else is taking over — cancel my own bid.
          if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
        }
        return;
      }
      if (t === topic(roomCode, 'snap')) { latestSnap = msg; return; }
      if (t === topic(roomCode, 'pub')) {
        if (msg.type === 'state') {
          lastPub = msg.data; lastStateAt = Date.now();
          candidacy = false; // a host is serving again
          h.onState(msg.data);
        } else if (msg.type === 'migrated') {
          sendJoin(); // rekey my private channel against the successor host
        } else if (msg.type === 'hostGone') {
          onHostGone(packet);
        }
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
      if (msg.type === 'error') { if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; } notifyError(msg.msg); return; }
      if (msg.enc === 1 && aesKey) {
        try {
          const dec: any = await decryptJson(aesKey, msg);
          if (dec?.type === 'private') {
            const ek = (dec.data as any)?.escrowKey;
            if (typeof ek === 'string' && ek) myEscrowKeyB64 = ek;
            h.onPrivate(dec.data);
          }
        } catch { /* ignore */ }
      }
    });
    c.on('connect', sendJoin);
    if (c.connected) sendJoin();
  }

  /* ---------- host migration (guest side) ---------- */
  function onHostGone(packet: any) {
    if (candidacy || migrating || engine || left) return;
    // A RETAINED copy redelivered on resubscribe while a live host is
    // serving is stale news, not a death.
    if (packet?.retain && Date.now() - lastStateAt < 8000) return;
    if (!lastPub || !myEscrowKeyB64) { notifyError('HOST_GONE'); return; }
    beginCandidacy();
  }

  function beginCandidacy() {
    if (candidacy || !client) return;
    candidacy = true;
    claimsSeen.clear();
    latestSnap = null;
    client.subscribe(topic(roomCode, 'claim'), { qos: 1 });
    client.subscribe(topic(roomCode, 'snap'), { qos: 1 });
    const cands = (lastPub?.players ?? []).filter((p: any) => p.connected && !p.isHost);
    const rank = Math.max(0, cands.findIndex((p: any) => p.id === myId));
    const myDelay = 5000 + rank * 2500;
    claimTimer = setTimeout(() => { void tryPromote(); }, myDelay);
    // Nobody could take over (e.g. the winner died too): surface the loss.
    setTimeout(() => { if (candidacy && !engine && !migrating) { candidacy = false; notifyError('HOST_GONE'); } }, myDelay + 25000);
  }

  async function tryPromote() {
    claimTimer = null;
    if (!candidacy || engine || migrating || left) return;
    const now = Date.now();
    client?.publish(topic(roomCode, 'claim'), JSON.stringify({ by: myId, ts: now }), { retain: true, qos: 1 });
    await new Promise(r => setTimeout(r, 700));
    if (!candidacy || engine || migrating || left) return; // a host resumed meanwhile
    const beaten = [...claimsSeen.values()].some(ts => ts <= now);
    if (beaten) { candidacy = false; return; } // an earlier claim won; stay guest
    if (!latestSnap || !myEscrowKeyB64) { candidacy = false; notifyError('HOST_GONE'); return; }
    await promote(latestSnap);
  }

  async function promote(snapEnc: any) {
    migrating = true;
    try {
      const key = await importRoomKey(myEscrowKeyB64);
      const dec: any = await decryptJson(key, snapEnc);
      const snap = JSON.parse(dec.data);
      const state = snap.state;
      const oldHostId = state.players.find((p: any) => p.isHost)?.id;
      myKeys = await generateKeys();
      roomKey = key; roomKeyB64 = myEscrowKeyB64;
      const Ctor = engineFor(gameId);
      if (!Ctor) { migrating = false; notifyError('GAME_NOT_SUPPORTED'); return; }
      const eng = new Ctor(state.roomCode || roomCode, makeHooks());
      eng.state = state;
      eng.state.players.forEach((p: any) => {
        if (p.id === myId) { p.isHost = true; p.connected = true; }
        else if (p.id === oldHostId) { p.isHost = false; p.connected = false; }
      });
      engine = eng; isHost = true; hostSince = Date.now();
      pubKeys.clear();
      Object.entries(snap.pubKeys || {}).forEach(([pid, jwk]) => pubKeys.set(pid, jwk as JsonWebKey));
      hostAes.clear();
      for (const [pid, jwk] of pubKeys) {
        if (pid === myId) continue;
        try { hostAes.set(pid, await deriveAesKey(myKeys.pair.privateKey, jwk)); } catch { /* rekeyed on their re-join */ }
      }
      eng.resumeTimers();
      // Swap transports: end the guest connection gracefully (its will is
      // discarded), reconnect with a HOST will, and serve.
      const old = client;
      try { old?.end(true); } catch { /* noop */ }
      makeExtra = () => ({ clientId: 'ct-h-' + myId + '-' + Math.random().toString(36).slice(2, 7),
        will: { topic: topic(roomCode, 'pub'), payload: JSON.stringify({ type: 'hostGone' }), retain: true, qos: 1 } as any });
      bindCurrent = () => { if (client) bindHost(client); };
      const r = await connectMqttSequential(order, 0, makeExtra());
      client = r.client; brokerIdx = r.idx;
      watchLifecycle(client);
      bindCurrent();
      candidacy = false;
      h.onPromoted?.();
      engine.broadcast();
      client.publish(topic(roomCode, 'pub'), JSON.stringify({ type: 'migrated', by: myId }), { qos: 1 });
    } catch {
      notifyError('HOST_GONE');
    } finally { migrating = false; }
  }

  /** A returning old host steps aside: its room already has a successor. */
  async function standDown() {
    if (!engine || migrating) return;
    try { engine.dispose?.(); } catch { /* noop */ }
    engine = null; isHost = false; hostSince = 0;
    pubKeys.clear(); hostAes.clear();
    const old = client;
    try { old?.end(true); } catch { /* noop */ }
    client = null;
    await startClient(roomCode, myName, ++attemptSeq).catch(() => notifyError('NET_UNREACHABLE'));
  }

  async function startClient(code: string, name: string, att: number) {
    roomCode = code.toUpperCase().trim(); isHost = false; joinedFired = false; left = false;
    myName = name;
    h.onStatus('STATUS_CONNECTING:' + roomCode);
    myKeys = await generateKeys();
    makeExtra = () => {
      willConn = nonce();
      return { clientId: 'ct-c-' + myId + '-' + Math.random().toString(36).slice(2, 7),
        will: { topic: topic(roomCode, 'in'), payload: JSON.stringify({ type: 'intent', playerId: myId, action: '__gone', conn: willConn }), qos: 1 } as any };
    };
    bindCurrent = () => { if (client) bindGuest(client); };
    order = brokerOrder(roomCode);
    // JOIN RACE (v40 — "bấm phát vào luôn"): connect to every broker in
    // the room's order in parallel and send the join on each one as soon
    // as it connects. Only the broker the host is on can answer 'joined'
    // (the reply is never retained, and no host listens on the others),
    // so the guest lands on the host's broker in ~1–2s — whether or not
    // that broker is first in the order. The old sequential walk + 12s
    // hop burned 12s+ on split-broker rooms (host and guest on different
    // networks reaching different brokers first).
    const rc = await raceJoin(att);
    if (att !== attemptSeq) { if (rc && 'client' in rc) { try { rc.client.end(true); } catch { /* noop */ } } return; } // cancelled mid-race
    if (!rc) { notifyError('HOST_UNREACHABLE'); return; }
    if ('error' in rc) { notifyError(rc.error); return; }
    client = rc.client; brokerIdx = rc.idx; willConn = rc.conn;
    // Long-lived bus: restore auto-reconnect (v29 voice regression).
    (client as any).options.reconnectPeriod = 2000;
    watchLifecycle(client);
    bindCurrent(); // re-joins with the winner's conn; the host answers 'joined' again
    armJoinTimer(att); // the re-join's reply has 12s; bindGuest clears it
  }

  /** (Re)arm the host-reply clock: 12s with no 'joined' reply, then the
   *  host is unreachable on every broker we tried. */
  function armJoinTimer(att: number) {
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    joinTimer = setTimeout(() => { if (att === attemptSeq && !joinedFired && !left) notifyError('HOST_UNREACHABLE'); }, 12000);
  }

  /** Parallel join race (see startClient). Resolves the winning client
   *  (with its leave-will nonce), {error} when the host answers with a
   *  rejection (ROOM_FULL / GAME_STARTED), or null when no broker is
   *  reachable at all (NET_UNREACHABLE) or nobody answers in 12s
   *  (HOST_UNREACHABLE — the caller maps null to that). Loser clients are
   *  ended gracefully, so their leave-wills never fire. */
  function raceJoin(att: number): Promise<{ client: MqttClient; idx: number; conn: string } | { error: string } | null> {
    return new Promise((resolve) => {
      let done = false;
      let connected = 0;
      const clients: MqttClient[] = [];
      raceClients = clients;
      let replyTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (r: { client: MqttClient; idx: number; conn: string } | { error: string } | null) => {
        if (done) return; done = true;
        if (replyTimer) { clearTimeout(replyTimer); replyTimer = null; }
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        for (const c of clients) {
          if (!r || !('client' in r) || c !== r.client) { try { c.removeAllListeners(); c.end(true); } catch { /* noop */ } }
        }
        raceClients = [];
        resolve(r);
      };
      const onClient = (c: MqttClient, idx: number, conn: string) => {
        if (done || att !== attemptSeq || left) { try { c.end(true); } catch { /* noop */ } return; }
        clients.push(c); connected++;
        if (!replyTimer) {
          // First join is out — the host has 12s to answer on any broker.
          replyTimer = setTimeout(() => finish(null), 12000);
          joinTimer = replyTimer; // cancelConnect / notifyError clear it
        }
        // Minimal race binding: only the private topic. We deliberately do
        // NOT subscribe to 'pub' yet — a stale retained state/hostGone on
        // a broker we don't end up using must not fail the join.
        c.subscribe(topic(roomCode, 'p/' + myId), { qos: 1 });
        c.on('message', (_t, payload) => {
          if (done || att !== attemptSeq) return;
          let msg: any; try { msg = JSON.parse(payload.toString()); } catch { return; }
          if (msg.type === 'joined') finish({ client: c, idx, conn });
          else if (msg.type === 'error') finish({ error: String(msg.msg || 'HOST_UNREACHABLE') });
        });
        c.publish(topic(roomCode, 'in'), JSON.stringify({
          type: 'join', clientId: myId, name: cleanName(myName), pubJwk: myKeys!.pubJwk, conn,
        }), { qos: 1 });
      };
      const extraFactory = () => { const opts = makeExtra!(); return { opts, tag: willConn }; };
      void connectMqttParallel(order, extraFactory, onClient).then(() => {
        if (done) return;
        if (connected === 0) finish({ error: 'NET_UNREACHABLE' });
      });
    });
  }

  const intent = (action: string, extra: object = {}) => {
    if (engine) {
      const me = engine.state.players.find((p: any) => p.id === myId);
      if (me) engine.handle(me, { action, ...extra });
    } else {
      client?.publish(topic(roomCode, 'in'), JSON.stringify({ type: 'intent', playerId: myId, action, ...extra }), { qos: 1 });
    }
  };

  return {
    createRoom(name: string) {
      if (starting || joinedFired) return;
      starting = true;
      const att = ++attemptSeq;
      startHost(name, att).catch(() => { if (att === attemptSeq) notifyError('NET_UNREACHABLE'); });
    },
    joinRoom(code: string, name: string) {
      if (starting || joinedFired) return;
      starting = true;
      const att = ++attemptSeq;
      startClient(code, name, att).catch(() => { if (att === attemptSeq) notifyError('NET_UNREACHABLE'); });
    },
    cancelConnect() {
      if (!starting) return; // only an in-flight create/join can be cancelled
      attemptSeq++; // the walk's late result is discarded by the stale-checks
      starting = false;
      left = true; // lifecycle watcher/failover stay down; next attempt resets it
      if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      // A join race may be in flight (module `client` is still null):
      // drop its clients too, or they linger connected with live wills.
      for (const c of raceClients) { try { c.end(true); } catch { /* noop */ } }
      raceClients = [];
      // A client may already be connected (guest waiting on the host's
      // 'joined' reply): drop it. We never got a player slot, so the
      // leave-will's __gone names a player the host never added — a no-op.
      if (client) { try { client.end(true); } catch { /* noop */ } client = null; }
      engine = null; joinedFired = false;
      h.onStatus('');
    },
    startGame: () => intent('startGame'),
    beginNight: () => intent('beginNight'),
    ready: () => intent('ready'),
    readyVote: () => intent('readyVote'),
    nightAction: (kind, targetId, extra) => intent(kind, { targetId, ...extra }),
    chat: (text) => intent('chat', { text }),
    wolfChat: (text) => intent('wolfChat', { text }),
    toVoting: () => intent('toVoting'),
    vote: (targetId) => intent('vote', { targetId }),
    playAgain: () => intent('playAgain'),
    kick: (targetId) => intent('kick', { targetId }),
    setDiscussion: (ms) => intent('setDiscussion', { ms }),
    leave() {
      left = true;
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      for (const c of raceClients) { try { c.end(true); } catch { /* noop */ } }
      raceClients = [];
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

