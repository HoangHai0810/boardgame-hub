// Love Letter — rules engine. One source of truth for the game's rules,
// used by the browser host (client/src/games/love-letter/hostEngine.ts).
// The dedicated Socket.IO server does NOT run this game yet
// (GAME_NOT_SUPPORTED); the public MQTT/PeerJS transports use the browser
// host engine.
//
// Classic Love Letter (AEG 2012, 16 cards), 2–4 players. Each round you
// hold one secret card; on your turn you draw one and play one, resolving
// its effect. Guard guesses a hand, Priest peeks, Baron compares, Handmaid
// protects, Prince forces a discard + redraw, King trades hands, Countess
// must be discarded when held with the King or Prince, and discarding the
// Princess knocks you out. The round ends when one player is left, or when
// the deck runs out — highest hand wins, ties broken by discard-pile total,
// still tied → all tied players win. Tokens of affection: 2p = 7, 3p = 5,
// 4p = 4 (quick mode: 3 for everyone).
export type CardKind = 'guard' | 'priest' | 'baron' | 'handmaid' | 'prince' | 'king' | 'countess' | 'princess';
export type Phase = 'lobby' | 'playing' | 'roundEnd' | 'results';
export type PendingType = 'guard' | 'priest' | 'baron' | 'king' | 'prince';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const CARD_VALUE: Record<CardKind, number> = {
  guard: 1, priest: 2, baron: 3, handmaid: 4, prince: 5, king: 6, countess: 7, princess: 8,
};
export const CARD_COUNT: Record<CardKind, number> = {
  guard: 5, priest: 2, baron: 2, handmaid: 2, prince: 2, king: 1, countess: 1, princess: 1,
};
/** Cards a Guard may name (never the Guard itself). */
export const GUESSABLE: CardKind[] = ['priest', 'baron', 'handmaid', 'prince', 'king', 'countess', 'princess'];

export interface Config { turnSeconds: 30 | 60 | 90; quickMode: boolean }
export const DEFAULT_CONFIG: Config = { turnSeconds: 60, quickMode: false };

export interface Card { id: string; kind: CardKind; value: number }
export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }

export interface Player {
  id: string; name: string; isHost: boolean; connected: boolean;
  hand: Card[]; discardPile: Card[];
  protected: boolean; inRound: boolean; tokens: number; roundWins: number;
}

export type LastPlayOutcome =
  | 'hit' | 'miss' | 'peek' | 'win' | 'lose' | 'tie' | 'trade'
  | 'redraw' | 'princess' | 'no-target' | 'none';
export interface LastPlay {
  by: string; card: CardKind; targetId?: string; guess?: CardKind; outcome: LastPlayOutcome;
}
export interface RoundResult {
  reason: 'last-standing' | 'showdown' | 'showdown-tiebreak' | 'showdown-tie';
  /** Hands of the players still in at a deck-empty showdown (public then). */
  hands?: Record<string, Card>;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  round: number;
  config: Config;
  players: Player[];
  deck: Card[];
  /** The face-down card removed at setup; secret until a Prince draws it. */
  setAside: Card | null;
  /** 2-player games only: 3 cards removed face-up (public). */
  faceUpRemoved: Card[];
  turn: string | null;
  turnEndsAt: number | null;
  /** A played card awaiting its target/guess choice — the turn does not
   *  advance until this resolves. */
  pendingAction: { type: PendingType; actorId: string; cardId: string } | null;
  /** Priest peeks, keyed by viewer — cleared when the target's hand changes. */
  seenHands: Record<string, { targetId: string; card: Card }>;
  lastPlay: LastPlay | null;
  roundWinners: string[];
  roundResult: RoundResult | null;
  tokensToWin: number;
  sessionWinner: string | null;
  /** Who goes first next round (the round winner, or a random tied winner). */
  nextFirstPlayerId: string | null;
  chat: ChatMsg[];
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', round: 1, config: { ...DEFAULT_CONFIG },
    players: [], deck: [], setAside: null, faceUpRemoved: [],
    turn: null, turnEndsAt: null, pendingAction: null, seenHands: {},
    lastPlay: null, roundWinners: [], roundResult: null,
    tokensToWin: 4, sessionWinner: null, nextFirstPlayerId: null, chat: [],
  };
}

/** The 16-card deck. ids are unique per physical card. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  (Object.keys(CARD_COUNT) as CardKind[]).forEach(kind => {
    for (let n = 0; n < CARD_COUNT[kind]; n++) deck.push({ id: `${kind}-${n}`, kind, value: CARD_VALUE[kind] });
  });
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function tokensFor(playerCount: number, quickMode: boolean): number {
  if (quickMode) return 3;
  return playerCount === 2 ? 7 : playerCount === 3 ? 5 : 4;
}

const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);
const alive = (s: GameState) => s.players.filter(p => p.inRound);

/** The cards this player may legally play right now. The Countess rule:
 *  holding her with the King or Prince forces the Countess. */
export function legalPlays(s: GameState, player: Player): Card[] {
  const kinds = player.hand.map(c => c.kind);
  if (kinds.includes('countess') && (kinds.includes('king') || kinds.includes('prince'))) {
    return player.hand.filter(c => c.kind === 'countess');
  }
  return [...player.hand];
}

/** Valid targets for a card that needs another player. The Prince may
 *  also target the actor themself; everyone else may not. */
export function validTargets(s: GameState, actor: Player, type: PendingType): Player[] {
  return s.players.filter(p => {
    if (!p.inRound || p.protected) return false;
    if (p.id === actor.id) return type === 'prince';
    return true;
  });
}

/** Set up a fresh round: shuffle, burn one card face-down, 2-player
 *  games also remove 3 face-up, deal 1 card each. The first player draws
 *  their second card at once (beginTurn). */
export function startRound(s: GameState, rng: () => number = Math.random): void {
  s.deck = shuffle(buildDeck(), rng);
  s.setAside = s.deck.pop() ?? null;
  s.faceUpRemoved = [];
  if (s.players.length === 2) {
    for (let i = 0; i < 3; i++) { const c = s.deck.pop(); if (c) s.faceUpRemoved.push(c); }
  }
  for (const p of s.players) {
    p.hand = []; p.discardPile = []; p.protected = false; p.inRound = true;
    const c = s.deck.pop(); if (c) p.hand.push(c);
  }
  s.pendingAction = null; s.seenHands = {}; s.lastPlay = null;
  s.roundWinners = []; s.roundResult = null;
  s.tokensToWin = tokensFor(s.players.length, s.config.quickMode);
  s.phase = 'playing';
  const first = (s.nextFirstPlayerId ? byId(s, s.nextFirstPlayerId) : undefined)
    ?? s.players[Math.floor(rng() * s.players.length)];
  s.nextFirstPlayerId = null;
  beginTurn(s, first);
}

/** Start a player's turn: Handmaid protection ends at the start of your
 *  next turn; draw one card from the deck (the deck cannot be empty here
 *  — the round ends at the end of the turn that empties it). A Priest
 *  peek at your hand survives the draw — the seen card is still in your
 *  hand — and goes stale only when you play that very card (see
 *  playCard), trade it, redraw it, or are knocked out. */
export function beginTurn(s: GameState, player: Player): void {
  s.turn = player.id;
  player.protected = false;
  const c = s.deck.pop();
  if (c) player.hand.push(c);
  s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
}

/** Step the turn to the next player who is still in the round and
 *  connected (a disconnected player's hand waits for them). */
export function advanceTurn(s: GameState): void {
  const order = s.players.filter(p => p.inRound && p.connected);
  if (!order.length) { s.turn = null; s.turnEndsAt = null; return; }
  let idx = order.findIndex(p => p.id === s.turn);
  if (idx < 0) idx = 0;
  else idx = (idx + 1) % order.length;
  beginTurn(s, order[idx]);
}

/** Knock a player out of the round: their hand is discarded face-up
 *  (without applying its effect) and any peek at them goes stale. */
export function knockOut(s: GameState, player: Player): void {
  player.inRound = false;
  player.protected = false;
  if (player.hand.length) {
    player.discardPile.push(...player.hand);
    player.hand = [];
  }
  for (const viewerId of Object.keys(s.seenHands)) {
    if (s.seenHands[viewerId].targetId === player.id) delete s.seenHands[viewerId];
  }
}

function clearPeeksOn(s: GameState, targetId: string): void {
  for (const viewerId of Object.keys(s.seenHands)) {
    if (s.seenHands[viewerId].targetId === targetId) delete s.seenHands[viewerId];
  }
}

/** After a turn's play + effect, the round may be over; otherwise the
 *  turn passes. Called after every completed play. */
function endTurn(s: GameState, rng: () => number = Math.random): void {
  s.pendingAction = null;
  const alivePlayers = alive(s);
  if (alivePlayers.length === 1) {
    finishRound(s, [alivePlayers[0].id], { reason: 'last-standing' }, rng);
    return;
  }
  if (s.deck.length === 0) {
    // Showdown: highest hand wins; tie → highest discard-pile total;
    // still tied → all tied players win.
    const best = Math.max(...alivePlayers.map(p => p.hand[0]?.value ?? -1));
    let tied = alivePlayers.filter(p => (p.hand[0]?.value ?? -1) === best);
    let reason: RoundResult['reason'] = 'showdown';
    if (tied.length > 1) {
      const sum = (p: Player) => p.discardPile.reduce((a, c) => a + c.value, 0);
      const bestSum = Math.max(...tied.map(sum));
      const top = tied.filter(p => sum(p) === bestSum);
      if (top.length < tied.length) { tied = top; reason = 'showdown-tiebreak'; }
      else reason = 'showdown-tie';
    }
    const hands: Record<string, Card> = {};
    for (const p of alivePlayers) if (p.hand[0]) hands[p.id] = p.hand[0];
    finishRound(s, tied.map(p => p.id), { reason, hands }, rng);
    return;
  }
  advanceTurn(s);
}

function finishRound(s: GameState, winnerIds: string[], result: RoundResult, rng: () => number = Math.random): void {
  s.roundWinners = winnerIds;
  s.roundResult = result;
  for (const id of winnerIds) {
    const p = byId(s, id);
    if (p) { p.tokens++; p.roundWins++; }
  }
  const reached = winnerIds.filter(id => (byId(s, id)?.tokens ?? 0) >= s.tokensToWin);
  s.turn = null; s.turnEndsAt = null; s.pendingAction = null;
  if (reached.length) {
    // House rule for the vanishingly rare double-reach: the first winner
    // in round order (highest hand, then highest discard total) takes it.
    s.sessionWinner = reached[0];
    s.phase = 'results';
  } else {
    s.phase = 'roundEnd';
    s.nextFirstPlayerId = winnerIds.length === 1
      ? winnerIds[0]
      : winnerIds[Math.floor(rng() * winnerIds.length)];
  }
}

/* ---------- turn actions (all validated; each returns whether it landed) ---------- */

export function playCard(s: GameState, player: Player, cardId: string, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || s.turn !== player.id || !player.inRound) return false;
  if (s.pendingAction) return false; // resolve the open effect first
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return false;
  if (!legalPlays(s, player).some(c => c.id === cardId)) return false; // Countess rule
  player.hand = player.hand.filter(c => c.id !== cardId);
  player.discardPile.push(card);
  // A Priest peek at this hand goes stale only if the card just played
  // is the very card that was seen — the other card stays known.
  for (const viewerId of Object.keys(s.seenHands)) {
    const seen = s.seenHands[viewerId];
    if (seen.targetId === player.id && seen.card.id === card.id) delete s.seenHands[viewerId];
  }
  s.lastPlay = { by: player.id, card: card.kind, outcome: 'none' };
  switch (card.kind) {
    case 'princess':
      knockOut(s, player);
      s.lastPlay.outcome = 'princess';
      endTurn(s, rng);
      return true;
    case 'countess':
    case 'handmaid':
      if (card.kind === 'handmaid') player.protected = true;
      endTurn(s, rng);
      return true;
    default: {
      const type = card.kind as PendingType;
      const targets = validTargets(s, player, type);
      if (!targets.length) {
        // No legal target at all (everyone else protected/out): the card
        // is played with no effect — except the Prince, who must target
        // themself, so that always has a target.
        s.lastPlay.outcome = 'no-target';
        endTurn(s, rng);
        return true;
      }
      s.pendingAction = { type, actorId: player.id, cardId: card.id };
      s.turnEndsAt = Date.now() + s.config.turnSeconds * 1000;
      return true;
    }
  }
}

/** Resolve the open effect with a chosen target (and, for the Guard, a
 *  guessed card). The turn advances when this returns. */
export function chooseTarget(
  s: GameState, player: Player, targetId: string, guess?: CardKind,
  rng: () => number = Math.random,
): boolean {
  const pending = s.pendingAction;
  if (!pending || s.phase !== 'playing' || pending.actorId !== player.id) return false;
  const target = byId(s, targetId);
  if (!target) return false;
  if (!validTargets(s, player, pending.type).some(p => p.id === targetId)) return false;
  if (pending.type === 'guard') {
    if (!guess || !GUESSABLE.includes(guess)) return false;
  }
  s.pendingAction = null;
  const play = s.lastPlay;
  if (play) { play.targetId = targetId; if (guess) play.guess = guess; }
  switch (pending.type) {
    case 'guard': {
      const hit = target.hand[0]?.kind === guess;
      if (play) play.outcome = hit ? 'hit' : 'miss';
      if (hit) knockOut(s, target);
      break;
    }
    case 'priest': {
      if (target.hand[0]) s.seenHands[player.id] = { targetId, card: target.hand[0] };
      if (play) play.outcome = 'peek';
      break;
    }
    case 'baron': {
      const mine = player.hand[0]?.value ?? -1;
      const theirs = target.hand[0]?.value ?? -1;
      if (mine > theirs) { knockOut(s, target); if (play) play.outcome = 'win'; }
      else if (mine < theirs) { knockOut(s, player); if (play) play.outcome = 'lose'; }
      else if (play) play.outcome = 'tie';
      break;
    }
    case 'king': {
      const myHand = player.hand;
      player.hand = target.hand;
      target.hand = myHand;
      clearPeeksOn(s, player.id);
      clearPeeksOn(s, target.id);
      if (play) play.outcome = 'trade';
      break;
    }
    case 'prince': {
      const discarded = target.hand[0];
      target.hand = [];
      if (discarded) target.discardPile.push(discarded);
      clearPeeksOn(s, target.id);
      if (discarded?.kind === 'princess') {
        knockOut(s, target);
        if (play) play.outcome = 'princess';
      } else {
        // Draw a new card: from the deck, or the face-down card set
        // aside at setup when the deck is empty.
        const drawn = s.deck.pop() ?? s.setAside ?? null;
        if (drawn === s.setAside) s.setAside = null;
        if (drawn) target.hand.push(drawn);
        if (play) play.outcome = 'redraw';
      }
      break;
    }
  }
  endTurn(s, rng);
  return true;
}

/** The turn timer's default for a player who forgot to act (the
 *  platform's rule: a forgotten action gets a sensible default, never a
 *  silent skip). A random legal card is played (Countess forced when
 *  held with King/Prince) and any effect it opens is resolved with a
 *  random valid target — Guard with a random guess, Prince possibly on
 *  themself. */
export function autoTurn(s: GameState, rng: () => number = Math.random): void {
  if (s.phase !== 'playing' || !s.turn) return;
  const me = byId(s, s.turn);
  if (!me) { advanceTurn(s); return; }
  if (s.pendingAction) { autoResolvePending(s, rng); return; }
  const legal = legalPlays(s, me);
  if (!legal.length) { advanceTurn(s); return; }
  const card = legal[Math.floor(rng() * legal.length)];
  playCard(s, me, card.id, rng);
  if (s.pendingAction) autoResolvePending(s, rng);
}

function autoResolvePending(s: GameState, rng: () => number = Math.random): void {
  const pending = s.pendingAction;
  if (!pending) return;
  const actor = byId(s, pending.actorId);
  if (!actor) { s.pendingAction = null; advanceTurn(s); return; }
  const targets = validTargets(s, actor, pending.type);
  if (!targets.length) { s.pendingAction = null; endTurn(s, rng); return; }
  const target = targets[Math.floor(rng() * targets.length)];
  const guess = pending.type === 'guard'
    ? GUESSABLE[Math.floor(rng() * GUESSABLE.length)]
    : undefined;
  chooseTarget(s, actor, target.id, guess, rng);
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  return {
    roomCode: s.roomCode, phase: s.phase, round: s.round, config: s.config,
    turn: s.turn, turnEndsAt: s.turnEndsAt,
    pendingAction: s.pendingAction
      ? { type: s.pendingAction.type, actorId: s.pendingAction.actorId }
      : null,
    deckCount: s.deck.length,
    setAsidePresent: s.setAside !== null,
    faceUpRemoved: s.faceUpRemoved,
    lastPlay: s.lastPlay,
    roundWinners: s.roundWinners,
    roundResult: s.roundResult,
    tokensToWin: s.tokensToWin,
    sessionWinner: s.sessionWinner,
    chat: s.chat,
    players: s.players.map(p => ({
      id: p.id, name: p.name, isHost: p.isHost, connected: p.connected,
      handCount: p.hand.length, discardPile: p.discardPile,
      protected: p.protected, inRound: p.inRound,
      tokens: p.tokens, roundWins: p.roundWins,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  return {
    myHand: me.hand,
    mySeen: s.seenHands[me.id] ?? null,
  };
}
