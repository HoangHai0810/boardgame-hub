// Cheese Thief — server-authoritative Socket.IO server.
// All roles/dice/actions/votes are decided and validated here.
// Private data is emitted ONLY to the owning socket (socket.emit), never broadcast.
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import {
  GameState, Player, createGame, assignRolesAndDice, publicState, privateState,
  doSteal, doInspect, castVote, resolveVotes, canSteal, thiefOf,
  autoInspectIdle, applyDefaultVotes,
  chooseFollower, autoResolveFollowerChoice, recruitCount, followers, recordHour,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, RECRUIT_MS, DISCUSSION_MS, VOTE_MS,
} from '../../games/cheese-thief/logic.js';
import { makeRoomCode } from '../../games/room.js';

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

// Platform rule: one server can host many games; a room is (game, code).
// The engine for each game lives in games/<id>/ — only cheese-thief has
// one today, so the registry is a single-entry set until the next game lands.
const GAME_IDS = new Set(['cheese-thief']);
const AVATAR_IDS = new Set(['cat-orange', 'cat-grey', 'mouse', 'fox', 'wolf', 'bear', 'rabbit', 'panda', 'frog', 'owl', 'pig', 'dog']);
function cleanAvatar(a: unknown): string | undefined {
  return typeof a === 'string' && AVATAR_IDS.has(a) ? a : undefined;
}
const roomKey = (game: string, code: string) => `${game}:${code}`;
interface Room { game: string; state: GameState; timers: NodeJS.Timeout[]; sockets: Map<string, string>; /* playerId -> socketId */ }
const rooms = new Map<string, Room>();

function clearTimers(room: Room) { room.timers.forEach(clearTimeout); room.timers = []; }
function later(room: Room, ms: number, fn: () => void) { room.timers.push(setTimeout(fn, ms)); }

function broadcast(room: Room) {
  io.to(roomKey(room.game, room.state.roomCode)).emit('state', publicState(room.state));
  // private snapshots, point-to-point
  for (const p of room.state.players) {
    const sid = room.sockets.get(p.id);
    if (sid) io.to(sid).emit('private', privateState(room.state, p));
  }
}

function startDay(room: Room) {
  const s = room.state;
  s.phase = 'day';
  s.dayReady = [];
  s.discussionEndsAt = Date.now() + s.discussionMs;
  broadcast(room);
  later(room, s.discussionMs, () => { if (s.phase === 'day') startVoting(room); });
}

function startRecruit(room: Room) {
  const s = room.state;
  s.phase = 'recruit';
  s.recruitEndsAt = Date.now() + RECRUIT;
  broadcast(room);
  later(room, RECRUIT, () => {
    if (s.phase !== 'recruit') return;
    autoResolveFollowerChoice(s); // thief idled: random recruits
    startDay(room);
  });
}

function startNight(room: Room) {
  const s = room.state;
  s.phase = 'night';
  const stepHour = (h: number) => {
    if (s.phase !== 'night') return;
    // Previous hour ended: defaults for forgotten actions (random peek for an
    // idle lone waker; resolve an unmade 5p witness choice for the thief).
    autoInspectIdle(s);
    autoResolveFollowerChoice(s);
    if (h > 6) { // dawn — via the recruit phase first at 6–8 players
      if (recruitCount(s) > 0) startRecruit(room);
      else startDay(room);
      return;
    }
    s.currentHour = h;
    s.hourEndsAt = Date.now() + HOUR;
    recordHour(s);
    s.players.forEach(p => { p.hasActedThisHour = false; });
    // Stealing is automatic: the Cheese Mouse always takes the cheese when
    // their hour comes — no button to forget.
    const thief = thiefOf(s);
    if (thief && canSteal(s, thief)) doSteal(s, thief);
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
  // Anyone who forgot to vote gets a default (random) vote — no silent abstains.
  applyDefaultVotes(room.state);
  resolveVotes(room.state);
  broadcast(room);
}

function startRound(room: Room) {
  const s = room.state;
  clearTimers(room);
  assignRolesAndDice(s);
  s.phase = 'roleReveal';
  broadcast(room);
  // Night normally starts when EVERY player pressed "I'm ready" on their role
  // card (or host forces beginNight); this is only a long fallback.
  later(room, Number(process.env.CT_REVEAL_MS || 45000), () => { if (s.phase === 'roleReveal') startNight(room); });
}

const lastChat = new Map<string, number>();
function cleanName(n: unknown): string {
  return String(n ?? 'Mouse').replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
}

io.on('connection', (socket: Socket) => {
  let room: Room | null = null;
  let player: Player | null = null;

  socket.on('createRoom', ({ game, name, clientId, avatar }: { game: string; name: string; clientId: string; avatar?: string }, cb: (r: unknown) => void) => {
    const g = String(game || 'cheese-thief');
    if (!GAME_IDS.has(g)) return cb?.({ ok: false, error: 'GAME_NOT_SUPPORTED' });
    let code = makeRoomCode();
    while (rooms.has(roomKey(g, code))) code = makeRoomCode();
    const state = createGame(code);
    state.discussionMs = DISC; // env override (tests) seeds the room option
    room = { game: g, state, timers: [], sockets: new Map() };
    rooms.set(roomKey(g, code), room);
    player = { id: String(clientId), name: cleanName(name), isHost: true, connected: true, avatar: cleanAvatar(avatar), hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0 };
    state.players.push(player);
    room.sockets.set(player.id, socket.id);
    socket.join(roomKey(g, code));
    cb?.({ ok: true, code, playerId: player.id });
    broadcast(room);
  });

  socket.on('joinRoom', ({ game, code, name, clientId, avatar }: { game: string; code: string; name: string; clientId: string; avatar?: string }, cb: (r: unknown) => void) => {
    const r = rooms.get(roomKey(String(game || 'cheese-thief'), String(code || '').toUpperCase().trim()));
    if (!r) return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
    room = r;
    const existing = r.state.players.find(p => p.id === String(clientId));
    if (existing) { // reconnection / session recovery
      player = existing; player.connected = true; if (cleanAvatar(avatar)) player.avatar = cleanAvatar(avatar);
      r.sockets.set(player.id, socket.id);
      socket.join(roomKey(r.game, r.state.roomCode));
      cb?.({ ok: true, code: r.state.roomCode, playerId: player.id, rejoined: true });
      broadcast(r); return;
    }
    if (r.state.phase !== 'lobby') return cb?.({ ok: false, error: 'GAME_STARTED' });
    if (r.state.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'ROOM_FULL' });
    player = { id: String(clientId), name: cleanName(name), isHost: false, connected: true, avatar: cleanAvatar(avatar), hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0 };
    r.state.players.push(player);
    r.sockets.set(player.id, socket.id);
    socket.join(roomKey(r.game, r.state.roomCode));
    cb?.({ ok: true, code: r.state.roomCode, playerId: player.id });
    broadcast(r);
  });

  const guard = () => room !== null && player !== null;

  socket.on('kick', ({ targetId }: { targetId: string }) => {
    // Host-only, lobby-only (mirrors the browser host engine). Mid-game
    // removal belongs to the vote.
    if (!guard() || !player!.isHost) return;
    const s = room!.state;
    if (s.phase !== 'lobby' || !targetId || targetId === player!.id) return;
    const target = s.players.find(p => p.id === targetId);
    if (!target || target.isHost) return;
    s.players = s.players.filter(p => p.id !== targetId);
    const sid = room!.sockets.get(targetId); // playerId -> socketId
    room!.sockets.delete(targetId);
    if (sid) {
      io.to(sid).emit('errorMsg', 'KICKED');
      // Drop the kicked socket shortly after so its handlers can't act as a
      // ghost player; the delay lets the KICKED message flush first.
      setTimeout(() => io.sockets.sockets.get(sid)?.disconnect(true), 250);
    }
    broadcast(room!);
  });

  socket.on('setDiscussion', ({ ms }: { ms: number }) => {
    // Room option (Cycle 6): host-only, lobby-only, fixed choices.
    if (!guard() || !player!.isHost) return;
    const s = room!.state;
    if (s.phase !== 'lobby' || ![60000, 120000, 180000].includes(ms)) return;
    s.discussionMs = ms;
    broadcast(room!);
  });

  socket.on('startGame', () => {
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase !== 'lobby' && room!.state.phase !== 'results') return;
    if (room!.state.players.filter(p => p.connected).length < MIN_PLAYERS) {
      socket.emit('errorMsg', 'NEED_MORE_PLAYERS');
      return;
    }
    if (room!.state.phase === 'results') room!.state.round++;
    startRound(room!);
  });

  socket.on('beginNight', () => { // host may skip the reveal wait
    if (!guard() || !player!.isHost) return;
    if (room!.state.phase === 'roleReveal') { clearTimers(room!); startNight(room!); }
  });

  socket.on('ready', () => { // player confirmed their role card
    if (!guard()) return;
    const s = room!.state;
    if (s.phase !== 'roleReveal') return;
    if (!s.revealReady.includes(player!.id)) s.revealReady.push(player!.id);
    if (s.players.filter(p => p.connected).every(p => s.revealReady.includes(p.id))) {
      clearTimers(room!); startNight(room!);
    } else broadcast(room!);
  });

  socket.on('readyVote', () => { // player votes to end discussion now
    if (!guard()) return;
    const s = room!.state;
    if (s.phase !== 'day') return;
    if (!s.dayReady.includes(player!.id)) s.dayReady.push(player!.id);
    if (s.players.filter(p => p.connected).every(p => s.dayReady.includes(p.id))) startVoting(room!);
    else broadcast(room!);
  });

  socket.on('nightAction', ({ kind, targetId, ...extra }: { kind: string; targetId?: string; [k: string]: unknown }) => {
    if (!guard()) return;
    if (kind === 'steal') doSteal(room!.state, player!);
    else if (kind === 'inspect' && targetId) doInspect(room!.state, player!, targetId);
    else if (kind === 'chooseFollower' && targetId) {
      const s = room!.state;
      if (chooseFollower(s, player!, targetId) && s.phase === 'recruit' && followers(s).length >= recruitCount(s)) {
        clearTimers(room!); startDay(room!); return;
      }
    }
    broadcast(room!); // public state contains no trace of who acted
  });

  socket.on('chat', ({ text }: { text: string }) => {
    if (!guard() || room!.state.phase === 'voting' || room!.state.phase === 'roleReveal') return;
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
    room!.state.players.forEach(p => { p.role = undefined; p.dice = undefined; p.isFollower = false; p.vote = null; p.hasVoted = false; p.inspectedDice = null; p.peeks = []; });
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
      clearTimers(room); rooms.delete(roomKey(room.game, s.roomCode)); return;
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

// Test hooks: allow fast timers via env (production defaults come from the game's logic).
const HOUR = Number(process.env.CT_HOUR_MS || HOUR_MS);
const RECRUIT = Number(process.env.CT_RECRUIT_MS || RECRUIT_MS);
const DISC = Number(process.env.CT_DISCUSSION_MS || DISCUSSION_MS);
const VOTE = Number(process.env.CT_VOTE_MS || VOTE_MS);
const PORT = Number(process.env.PORT || 3001);
http.listen(PORT, () => console.log(`Cheese Thief server on :${PORT}`));
