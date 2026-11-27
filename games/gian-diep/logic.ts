// Ai là Gián Điệp? (Spyfall) — rules engine. One source of truth for the
// game's rules, used by the browser host (client/src/games/gian-diep/
// hostEngine.ts). The dedicated Socket.IO server does NOT run this game
// yet (GAME_NOT_SUPPORTED); the public MQTT/PeerJS transports use the
// browser host engine.
//
// Rules (official Cryptozoic Spyfall rulebook, design note
// goals/cheese-thief-multiplayer-game/hidden_files/gian-diep-design.md):
// 3–8 players, one Spy per round; everyone else gets the same location
// card with a role. The dealer asks a named player a question; the
// answerer then asks someone else (never themself). Once per round each
// player may stop the clock and accuse someone: everyone except the
// accused votes, only a UNANIMOUS vote convicts. The spy may reveal and
// guess the location at any time except during a vote. Timer out: accuser
// turns rotate from the dealer; the first unanimous vote decides; nobody
// convicted → the spy wins. Scoring (official table): spy caught → each
// non-spy 1, the winning accuser 2; innocent convicted → spy 4; spy
// guesses right → spy 4; spy guesses wrong → locals 1 each; timeout with
// nobody convicted → spy 2. Next dealer = the previous spy.
export type Phase = 'lobby' | 'roleReveal' | 'questioning' | 'roundEnd' | 'results';
export type Winner = 'spy' | 'locals';
export type RoundReason = 'spy-caught' | 'innocent-convicted' | 'spy-guess-right' | 'spy-guess-wrong' | 'timeout-spy-wins';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const ROUND_MINUTES = [6, 8, 12] as const;
export const ROUNDS_OPTIONS = [3, 5, 7] as const;
/** Window for the current asker to pick a target, for an accusation
 *  vote, and for a timer-end accuser to pick a suspect. */
export const ASK_MS = 30000;
export const VOTE_MS = 30000;
/** The reveal card waits at most this long before the round starts
 *  anyway (the n−1 quorum below usually fires first). */
export const REVEAL_MS = 30000;

export interface LocName { vi: string; en: string }
export interface LocationDef { icon: string; name: LocName; roles: LocName[] }
export const LOCATIONS: LocationDef[] = [
  { icon: '🏖️', name: { vi: 'Bãi biển', en: 'Beach' }, roles: [
    { vi: 'Du khách', en: 'Tourist' }, { vi: 'Cứu hộ', en: 'Lifeguard' },
    { vi: 'Người bán dừa', en: 'Coconut seller' }, { vi: 'Thợ lặn', en: 'Diver' },
    { vi: 'Nhiếp ảnh gia', en: 'Photographer' }, { vi: 'Chủ quán bar biển', en: 'Beach bar owner' },
    { vi: 'Trẻ em chơi cát', en: 'Kid building sandcastles' } ] },
  { icon: '🏥', name: { vi: 'Bệnh viện', en: 'Hospital' }, roles: [
    { vi: 'Bác sĩ', en: 'Doctor' }, { vi: 'Y tá', en: 'Nurse' },
    { vi: 'Bệnh nhân', en: 'Patient' }, { vi: 'Dược sĩ', en: 'Pharmacist' },
    { vi: 'Bảo vệ', en: 'Security guard' }, { vi: 'Người nhà bệnh nhân', en: "Patient's family" },
    { vi: 'Lao công', en: 'Cleaner' } ] },
  { icon: '🏫', name: { vi: 'Trường học', en: 'School' }, roles: [
    { vi: 'Giáo viên', en: 'Teacher' }, { vi: 'Học sinh', en: 'Student' },
    { vi: 'Hiệu trưởng', en: 'Principal' }, { vi: 'Bảo vệ', en: 'Security guard' },
    { vi: 'Lao công', en: 'Cleaner' }, { vi: 'Phụ huynh', en: 'Parent' },
    { vi: 'Thủ thư', en: 'Librarian' } ] },
  { icon: '🍽️', name: { vi: 'Nhà hàng', en: 'Restaurant' }, roles: [
    { vi: 'Đầu bếp', en: 'Chef' }, { vi: 'Bồi bàn', en: 'Waiter' },
    { vi: 'Thực khách', en: 'Diner' }, { vi: 'Quản lý', en: 'Manager' },
    { vi: 'Thu ngân', en: 'Cashier' }, { vi: 'Người giao hàng', en: 'Delivery rider' },
    { vi: 'Rửa bát', en: 'Dishwasher' } ] },
  { icon: '✈️', name: { vi: 'Sân bay', en: 'Airport' }, roles: [
    { vi: 'Phi công', en: 'Pilot' }, { vi: 'Tiếp viên', en: 'Flight attendant' },
    { vi: 'Hành khách', en: 'Passenger' }, { vi: 'Nhân viên soi chiếu', en: 'Security screener' },
    { vi: 'Nhân viên mặt đất', en: 'Ground staff' }, { vi: 'Tài xế xe đẩy', en: 'Cart driver' },
    { vi: 'Người đón khách', en: 'Greeter' } ] },
  { icon: '🚆', name: { vi: 'Ga tàu', en: 'Train station' }, roles: [
    { vi: 'Lái tàu', en: 'Train driver' }, { vi: 'Nhân viên bán vé', en: 'Ticket seller' },
    { vi: 'Hành khách', en: 'Passenger' }, { vi: 'Nhân viên soát vé', en: 'Ticket inspector' },
    { vi: 'Người bán hàng rong', en: 'Street vendor' }, { vi: 'Bảo vệ', en: 'Security guard' },
    { vi: 'Lao công', en: 'Cleaner' } ] },
  { icon: '🎬', name: { vi: 'Rạp chiếu phim', en: 'Cinema' }, roles: [
    { vi: 'Khán giả', en: 'Moviegoer' }, { vi: 'Nhân viên bán vé', en: 'Ticket seller' },
    { vi: 'Nhân viên bán bỏng ngô', en: 'Popcorn seller' }, { vi: 'Người soát vé', en: 'Usher' },
    { vi: 'Quản lý rạp', en: 'Cinema manager' }, { vi: 'Lao công', en: 'Cleaner' },
    { vi: 'Diễn viên', en: 'Actor' } ] },
  { icon: '🌳', name: { vi: 'Công viên', en: 'Park' }, roles: [
    { vi: 'Người chạy bộ', en: 'Jogger' }, { vi: 'Người bán kem', en: 'Ice-cream seller' },
    { vi: 'Người làm vườn', en: 'Gardener' }, { vi: 'Trẻ em chơi đùa', en: 'Playing kid' },
    { vi: 'Người chụp ảnh', en: 'Photographer' }, { vi: 'Bảo vệ', en: 'Security guard' },
    { vi: 'Người câu cá', en: 'Angler' } ] },
  { icon: '🛒', name: { vi: 'Siêu thị', en: 'Supermarket' }, roles: [
    { vi: 'Khách mua hàng', en: 'Shopper' }, { vi: 'Thu ngân', en: 'Cashier' },
    { vi: 'Nhân viên kho', en: 'Warehouse staff' }, { vi: 'Bảo vệ', en: 'Security guard' },
    { vi: 'Quản lý', en: 'Manager' }, { vi: 'Người giao hàng', en: 'Delivery rider' },
    { vi: 'Lao công', en: 'Cleaner' } ] },
  { icon: '🏨', name: { vi: 'Khách sạn', en: 'Hotel' }, roles: [
    { vi: 'Lễ tân', en: 'Receptionist' }, { vi: 'Khách lưu trú', en: 'Guest' },
    { vi: 'Nhân viên dọn phòng', en: 'Housekeeper' }, { vi: 'Quản lý', en: 'Manager' },
    { vi: 'Đầu bếp', en: 'Chef' }, { vi: 'Bảo vệ', en: 'Security guard' },
    { vi: 'Người giao hành lý', en: 'Bellhop' } ] },
  { icon: '🏢', name: { vi: 'Văn phòng', en: 'Office' }, roles: [
    { vi: 'Giám đốc', en: 'Director' }, { vi: 'Nhân viên kế toán', en: 'Accountant' },
    { vi: 'Lập trình viên', en: 'Programmer' }, { vi: 'Lễ tân', en: 'Receptionist' },
    { vi: 'Lao công', en: 'Cleaner' }, { vi: 'Thực tập sinh', en: 'Intern' },
    { vi: 'Bảo vệ', en: 'Security guard' } ] },
  { icon: '🏋️', name: { vi: 'Phòng tập gym', en: 'Gym' }, roles: [
    { vi: 'Huấn luyện viên', en: 'Trainer' }, { vi: 'Hội viên', en: 'Member' },
    { vi: 'Lễ tân', en: 'Receptionist' }, { vi: 'Nhân viên dọn dẹp', en: 'Cleaner' },
    { vi: 'Quản lý', en: 'Manager' }, { vi: 'Người bán đồ uống', en: 'Drinks seller' },
    { vi: 'Bảo vệ', en: 'Security guard' } ] },
];

export interface Config { roundMinutes: 6 | 8 | 12; roundsTotal: 3 | 5 | 7; rolesOn: boolean; pointsOn: boolean }
export const DEFAULT_CONFIG: Config = { roundMinutes: 8, roundsTotal: 5, rolesOn: true, pointsOn: true };

export interface Player {
  id: string; name: string; avatar?: string; isHost: boolean; connected: boolean;
  score: number; roundWins: number;
}
export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }
export interface FeedEvent { ts: number; actorId: string; kind: string; targetId?: string; count?: number }
export interface Accusation { accuserId: string; suspectId: string; votes: Record<string, boolean>; endsAt: number }
export interface FinalVote { suspectId: string; votes: Record<string, boolean>; endsAt: number }
export interface RoundResult {
  winner: Winner; reason: RoundReason;
  spyId: string; locationIdx: number; accuserId?: string;
  points: Record<string, number>;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  round: number;
  config: Config;
  players: Player[];
  locationIdx: number | null;
  spyId: string | null;
  /** Role index into the location's roles, per local (spy has none). */
  roleIdx: Record<string, number>;
  dealerId: string | null;
  currentAskerId: string | null;
  askEndsAt: number | null;
  accusedOnce: string[];
  roundEndsAt: number | null;
  /** Remaining round time while the clock is paused for an accusation. */
  roundRemainingMs: number | null;
  accusation: Accusation | null;
  finalPhase: boolean;
  finalOrder: string[];
  finalIdx: number;
  finalPickEndsAt: number | null;
  finalVote: FinalVote | null;
  revealReady: string[];
  roundResult: RoundResult | null;
  chat: ChatMsg[];
  feed: FeedEvent[];
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', round: 1, config: { ...DEFAULT_CONFIG },
    players: [], locationIdx: null, spyId: null, roleIdx: {},
    dealerId: null, currentAskerId: null, askEndsAt: null,
    accusedOnce: [], roundEndsAt: null, roundRemainingMs: null,
    accusation: null, finalPhase: false, finalOrder: [], finalIdx: 0,
    finalPickEndsAt: null, finalVote: null, revealReady: [],
    roundResult: null, chat: [], feed: [],
  };
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);
export const connectedPlayers = (s: GameState): Player[] => s.players.filter(p => p.connected);

function feed(s: GameState, actorId: string, kind: string, targetId?: string, count?: number): void {
  s.feed.push({ ts: Date.now(), actorId, kind, targetId, count });
  if (s.feed.length > 30) s.feed = s.feed.slice(-30);
}

/** Deal a round: one random location (not the previous round's when the
 *  pool allows), one random spy, distinct roles for the locals. The
 *  dealer is the previous round's spy, or the host on round 1. */
export function dealRound(s: GameState, rng: () => number = Math.random): void {
  const pool = connectedPlayers(s);
  if (pool.length < MIN_PLAYERS) return;
  const prevLoc = s.locationIdx;
  let loc = Math.floor(rng() * LOCATIONS.length);
  if (LOCATIONS.length > 1 && loc === prevLoc) loc = (loc + 1) % LOCATIONS.length;
  s.locationIdx = loc;
  s.spyId = pool[Math.floor(rng() * pool.length)].id;
  const roleOrder = shuffle([0, 1, 2, 3, 4, 5, 6], rng);
  s.roleIdx = {};
  let ri = 0;
  for (const p of pool) {
    if (p.id === s.spyId) continue;
    s.roleIdx[p.id] = roleOrder[ri++ % roleOrder.length];
  }
  s.dealerId = s.dealerId && pool.some(p => p.id === s.dealerId) ? s.dealerId : pool[0].id;
  s.currentAskerId = s.dealerId;
  s.askEndsAt = null;
  s.accusedOnce = [];
  s.roundEndsAt = null;
  s.roundRemainingMs = null;
  s.accusation = null;
  s.finalPhase = false;
  s.finalOrder = [];
  s.finalIdx = 0;
  s.finalPickEndsAt = null;
  s.finalVote = null;
  s.revealReady = [];
  s.roundResult = null;
  s.phase = 'roleReveal';
  feed(s, s.dealerId, 'start');
}

/** The reveal card is done: the dealer asks first and the round clock
 *  starts now (reading time does not eat into the round). */
export function startQuestioning(s: GameState): void {
  if (s.phase !== 'roleReveal') return;
  s.phase = 'questioning';
  s.roundEndsAt = Date.now() + s.config.roundMinutes * 60000;
  s.askEndsAt = Date.now() + ASK_MS;
}

/** The current asker names the next player to question. The answerer
 *  becomes the next asker. */
export function askTarget(s: GameState, asker: Player, targetId: string): boolean {
  if (s.phase !== 'questioning' || s.finalPhase || s.accusation || s.finalVote) return false;
  if (s.currentAskerId !== asker.id || !asker.connected) return false;
  const target = byId(s, targetId);
  if (!target || target.id === asker.id || !target.connected) return false;
  s.currentAskerId = target.id;
  s.askEndsAt = Date.now() + ASK_MS;
  feed(s, asker.id, 'ask', target.id);
  return true;
}

/** A forgotten question gets a sensible default: a random other
 *  connected player is picked (the platform's rule — never a silent
 *  stall). */
export function autoAsk(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'questioning' || s.finalPhase || s.accusation || s.finalVote) return;
  const asker = byId(s, s.currentAskerId);
  if (!asker) return;
  const others = connectedPlayers(s).filter(p => p.id !== asker.id);
  if (!others.length) return;
  askTarget(s, asker, others[Math.floor(rng() * others.length)].id);
}

/** Stop the clock and accuse someone. Once per player per round. */
export function accuse(s: GameState, accuser: Player, suspectId: string): boolean {
  if (s.phase !== 'questioning' || s.finalPhase || s.accusation || s.finalVote) return false;
  if (!accuser.connected || s.accusedOnce.includes(accuser.id)) return false;
  const suspect = byId(s, suspectId);
  if (!suspect || suspect.id === accuser.id || !suspect.connected) return false;
  s.accusedOnce.push(accuser.id);
  s.roundRemainingMs = s.roundEndsAt ? Math.max(0, s.roundEndsAt - Date.now()) : null;
  s.roundEndsAt = null;
  s.askEndsAt = null;
  s.accusation = { accuserId: accuser.id, suspectId, votes: {}, endsAt: Date.now() + VOTE_MS };
  feed(s, accuser.id, 'accuse', suspectId);
  return true;
}

/** Eligible voters for the current accusation: everyone connected
 *  except the accused (the accused does not vote). */
function eligibleVoters(s: GameState, suspectId: string): Player[] {
  return connectedPlayers(s).filter(p => p.id !== suspectId);
}

/** A secret YES/NO vote on the open accusation. Resolves as soon as
 *  every eligible voter has voted. */
export function voteAccuse(s: GameState, voter: Player, yes: boolean): boolean {
  const a = s.accusation;
  if (!a || s.phase !== 'questioning' || !voter.connected) return false;
  if (voter.id === a.suspectId || a.votes[voter.id] !== undefined) return false;
  a.votes[voter.id] = yes;
  maybeResolveAccusation(s);
  return true;
}

/** Resolve an accusation whose vote is complete (or whose timer fired).
 *  Unanimous YES convicts; anything else restarts the clock. */
export function resolveAccusation(s: GameState): void {
  const a = s.accusation;
  if (!a) return;
  const voters = eligibleVoters(s, a.suspectId);
  const allVoted = voters.length > 0 && voters.every(p => a.votes[p.id] !== undefined);
  const unanimous = allVoted && voters.every(p => a.votes[p.id] === true);
  s.accusation = null;
  if (unanimous) {
    if (a.suspectId === s.spyId) endRound(s, 'locals', 'spy-caught', a.accuserId);
    else endRound(s, 'spy', 'innocent-convicted', a.accuserId);
    return;
  }
  feed(s, a.accuserId, 'accuse-fail', a.suspectId);
  s.roundEndsAt = s.roundRemainingMs !== null ? Date.now() + s.roundRemainingMs : null;
  s.roundRemainingMs = null;
  s.askEndsAt = Date.now() + ASK_MS;
}

/** Called after a vote or a disconnect: resolve early when the vote can
 *  no longer change (everyone still connected has voted). */
export function maybeResolveAccusation(s: GameState): void {
  const a = s.accusation;
  if (!a) return;
  const voters = eligibleVoters(s, a.suspectId);
  if (voters.length > 0 && voters.every(p => a.votes[p.id] !== undefined)) resolveAccusation(s);
}

/** The suspect left mid-vote: drop the accusation and restart the clock. */
export function cancelAccusation(s: GameState): void {
  const a = s.accusation;
  if (!a) return;
  s.accusation = null;
  feed(s, a.accuserId, 'accuse-cancel', a.suspectId);
  s.roundEndsAt = s.roundRemainingMs !== null ? Date.now() + s.roundRemainingMs : null;
  s.roundRemainingMs = null;
  s.askEndsAt = Date.now() + ASK_MS;
}

/** The timer-end suspect left mid-vote: drop the vote, the accuser's
 *  turn is spent and the rotation moves on. */
export function cancelFinalVote(s: GameState): void {
  const fv = s.finalVote;
  if (!fv) return;
  s.finalVote = null;
  feed(s, s.finalOrder[s.finalIdx] ?? '', 'accuse-cancel', fv.suspectId);
  advanceFinal(s);
}

/** The spy reveals and guesses the location — allowed any time during
 *  questioning except while a vote is open. */
export function spyGuess(s: GameState, spy: Player, locationIdx: number): boolean {
  if (s.phase !== 'questioning' || s.accusation || s.finalVote) return false;
  if (spy.id !== s.spyId || !spy.connected) return false;
  if (locationIdx < 0 || locationIdx >= LOCATIONS.length) return false;
  if (locationIdx === s.locationIdx) endRound(s, 'spy', 'spy-guess-right', spy.id);
  else endRound(s, 'locals', 'spy-guess-wrong', spy.id);
  return true;
}

/** The round clock ran out: accuser turns rotate from the dealer. The
 *  first unanimous vote decides; nobody convicted → the spy wins. */
export function startFinalPhase(s: GameState): void {
  if (s.phase !== 'questioning' || s.finalPhase) return;
  const pool = connectedPlayers(s);
  if (!pool.length) return;
  s.finalPhase = true;
  s.askEndsAt = null;
  s.roundEndsAt = null;
  s.roundRemainingMs = null;
  const dealerIdx = Math.max(0, pool.findIndex(p => p.id === s.dealerId));
  s.finalOrder = [...pool.slice(dealerIdx), ...pool.slice(0, dealerIdx)].map(p => p.id);
  s.finalIdx = 0;
  s.finalPickEndsAt = Date.now() + ASK_MS;
  s.finalVote = null;
  feed(s, s.dealerId ?? '', 'final-start');
}

/** The current final-phase accuser names a suspect (or passes with
 *  null). A pass moves to the next accuser; the last pass ends the
 *  round with a spy win. */
export function finalPick(s: GameState, accuser: Player, suspectId: string | null): boolean {
  if (s.phase !== 'questioning' || !s.finalPhase || s.finalVote) return false;
  if (s.finalOrder[s.finalIdx] !== accuser.id || !accuser.connected) return false;
  if (suspectId === null) {
    feed(s, accuser.id, 'final-pass');
    advanceFinal(s);
    return true;
  }
  const suspect = byId(s, suspectId);
  if (!suspect || suspect.id === accuser.id || !suspect.connected) return false;
  s.finalVote = { suspectId, votes: {}, endsAt: Date.now() + VOTE_MS };
  s.finalPickEndsAt = null;
  feed(s, accuser.id, 'accuse', suspectId);
  return true;
}

/** Vote on the timer-end accusation. Resolves as soon as every
 *  eligible voter has voted. */
export function finalVote(s: GameState, voter: Player, yes: boolean): boolean {
  const fv = s.finalVote;
  if (!fv || s.phase !== 'questioning' || !voter.connected) return false;
  if (voter.id === fv.suspectId || fv.votes[voter.id] !== undefined) return false;
  fv.votes[voter.id] = yes;
  maybeResolveFinalVote(s);
  return true;
}

export function resolveFinalVote(s: GameState): void {
  const fv = s.finalVote;
  if (!fv) return;
  const voters = eligibleVoters(s, fv.suspectId);
  const allVoted = voters.length > 0 && voters.every(p => fv.votes[p.id] !== undefined);
  const unanimous = allVoted && voters.every(p => fv.votes[p.id] === true);
  const accuserId = s.finalOrder[s.finalIdx];
  s.finalVote = null;
  if (unanimous) {
    if (fv.suspectId === s.spyId) endRound(s, 'locals', 'spy-caught', accuserId);
    else endRound(s, 'spy', 'innocent-convicted', accuserId);
    return;
  }
  feed(s, accuserId, 'accuse-fail', fv.suspectId);
  advanceFinal(s);
}

export function maybeResolveFinalVote(s: GameState): void {
  const fv = s.finalVote;
  if (!fv) return;
  const voters = eligibleVoters(s, fv.suspectId);
  if (voters.length > 0 && voters.every(p => fv.votes[p.id] !== undefined)) resolveFinalVote(s);
}

/** Move to the next timer-end accuser; the last one passing ends the
 *  round with a spy win (2 points). Disconnected accusers are skipped. */
export function advanceFinal(s: GameState): void {
  s.finalVote = null;
  s.finalPickEndsAt = null;
  while (true) {
    s.finalIdx++;
    if (s.finalIdx >= s.finalOrder.length) {
      endRound(s, 'spy', 'timeout-spy-wins');
      return;
    }
    const next = byId(s, s.finalOrder[s.finalIdx]);
    if (next && next.connected) {
      s.finalPickEndsAt = Date.now() + ASK_MS;
      return;
    }
  }
}

/** Score a finished round by the official table, then park on the
 *  round-end screen. The next dealer is the spy who just played. */
export function endRound(s: GameState, winner: Winner, reason: RoundReason, accuserId?: string): void {
  const points: Record<string, number> = {};
  const award = (id: string, n: number) => { points[id] = (points[id] ?? 0) + n; };
  if (s.config.pointsOn) {
    if (reason === 'spy-caught') {
      for (const p of s.players) {
        if (p.id === s.spyId) continue;
        award(p.id, p.id === accuserId ? 2 : 1);
      }
    } else if (reason === 'innocent-convicted' || reason === 'spy-guess-right') {
      if (s.spyId) award(s.spyId, 4);
    } else if (reason === 'spy-guess-wrong') {
      for (const p of s.players) if (p.id !== s.spyId) award(p.id, 1);
    } else if (reason === 'timeout-spy-wins') {
      if (s.spyId) award(s.spyId, 2);
    }
  }
  for (const [id, n] of Object.entries(points)) {
    const p = byId(s, id);
    if (p) p.score += n;
  }
  if (winner === 'spy') {
    const spy = byId(s, s.spyId);
    if (spy) spy.roundWins++;
  } else {
    for (const p of s.players) if (p.id !== s.spyId) p.roundWins++;
  }
  s.roundResult = {
    winner, reason, spyId: s.spyId ?? '', locationIdx: s.locationIdx ?? 0,
    accuserId, points,
  };
  s.dealerId = s.spyId;
  s.accusation = null;
  s.finalVote = null;
  s.askEndsAt = null;
  s.roundEndsAt = null;
  s.roundRemainingMs = null;
  s.finalPhase = false;
  s.finalOrder = [];
  s.finalIdx = 0;
  s.finalPickEndsAt = null;
  s.phase = 'roundEnd';
  feed(s, s.spyId ?? '', reason === 'spy-caught' ? 'convict-spy' : reason === 'innocent-convicted' ? 'convict-innocent' : reason === 'spy-guess-right' ? 'guess-right' : reason === 'spy-guess-wrong' ? 'guess-wrong' : 'timeout-spy');
}

/** Advance to the next round, or to session results after the last one. */
export function nextRound(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'roundEnd') return;
  if (s.round >= s.config.roundsTotal) { s.phase = 'results'; return; }
  s.round++;
  dealRound(s, rng);
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  return {
    roomCode: s.roomCode, phase: s.phase, round: s.round, config: s.config,
    dealerId: s.dealerId, currentAskerId: s.currentAskerId, askEndsAt: s.askEndsAt,
    accusedOnce: s.accusedOnce,
    roundEndsAt: s.roundEndsAt, roundRemainingMs: s.roundRemainingMs,
    accusation: s.accusation ? {
      accuserId: s.accusation.accuserId, suspectId: s.accusation.suspectId,
      endsAt: s.accusation.endsAt, voted: Object.keys(s.accusation.votes),
    } : null,
    finalPhase: s.finalPhase, finalOrder: s.finalOrder, finalIdx: s.finalIdx,
    finalPickEndsAt: s.finalPickEndsAt,
    finalVote: s.finalVote ? {
      suspectId: s.finalVote.suspectId, endsAt: s.finalVote.endsAt,
      voted: Object.keys(s.finalVote.votes),
    } : null,
    revealReady: s.revealReady,
    roundResult: s.roundResult,
    chat: s.chat, feed: s.feed.slice(-20),
    players: s.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar ?? null, isHost: p.isHost, connected: p.connected,
      score: p.score, roundWins: p.roundWins,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  const isSpy = s.spyId === me.id;
  const inQuestion = s.phase === 'questioning';
  return {
    isSpy,
    locationIdx: isSpy ? null : s.locationIdx,
    roleIdx: isSpy ? null : (s.roleIdx[me.id] ?? null),
    locations: LOCATIONS,
    canAccuse: inQuestion && !s.finalPhase && !s.accusation && !s.finalVote
      && !s.accusedOnce.includes(me.id) && me.connected,
    canGuess: isSpy && inQuestion && !s.accusation && !s.finalVote,
    myVote: s.accusation ? (s.accusation.votes[me.id] ?? null)
      : s.finalVote ? (s.finalVote.votes[me.id] ?? null) : null,
    isDealer: s.dealerId === me.id,
  };
}
