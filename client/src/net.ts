// Transport layer with ONE interface, two implementations:
//  A) PeerJS (default, used by the public GitHub Pages deployment):
//     the host's browser runs the authoritative engine below — it assigns
//     roles/dice, validates every action, and sends private data ONLY over
//     that player's own WebRTC data channel. Other clients never receive it.
//  B) Socket.IO: talks to server/ (Node) when ?server=<url> is present —
//     same engine logic, dedicated-server variant for self-hosting.
import Peer, { DataConnection } from 'peerjs';
import { io, Socket } from 'socket.io-client';
import {
  GameState, Player, createGame, assignRolesAndDice, publicState, privateState,
  doSteal, doInspect, castVote, resolveVotes, makeRoomCode,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, DISCUSSION_MS, VOTE_MS,
} from '../../shared/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface Net {
  createRoom(name: string): void;
  joinRoom(code: string, name: string): void;
  startGame(): void; beginNight(): void; ready(): void; readyVote(): void;
  nightAction(kind: 'steal' | 'inspect', targetId?: string): void;
  chat(text: string): void; toVoting(): void;
  vote(targetId: string): void; playAgain(): void; leave(): void;
}
export interface Handlers {
  onState(s: Pub): void; onPrivate(p: Priv): void;
  onJoined(code: string, playerId: string, isHost: boolean): void;
  onError(msg: string): void; onStatus(msg: string): void;
}

export function getClientId(): string {
  let id = sessionStorage.getItem('ct_client_id');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('ct_client_id', id); }
  return id;
}
const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
const PEER_PREFIX = 'cheesethief-v1-';
// STUN alone fails on symmetric-NAT / restricted networks (the WebRTC data
// channel never opens and joining hangs forever). Public TURN relays fix
// most of those cases by relaying the data channel over the TURN server.
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

/* ---------------- Authoritative engine (host peer) ---------------- */
class HostEngine {
  state: GameState; timers: ReturnType<typeof setTimeout>[] = [];
  conns = new Map<string, DataConnection>(); // playerId -> conn
  lastChat = new Map<string, number>();
  constructor(code: string, private sendState: (pid: string, s: Pub, p: Priv) => void,
              private sendAll: (s: Pub) => void, private privFor: (pid: string) => Priv | null) {
    this.state = createGame(code);
  }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  broadcast() {
    const pub = publicState(this.state);
    this.sendAll(pub);
    for (const p of this.state.players) {
      const priv = this.privFor(p.id);
      if (priv) this.sendState(p.id, pub, priv);
    }
  }
  addPlayer(id: string, name: string, isHost: boolean): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear(); assignRolesAndDice(this.state); this.state.phase = 'roleReveal'; this.broadcast();
    // Night starts when EVERY player pressed "I'm ready" (see 'ready' action);
    // 45s is only a fallback, host can also force it with beginNight.
    this.later(45000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
  }
  startNight() {
    const s = this.state; s.phase = 'night';
    const step = (h: number) => {
      if (s.phase !== 'night') return;
      if (h > 6) {
        s.phase = 'day'; s.dayReady = []; s.discussionEndsAt = Date.now() + DISCUSSION_MS; this.broadcast();
        this.later(DISCUSSION_MS, () => { if (s.phase === 'day') this.startVoting(); });
        return;
      }
      s.currentHour = h; s.hourEndsAt = Date.now() + HOUR_MS;
      s.players.forEach(p => { p.hasActedThisHour = false; });
      this.broadcast(); this.later(HOUR_MS, () => step(h + 1));
    };
    step(1);
  }
  startVoting() {
    this.clear(); const s = this.state;
    s.phase = 'voting'; s.voteEndsAt = Date.now() + VOTE_MS; this.broadcast();
    this.later(VOTE_MS, () => { if (s.phase === 'voting') this.finishVoting(); });
  }
  finishVoting() { this.clear(); resolveVotes(this.state); this.broadcast(); }
  handle(player: Player, msg: any) {
    const s = this.state;
    switch (msg.action) {
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (s.players.filter(p => p.connected).length < MIN_PLAYERS) return;
        if (s.phase === 'results') s.round++;
        this.startRound(); break;
      }
      case 'beginNight': if (player.isHost && s.phase === 'roleReveal') { this.clear(); this.startNight(); } break;
      case 'ready': {
        if (s.phase !== 'roleReveal') break;
        if (!s.revealReady.includes(player.id)) s.revealReady.push(player.id);
        if (s.players.filter(p => p.connected).every(p => s.revealReady.includes(p.id))) { this.clear(); this.startNight(); }
        else this.broadcast();
        break;
      }
      case 'readyVote': {
        if (s.phase !== 'day') break;
        if (!s.dayReady.includes(player.id)) s.dayReady.push(player.id);
        if (s.players.filter(p => p.connected).every(p => s.dayReady.includes(p.id))) this.startVoting();
        else this.broadcast();
        break;
      }
      case 'steal': doSteal(s, player); this.broadcast(); break;
      case 'inspect': if (msg.targetId) doInspect(s, player, msg.targetId); this.broadcast(); break;
      case 'chat': {
        if (s.phase !== 'day') return;
        const now = Date.now();
        if (now - (this.lastChat.get(player.id) ?? 0) < 400) return;
        this.lastChat.set(player.id, now);
        const text = String(msg.text ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
        if (text) { s.chat.push({ fromId: player.id, fromName: player.name, text, ts: now }); this.broadcast(); }
        break;
      }
      case 'toVoting': if (player.isHost && s.phase === 'day') this.startVoting(); break;
      case 'vote':
        if (castVote(s, player, msg.targetId)) {
          this.broadcast();
          if (s.players.every(p => !p.connected || p.hasVoted)) this.finishVoting();
        }
        break;
      case 'playAgain':
        if (player.isHost && s.phase === 'results') {
          s.round++; s.phase = 'lobby';
          s.players.forEach(p => { p.role = undefined; p.dice = undefined; p.vote = null; p.hasVoted = false; p.inspectedDice = null; });
          this.broadcast();
        }
        break;
    }
  }
  disconnect(playerId: string) {
    const s = this.state; const p = s.players.find(x => x.id === playerId); if (!p) return;
    p.connected = false;
    if (s.phase === 'lobby' || s.phase === 'results') {
      s.players = s.players.filter(x => x.id !== playerId);
      if (s.players.length && !s.players.some(x => x.isHost)) s.players[0].isHost = true;
    } else if (p.isHost) {
      const next = s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    if (s.phase === 'voting' && s.players.filter(x => x.connected).every(x => x.hasVoted) && s.players.some(x => x.connected)) this.finishVoting();
    else this.broadcast();
  }
}

/* ---------------- PeerJS transport ---------------- */
export function createPeerNet(h: Handlers): Net {
  let peer: Peer | null = null;
  let hostConn: DataConnection | null = null;
  let engine: HostEngine | null = null;
  let myId = getClientId();
  let myName = 'Mouse';
  let isHost = false;
  let roomCode = '';

  const sendToPlayer = (pid: string, payload: unknown) => {
    if (engine) {
      if (pid === myId) { handleHostMsg(payload); return; }
      engine.conns.get(pid)?.send(payload);
    }
  };
  function handleHostMsg(m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state') h.onState(m.data);
    else if (m.type === 'private') h.onPrivate(m.data);
    else if (m.type === 'joined') h.onJoined(m.code, m.playerId, m.isHost);
    else if (m.type === 'error') h.onError(m.msg);
    else if (m.type === 'hostGone') h.onError('The host left — the room has closed. 🏠');
  }
  function wireHostConn(conn: DataConnection) {
    conn.on('data', (raw: any) => {
      if (!engine) return;
      if (raw?.type === 'join') {
        const pid = String(raw.clientId);
        if (engine.state.phase !== 'lobby' && !engine.state.players.some(p => p.id === pid)) {
          conn.send({ type: 'error', msg: 'Game already started — you cannot join now.' }); return;
        }
        if (!engine.state.players.some(p => p.id === pid) && engine.state.players.length >= MAX_PLAYERS) {
          conn.send({ type: 'error', msg: 'Room is full (8 players).' }); return;
        }
        engine.conns.set(pid, conn);
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
      for (const [pid, c] of engine.conns) if (c === conn) { engine.conns.delete(pid); engine.disconnect(pid); }
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
      myName = cleanName(name); isHost = true;
      roomCode = makeRoomCode();
      h.onStatus('Creating room…');
      peer = new Peer(PEER_PREFIX + roomCode, PEER_OPTS);
      peer.on('open', () => {
        engine = new HostEngine(roomCode,
          (pid, _s, priv) => sendToPlayer(pid, { type: 'private', data: priv }),
          (pub) => { h.onState(pub); for (const pid of engine!.conns.keys()) engine!.conns.get(pid)?.send({ type: 'state', data: pub }); },
          (pid) => { const p = engine!.state.players.find(x => x.id === pid); return p ? privateState(engine!.state, p) : null; });
        engine.addPlayer(myId, myName, true);
        h.onJoined(roomCode, myId, true);
        engine.broadcast();
      });
      peer.on('connection', wireHostConn);
      peer.on('error', (e: any) => {
        if (e?.type === 'unavailable-id') { roomCode = makeRoomCode(); peer?.destroy(); this.createRoom(name); }
        else h.onError('Connection error: ' + (e?.type || 'unknown'));
      });
    },
    joinRoom(code: string, name: string) {
      myName = cleanName(name); isHost = false;
      roomCode = code.toUpperCase().trim();
      h.onStatus('Connecting to room ' + roomCode + '…');
      peer = new Peer(PEER_OPTS);
      // Never hang on "Connecting…" forever: if the data channel has not
      // opened in 30s, surface a real error instead.
      const joinTimer = setTimeout(() => {
        if (!hostConn?.open) h.onError('Could not open a connection to the host (network blocked WebRTC). Check your network/VPN and try again.');
      }, 30000);
      peer.on('open', () => {
        hostConn = peer!.connect(PEER_PREFIX + roomCode, { reliable: true });
        hostConn.on('open', () => { clearTimeout(joinTimer); hostConn!.send({ type: 'join', clientId: myId, name: myName }); });
        hostConn.on('data', handleHostMsg);
        hostConn.on('close', () => h.onError('Disconnected from the host. Try rejoining with the same room code.'));
      });
      peer.on('error', (e: any) => {
        if (e?.type === 'peer-unavailable') h.onError('Room not found. Check the code and make sure the host is still online.');
        else h.onError('Connection error: ' + (e?.type || 'unknown'));
      });
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
    leave() {
      if (engine) for (const c of engine.conns.values()) { try { c.send({ type: 'hostGone' }); } catch { /* noop */ } }
      try { hostConn?.close(); peer?.destroy(); } catch { /* noop */ }
      engine = null; hostConn = null; peer = null;
    },
  };
}

/* ---------------- Socket.IO transport ---------------- */
export function createSocketNet(serverUrl: string, h: Handlers): Net {
  const socket: Socket = io(serverUrl, { transports: ['websocket', 'polling'] });
  let myId = getClientId();
  socket.on('state', (s: Pub) => h.onState(s));
  socket.on('private', (p: Priv) => h.onPrivate(p));
  socket.on('errorMsg', (m: string) => h.onError(m));
  socket.on('connect_error', () => h.onError('Cannot reach the game server.'));
  return {
    createRoom(name: string) {
      socket.emit('createRoom', { name: cleanName(name), clientId: myId }, (r: any) =>
        r?.ok ? h.onJoined(r.code, r.playerId, true) : h.onError(r?.error || 'Failed'));
    },
    joinRoom(code: string, name: string) {
      socket.emit('joinRoom', { code, name: cleanName(name), clientId: myId }, (r: any) =>
        r?.ok ? h.onJoined(r.code, r.playerId, false) : h.onError(r?.error || 'Failed'));
    },
    startGame: () => socket.emit('startGame'),
    beginNight: () => socket.emit('beginNight'),
    ready: () => socket.emit('ready'),
    readyVote: () => socket.emit('readyVote'),
    nightAction: (kind, targetId) => socket.emit('nightAction', { kind, targetId }),
    chat: (text) => socket.emit('chat', { text }),
    toVoting: () => socket.emit('toVoting'),
    vote: (targetId) => socket.emit('vote', { targetId }),
    playAgain: () => socket.emit('playAgain'),
    leave() { socket.disconnect(); },
  };
}

export function createNet(h: Handlers): Net {
  const server = new URLSearchParams(location.search).get('server');
  return server ? createSocketNet(server, h) : createPeerNet(h);
}
