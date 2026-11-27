// Mèo Nổ (Exploding Kittens) — rules engine. One source of truth for the
// game's rules, used by the browser host (client/src/games/meo-no/
// hostEngine.ts). The dedicated Socket.IO server does NOT run this game
// yet (GAME_NOT_SUPPORTED); the public MQTT/PeerJS transports use the
// browser host engine.
//
// Rules (Hoàng's design, redesign-meo-no-2026-11-25.md): 2–5 players,
// 7 cards each (1 Defuse + 6). Deck: Exploding Kittens = players − 1,
// Defuse 6 total, Nope / Skip / Shuffle / See the Future / Attack / Favor
// 4 each, Cat cards 5 types × 4 = 20. A turn: play any number of action
// cards, then draw 1 to end it (Skip ends the turn without drawing,
// Attack ends it and makes the next player draw twice). Attack debt
// stacks: answering an Attack with an Attack adds 2 and passes it on.
// Drawing an Exploding Kitten: with a Defuse you defuse it and reinsert
// it at one of 5 fixed positions (top / 2nd / 3rd / middle / bottom);
// without one you explode at once — hand discarded, out of the game.
// Nope (when the lobby toggle is on): any other player holding a Nope
// may block an action card within 5s; a Nope may itself be Noped, and
// the chain restarts its 5s window each time — an odd number of Nopes
// cancels the action. Cat cards have no standalone effect in v1.
export type Kind = 'exploding' | 'defuse' | 'nope' | 'skip' | 'shuffle' | 'peek' | 'attack' | 'favor' | 'cat';
export type CatVariant = 'tabby' | 'siamese' | 'calico' | 'black' | 'white';
export type Phase = 'lobby' | 'playing' | 'results';
export type ActionKind = 'skip' | 'shuffle' | 'peek' | 'attack' | 'favor';

export const CAT_VARIANTS: CatVariant[] = ['tabby', 'siamese', 'calico', 'black', 'white'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const TURN_MS = 30000;
export const NOPE_MS = 5000;
/** Fallback for a pending decision (defuse / reinsert / give a card)
 *  when the 30s turn timer is OFF — a forgotten decision still gets a
 *  sensible default instead of stalling the table. */
export const DECISION_MS = 30000;
export const DEAL_N = 7;

export interface Card { id: string; kind: Kind; variant?: CatVariant }
export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }
export interface FeedEvent { ts: number; actorId: string; kind: string; targetId?: string; count?: number }
export interface Config { nopeEnabled: boolean; showCounts: boolean; timerEnabled: boolean }
export const DEFAULT_CONFIG: Config = { nopeEnabled: true, showCounts: true, timerEnabled: false };

export interface Player {
  id: string; name: string; avatar?: string; isHost: boolean; connected: boolean;
  hand: Card[]; wins: number; alive: boolean; explodedTurn: number | null;
  /** Engine-side bot (see addBot): counts as a connected player. */
  isBot?: boolean;
}

export interface PendingAction {
  cardId: string; kind: ActionKind; actorId: string; targetId?: string;
  nopes: string[]; endsAt: number;
  /** Players who tapped "let it pass" this Nope round (reset on each
   *  new Nope — everyone gets a fresh chance to block the block). */
  passes: string[];
}
export interface PendingExplode { playerId: string; hasDefuse: boolean }
export interface PendingFavor { fromId: string; targetId: string }

export interface GameState {
  roomCode: string;
  phase: Phase;
  round: number;
  config: Config;
  players: Player[];
  deck: Card[];
  discard: Card[];
  turn: string | null;
  turnCount: number;
  turnEndsAt: number | null;
  /** Draws owed by the current player (Attack debt). */
  debt: number;
  /** An action card awaiting its Nope window. The card is held out of hand. */
  pendingAction: PendingAction | null;
  /** A player who just drew an Exploding Kitten and holds a Defuse. */
  pendingExplode: PendingExplode | null;
  /** A player who defused and must pick a reinsert position. */
  pendingReinsert: string | null;
  /** A Favor waiting for its target to hand over a card. */
  pendingFavor: PendingFavor | null;
  /** Who may currently see the top 3 cards (See the Future). */
  peekShownFor: string | null;
  chat: ChatMsg[];
  feed: FeedEvent[];
  winner: string | null;
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', round: 1, config: { ...DEFAULT_CONFIG },
    players: [], deck: [], discard: [], turn: null, turnCount: 0, turnEndsAt: null,
    debt: 0, pendingAction: null, pendingExplode: null, pendingReinsert: null,
    pendingFavor: null, peekShownFor: null, chat: [], feed: [], winner: null,
  };
}

/** The deck before dealing (Exploding Kittens are added after the deal). */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let n = 0; n < 6; n++) deck.push({ id: `defuse-${n}`, kind: 'defuse' });
  for (const kind of ['nope', 'skip', 'shuffle', 'peek', 'attack', 'favor'] as const)
    for (let n = 0; n < 4; n++) deck.push({ id: `${kind}-${n}`, kind });
  for (const v of CAT_VARIANTS)
    for (let n = 0; n < 4; n++) deck.push({ id: `cat-${v}-${n}`, kind: 'cat', variant: v });
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/** The top of the deck is its END (draws pop). The next card to draw. */
export const topDeck = (s: GameState): Card | null => s.deck.length ? s.deck[s.deck.length - 1] : null;
export const topDiscard = (s: GameState): Card | null => s.discard.length ? s.discard[s.discard.length - 1] : null;
export const ekInDeck = (s: GameState): number => s.deck.filter(c => c.kind === 'exploding').length;
const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);
export const alivePlayers = (s: GameState): Player[] => s.players.filter(p => p.alive);
const isAction = (k: Kind): k is ActionKind => k === 'skip' || k === 'shuffle' || k === 'peek' || k === 'attack' || k === 'favor';

function feed(s: GameState, actorId: string, kind: string, targetId?: string, count?: number): void {
  s.feed.push({ ts: Date.now(), actorId, kind, targetId, count });
  if (s.feed.length > 30) s.feed = s.feed.slice(-30);
}

/** Bot names (Vietnamese first names — the UI prefixes them with 🤖). */
export const BOT_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khánh', 'Linh', 'Minh'];

/** Add an engine-side bot to the lobby (host only). Returns the bot, or
 *  null when the room is full. Bots are always "connected" and count
 *  toward the minimum player count, so a table can start with 1 human
 *  + bots. */
export function addBot(s: GameState, rng: () => number = Math.random): Player | null {
  if (s.players.length >= MAX_PLAYERS) return null;
  const used = new Set(s.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(`Bot ${n}`)) ?? `Bot ${s.players.length + 1}`;
  const bot: Player = {
    id: `bot-${Math.floor(rng() * 1e9).toString(36)}${Date.now().toString(36)}`,
    name: `Bot ${name}`, isHost: false, connected: true, isBot: true,
    hand: [], wins: 0, alive: true, explodedTurn: null,
  };
  s.players.push(bot);
  return bot;
}

export function removeBot(s: GameState, id: string): boolean {
  const p = s.players.find(x => x.id === id);
  if (!p || !p.isBot) return false;
  s.players = s.players.filter(x => x.id !== id);
  return true;
}

/** Deal 7 cards each (1 Defuse + 6), then insert players−1 Exploding
 *  Kittens into the deck. First player is the host (players[0]). */
export function deal(s: GameState, rng: () => number = Math.random): void {
  const n = s.players.length;
  const deck = shuffle(buildDeck(), rng);
  s.discard = [];
  s.deck = [];
  for (const p of s.players) { p.hand = []; p.alive = true; p.explodedTurn = null; }
  for (const p of s.players) {
    const d = deck.findIndex(c => c.kind === 'defuse');
    if (d >= 0) p.hand.push(deck.splice(d, 1)[0]);
  }
  for (let i = 0; i < DEAL_N - 1; i++) for (const p of s.players) { const c = deck.pop(); if (c) p.hand.push(c); }
  s.deck = deck;
  for (let i = 0; i < n - 1; i++) s.deck.push({ id: `ek-${i}`, kind: 'exploding' });
  shuffle(s.deck, rng);
  s.pendingAction = null; s.pendingExplode = null; s.pendingReinsert = null;
  s.pendingFavor = null; s.peekShownFor = null; s.debt = 0; s.turnCount = 1;
  s.turn = s.players[0]?.id ?? null;
  s.turnEndsAt = s.config.timerEnabled && s.turn ? Date.now() + TURN_MS : null;
  feed(s, s.turn ?? '', 'start');
}

/** Step the turn to the next living, connected player. */
export function advanceTurn(s: GameState): void {
  const live = s.players.filter(p => p.alive && p.connected);
  if (!live.length) { s.turn = null; return; }
  let idx = live.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0; else idx = (idx + 1) % live.length;
  s.turn = live[idx].id;
  s.turnCount++;
  s.debt = 0;
  s.peekShownFor = null;
  s.turnEndsAt = s.config.timerEnabled ? Date.now() + TURN_MS : null;
}

/** The next living player after the current turn (without moving it). */
export function nextAlive(s: GameState): Player | null {
  const live = s.players.filter(p => p.alive);
  if (!live.length) return null;
  let idx = live.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0; else idx = (idx + 1) % live.length;
  return live[idx];
}

function finishRound(s: GameState, winner: Player): void {
  winner.wins++;
  s.winner = winner.id; s.phase = 'results';
  s.turn = null; s.turnEndsAt = null; s.debt = 0;
  s.pendingAction = null; s.pendingExplode = null; s.pendingReinsert = null; s.pendingFavor = null;
  feed(s, winner.id, 'win');
}

function eliminate(s: GameState, p: Player): void {
  p.alive = false;
  p.explodedTurn = s.turnCount;
  s.discard.push(...p.hand);
  p.hand = [];
  feed(s, p.id, 'exploded');
  const live = alivePlayers(s);
  if (live.length === 1) finishRound(s, live[0]);
}

/** Draw one card off the deck (reshuffling the discard back in when the
 *  deck runs dry — Exploding Kittens never reach the discard, so the
 *  count of live kittens is preserved). */
function drawFromDeck(s: GameState, rng: () => number = Math.random): Card | null {
  if (!s.deck.length) {
    if (s.discard.length <= 1) return null;
    const top = s.discard.pop()!;
    s.deck = shuffle([...s.discard], rng);
    s.discard = [top];
  }
  return s.deck.pop() ?? null;
}

/* ---------- turn actions (all validated; each returns whether it landed) ---------- */

export function canPlayCard(s: GameState, player: Player, card: Card): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id || !player.alive) return false;
  if (s.pendingAction || s.pendingExplode || s.pendingReinsert || s.pendingFavor) return false;
  return isAction(card.kind);
}

/** Play an action card. Favor needs a target. When Nope is enabled the
 *  card waits out its 5s Nope window instead of resolving at once. */
export function playCard(s: GameState, player: Player, cardId: string, targetId?: string, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id || !player.alive) return false;
  if (s.pendingAction || s.pendingExplode || s.pendingReinsert || s.pendingFavor) return false;
  const card = player.hand.find(c => c.id === cardId);
  if (!card || !isAction(card.kind)) return false;
  if (card.kind === 'favor') {
    const target = byId(s, targetId);
    if (!target || target.id === player.id || !target.alive) return false;
  }
  player.hand = player.hand.filter(c => c.id !== cardId);
  if (s.config.nopeEnabled) {
    s.pendingAction = { cardId, kind: card.kind, actorId: player.id, targetId, nopes: [], passes: [], endsAt: Date.now() + NOPE_MS };
    feed(s, player.id, 'play-' + card.kind, targetId);
    return true;
  }
  s.discard.push(card);
  return resolveActionEffect(s, card.kind, player, targetId, rng);
}

/** Apply an action card's effect (after its Nope window closed unblocked). */
function resolveActionEffect(s: GameState, kind: ActionKind, actor: Player, targetId: string | undefined, rng: () => number = Math.random): boolean {
  switch (kind) {
    case 'skip': {
      if (s.debt > 0) {
        s.debt--;
        feed(s, actor.id, 'skip-debt');
        if (s.debt === 0) advanceTurn(s);
      } else {
        feed(s, actor.id, 'skip');
        advanceTurn(s);
      }
      return true;
    }
    case 'shuffle': {
      shuffle(s.deck, rng);
      feed(s, actor.id, 'shuffle');
      return true;
    }
    case 'peek': {
      s.peekShownFor = actor.id;
      feed(s, actor.id, 'peek');
      return true;
    }
    case 'attack': {
      // The debt is owed by the NEXT player: advanceTurn resets debt to 0,
      // so capture the total first and re-apply it after the move.
      const owed = s.debt + 2;
      const victim = nextAlive(s);
      feed(s, actor.id, 'attack', victim?.id);
      advanceTurn(s);
      s.debt = owed;
      if (s.config.timerEnabled) s.turnEndsAt = Date.now() + TURN_MS;
      return true;
    }
    case 'favor': {
      const target = byId(s, targetId);
      if (!target) return false;
      if (!target.hand.length) { feed(s, actor.id, 'favor-empty', target.id); return true; }
      s.pendingFavor = { fromId: actor.id, targetId: target.id };
      feed(s, actor.id, 'favor', target.id);
      return true;
    }
  }
}

/** Resolve a Nope window that just expired: an odd number of Nopes
 *  cancels the action; otherwise it takes effect. */
export function resolvePendingAction(s: GameState, rng: () => number = Math.random): void {
  const pa = s.pendingAction;
  if (!pa) return;
  s.pendingAction = null;
  const card = { id: pa.cardId, kind: pa.kind as Kind };
  s.discard.push(card);
  if (pa.nopes.length % 2 === 1) {
    feed(s, pa.nopes[pa.nopes.length - 1], 'nope-block', pa.actorId);
    return;
  }
  const actor = byId(s, pa.actorId);
  if (!actor || !actor.alive) return;
  resolveActionEffect(s, pa.kind, actor, pa.targetId, rng);
}

/** Play a Nope against the pending action (or against the last Nope).
 *  The first Nope must come from someone other than the actor; a Nope
 *  may never answer its own player's Nope. Each Nope restarts the 5s
 *  window. Returns whether it landed. */
export function playNope(s: GameState, player: Player): boolean {
  const pa = s.pendingAction;
  if (!pa || s.phase !== 'playing' || !player.alive) return false;
  if (pa.nopes.length === 0 && player.id === pa.actorId) return false;
  if (pa.nopes.length > 0 && player.id === pa.nopes[pa.nopes.length - 1]) return false;
  if (pa.passes.includes(player.id)) return false; // passed this round — binding
  const idx = player.hand.findIndex(c => c.kind === 'nope');
  if (idx < 0) return false;
  const [nope] = player.hand.splice(idx, 1);
  s.discard.push(nope);
  pa.nopes.push(player.id);
  pa.passes = [];
  pa.endsAt = Date.now() + NOPE_MS;
  feed(s, player.id, 'nope', pa.actorId);
  return true;
}

/** Decline to block the pending action this round. Anyone alive may pass;
 *  the pass only counts until the next Nope lands (fresh round). */
export function passNope(s: GameState, player: Player): boolean {
  const pa = s.pendingAction;
  if (!pa || s.phase !== 'playing' || !player.alive) return false;
  if (pa.passes.includes(player.id)) return false;
  pa.passes.push(player.id);
  return true;
}

/** Who still has to decide before the Nope window can close early:
 *  alive players who hold a Nope and are allowed to play one right now
 *  (not the actor before the first Nope, not the last Noper). Players
 *  without a Nope, dead players and disconnected players count as
 *  passed — they cannot block anything. */
export function nopePassProgress(s: GameState): { passed: number; needed: number } {
  const pa = s.pendingAction;
  if (!pa) return { passed: 0, needed: 0 };
  const barred = pa.nopes.length === 0 ? pa.actorId : pa.nopes[pa.nopes.length - 1];
  let needed = 0; let passed = 0;
  for (const p of s.players) {
    if (!p.alive || p.id === barred) continue;
    if (!p.hand.some(c => c.kind === 'nope')) continue;
    if (!p.connected) continue;
    needed++;
    if (pa.passes.includes(p.id)) passed++;
  }
  return { passed, needed };
}

/** The window may close at once when everyone who could still block it
 *  has passed (or nobody can block at all — then it never waits). */
export function canResolveNopeEarly(s: GameState): boolean {
  if (!s.pendingAction) return false;
  const { passed, needed } = nopePassProgress(s);
  return passed >= needed;
}

/** Draw a card to end (part of) the turn. Drawing an Exploding Kitten
 *  opens the defuse flow (or eliminates at once without a Defuse). */
export function drawCard(s: GameState, player: Player, rng: () => number = Math.random): Card | null {
  if (s.phase !== 'playing' || s.turn !== player.id || !player.alive) return null;
  if (s.pendingAction || s.pendingExplode || s.pendingReinsert || s.pendingFavor) return null;
  const card = drawFromDeck(s, rng);
  if (!card) return null;
  if (card.kind === 'exploding') {
    const hasDefuse = player.hand.some(c => c.kind === 'defuse');
    if (hasDefuse) {
      s.pendingExplode = { playerId: player.id, hasDefuse: true };
      feed(s, player.id, 'drew-ek');
      return card;
    }
    // No Defuse: out at once — the kitten leaves the game.
    feed(s, player.id, 'drew-ek');
    eliminate(s, player);
    if (s.phase === 'playing') advanceTurn(s);
    return card;
  }
  player.hand.push(card);
  feed(s, player.id, 'draw');
  if (s.debt > 0) {
    s.debt--;
    if (s.debt === 0) advanceTurn(s);
    else if (s.config.timerEnabled) s.turnEndsAt = Date.now() + TURN_MS;
  } else {
    advanceTurn(s);
  }
  return card;
}

/** Use a Defuse on the Exploding Kitten just drawn. */
export function defuse(s: GameState, player: Player): boolean {
  if (!s.pendingExplode || s.pendingExplode.playerId !== player.id) return false;
  const idx = player.hand.findIndex(c => c.kind === 'defuse');
  if (idx < 0) return false;
  const [d] = player.hand.splice(idx, 1);
  s.discard.push(d);
  s.pendingExplode = null;
  s.pendingReinsert = player.id;
  feed(s, player.id, 'defuse');
  return true;
}

/** The 5 fixed reinsert positions (design MN6): 1 = top, 2 = 2nd, 3 = 3rd,
 *  middle, bottom. `pos` is the 1-based position from the top. */
export function reinsertPositions(s: GameState): { pos: number; label: string }[] {
  const n = s.deck.length;
  const mid = Math.max(1, Math.ceil(n / 2));
  const seen = new Set<number>();
  const out: { pos: number; label: string }[] = [];
  const push = (pos: number, label: string) => {
    if (pos < 1 || pos > n + 1 || seen.has(pos)) return;
    seen.add(pos); out.push({ pos, label });
  };
  push(1, 'Trên cùng');
  push(2, 'Lá thứ 2');
  push(3, 'Lá thứ 3');
  push(mid, 'Giữa chồng');
  push(n + 1, 'Dưới đáy');
  return out;
}

/** Put the defused kitten back at the chosen 1-based position from the
 *  top (deck top = end of the array). The draw that found it counts
 *  against Attack debt; otherwise the turn passes. */
export function reinsert(s: GameState, player: Player, pos: number): boolean {
  if (s.pendingReinsert !== player.id) return false;
  const options = reinsertPositions(s).map(o => o.pos);
  if (!options.includes(pos)) return false;
  const idx = s.deck.length - pos + 1; // 1-based from top → array index
  s.deck.splice(idx, 0, { id: `ek-back-${Date.now()}`, kind: 'exploding' });
  s.pendingReinsert = null;
  feed(s, player.id, 'reinsert');
  if (s.debt > 0) {
    s.debt--;
    if (s.debt === 0) advanceTurn(s);
    else if (s.config.timerEnabled) s.turnEndsAt = Date.now() + TURN_MS;
  } else {
    advanceTurn(s);
  }
  return true;
}

/** The Favor target hands over one card of their choice. */
export function giveFavorCard(s: GameState, player: Player, cardId: string): boolean {
  if (!s.pendingFavor || s.pendingFavor.targetId !== player.id) return false;
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return false;
  const from = byId(s, s.pendingFavor.fromId);
  player.hand = player.hand.filter(c => c.id !== cardId);
  if (from && from.alive) from.hand.push(card);
  feed(s, player.id, 'favor-give', s.pendingFavor.fromId);
  s.pendingFavor = null;
  return true;
}

/** The turn timer's default for a player who forgot to act (the
 *  platform's rule: a forgotten action gets a sensible default, never a
 *  silent skip). A pending defuse is used at once (reinserted mid-deck);
 *  otherwise the player draws 1 and the turn passes. */
export function autoTurn(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'playing' || !s.turn) return;
  if (s.pendingAction) { resolvePendingAction(s, rng); return; }
  const me = byId(s, s.turn);
  if (!me) { advanceTurn(s); return; }
  if (s.pendingExplode?.playerId === me.id) { autoResolvePending(s, rng); return; }
  if (s.pendingReinsert === me.id) { autoResolvePending(s, rng); return; }
  if (s.pendingFavor && s.pendingFavor.targetId === me.id) { autoResolvePending(s, rng); return; }
  drawCard(s, me, rng);
}

/** Resolve a pending decision with safe defaults: defuse + reinsert
 *  mid-deck; a Favor target hands over a random card. */
export function autoResolvePending(s: GameState, rng: () => number = Math.random): void {
  if (s.pendingExplode) {
    const p = byId(s, s.pendingExplode.playerId);
    if (p && defuse(s, p)) {
      const opts = reinsertPositions(s);
      const mid = opts.find(o => o.label === 'Giữa chồng') ?? opts[opts.length - 1];
      if (mid) reinsert(s, p, mid.pos);
    }
    return;
  }
  if (s.pendingReinsert) {
    const p = byId(s, s.pendingReinsert);
    if (p) {
      const opts = reinsertPositions(s);
      const mid = opts.find(o => o.label === 'Giữa chồng') ?? opts[opts.length - 1];
      if (mid) reinsert(s, p, mid.pos);
    }
    return;
  }
  if (s.pendingFavor) {
    const t = byId(s, s.pendingFavor.targetId);
    if (t && t.hand.length) {
      const c = t.hand[Math.floor(rng() * t.hand.length)];
      giveFavorCard(s, t, c.id);
    } else {
      s.pendingFavor = null;
    }
  }
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  const nope = s.pendingAction ? nopePassProgress(s) : null;
  return {
    roomCode: s.roomCode, phase: s.phase, round: s.round, config: s.config,
    turn: s.turn, turnCount: s.turnCount, turnEndsAt: s.turnEndsAt, debt: s.debt,
    deckCount: s.deck.length, ekInDeck: ekInDeck(s),
    topCard: topDiscard(s), discardCount: s.discard.length,
    // The Nope window is public (everyone sees the countdown + who noped),
    // but the held card's identity stays hidden until it resolves.
    pendingAction: s.pendingAction ? {
      kind: s.pendingAction.kind, actorId: s.pendingAction.actorId,
      targetId: s.pendingAction.targetId, nopes: s.pendingAction.nopes.length,
      lastNoper: s.pendingAction.nopes[s.pendingAction.nopes.length - 1] ?? null,
      endsAt: s.pendingAction.endsAt,
      passed: nope?.passed ?? 0, passNeeded: nope?.needed ?? 0,
    } : null,
    pendingExplode: s.pendingExplode ? { playerId: s.pendingExplode.playerId } : null,
    pendingReinsert: s.pendingReinsert,
    pendingFavor: s.pendingFavor,
    peekShownFor: s.peekShownFor,
    feed: s.feed.slice(-20),
    winner: s.winner,
    chat: s.chat,
    players: s.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar ?? null, isHost: p.isHost, connected: p.connected,
      isBot: !!p.isBot,
      handCount: s.config.showCounts ? p.hand.length : null,
      alive: p.alive, explodedTurn: p.explodedTurn, wins: p.wins,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  const peek = s.peekShownFor === me.id
    ? [...s.deck].slice(-3).reverse()
    : null;
  return {
    myHand: me.hand,
    hasDefuse: s.pendingExplode?.playerId === me.id ? s.pendingExplode.hasDefuse : null,
    reinsertOptions: s.pendingReinsert === me.id ? reinsertPositions(s) : null,
    peekCards: peek,
    favorGive: s.pendingFavor?.targetId === me.id,
  };
}
