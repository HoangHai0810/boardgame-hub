// Shared authoritative game logic — used by the Socket.IO server AND by the
// host peer in the PeerJS public deployment (host acts as the server).
// No secret info is ever placed in public state built by publicState().

export type Role = 'thief' | 'sleepyhead' | 'fallmouse';
/** Villager-side roles: the Fall Mouse plays exactly like a Sleepyhead at night. */
export const isVillager = (p: Player) => p.role === 'sleepyhead' || p.role === 'fallmouse';
export type Phase = 'lobby' | 'roleReveal' | 'night' | 'recruit' | 'day' | 'voting' | 'results';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  role?: Role;
  dice?: number;
  isFollower?: boolean; // switched sides to the thief's team (5–8 player games)
  hasActedThisHour: boolean;
  inspectedDice?: { targetId: string; dice: number } | null; // private, never public
  vote?: string | null; // private until results
  hasVoted: boolean;
  wins: number; // session scoreboard: rounds won in this room (public, not a secret)
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
  winner: 'sleepyheads' | 'thief' | 'fallmouse' | null;
  thiefId: string | null; // set only at results
  round: number;
  revealReady: string[]; // playerIds who confirmed their role card
  dayReady: string[]; // playerIds who voted to end discussion early
  // Follower mechanics (official rules, 5–8 players)
  stolenWitnessIds: string[]; // sleepyheads awake at the hour the cheese was stolen
  pendingFollowerChoice: string[] | null; // 5p: witness ids the thief must pick one from, this hour
  recruitEndsAt: number | null;
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const HOUR_MS = 12000;
export const RECRUIT_MS = 20000;
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
    discussionEndsAt: null, voteEndsAt: null, hourEndsAt: null, recruitEndsAt: null,
    winner: null, thiefId: null, round: 1, revealReady: [], dayReady: [],
    stolenWitnessIds: [], pendingFollowerChoice: null,
  };
}

export function assignRolesAndDice(state: GameState, rng: () => number = Math.random): void {
  const idx = Math.floor(rng() * state.players.length);
  // Fall Mouse (Chuột Chết) — official variant for 6–8 players: one villager
  // card is secretly the Fall Mouse, who wins ALONE by getting the most votes.
  let fallIdx = -1;
  if (state.players.length >= 6) {
    do { fallIdx = Math.floor(rng() * state.players.length); } while (fallIdx === idx);
  }
  state.players.forEach((p, i) => {
    p.role = i === idx ? 'thief' : i === fallIdx ? 'fallmouse' : 'sleepyhead';
    p.dice = 1 + Math.floor(rng() * 6);
    p.isFollower = false;
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
  // Chat is a room conversation: lobby chat is NOT wiped when the game
  // starts (publicState caps it at the last 100 messages).
  state.revealReady = [];
  state.dayReady = [];
  state.stolenWitnessIds = [];
  state.pendingFollowerChoice = null;
  state.recruitEndsAt = null;
}

/** Followers the thief recruits AFTER hour 6 (official rules): 6p → 1, 7–8p → 2.
 *  5p uses the witness mechanism instead; 4p has no followers. */
export function recruitCount(state: GameState): number {
  const n = state.players.length;
  if (n >= 7) return 2;
  if (n === 6) return 1;
  return 0;
}
export const followers = (state: GameState) => state.players.filter(p => p.isFollower);
export const thiefOf = (state: GameState) => state.players.find(p => p.role === 'thief');

/** The thief picks a follower: either resolving the 5p witness choice during
 *  the night hour, or recruiting during the post-night 'recruit' phase. */
export function chooseFollower(state: GameState, thief: Player, targetId: string): boolean {
  if (thief.role !== 'thief') return false;
  const target = state.players.find(p => p.id === targetId);
  if (!target || !isVillager(target) || target.isFollower) return false;
  if (state.phase === 'night' && state.pendingFollowerChoice) {
    if (!state.pendingFollowerChoice.includes(targetId)) return false;
    target.isFollower = true;
    state.pendingFollowerChoice = null;
    return true;
  }
  if (state.phase === 'recruit') {
    if (followers(state).length >= recruitCount(state)) return false;
    target.isFollower = true;
    return true;
  }
  return false;
}

/** If the thief never picks (hour/phase timer ran out), pick at random from
 *  the valid candidates so the game never stalls. */
export function autoResolveFollowerChoice(state: GameState, rng: () => number = Math.random): void {
  const thief = thiefOf(state); if (!thief) return;
  if (state.phase === 'night' && state.pendingFollowerChoice?.length) {
    const ids = state.pendingFollowerChoice;
    chooseFollower(state, thief, ids[Math.floor(rng() * ids.length)]);
  }
  if (state.phase === 'recruit') {
    let need = recruitCount(state) - followers(state).length;
    const pool = state.players.filter(p => isVillager(p) && !p.isFollower);
    while (need-- > 0 && pool.length) {
      const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      chooseFollower(state, thief, t.id);
    }
  }
}

/** What a follower (or the thief, or a 5p witness) is entitled to know.
 *  Official information rules:
 *   - the thief always knows their followers;
 *   - 5p: the follower saw the theft → knows the thief; fellow witnesses of
 *     the steal know who the follower is;
 *   - 6p: follower and thief know each other;
 *   - 7p: the 2 followers know EACH OTHER but NOT the thief;
 *   - 8p: thief and both followers all know each other. */
export function followerKnowledge(state: GameState, player: Player): { knownThiefId: string | null; knownFollowerIds: string[] } {
  const n = state.players.length;
  const thief = thiefOf(state);
  const fols = followers(state);
  let knownThiefId: string | null = null;
  let knownFollowerIds: string[] = [];
  if (!thief || fols.length === 0) return { knownThiefId, knownFollowerIds };
  if (player.role === 'thief') {
    knownFollowerIds = fols.map(f => f.id);
  } else if (player.isFollower) {
    if (n === 7) knownFollowerIds = fols.filter(f => f.id !== player.id).map(f => f.id);
    else { knownThiefId = thief.id; knownFollowerIds = fols.filter(f => f.id !== player.id).map(f => f.id); }
  } else if (n === 5 && state.stolenWitnessIds.includes(player.id)) {
    knownFollowerIds = fols.map(f => f.id);
  }
  return { knownThiefId, knownFollowerIds };
}

/** Players (any role) whose dice equals the current hour. */
export function wakers(state: GameState, hour = state.currentHour): Player[] {
  return state.players.filter(p => p.dice === hour);
}

/** A sleepyhead may inspect iff they are the ONLY waker at this hour. */
export function canInspect(state: GameState, player: Player): boolean {
  if (state.phase !== 'night' || !isVillager(player)) return false;
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
  // 5-player witness rule: sleepyheads awake at this hour SEE the theft.
  // Exactly one witness → they become a Follower on the spot. More than one →
  // the thief must choose one of them before the hour ends.
  state.stolenWitnessIds = wakers(state).filter(p => isVillager(p)).map(p => p.id);
  if (state.players.length === 5 && followers(state).length === 0) {
    if (state.stolenWitnessIds.length === 1) {
      const w = state.players.find(p => p.id === state.stolenWitnessIds[0])!;
      w.isFollower = true;
    } else if (state.stolenWitnessIds.length > 1) {
      state.pendingFollowerChoice = [...state.stolenWitnessIds];
    }
  }
  return true;
}

/** Candidate ids the thief may pick a follower from RIGHT NOW (else null). */
export function followerCandidates(state: GameState, player: Player): string[] | null {
  if (player.role !== 'thief') return null;
  if (state.phase === 'night' && state.pendingFollowerChoice) return [...state.pendingFollowerChoice];
  if (state.phase === 'recruit' && followers(state).length < recruitCount(state)) {
    return state.players.filter(p => isVillager(p) && !p.isFollower).map(p => p.id);
  }
  return null;
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
  // Session scoreboard: score exactly once per round — a second call on an
  // already-resolved state returns the tally without re-scoring.
  const alreadyResolved = state.winner !== null;
  const score = (winners: Player[]) => {
    if (alreadyResolved) return;
    winners.forEach(p => { p.wins = (p.wins ?? 0) + 1; });
  };
  // Fall Mouse (official variant): if the Fall Mouse is among the top-voted,
  // they win ALONE — even as a Follower, even tied with the thief.
  const fall = state.players.find(p => p.role === 'fallmouse');
  if (fall && topIds.includes(fall.id)) {
    state.winner = 'fallmouse';
    state.thiefId = thief.id;
    state.phase = 'results';
    score([fall]);
    return { counts, topIds, caught: false };
  }
  // Tie rule (per task spec): tie involving the thief => thief caught.
  const caught = topIds.includes(thief.id);
  state.winner = caught ? 'sleepyheads' : 'thief';
  state.thiefId = thief.id;
  state.phase = 'results';
  score(caught
    ? state.players.filter(p => isVillager(p) && !p.isFollower)
    : state.players.filter(p => p.role === 'thief' || !!p.isFollower));
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
    recruitEndsAt: state.recruitEndsAt,
    winner: state.winner,
    revealReady: state.revealReady,
    dayReady: state.dayReady,
    players: state.players.map(p => ({
      id: p.id, name: p.name, isHost: p.isHost, connected: p.connected,
      hasVoted: p.hasVoted, wins: p.wins ?? 0,
      ...(inResults ? { role: p.role, dice: p.dice, vote: p.vote, isFollower: !!p.isFollower } : {}),
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
  const know = followerKnowledge(state, player);
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
    // Follower info — strictly per the official information rules.
    isFollower: !!player.isFollower,
    knownThiefId: know.knownThiefId,
    knownFollowerIds: know.knownFollowerIds,
    followerCandidates: followerCandidates(state, player),
    followersNeeded: recruitCount(state),
    followersChosen: followers(state).length,
  };
}
