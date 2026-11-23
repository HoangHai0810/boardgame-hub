// Cheese Thief — server-authoritative Socket.IO server.
// All roles/dice/actions/votes are decided and validated here.
// Private data is emitted ONLY to the owning socket (socket.emit), never broadcast.
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import {
  GameState, Player, createGame, assignRolesAndDice, publicState, privateState,
  doSteal, doInspect, castVote, resolveVotes, makeRoomCode,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, DISCUSSION_MS, VOTE_MS,
} from '../../shared/logic.js';

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

interface Room { state: GameState; timers: NodeJS.Timeout[]; sockets: Map<string, string>; /* playerId -> socketId */ }
const rooms = new Map<string, Room>();

function clearTimers(room: Room) { room.timers.forEach(clearTimeout); room.timers = []; }
function later(room: Room, ms: number, fn: () => void) { room.timers.push(setTimeout(fn, ms)); }

function broadcast(room: Room) {
  io.to(room.state.roomCode).emit('state', publicState(room.state));
  // private snapshots, point-to-point
  for (const p of room.state.players) {
    const sid = room.sockets.get(p.id);
    if (sid) io.to(sid).emit('private', privateState(room.state, p));
  }
}

function startNight(room: Room) {
  const s = room.state;
  s.phase = 'night';
  const stepHour = (h: number) => {
    if (s.phase !== 'night') return;
    if (h > 6) { // dawn
      s.phase = 'day';
      s.discussionEndsAt = Date.now() + DISC;
      broadcast(room);
      later(room, DISC, () => { if (s.phase === 'day') startVoting(room); });
      return;
    }
    s.currentHour = h;
    s.hourEndsAt = Date.now() + HOUR;
    s.players.forEach(p => { p.hasActedThisHour = false; });
    broadcast(room);
    later(room, HOUR, () => stepHour(h + 1));
  };
  stepHour(1);
}

function startVoting(room: Room) {
  const s = room.state;
  clearTimers(room);
  s.phase = 'voting';
  s.voteEndsAt = Date.now() + VOTE;
  broadcast(room);
  later(room, VOTE, () => { if (s.phase === 'voting') finishVoting(room); });
}

function finishVoting(room: Room) {
  clearTimers(room);
  resolveVotes(room.state);
  broadcast(room);
}

function startRound(room: Room) {
  const s = room.state;
  clearTimers(room);
  assignRolesAndDice(s);
  s.phase = 'roleReveal';
  broadcast(room);
  later(room, Number(process.env.CT_REVEAL_MS || 6000), () => { if (s.phase === 'roleReveal') startNight(room); });
}

const lastChat = new Map<string, number>();
function cleanName(n: unknown): string {
  return String(n ?? 'Mouse').replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
}

io.on('connection', (socket: Socket) => {
  let room: Room | null = null;
  let player: Player | null = null;

  socket.on('createRoom', ({ name, clientId }: { name: string; clientId: string }, cb: (r: unknown) => void) => {
    let code = makeRoomCode();
    while (rooms.has(code)) code = makeRoomCode();
    const state = createGame(code);
    room = { state, timers: [], sockets: new Map() };
    rooms.set(code, room);
    player = { id: String(clientId), name: cleanName(name), isHost: true, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null };
    state.players.push(player);
    room.sockets.set(player.id, socket.id);
    socket.join(code);
    cb?.({ ok: true, code, playerId: player.id });
    broadcast(room);
  });

  socket.on('joinRoom', ({ code, name, clientId }: { code: string; name: string; clientId: string }, cb: (r: unknown) => void) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return cb?.({ ok: false, error: 'Room not found' });
    room = r;
    const existing = r.state.players.find(p => p.id === String(clientId));
    if (existing) { // reconnection / session recovery
      player = existing; player.connected = true;
      r.sockets.set(player.id, socket.id);
      socket.join(r.state.roomCode);
      cb?.({ ok: true, code: r.state.roomCode, playerId: player.id, rejoined: true });
      broadcast(r); return;
    }
    if (r.state.phase !== 'lobby') return cb?.({ ok: false, error: 'Game already started' });
    if (r.state.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Room is full (8)' });
    player = { id: String(clientId), name: cleanName(name), isHost: false, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null };
    r.state.players.push(player);
    r.sockets.set(player.id, socket.id);
    socket.join(r.state.roomCode);
    cb?.({ ok: true, code: r.state.roomCode, playerId: player.id });
    broadcast(r);
  });

  const guard = () => room !== null && player !== null;

  socket.on('startGame', () => {
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase !== 'lobby' && room!.state.phase !== 'results') return;
    if (room!.state.players.filter(p => p.connected).length < MIN_PLAYERS) {
      socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players`);
      return;
    }
    if (room!.state.phase === 'results') room!.state.round++;
    startRound(room!);
  });

  socket.on('beginNight', () => { // host may skip the reveal wait
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase === 'roleReveal') { clearTimers(room!); startNight(room!); }
  });

  socket.on('nightAction', ({ kind, targetId }: { kind: string; targetId?: string }) => {
    if (!guard()) return;
    if (kind === 'steal') doSteal(room!.state, player!);
    else if (kind === 'inspect' && targetId) doInspect(room!.state, player!, targetId);
    broadcast(room!); // public state contains no trace of who acted
  });

  socket.on('chat', ({ text }: { text: string }) => {
    if (!guard() || room!.state.phase !== 'day') return;
    const now = Date.now();
    if (now - (lastChat.get(player!.id) ?? 0) < 400) return; // spam guard
    lastChat.set(player!.id, now);
    const clean = String(text ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
    if (!clean) return;
    room!.state.chat.push({ fromId: player!.id, fromName: player!.name, text: clean, ts: now });
    broadcast(room!);
  });

  socket.on('toVoting', () => { // host can end discussion early
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase === 'day') startVoting(room!);
  });

  socket.on('vote', ({ targetId }: { targetId: string }) => {
    if (!guard()) return;
    if (castVote(room!.state, player!, targetId)) {
      broadcast(room!);
      if (room!.state.players.every(p => !p.connected || p.hasVoted)) finishVoting(room!);
    }
  });

  socket.on('playAgain', () => {
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase !== 'results') return;
    room!.state.round++;
    room!.state.phase = 'lobby';
    room!.state.players.forEach(p => { p.role = undefined; p.dice = undefined; p.vote = null; p.hasVoted = false; p.inspectedDice = null; });
    broadcast(room!);
  });

  socket.on('disconnect', () => {
    if (!room || !player) return;
    player.connected = false;
    const s = room.state;
    if (s.phase === 'lobby' || s.phase === 'results') {
      s.players = s.players.filter(p => p.id !== player!.id);
      if (s.players.length && !s.players.some(p => p.isHost)) s.players[0].isHost = true;
    } else if (player.isHost) {
      const next = s.players.find(p => p.connected && p.id !== player!.id);
      if (next) { s.players.forEach(p => { p.isHost = p.id === next.id; }); }
    }
    if (s.players.every(p => !p.connected)) {
      clearTimers(room); rooms.delete(s.roomCode); return;
    }
    // If everyone still in the game has voted, finish even with a disconnected player pending.
    if (s.phase === 'voting' && s.players.filter(p => p.connected).every(p => p.hasVoted)) finishVoting(room);
    else broadcast(room);
  });
});

// Abandoned-room cleanup sweep
setInterval(() => {
  for (const [code, r] of rooms) if (r.state.players.every(p => !p.connected)) { clearTimers(r); rooms.delete(code); }
}, 60000);

// Test hooks: allow fast timers via env (production defaults come from shared/logic).
const HOUR = Number(process.env.CT_HOUR_MS || HOUR_MS);
const DISC = Number(process.env.CT_DISCUSSION_MS || DISCUSSION_MS);
const VOTE = Number(process.env.CT_VOTE_MS || VOTE_MS);
const PORT = Number(process.env.PORT || 3001);
http.listen(PORT, () => console.log(`Cheese Thief server on :${PORT}`));
