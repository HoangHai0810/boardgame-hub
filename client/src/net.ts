// Transport layer with ONE interface, three implementations:
//  A) MQTT over secure WebSocket (DEFAULT, public site): host's browser runs
//     the authoritative HostEngine; public state rides a public MQTT broker,
//     private data is ECDH+AES-GCM encrypted per player (see net-mqtt.ts).
//     Works in networks/browsers where WebRTC is blocked.
//  B) PeerJS/WebRTC (?net=peer): same host engine, private data over each
//     player's own DTLS-encrypted data channel.
//  C) Socket.IO (?server=<url>): the dedicated Node server in server/.
import Peer, { DataConnection } from 'peerjs';
import { io, Socket } from 'socket.io-client';
import { HostEngine, Pub, Priv } from './hostEngine';
import { makeRoomCode } from '../../shared/logic';
import { createMqttNet } from './net-mqtt';
import { getClientId } from './util';

export type { Pub, Priv };

export interface Net {
  createRoom(name: string): void;
  joinRoom(code: string, name: string): void;
  /** Abort an in-flight create/join (wrong button, dead network): tears
   *  the attempt down, clears the connecting status, never fires
   *  onJoined/onError for the cancelled attempt afterwards. */
  cancelConnect(): void;
  startGame(): void; beginNight(): void; ready(): void; readyVote(): void;
  nightAction(kind: 'steal' | 'inspect' | 'chooseFollower', targetId?: string): void;
  chat(text: string): void; toVoting(): void;
  vote(targetId: string): void; playAgain(): void; leave(): void;
  kick(targetId: string): void;
  setDiscussion(ms: number): void;
}
export interface Handlers {
  onState(s: Pub): void; onPrivate(p: Priv): void;
  onJoined(code: string, playerId: string, isHost: boolean): void;
  onError(msg: string): void; onStatus(msg: string): void;
  /** MQTT transport only: this guest was elected successor host after
   *  the original host died (host migration, v28). */
  onPromoted?(): void;
}

export { getClientId } from './util';
const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
const PEER_PREFIX = 'cheesethief-v1-';
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

/* ---------------- PeerJS transport ---------------- */
export function createPeerNet(h: Handlers): Net {
  let peer: Peer | null = null;
  let hostConn: DataConnection | null = null;
  let engine: HostEngine | null = null;
  const conns = new Map<string, DataConnection>();
  let myId = getClientId();
  let isHost = false;
  let roomCode = '';
  let joinTimer: ReturnType<typeof setTimeout> | null = null;

  function handleHostMsg(m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state') h.onState(m.data);
    else if (m.type === 'private') h.onPrivate(m.data);
    else if (m.type === 'joined') h.onJoined(m.code, m.playerId, m.isHost);
    else if (m.type === 'error') h.onError(m.msg);
    else if (m.type === 'hostGone') h.onError('HOST_GONE');
  }
  function wireHostConn(conn: DataConnection) {
    conn.on('data', (raw: any) => {
      if (!engine) return;
      if (raw?.type === 'join') {
        const pid = String(raw.clientId);
        const verdict = engine.canAcceptJoin(pid);
        if (verdict !== 'ok') {
          conn.send({ type: 'error', msg: verdict === 'full' ? 'ROOM_FULL' : 'GAME_STARTED' });
          return;
        }
        conns.set(pid, conn);
        engine.addPlayer(pid, String(raw.name || 'Mouse'), false);
        conn.send({ type: 'joined', code: roomCode, playerId: pid, isHost: false });
        engine.broadcast();
      } else if (raw?.type === 'intent' && raw.playerId) {
        const p = engine.state.players.find(x => x.id === raw.playerId);
        if (p) engine.handle(p, raw);
      }
    });
    conn.on('close', () => {
      if (!engine) return;
      for (const [pid, c] of conns) if (c === conn) { conns.delete(pid); engine.disconnect(pid); }
    });
  }
  const intent = (action: string, extra: object = {}) => {
    if (engine) {
      const me = engine.state.players.find(p => p.id === myId);
      if (me) engine.handle(me, { action, ...extra });
    } else hostConn?.send({ type: 'intent', playerId: myId, action, ...extra });
  };

  return {
    createRoom(name: string) {
      isHost = true; roomCode = makeRoomCode();
      h.onStatus('STATUS_CREATING');
      peer = new Peer(PEER_PREFIX + roomCode, PEER_OPTS);
      peer.on('open', () => {
        engine = new HostEngine(roomCode, {
          sendPub: (pub) => { h.onState(pub); for (const c of conns.values()) c.send({ type: 'state', data: pub }); },
          sendPriv: (pid, priv) => {
            if (pid === myId) { h.onPrivate(priv); return; }
            conns.get(pid)?.send({ type: 'private', data: priv });
          },
          sendError: (pid, msg) => {
            if (pid === myId) { h.onError(msg); return; }
            conns.get(pid)?.send({ type: 'error', msg });
          },
        });
        engine.addPlayer(myId, cleanName(name), true);
        h.onJoined(roomCode, myId, true);
        engine.broadcast();
      });
      peer.on('connection', wireHostConn);
      peer.on('error', (e: any) => {
        if (e?.type === 'unavailable-id') { roomCode = makeRoomCode(); peer?.destroy(); this.createRoom(name); }
        else h.onError('CONN_ERROR:' + (e?.type || 'unknown'));
      });
    },
    joinRoom(code: string, name: string) {
      isHost = false; roomCode = code.toUpperCase().trim();
      h.onStatus('STATUS_CONNECTING:' + roomCode);
      peer = new Peer(PEER_OPTS);
      joinTimer = setTimeout(() => {
        if (!hostConn?.open) h.onError('PEER_BLOCKED');
      }, 30000);
      peer.on('open', () => {
        hostConn = peer!.connect(PEER_PREFIX + roomCode, { reliable: true });
        hostConn.on('open', () => { if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; } hostConn!.send({ type: 'join', clientId: myId, name: cleanName(name) }); });
        hostConn.on('data', handleHostMsg);
        hostConn.on('close', () => h.onError('HOST_DISCONNECTED'));
      });
      peer.on('error', (e: any) => {
        if (e?.type === 'peer-unavailable') h.onError('ROOM_NOT_FOUND');
        else h.onError('CONN_ERROR:' + (e?.type || 'unknown'));
      });
    },
    cancelConnect() {
      if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
      try { hostConn?.close(); peer?.destroy(); } catch { /* noop */ }
      peer = null; hostConn = null; engine = null;
      h.onStatus('');
    },
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
      if (engine) for (const c of conns.values()) { try { c.send({ type: 'hostGone' }); } catch { /* noop */ } }
      try { hostConn?.close(); peer?.destroy(); } catch { /* noop */ }
      engine = null; hostConn = null; peer = null;
    },
  };
}

/* ---------------- Socket.IO transport ---------------- */
export function createSocketNet(serverUrl: string, h: Handlers): Net {
  const socket: Socket = io(serverUrl, { transports: ['websocket', 'polling'] });
  let myId = getClientId();
  let sockAttempt = 0;
  socket.on('state', (s: Pub) => h.onState(s));
  socket.on('private', (p: Priv) => h.onPrivate(p));
  socket.on('errorMsg', (m: string) => h.onError(m));
  socket.on('connect_error', () => h.onError('SERVER_UNREACHABLE'));
  return {
    createRoom(name: string) {
      const att = ++sockAttempt;
      socket.emit('createRoom', { name: cleanName(name), clientId: myId }, (r: any) => {
        if (att !== sockAttempt) return; // cancelled meanwhile
        r?.ok ? h.onJoined(r.code, r.playerId, true) : h.onError(r?.error || 'FAILED');
      });
    },
    joinRoom(code: string, name: string) {
      const att = ++sockAttempt;
      socket.emit('joinRoom', { code, name: cleanName(name), clientId: myId }, (r: any) => {
        if (att !== sockAttempt) return; // cancelled meanwhile
        r?.ok ? h.onJoined(r.code, r.playerId, false) : h.onError(r?.error || 'FAILED');
      });
    },
    cancelConnect() { sockAttempt++; h.onStatus(''); },
    startGame: () => socket.emit('startGame'),
    beginNight: () => socket.emit('beginNight'),
    ready: () => socket.emit('ready'),
    readyVote: () => socket.emit('readyVote'),
    nightAction: (kind, targetId) => socket.emit('nightAction', { kind, targetId }),
    chat: (text) => socket.emit('chat', { text }),
    toVoting: () => socket.emit('toVoting'),
    vote: (targetId) => socket.emit('vote', { targetId }),
    playAgain: () => socket.emit('playAgain'),
    kick: (targetId) => socket.emit('kick', { targetId }),
    setDiscussion: (ms) => socket.emit('setDiscussion', { ms }),
    leave() { socket.disconnect(); },
  };
}

export function createNet(h: Handlers): Net {
  const q = new URLSearchParams(location.search);
  const server = q.get('server');
  if (server) return createSocketNet(server, h);
  if (q.get('net') === 'peer') return createPeerNet(h);
  return createMqttNet(h);
}
