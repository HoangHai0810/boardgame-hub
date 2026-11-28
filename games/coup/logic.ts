// Coup — rules engine. One source of truth for the game's rules, used by
// the browser host (client/src/games/coup/hostEngine.ts). The dedicated
// Socket.IO server does NOT run this game yet (GAME_NOT_SUPPORTED); the
// public MQTT/PeerJS transports use the browser host engine.
//
// Coup, La Mame Games 2012 (Rikki Tahta), base game only, 2–6 players.
// 15 character cards (3 each of Duke, Assassin, Captain, Ambassador,
// Contessa); each player holds 2 face-down influence cards and 2 coins
// (2-player games: the starting player gets 1 coin). On your turn take
// exactly one action; with 10+ coins you must Coup. Character actions
// are claims — truth or bluff — and any other player may challenge a
// claim; blocks (Duke vs Foreign Aid, Contessa vs Assassinate,
// Captain/Ambassador vs Steal) may themselves be challenged. A proven
// claim returns the shown card to the Court deck and draws a random
// replacement; a failed claim loses an influence and the action fails
// (paid coins returned), while a successful block fails the action with
// paid coins spent. Losing an influence means revealing one of your own
// face-down cards (your choice); losing both exiles you. Last player
// with influence wins.
//
// Response order (digital adaptation, see the design note): after an
// action is declared, every other living player gets one response
// window — the FIRST challenge or block that arrives wins. After a
// successful challenge the block window opens (the claim can no longer
// be challenged). After a block, anyone except the blocker may challenge
// it. A window closes when every eligible player has passed or the timer
// expires. The 2-player set-of-5 variant, the Inquisitor and Reformation
// are NOT in v1.
export type CharKind = 'duke' | 'assassin' | 'captain' | 'ambassador' | 'contessa';
export type ActionKind = 'income' | 'foreign-aid' | 'coup' | 'tax' | 'assassinate' | 'steal' | 'exchange';
export type Phase = 'lobby' | 'playing' | 'results';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const COUP_COST = 7;
export const ASSASSIN_COST = 3;
export const MUST_COUP_AT = 10;

export const CHARS: CharKind[] = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
export const CHAR_COUNT: Record<CharKind, number> = {
  duke: 3, assassin: 3, captain: 3, ambassador: 3, contessa: 3,
};
/** The character a character action claims. */
export const ACTION_CHAR: Partial<Record<ActionKind, CharKind>> = {
  tax: 'duke', assassinate: 'assassin', steal: 'captain', exchange: 'ambassador',
};
/** Which characters may block an action (empty = unblockable). */
export const BLOCK_CHARS: Partial<Record<ActionKind, CharKind[]>> = {
  'foreign-aid': ['duke'],
  assassinate: ['contessa'],
  steal: ['captain', 'ambassador'],
};
export const NEEDS_TARGET: ActionKind[] = ['coup', 'assassinate', 'steal'];

export interface Config { turnSeconds: 30 | 60 | 90 }
export const DEFAULT_CONFIG: Config = { turnSeconds: 60 };

export interface Card { id: string; kind: CharKind }
export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }

export interface Player {
  id: string; name: string; avatar?: string; isHost: boolean; connected: boolean;
  hand: Card[]; revealed: Card[]; coins: number; eliminated: boolean;
}

export interface DeclaredAction {
  kind: ActionKind;
  actorId: string;
  targetId?: string;
  char?: CharKind;
  costPaid: number;
}

export type AfterLose =
  | { type: 'failAction'; action: DeclaredAction }
  | { type: 'toBlockWindow'; action: DeclaredAction }
  | { type: 'resolveAction'; action: DeclaredAction }
  | { type: 'endTurn' }
  | { type: 'blockStands'; action: DeclaredAction };

export type Pending =
  | { stage: 'respond'; action: DeclaredAction; passed: string[] }
  | { stage: 'blockWindow'; action: DeclaredAction; passed: string[] }
  | { stage: 'blockRespond'; action: DeclaredAction; blockerId: string; blockChar: CharKind; passed: string[] }
  | { stage: 'chooseLose'; playerId: string; after: AfterLose }
  | { stage: 'exchange'; actorId: string; keepCount: number };

export type FeedKind =
  | 'action' | 'challenge-win' | 'challenge-fail' | 'block'
  | 'block-challenge-win' | 'block-challenge-fail'
  | 'lose' | 'eliminated' | 'exchange' | 'win';
export interface FeedEntry {
  kind: FeedKind;
  by?: string; targetId?: string; action?: ActionKind; char?: CharKind; card?: CharKind;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  config: Config;
  players: Player[];
  court: Card[];
  turn: string | null;
  turnEndsAt: number | null;
  pending: Pending | null;
  feed: FeedEntry[];
  winner: string | null;
  eliminationOrder: string[];
  chat: ChatMsg[];
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', config: { ...DEFAULT_CONFIG },
    players: [], court: [],
    turn: null, turnEndsAt: null, pending: null,
    feed: [], winner: null, eliminationOrder: [], chat: [],
  };
}

/** The 15-card deck. ids are unique per physical card. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const kind of CHARS) {
    for (let n = 0; n < CHAR_COUNT[kind]; n++) deck.push({ id: `${kind}-${n}`, kind });
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);
const alivePlayers = (s: GameState) => s.players.filter(p => !p.eliminated);
const isAlive = (p?: Player | null) => !!p && !p.eliminated;

function pushFeed(s: GameState, e: FeedEntry): void {
  s.feed = [e, ...s.feed].slice(0, 8);
}

/** Actions the player may legally declare right now. At 10+ coins the
 *  only legal action is Coup (rulebook: "you must launch a Coup"). */
export function legalActions(s: GameState, player: Player): ActionKind[] {
  if (player.eliminated || s.phase !== 'playing') return [];
  if (player.coins >= MUST_COUP_AT) return ['coup'];
  const acts: ActionKind[] = ['income', 'foreign-aid', 'tax', 'steal', 'exchange'];
  if (player.coins >= ASSASSIN_COST) acts.push('assassinate');
  if (player.coins >= COUP_COST) acts.push('coup');
  return acts;
}

/** A character action is a claim that can be challenged; a blockable
 *  action is one a counteraction can stop. */
export function isChallengeable(a: DeclaredAction): boolean { return !!a.char; }
export function isBlockable(a: DeclaredAction): boolean { return !!BLOCK_CHARS[a.kind]; }
/** Who may block this action: anyone (Foreign Aid) or the target only. */
export function canBlock(s: GameState, player: Player, a: DeclaredAction): boolean {
  if (!isBlockable(a) || !isAlive(player) || player.id === a.actorId) return false;
  if (a.kind === 'foreign-aid') return true;
  return player.id === a.targetId;
}
export function canChallenge(s: GameState, player: Player, a: DeclaredAction): boolean {
  return isChallengeable(a) && isAlive(player) && player.id !== a.actorId;
}

/** Set up a fresh game: shuffle, deal 2 influence cards each, 2 coins
 *  each — except in a 2-player game the starting player gets 1 coin
 *  (rulebook, "Two Player Coup"). The court deck keeps the rest. */
export function startGame(s: GameState, rng: () => number = Math.random): void {
  s.court = shuffle(buildDeck(), rng);
  for (const p of s.players) {
    p.hand = []; p.revealed = []; p.coins = 2; p.eliminated = false;
    for (let i = 0; i < 2; i++) { const c = s.court.pop(); if (c) p.hand.push(c); }
  }
  s.feed = []; s.winner = null; s.eliminationOrder = [];
  s.pending = null;
  s.phase = 'playing';
  const first = s.players[Math.floor(rng() * s.players.length)];
  if (s.players.length === 2 && first) first.coins = 1;
  beginTurn(s, first);
}

function beginTurn(s: GameState, player: Player): void {
  s.turn = player.id;
  s.pending = null;
  s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
}

/** Step the turn to the next living, connected player (clockwise in seat
 *  order). A disconnected player never holds the turn — the same rule
 *  as Love Letter / Uno. */
export function advanceTurn(s: GameState): void {
  const order = alivePlayers(s).filter(p => p.connected);
  if (!order.length) { s.turn = null; s.turnEndsAt = null; return; }
  let idx = order.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0;
  else idx = (idx + 1) % order.length;
  beginTurn(s, order[idx]);
}

function endIfWon(s: GameState): boolean {
  const alive = alivePlayers(s);
  if (alive.length === 1) {
    s.winner = alive[0].id;
    s.phase = 'results';
    s.turn = null; s.turnEndsAt = null; s.pending = null;
    pushFeed(s, { kind: 'win', by: alive[0].id });
    return true;
  }
  return false;
}

/** Reveal one of a player's face-down cards (their choice when they
 *  hold 2 — with 1 it is automatic). Eliminates them when the last one
 *  goes, and ends the game when one player is left. Returns true when
 *  the game ended. */
function revealInfluence(s: GameState, player: Player, cardId: string): boolean {
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return false;
  player.hand = player.hand.filter(c => c.id !== cardId);
  player.revealed.push(card);
  pushFeed(s, { kind: 'lose', by: player.id, card: card.kind });
  if (!player.hand.length) {
    player.eliminated = true;
    player.coins = 0; // coins return to the Treasury
    s.eliminationOrder.push(player.id);
    pushFeed(s, { kind: 'eliminated', by: player.id });
  }
  return endIfWon(s);
}

/** Make a player lose one influence: with 2 face-down cards they choose
 *  which (pending chooseLose); with 1 it flips at once and the
 *  continuation runs immediately. */
function loseInfluence(s: GameState, player: Player, after: AfterLose, rng: () => number = Math.random): void {
  if (!isAlive(player)) { runAfter(s, after, rng); return; }
  if (player.hand.length > 1) {
    if (!player.connected) {
      // A disconnected player never holds the table: reveal the
      // leftmost card at once instead of opening a choice.
      const ended = revealInfluence(s, player, player.hand[0].id);
      if (!ended) runAfter(s, after, rng);
      return;
    }
    s.pending = { stage: 'chooseLose', playerId: player.id, after };
    s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
    return;
  }
  if (player.hand.length === 1) {
    const ended = revealInfluence(s, player, player.hand[0].id);
    if (!ended) runAfter(s, after, rng);
    return;
  }
  runAfter(s, after, rng);
}

/** The continuation after a lost influence is resolved. */
function runAfter(s: GameState, after: AfterLose, rng: () => number = Math.random): void {
  if (s.phase !== 'playing') return;
  switch (after.type) {
    case 'failAction': {
      // A successfully challenged action fails and its paid coins are
      // returned to the player (rulebook, Challenges).
      const actor = byId(s, after.action.actorId);
      if (actor && after.action.costPaid > 0) actor.coins += after.action.costPaid;
      endTurn(s);
      break;
    }
    case 'toBlockWindow': {
      // If nobody is left who could block (e.g. the target was just
      // eliminated by the failed challenge), the action resolves at once
      // instead of opening a window nobody can answer.
      const blockers = eligibleBlockers(s, after.action);
      if (!blockers.length) { resolveAction(s, after.action, rng); break; }
      s.pending = { stage: 'blockWindow', action: after.action, passed: [] };
      s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
      break;
    }
    case 'resolveAction':
      resolveAction(s, after.action, rng);
      break;
    case 'blockStands':
      // The block was proven (or nobody challenged it): the action
      // fails, paid coins stay spent.
      endTurn(s);
      break;
    case 'endTurn':
      endTurn(s);
      break;
  }
}

function endTurn(s: GameState): void {
  if (s.phase !== 'playing') return;
  if (endIfWon(s)) return;
  advanceTurn(s);
}

/** Return a shown card to the Court deck, reshuffle, and draw a random
 *  replacement (rulebook: the claimer "has not lost an influence"). */
function replaceShownCard(s: GameState, player: Player, kind: CharKind, rng: () => number = Math.random): void {
  const shown = player.hand.find(c => c.kind === kind);
  if (!shown) return;
  player.hand = player.hand.filter(c => c.id !== shown.id);
  s.court.push(shown);
  shuffle(s.court, rng);
  const drawn = s.court.pop();
  if (drawn) player.hand.push(drawn);
}

/* ---------- turn actions (all validated; each returns whether it landed) ---------- */

export function declareAction(
  s: GameState, player: Player, kind: ActionKind, targetId?: string,
  rng: () => number = Math.random,
): boolean {
  if (s.phase !== 'playing' || s.pending !== null || s.turn !== player.id) return false;
  if (!isAlive(player)) return false;
  if (!legalActions(s, player).includes(kind)) return false;
  const target = targetId ? byId(s, targetId) : undefined;
  if (NEEDS_TARGET.includes(kind)) {
    if (!target || !isAlive(target) || target.id === player.id) return false;
  }
  const cost = kind === 'coup' ? COUP_COST : kind === 'assassinate' ? ASSASSIN_COST : 0;
  if (player.coins < cost) return false;
  player.coins -= cost;
  const action: DeclaredAction = {
    kind, actorId: player.id, targetId: target?.id,
    char: ACTION_CHAR[kind], costPaid: cost,
  };
  pushFeed(s, { kind: 'action', by: player.id, targetId: target?.id, action: kind, char: action.char });
  switch (kind) {
    case 'income':
      player.coins += 1;
      endTurn(s);
      return true;
    case 'coup': {
      // A Coup is always successful and cannot be blocked or challenged:
      // the target loses an influence at once.
      const t = target!;
      loseInfluence(s, t, { type: 'endTurn' }, rng);
      return true;
    }
    default:
      // Foreign Aid (block only), Tax / Assassinate / Steal / Exchange
      // (challenge + block): open the response window.
      s.pending = { stage: 'respond', action, passed: [] };
      s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
      return true;
  }
}

/** Eligible responders for the open window: every living player except
 *  the actor (respond), except the actor for blocks on Foreign Aid —
 *  the union is the same set; who may actually block is checked in
 *  `respond` via canBlock. */
function eligibleResponders(s: GameState, action: DeclaredAction): Player[] {
  return alivePlayers(s).filter(p => p.id !== action.actorId);
}
function eligibleBlockers(s: GameState, action: DeclaredAction): Player[] {
  if (action.kind === 'foreign-aid') return eligibleResponders(s, action);
  return alivePlayers(s).filter(p => p.id === action.targetId);
}
function eligibleBlockChallengers(s: GameState, blockerId: string): Player[] {
  return alivePlayers(s).filter(p => p.id !== blockerId);
}

/** A response to the open action window: pass, challenge the claim, or
 *  block it. The first non-pass response wins the window. */
export function respond(
  s: GameState, player: Player,
  move: 'pass' | 'challenge' | 'block', blockChar?: CharKind,
  rng: () => number = Math.random,
): boolean {
  const pending = s.pending;
  if (!pending || pending.stage !== 'respond' || s.phase !== 'playing') return false;
  if (!isAlive(player) || player.id === pending.action.actorId) return false;
  if (pending.passed.includes(player.id)) return false;
  const action = pending.action;
  if (move === 'pass') {
    pending.passed.push(player.id);
    // Disconnected players count as passed: a window never waits on an
    // empty chair.
    if (eligibleResponders(s, action).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      resolveAction(s, action, rng);
    }
    return true;
  }
  if (move === 'challenge') {
    if (!canChallenge(s, player, action)) return false;
    const actor = byId(s, action.actorId)!;
    const claimed = action.char!;
    s.pending = null;
    if (actor.hand.some(c => c.kind === claimed)) {
      replaceShownCard(s, actor, claimed, rng);
      pushFeed(s, { kind: 'challenge-win', by: player.id, targetId: actor.id, char: claimed, action: action.kind });
      loseInfluence(s, player, isBlockable(action)
        ? { type: 'toBlockWindow', action }
        : { type: 'resolveAction', action }, rng);
    } else {
      pushFeed(s, { kind: 'challenge-fail', by: player.id, targetId: actor.id, char: claimed, action: action.kind });
      loseInfluence(s, actor, { type: 'failAction', action }, rng);
    }
    return true;
  }
  // block
  if (move === 'block') {
    if (!blockChar || !(BLOCK_CHARS[action.kind] ?? []).includes(blockChar)) return false;
    if (!canBlock(s, player, action)) return false;
    pushFeed(s, { kind: 'block', by: player.id, targetId: action.actorId, action: action.kind, char: blockChar });
    s.pending = { stage: 'blockRespond', action, blockerId: player.id, blockChar, passed: [] };
    s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
    return true;
  }
  return false;
}

/** A response in the block-only window that opens after a successful
 *  challenge: only blocks are legal here — the claim itself was proven. */
export function respondBlockWindow(
  s: GameState, player: Player,
  move: 'pass' | 'block', blockChar?: CharKind,
  rng: () => number = Math.random,
): boolean {
  const pending = s.pending;
  if (!pending || pending.stage !== 'blockWindow' || s.phase !== 'playing') return false;
  if (!isAlive(player) || player.id === pending.action.actorId) return false;
  if (pending.passed.includes(player.id)) return false;
  const action = pending.action;
  if (move === 'pass') {
    pending.passed.push(player.id);
    if (eligibleBlockers(s, action).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      resolveAction(s, action, rng);
    }
    return true;
  }
  if (move === 'block') {
    if (!blockChar || !(BLOCK_CHARS[action.kind] ?? []).includes(blockChar)) return false;
    if (!canBlock(s, player, action)) return false;
    pushFeed(s, { kind: 'block', by: player.id, targetId: action.actorId, action: action.kind, char: blockChar });
    s.pending = { stage: 'blockRespond', action, blockerId: player.id, blockChar, passed: [] };
    s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
    return true;
  }
  return false;
}

/** A response to a declared block: pass, or challenge the blocker's
 *  claim. Anyone except the blocker may challenge. */
export function respondBlock(
  s: GameState, player: Player, move: 'pass' | 'challenge',
  rng: () => number = Math.random,
): boolean {
  const pending = s.pending;
  if (!pending || pending.stage !== 'blockRespond' || s.phase !== 'playing') return false;
  if (!isAlive(player) || player.id === pending.blockerId) return false;
  if (pending.passed.includes(player.id)) return false;
  const { action, blockerId, blockChar } = pending;
  const blocker = byId(s, blockerId)!;
  if (move === 'pass') {
    pending.passed.push(player.id);
    if (eligibleBlockChallengers(s, blockerId).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      // Nobody challenged the block: it stands, the action fails.
      endTurn(s);
    }
    return true;
  }
  if (move === 'challenge') {
    s.pending = null;
    if (blocker.hand.some(c => c.kind === blockChar)) {
      replaceShownCard(s, blocker, blockChar, rng);
      pushFeed(s, { kind: 'block-challenge-win', by: player.id, targetId: blockerId, char: blockChar, action: action.kind });
      // The challenger loses an influence; the block stands.
      loseInfluence(s, player, { type: 'blockStands', action }, rng);
    } else {
      pushFeed(s, { kind: 'block-challenge-fail', by: player.id, targetId: blockerId, char: blockChar, action: action.kind });
      // The blocker loses an influence; the block fails, the action proceeds.
      loseInfluence(s, blocker, { type: 'resolveAction', action }, rng);
    }
    return true;
  }
  return false;
}

/** Apply an action that survived every challenge and block. */
export function resolveAction(s: GameState, action: DeclaredAction, rng: () => number = Math.random): void {
  if (s.phase !== 'playing') return;
  s.pending = null;
  const actor = byId(s, action.actorId);
  if (!actor || !isAlive(actor)) { endTurn(s); return; }
  const target = action.targetId ? byId(s, action.targetId) : undefined;
  switch (action.kind) {
    case 'foreign-aid':
      actor.coins += 2;
      endTurn(s);
      return;
    case 'tax':
      actor.coins += 3;
      endTurn(s);
      return;
    case 'assassinate': {
      if (!target || !isAlive(target)) { endTurn(s); return; }
      // Double danger lives here: a target who just lost an influence
      // to a failed challenge loses a second one to the assassination.
      loseInfluence(s, target, { type: 'endTurn' }, rng);
      return;
    }
    case 'steal': {
      if (!target || !isAlive(target)) { endTurn(s); return; }
      const n = Math.min(2, target.coins);
      target.coins -= n;
      actor.coins += n;
      endTurn(s);
      return;
    }
    case 'exchange': {
      // Draw 2 from the Court deck, then keep as many as you hold
      // influence for and return the rest (chooseExchange).
      const drawn: Card[] = [];
      for (let i = 0; i < 2; i++) { const c = s.court.pop(); if (c) drawn.push(c); }
      if (!drawn.length) { endTurn(s); return; }
      actor.hand.push(...drawn);
      const keepCount = actor.hand.length - drawn.length;
      s.pending = { stage: 'exchange', actorId: actor.id, keepCount };
      if (!actor.connected) {
        // A disconnected actor never holds the table: keep the cards
        // held before the draw (the drawn ones sit at the end).
        const keep = actor.hand.slice(0, keepCount).map(c => c.id);
        chooseExchange(s, actor, keep, rng);
        return;
      }
      s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
      return;
    }
    default:
      endTurn(s);
      return;
  }
}

/** Resolve an open lose-influence choice: the player reveals one of
 *  their own face-down cards, then the stored continuation runs. */
export function chooseLose(s: GameState, player: Player, cardId: string, rng: () => number = Math.random): boolean {
  const pending = s.pending;
  if (!pending || pending.stage !== 'chooseLose' || s.phase !== 'playing') return false;
  if (pending.playerId !== player.id) return false;
  if (!player.hand.some(c => c.id === cardId)) return false;
  const after = pending.after;
  s.pending = null;
  const ended = revealInfluence(s, player, cardId);
  if (!ended) runAfter(s, after, rng);
  return true;
}

/** Resolve an open Exchange: keep `keepCardIds` (exactly keepCount of
 *  them) and return the rest to the Court deck (shuffled back in). */
export function chooseExchange(s: GameState, player: Player, keepCardIds: string[], rng: () => number = Math.random): boolean {
  const pending = s.pending;
  if (!pending || pending.stage !== 'exchange' || s.phase !== 'playing') return false;
  if (pending.actorId !== player.id) return false;
  if (keepCardIds.length !== pending.keepCount) return false;
  const keep = new Set(keepCardIds);
  if (keepCardIds.some(id => !player.hand.some(c => c.id === id))) return false;
  const kept = player.hand.filter(c => keep.has(c.id));
  const returned = player.hand.filter(c => !keep.has(c.id));
  if (kept.length !== pending.keepCount || returned.length !== 2) return false;
  player.hand = kept;
  s.court.push(...returned);
  shuffle(s.court, rng);
  pushFeed(s, { kind: 'exchange', by: player.id });
  s.pending = null;
  endTurn(s);
  return true;
}

/** Mark a player as passed in the open response window (a disconnected
 *  player never holds the table). Runs the window's close check. */
export function markPassed(s: GameState, playerId: string, rng: () => number = Math.random): void {
  const pending = s.pending;
  if (!pending || s.phase !== 'playing') return;
  if (pending.stage === 'respond') {
    if (!pending.passed.includes(playerId)) pending.passed.push(playerId);
    if (eligibleResponders(s, pending.action).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      resolveAction(s, pending.action, rng);
    }
  } else if (pending.stage === 'blockWindow') {
    if (!pending.passed.includes(playerId)) pending.passed.push(playerId);
    if (eligibleBlockers(s, pending.action).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      resolveAction(s, pending.action, rng);
    }
  } else if (pending.stage === 'blockRespond') {
    if (!pending.passed.includes(playerId)) pending.passed.push(playerId);
    if (eligibleBlockChallengers(s, pending.blockerId).filter(p => p.connected).every(p => pending.passed.includes(p.id))) {
      // Nobody challenged the block: it stands, the action fails.
      endTurn(s);
    }
  }
}

/** The turn timer's default for a forgotten action (the platform's
 *  rule: a forgotten action gets a sensible default, never a silent
 *  skip). What "sensible" means depends on the open stage. */
export function autoStep(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'playing') return;
  const pending = s.pending;
  if (!pending) {
    // Choosing an action: 10+ coins → Coup the richest living opponent,
    // otherwise Income.
    const actor = byId(s, s.turn);
    if (!actor || !isAlive(actor)) { advanceTurn(s); return; }
    if (actor.coins >= MUST_COUP_AT) {
      const opponents = alivePlayers(s).filter(p => p.id !== actor.id);
      opponents.sort((a, b) => b.coins - a.coins);
      if (opponents.length) declareAction(s, actor, 'coup', opponents[0].id, rng);
      else endTurn(s);
    } else {
      declareAction(s, actor, 'income', undefined, rng);
    }
    return;
  }
  switch (pending.stage) {
    case 'respond': {
      // Everyone still to answer passes.
      for (const p of eligibleResponders(s, pending.action)) {
        if (!pending.passed.includes(p.id)) pending.passed.push(p.id);
      }
      resolveAction(s, pending.action, rng);
      return;
    }
    case 'blockWindow': {
      for (const p of eligibleBlockers(s, pending.action)) {
        if (!pending.passed.includes(p.id)) pending.passed.push(p.id);
      }
      resolveAction(s, pending.action, rng);
      return;
    }
    case 'blockRespond': {
      // Nobody challenged the block in time: it stands.
      endTurn(s);
      return;
    }
    case 'chooseLose': {
      const p = byId(s, pending.playerId);
      if (p && p.hand.length) chooseLose(s, p, p.hand[0].id, rng);
      return;
    }
    case 'exchange': {
      const p = byId(s, pending.actorId);
      if (!p) { s.pending = null; endTurn(s); return; }
      // Sensible default: keep the cards held before the draw (the
      // drawn cards sit at the end of the hand) — return the drawn ones.
      const keep = p.hand.slice(0, pending.keepCount).map(c => c.id);
      chooseExchange(s, p, keep, rng);
      return;
    }
  }
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  return {
    roomCode: s.roomCode, phase: s.phase, config: s.config,
    turn: s.turn, turnEndsAt: s.turnEndsAt,
    pending: s.pending,
    courtCount: s.court.length,
    feed: s.feed,
    winner: s.winner,
    eliminationOrder: s.eliminationOrder,
    chat: s.chat,
    players: s.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar ?? null, isHost: p.isHost, connected: p.connected,
      handCount: p.hand.length, revealed: p.revealed,
      coins: p.coins, eliminated: p.eliminated,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  return { myHand: me.hand };
}
