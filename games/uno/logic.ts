// Uno — rules engine. One source of truth for the game's rules, used by
// the browser host (client/src/games/uno/hostEngine.ts). The dedicated
// Socket.IO server does NOT run this game yet (GAME_NOT_SUPPORTED);
// the public MQTT/PeerJS transports use the browser host engine.
//
// Classic Uno (108 cards): 2–10 players, 7 cards each. Match the top
// discard by color, number or symbol; Wild / Wild Draw 4 always playable.
// Skip skips the next player, Reverse flips the direction (in a 2-player
// game it acts as a Skip), Draw 2 makes the next player draw 2 and lose
// their turn, Wild Draw 4 makes the next player draw 4 and lose their
// turn — but the next player may CHALLENGE it: if the +4 player held a
// card of the color in play, THEY draw 4 instead and the challenger keeps
// their turn; if the challenge fails, the challenger draws 6.
//
// UNO: playing down to 1 card without calling UNO is a foul — any other
// player may catch them ("Bắt UNO!"), and if the next player acts first,
// the foul player draws 2 automatically. A forgotten turn draws a card
// (the platform's default for a forgotten action); a drawn card that is
// playable may be played at once, or kept with a pass.
export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Kind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
export type Phase = 'lobby' | 'playing' | 'results';

export const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const TURN_MS = 30000;
export const DEAL_N = 7;

export interface Card { id: string; color: Color | 'wild'; kind: Kind; value?: number }
export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }

export interface Player {
  id: string; name: string; isHost: boolean; connected: boolean;
  hand: Card[]; wins: number; points: number;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  round: number;
  players: Player[];
  deck: Card[];
  discard: Card[];
  currentColor: Color;
  direction: 1 | -1;
  turn: string | null;
  turnEndsAt: number | null;
  /** The current player already drew this turn. */
  turnDrawn: boolean;
  /** Card drawn this turn (private — only the turn player sees it as playable-or-pass). */
  drawnCardId: string | null;
  /** Player sitting on 1 card who has not called UNO yet (public — anyone may catch them). */
  unoPending: string | null;
  /** A Wild Draw 4 awaiting the next player's decision (take 4, or challenge). */
  pendingDraw4: { from: string; hadColor: boolean } | null;
  /** First-card Wild: this player must pick the starting color. */
  colorPickPending: string | null;
  chat: ChatMsg[];
  winner: string | null;
  roundPoints: number;
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', round: 1, players: [],
    deck: [], discard: [], currentColor: 'red', direction: 1,
    turn: null, turnEndsAt: null, turnDrawn: false, drawnCardId: null,
    unoPending: null, pendingDraw4: null, colorPickPending: null,
    chat: [], winner: null, roundPoints: 0,
  };
}

/** The 108-card Uno deck. ids are unique per physical card. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    deck.push({ id: `${color}0-0`, color, kind: 'number', value: 0 });
    for (let v = 1; v <= 9; v++) for (let n = 0; n < 2; n++) deck.push({ id: `${color}${v}-${n}`, color, kind: 'number', value: v });
    for (const kind of ['skip', 'reverse', 'draw2'] as const) for (let n = 0; n < 2; n++) deck.push({ id: `${color}${kind}-${n}`, color, kind });
  }
  for (let n = 0; n < 4; n++) deck.push({ id: `wild-${n}`, color: 'wild', kind: 'wild' });
  for (let n = 0; n < 4; n++) deck.push({ id: `wild4-${n}`, color: 'wild', kind: 'wild4' });
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function cardPoints(c: Card): number {
  if (c.kind === 'number') return c.value ?? 0;
  if (c.kind === 'wild' || c.kind === 'wild4') return 50;
  return 20;
}

export const topCard = (s: GameState): Card | null => s.discard.length ? s.discard[s.discard.length - 1] : null;
const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);

/** Is this card legal on the current top card + current color? */
export function isPlayable(card: Card, top: Card | null, currentColor: Color): boolean {
  if (card.color === 'wild') return true;
  if (!top) return true;
  if (card.color === currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

/** Move the discard pile (except its top card) back into the draw pile. */
export function reshuffle(s: GameState, rng: () => number = Math.random): void {
  if (s.discard.length <= 1) return;
  const top = s.discard.pop()!;
  s.deck = shuffle([...s.discard], rng);
  s.discard = [top];
}

/** Draw n cards for a player (reshuffling when the deck runs out). */
export function drawCards(s: GameState, p: Player, n: number, rng: () => number = Math.random): Card[] {
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) reshuffle(s, rng);
    const c = s.deck.pop();
    if (!c) break;
    p.hand.push(c); got.push(c);
  }
  return got;
}

/** Deal 7 cards each and flip the first discard, applying the standard
 *  first-card rules (a Wild Draw 4 is shuffled back in; a Wild waits for
 *  the first player to pick a color; Skip / Reverse / Draw 2 hit the
 *  first player). */
export function deal(s: GameState, rng: () => number = Math.random): void {
  s.deck = shuffle(buildDeck(), rng);
  s.discard = [];
  s.direction = 1; s.unoPending = null; s.pendingDraw4 = null; s.colorPickPending = null;
  s.turnDrawn = false; s.drawnCardId = null;
  for (const p of s.players) p.hand = [];
  for (let i = 0; i < DEAL_N; i++) for (const p of s.players) { const c = s.deck.pop(); if (c) p.hand.push(c); }
  // Flip the first card. A Wild Draw 4 goes back in and we flip again.
  let first: Card | undefined;
  do {
    first = s.deck.pop();
    if (first && first.kind === 'wild4') { s.deck.push(first); shuffle(s.deck, rng); first = undefined; }
  } while (!first);
  s.discard.push(first);
  s.currentColor = first.color === 'wild' ? 'red' : first.color;
  const firstPlayer = s.players[0];
  s.turn = firstPlayer.id;
  if (first.kind === 'wild') {
    // The first player picks the starting color before anyone plays.
    s.colorPickPending = firstPlayer.id;
  } else if (first.kind === 'skip') {
    advanceTurn(s, 1);
  } else if (first.kind === 'reverse') {
    s.direction = -1;
    if (s.players.length === 2) advanceTurn(s, 1); // 2-player: reverse acts as skip
  } else if (first.kind === 'draw2') {
    drawCards(s, firstPlayer, 2, rng);
    advanceTurn(s, 1);
  }
  s.turnEndsAt = Date.now() + TURN_MS;
}

/** Step the turn `steps` times in the current direction, landing only on
 *  connected players (a disconnected player's hand waits for them). */
export function advanceTurn(s: GameState, steps = 1): void {
  const connected = s.players.filter(p => p.connected);
  if (!connected.length) { s.turn = null; return; }
  let idx = connected.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0;
  for (let i = 0; i < steps; i++) idx = (idx + s.direction + connected.length) % connected.length;
  s.turn = connected[idx].id;
  s.turnDrawn = false; s.drawnCardId = null;
  s.turnEndsAt = Date.now() + TURN_MS;
}

/** The UNO foul settles when the NEXT player acts: if the 1-card player
 *  still hasn't called UNO by then, they draw 2. */
export function settleUnoPending(s: GameState, actorId: string, rng: () => number = Math.random): void {
  if (!s.unoPending || s.unoPending === actorId) return;
  const foul = byId(s, s.unoPending);
  if (foul && foul.hand.length === 1) drawCards(s, foul, 2, rng);
  s.unoPending = null;
}

function finishRound(s: GameState, winner: Player): void {
  let points = 0;
  for (const p of s.players) if (p.id !== winner.id) for (const c of p.hand) points += cardPoints(c);
  winner.points += points; winner.wins++;
  s.winner = winner.id; s.roundPoints = points; s.phase = 'results';
  s.turn = null; s.turnEndsAt = null; s.pendingDraw4 = null; s.unoPending = null;
}

/* ---------- turn actions (all validated; each returns whether it landed) ---------- */

export function playCard(s: GameState, player: Player, cardId: string, color?: Color, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id) return false;
  if (s.pendingDraw4 || s.colorPickPending) return false; // decision turns only
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return false;
  if (!isPlayable(card, topCard(s), s.currentColor)) return false;
  // After drawing, only the drawn card may be played this turn.
  if (s.turnDrawn && s.drawnCardId !== cardId) return false;
  if ((card.kind === 'wild' || card.kind === 'wild4') && (!color || !COLORS.includes(color))) return false;
  settleUnoPending(s, player.id, rng);
  // The Wild Draw 4 challenge is about the color in play BEFORE the wild
  // was played — capture it before the chosen color overwrites it.
  const prevColor = s.currentColor;
  player.hand = player.hand.filter(c => c.id !== cardId);
  s.discard.push(card);
  s.currentColor = card.kind === 'wild' || card.kind === 'wild4' ? color! : (card.color as Color);
  s.turnDrawn = false; s.drawnCardId = null;
  if (player.hand.length === 0) { finishRound(s, player); return true; }
  if (player.hand.length === 1) s.unoPending = player.id;
  if (card.kind === 'skip') {
    advanceTurn(s, 2);
  } else if (card.kind === 'reverse') {
    s.direction = (s.direction * -1) as 1 | -1;
    advanceTurn(s, s.players.length === 2 ? 0 : 1); // 2-player: reverse acts as skip
  } else if (card.kind === 'draw2') {
    const next = nextPlayer(s, 1);
    if (next) drawCards(s, next, 2, rng);
    advanceTurn(s, 2);
  } else if (card.kind === 'wild4') {
    // The next player decides: take 4, or challenge the +4. hadColor is
    // judged on the remaining hand against the pre-play color.
    const hadColor = player.hand.some(c => c.color === prevColor);
    s.pendingDraw4 = { from: player.id, hadColor };
    advanceTurn(s, 1);
  } else {
    advanceTurn(s, 1);
  }
  return true;
}

/** The player after `steps` steps (connected only), without moving the turn. */
export function nextPlayer(s: GameState, steps = 1): Player | null {
  const connected = s.players.filter(p => p.connected);
  if (!connected.length) return null;
  let idx = connected.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0;
  for (let i = 0; i < steps; i++) idx = (idx + s.direction + connected.length) % connected.length;
  return connected[idx];
}

export function drawCard(s: GameState, player: Player, rng: () => number = Math.random): Card | null {
  if (s.phase !== 'playing' || s.turn !== player.id) return null;
  if (s.pendingDraw4 || s.colorPickPending) return null;
  if (s.turnDrawn) return null; // one draw per turn
  settleUnoPending(s, player.id, rng);
  if (s.unoPending === player.id) s.unoPending = null; // drawing grows the hand past 1
  const got = drawCards(s, player, 1, rng);
  const card = got[0] ?? null;
  s.turnDrawn = true;
  if (card && isPlayable(card, topCard(s), s.currentColor)) {
    s.drawnCardId = card.id; // may play it at once, or pass
  } else {
    s.drawnCardId = null;
    advanceTurn(s, 1);
  }
  return card;
}

export function passTurn(s: GameState, player: Player): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id) return false;
  if (!s.turnDrawn || !s.drawnCardId) return false; // only after drawing a playable card
  advanceTurn(s, 1);
  return true;
}

export function callUno(s: GameState, player: Player): boolean {
  if (s.unoPending !== player.id) return false;
  s.unoPending = null;
  return true;
}

/** Catch a player sitting on 1 card without calling UNO: they draw 2. */
export function catchUno(s: GameState, player: Player, targetId: string, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing') return false;
  if (s.unoPending !== targetId || player.id === targetId) return false;
  const target = byId(s, targetId);
  if (!target || target.hand.length !== 1) return false;
  drawCards(s, target, 2, rng);
  s.unoPending = null;
  return true;
}

/** Take the 4 cards from a Wild Draw 4 (and lose the turn). */
export function takeDraw4(s: GameState, player: Player, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id || !s.pendingDraw4) return false;
  drawCards(s, player, 4, rng);
  s.pendingDraw4 = null;
  advanceTurn(s, 1);
  return true;
}

/** Challenge a Wild Draw 4. If the +4 player held a card of the color in
 *  play, THEY draw 4 and the challenger keeps their turn; otherwise the
 *  challenger draws 6 and loses their turn. */
export function challengeWild4(s: GameState, player: Player, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id || !s.pendingDraw4) return false;
  const { from, hadColor } = s.pendingDraw4;
  s.pendingDraw4 = null;
  if (hadColor) {
    const bluffer = byId(s, from);
    if (bluffer) drawCards(s, bluffer, 4, rng);
    // Challenger keeps the turn: fresh timer, no draw yet.
    s.turnDrawn = false; s.drawnCardId = null;
    s.turnEndsAt = Date.now() + TURN_MS;
  } else {
    drawCards(s, player, 6, rng);
    advanceTurn(s, 1);
  }
  return true;
}

/** Pick the starting color after a first-card Wild. */
export function pickColor(s: GameState, player: Player, color: Color): boolean {
  if (s.phase !== 'playing' || s.colorPickPending !== player.id) return false;
  if (!COLORS.includes(color)) return false;
  s.currentColor = color;
  s.colorPickPending = null;
  s.turnEndsAt = Date.now() + TURN_MS;
  return true;
}

/** The turn timer's default for a player who forgot to act (the
 *  platform's rule: a forgotten action gets a sensible default, never a
 *  silent skip). Decision turns resolve to their safe default (take the
 *  4, or a random color); otherwise the player draws 1 and the turn
 *  passes — a drawn card that was playable is simply kept. */
export function autoTurn(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'playing' || !s.turn) return;
  const me = byId(s, s.turn);
  if (!me) { advanceTurn(s, 1); return; }
  if (s.colorPickPending === me.id) {
    s.currentColor = COLORS[Math.floor(rng() * COLORS.length)];
    s.colorPickPending = null;
    s.turnEndsAt = Date.now() + TURN_MS;
    return;
  }
  if (s.pendingDraw4) { takeDraw4(s, me, rng); return; }
  settleUnoPending(s, me.id, rng);
  if (!s.turnDrawn) {
    drawCards(s, me, 1, rng);
    if (s.unoPending === me.id) s.unoPending = null;
  }
  advanceTurn(s, 1);
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  return {
    roomCode: s.roomCode, phase: s.phase, round: s.round,
    turn: s.turn, direction: s.direction, currentColor: s.currentColor,
    topCard: topCard(s), deckCount: s.deck.length, discardCount: s.discard.length,
    turnEndsAt: s.turnEndsAt, turnDrawn: s.turnDrawn,
    unoPending: s.unoPending,
    // hadColor stays private — only the fact of the challenge is public.
    pendingDraw4: s.pendingDraw4 ? { from: s.pendingDraw4.from, count: 4 } : null,
    colorPickPending: s.colorPickPending,
    winner: s.winner, roundPoints: s.roundPoints,
    chat: s.chat,
    players: s.players.map(p => ({
      id: p.id, name: p.name, isHost: p.isHost, connected: p.connected,
      handCount: p.hand.length, wins: p.wins, points: p.points,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  return {
    myHand: me.hand,
    // The card I drew this turn, if it is playable — I may play it or pass.
    drawnCardId: s.turn === me.id && s.turnDrawn ? s.drawnCardId : null,
  };
}
