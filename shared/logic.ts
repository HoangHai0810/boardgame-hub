// Shared authoritative game logic — used by the Socket.IO server AND by the
// host peer in the PeerJS public deployment (host acts as the server).
// No secret info is ever placed in public state built by publicState().

export type Role = 'thief' | 'sleepyhead';
export type Phase = 'lobby' | 'roleReveal' | 'night' | 'day' | 'voting' | 'results';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  role?: Role;
  dice?: number;
  hasActedThisHour: boolean;
  inspectedDice?: { targetId: string; dice: number } | null; // private, never public
  vote?: string | null; // private until results
  hasVoted: boolean;
}

export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number; }

export interface GameState {
  roomCode: string;
  phase: Phase;
  players: Player[];
  currentHour: number; // 0 = not started, 1..6
  cheeseStolen: boolean;
  cheeseStolenAtHour: number | null;
  chat: ChatMsg[];
  discussionEndsAt: number | null;
  voteEndsAt: number | null;
  hourEndsAt: number | null;
  winner: 'sleepyheads' | 'thief' | null;
  thiefId: string | null; // set only at results
  round: number;
  revealReady: string[]; // playerIds who confirmed their role card
  dayReady: string[]; // playerIds who voted to end discussion early
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const HOUR_MS = 12000;
export const DISCUSSION_MS = 120000;
export const VOTE_MS = 60000;

export function makeRoomCode(rng: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

export function createGame(roomCode: string): GameState {
  return {
    roomCode, phase: 'lobby', players: [], currentHour: 0,
    cheeseStolen: false, cheeseStolenAtHour: null, chat: [],
    discussionEndsAt: null, voteEndsAt: null, hourEndsAt: null,
    winner: null, thiefId: null, round: 1, revealReady: [], dayReady: [],
  };
}

export function assignRolesAndDice(state: GameState, rng: () => number = Math.random): void {
  const idx = Math.floor(rng() * state.players.length);
  state.players.forEach((p, i) => {
    p.role = i === idx ? 'thief' : 'sleepyhead';
    p.dice = 1 + Math.floor(rng() * 6);
    p.hasActedThisHour = false;
    p.inspectedDice = null;
    p.vote = null;
    p.hasVoted = false;
  });
  state.cheeseStolen = false;
  state.cheeseStolenAtHour = null;
  state.currentHour = 0;
  state.winner = null;
  state.thiefId = null;
  state.chat = [];
  state.revealReady = [];
  state.dayReady = [];
}

/** Players (any role) whose dice equals the current hour. */
export function wakers(state: GameState, hour = state.currentHour): Player[] {
  return state.players.filter(p => p.dice === hour);
}

/** A sleepyhead may inspect iff they are the ONLY waker at this hour. */
export function canInspect(state: GameState, player: Player): boolean {
  if (state.phase !== 'night' || player.role !== 'sleepyhead') return false;
  if (player.dice !== state.currentHour || player.hasActedThisHour) return false;
  return wakers(state).length === 1;
}

export function canSteal(state: GameState, player: Player): boolean {
  return state.phase === 'night' && player.role === 'thief'
    && player.dice === state.currentHour && !state.cheeseStolen;
}

export function doSteal(state: GameState, player: Player): boolean {
  if (!canSteal(state, player)) return false;
  state.cheeseStolen = true;
  state.cheeseStolenAtHour = state.currentHour;
  player.hasActedThisHour = true;
  return true;
}

export function doInspect(state: GameState, player: Player, targetId: string): number | null {
  if (!canInspect(state, player)) return null;
  const target = state.players.find(p => p.id === targetId);
  if (!target || target.id === player.id) return null;
  player.hasActedThisHour = true;
  player.inspectedDice = { targetId, dice: target.dice! };
  return target.dice!;
}

export function castVote(state: GameState, player: Player, targetId: string): boolean {
  if (state.phase !== 'voting' || player.hasVoted) return false;
  if (targetId === player.id) return false;
  if (!state.players.some(p => p.id === targetId)) return false;
  player.vote = targetId;
  player.hasVoted = true;
  return true;
}

export interface VoteTally { counts: Record<string, number>; topIds: string[]; caught: boolean; }

export function resolveVotes(state: GameState): VoteTally {
  const counts: Record<string, number> = {};
  state.players.forEach(p => { counts[p.id] = 0; });
  state.players.forEach(p => { if (p.vote) counts[p.vote] = (counts[p.vote] ?? 0) + 1; });
  const max = Math.max(0, ...Object.values(counts));
  const topIds = Object.keys(counts).filter(id => counts[id] === max && max > 0);
  const thief = state.players.find(p => p.role === 'thief')!;
  // Tie rule (per task spec): tie involving the thief => thief caught.
  const caught = topIds.includes(thief.id);
  state.winner = caught ? 'sleepyheads' : 'thief';
  state.thiefId = thief.id;
  state.phase = 'results';
  return { counts, topIds, caught };
}

/** Public snapshot — strips role/dice/vote/inspection secrets. */
export function publicState(state: GameState, forPlayerId?: string) {
  const inResults = state.phase === 'results';
  return {
    roomCode: state.roomCode,
    phase: state.phase,
    round: state.round,
    currentHour: state.currentHour,
    // During night, cheese presence is only revealed privately to a waker
    // (see privateState). Publicly we reveal it from day phase onward.
    cheeseStolen: state.phase === 'night' ? false : state.cheeseStolen,
    discussionEndsAt: state.discussionEndsAt,
    voteEndsAt: state.voteEndsAt,
    hourEndsAt: state.hourEndsAt,
    winner: state.winner,
    revealReady: state.revealReady,
    dayReady: state.dayReady,
    players: state.players.map(p => ({
      id: p.id, name: p.name, isHost: p.isHost, connected: p.connected,
      hasVoted: p.hasVoted,
      ...(inResults ? { role: p.role, dice: p.dice, vote: p.vote } : {}),
    })),
    chat: state.chat.slice(-100),
    voteCounts: inResults
      ? state.players.map(p => ({ id: p.id, count: state.players.filter(v => v.vote === p.id).length }))
      : undefined,
    thiefId: inResults ? state.thiefId : undefined,
  };
}

/** Private snapshot for one player only — sent point-to-point, never broadcast. */
export function privateState(state: GameState, player: Player) {
  const awake = state.phase === 'night' && player.dice === state.currentHour;
  return {
    role: player.role ?? null,
    dice: player.dice ?? null,
    awake,
    canSteal: canSteal(state, player),
    canInspect: canInspect(state, player),
    // A waker sees whether the cheese is already gone when they wake.
    cheesePresentWhenAwake: awake ? !state.cheeseStolen : null,
    fellowWakers: awake ? wakers(state).filter(p => p.id !== player.id).map(p => p.id) : [],
    inspected: player.inspectedDice ?? null,
    hasActedThisHour: player.hasActedThisHour,
    myVote: player.vote ?? null,
  };
}
