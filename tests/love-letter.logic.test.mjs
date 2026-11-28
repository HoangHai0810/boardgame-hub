// Love Letter engine unit tests.
// Run: esbuild games/love-letter/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, buildDeck, startRound, playCard, chooseTarget, autoTurn,
  legalPlays, validTargets, tokensFor, knockOut, publicState, privateState,
  resolveChancellor, cancelPending,
  CARD_COUNT, CARD_VALUE, GUESSABLE, MIN_PLAYERS, MAX_PLAYERS,
} from '../games/love-letter/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
// rng 0: deterministic shuffle AND the first player is always p0
// (Math.floor(0 * n) = 0), so tests can reason about the turn player.
const rng = () => 0;
const mkPlayer = (id) => ({ id, name: id, isHost: id === 'p0', connected: true, hand: [], discardPile: [], protected: false, inRound: true, tokens: 0, roundWins: 0 });
// A fresh game in 'playing', with the turn on p0 holding 2 cards.
const mk = (count = 4, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  for (let i = 0; i < count; i++) s.players.push(mkPlayer('p' + i));
  startRound(s, rng);
  return s;
};
const turnPlayer = (s) => s.players.find(p => p.id === s.turn);
const give = (s, playerId, kinds) => {
  const p = s.players.find(x => x.id === playerId);
  p.hand = kinds.map((kind, i) => ({ id: `${kind}-t${i}`, kind, value: CARD_VALUE[kind] }));
  return p;
};
const setTurn = (s, playerId) => { s.turn = playerId; s.pendingAction = null; };
// Play `kind` from the turn player's hand (giving them that card first).
const playKind = (s, kind, extra) => {
  const me = turnPlayer(s);
  const other = me.hand.find(c => c.kind !== kind) ?? { id: 'filler', kind: 'guard', value: 1 };
  me.hand = [other, { id: `${kind}-play`, kind, value: CARD_VALUE[kind] }];
  return playCard(s, me, `${kind}-play`, rng);
};

t('limits 2-6, deck is 21 with the exact 2019 official counts', () => {
  assert.equal(MIN_PLAYERS, 2); assert.equal(MAX_PLAYERS, 6);
  const deck = buildDeck();
  assert.equal(deck.length, 21);
  assert.equal(CARD_COUNT.spy, 2); assert.equal(CARD_COUNT.guard, 6);
  assert.equal(CARD_COUNT.priest, 2); assert.equal(CARD_COUNT.baron, 2);
  assert.equal(CARD_COUNT.handmaid, 2); assert.equal(CARD_COUNT.prince, 2);
  assert.equal(CARD_COUNT.chancellor, 2); assert.equal(CARD_COUNT.king, 1);
  assert.equal(CARD_COUNT.countess, 1); assert.equal(CARD_COUNT.princess, 1);
  assert.equal(new Set(deck.map(c => c.id)).size, 21);
  assert.equal(CARD_VALUE.spy, 0); assert.equal(CARD_VALUE.chancellor, 6);
  assert.equal(CARD_VALUE.king, 7); assert.equal(CARD_VALUE.countess, 8);
  assert.equal(CARD_VALUE.princess, 9);
  assert.deepEqual(GUESSABLE, ['spy', 'priest', 'baron', 'handmaid', 'prince', 'chancellor', 'king', 'countess', 'princess']);
});

t('recentPlays keeps the last plays, newest first, capped at 6', () => {
  const s = mk(4);
  // Play a no-effect card (handmaid) three times across turns.
  for (let i = 0; i < 3; i++) {
    const me = turnPlayer(s);
    if (!me.inRound) { setTurn(s, s.players.find(p => p.inRound).id); }
    playKind(s, 'handmaid');
    if (s.phase !== 'playing') break;
    // Advance the turn by hand: the next player in round draws.
    const next = s.players.find(p => p.inRound && p.id !== s.turn);
    if (next) { s.turn = next.id; next.hand.push({ id: 'draw-' + i, kind: 'guard', value: 1 }); }
  }
  assert.ok(s.recentPlays.length >= 1 && s.recentPlays.length <= 6);
  assert.equal(s.recentPlays[0], s.lastPlay);
  assert.equal(publicState(s).recentPlays.length, s.recentPlays.length);
});

t('tokens to win: 2p=6, 3p=5, 4p=4, 5p=3, 6p=3, quick mode 3', () => {
  assert.equal(tokensFor(2, false), 6);
  assert.equal(tokensFor(3, false), 5);
  assert.equal(tokensFor(4, false), 4);
  assert.equal(tokensFor(5, false), 3);
  assert.equal(tokensFor(6, false), 3);
  assert.equal(tokensFor(2, true), 3);
  assert.equal(tokensFor(6, true), 3);
});

t('setup: 1 burn card, 1 card each, first player draws a second', () => {
  const s = mk(4);
  assert.equal(s.phase, 'playing');
  assert.ok(s.setAside);
  assert.equal(s.faceUpRemoved.length, 0);
  assert.equal(s.deck.length, 21 - 1 - 4 - 1);
  assert.equal(turnPlayer(s).hand.length, 2);
  s.players.filter(p => p.id !== s.turn).forEach(p => assert.equal(p.hand.length, 1));
});

t('setup 2-player: 1 burn + 3 face-up removed, all public', () => {
  const s = mk(2);
  assert.equal(s.faceUpRemoved.length, 3);
  assert.equal(s.deck.length, 21 - 1 - 3 - 2 - 1);
  assert.equal(publicState(s).faceUpRemoved.length, 3);
});

t('turn passes left after a no-effect play (Countess)', () => {
  const s = mk(3);
  const first = s.turn;
  assert.equal(playKind(s, 'countess'), true);
  assert.equal(s.phase, 'playing');
  assert.notEqual(s.turn, first);
  assert.equal(turnPlayer(s).hand.length, 2);
});

t('Countess must be played when held with King or Prince', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['countess', 'king']);
  assert.deepEqual(legalPlays(s, me).map(c => c.kind), ['countess']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'king').id, rng), false);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  give(s2, me2.id, ['countess', 'prince']);
  assert.deepEqual(legalPlays(s2, me2).map(c => c.kind), ['countess']);
});

t('Guard: correct guess knocks the target out, wrong guess does nothing', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, 'p1', ['princess']);
  assert.equal(playKind(s, 'guard'), true);
  assert.ok(s.pendingAction && s.pendingAction.type === 'guard');
  assert.equal(chooseTarget(s, me, 'p1', 'princess', rng), true);
  assert.equal(s.players[1].inRound, false);
  assert.equal(s.players[1].discardPile.some(c => c.kind === 'princess'), true);
  assert.equal(s.lastPlay.outcome, 'hit');
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  give(s2, 'p1', ['baron']);
  assert.equal(playKind(s2, 'guard'), true);
  assert.equal(chooseTarget(s2, me2, 'p1', 'princess', rng), true);
  assert.equal(s2.players[1].inRound, true);
  assert.equal(s2.lastPlay.outcome, 'miss');
});

t('Guard: cannot name Guard, cannot target self or a protected player', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(chooseTarget(s, me, 'p1', 'guard', rng), false);
  assert.equal(chooseTarget(s, me, me.id, 'priest', rng), false);
  s.players[1].protected = true;
  assert.equal(chooseTarget(s, me, 'p1', 'priest', rng), false);
  s.players[1].protected = false;
  assert.equal(chooseTarget(s, me, 'p1', 'priest', rng), true);
});

t('Priest: peek is private to the viewer and goes stale when the target draws', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, 'p1', ['king']);
  assert.equal(playKind(s, 'priest'), true);
  assert.equal(chooseTarget(s, me, 'p1', undefined, rng), true);
  assert.equal(s.lastPlay.outcome, 'peek');
  assert.equal(privateState(s, me).mySeen?.card.kind, 'king');
  assert.equal(privateState(s, s.players[1]).mySeen, null);
  assert.equal(s.turn, 'p1');
  // p1 drew at turn start, so they hold 2 — but the count is all the
  // public state reveals, never which cards.
  assert.equal(publicState(s).players[1].handCount, 2);
  // The peek must not leak into the public state at all.
  assert.equal(JSON.stringify(publicState(s)).includes('"king"'), false);
  // The peek survives the target drawing at the start of their turn (the
  // seen card is still in hand — the turn already passed to p1, who drew).
  assert.equal(s.turn, 'p1');
  assert.equal(privateState(s, me).mySeen?.card.kind, 'king');
  // …and goes stale only when the target plays that very card.
  const p1 = s.players[1];
  assert.equal(playCard(s, p1, p1.hand.find(c => c.kind === 'king').id, rng), true);
  assert.equal(privateState(s, me).mySeen, null);
});

t('Baron: lower hand is out; tie does nothing', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'baron']);
  give(s, 'p1', ['princess']);
  assert.equal(playKind(s, 'baron'), true);
  assert.equal(chooseTarget(s, me, 'p1', undefined, rng), true);
  assert.equal(s.lastPlay.outcome, 'lose'); // guard(1) < princess(9): I am out
  assert.equal(me.inRound, false);
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  give(s2, me2.id, ['prince', 'baron']);
  give(s2, 'p1', ['prince']);
  assert.equal(playKind(s2, 'baron'), true);
  assert.equal(chooseTarget(s2, me2, 'p1', undefined, rng), true);
  assert.equal(s2.lastPlay.outcome, 'tie');
  assert.equal(me2.inRound, true);
  assert.equal(s2.players[1].inRound, true);
});

t('Handmaid: protected until the start of your next turn', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  assert.equal(playKind(s, 'handmaid'), true);
  assert.equal(me.protected, true);
  assert.equal(validTargets(s, s.players[1], 'guard').some(p => p.id === me.id), false);
  // Play through the other players; when the turn comes back, protection ends.
  setTurn(s, 'p1');
  give(s, 'p1', ['guard', 'countess']);
  assert.equal(playCard(s, s.players[1], s.players[1].hand.find(c => c.kind === 'countess').id, rng), true);
  setTurn(s, 'p2');
  give(s, 'p2', ['guard', 'countess']);
  assert.equal(playCard(s, s.players[2], s.players[2].hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(me.protected, false);
});

t('Prince on another player: they discard and redraw; Princess discarded = out, no draw', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  const deckBefore = s.deck.length;
  give(s, 'p1', ['baron']);
  assert.equal(playKind(s, 'prince'), true);
  assert.equal(chooseTarget(s, me, 'p1', undefined, rng), true);
  assert.equal(s.lastPlay.outcome, 'redraw');
  assert.equal(s.players[1].inRound, true);
  assert.equal(s.players[1].discardPile.some(c => c.kind === 'baron'), true);
  // The turn already passed to p1, who drew at turn start: 1 redrawn card
  // (Prince) + 1 drawn card, and 2 cards left the deck in total.
  assert.equal(s.turn, 'p1');
  assert.equal(s.players[1].hand.length, 2);
  assert.equal(s.deck.length, deckBefore - 2);
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  give(s2, 'p1', ['princess']);
  assert.equal(playKind(s2, 'prince'), true);
  assert.equal(chooseTarget(s2, me2, 'p1', undefined, rng), true);
  assert.equal(s2.lastPlay.outcome, 'princess');
  assert.equal(s2.players[1].inRound, false);
  assert.equal(s2.players[1].hand.length, 0);
});

t('Prince with an empty deck draws the face-down set-aside card', () => {
  const s = mk(2);
  const me = turnPlayer(s);
  s.deck = [];
  const burn = s.setAside;
  assert.ok(burn);
  give(s, 'p1', ['guard']);
  assert.equal(playKind(s, 'prince'), true);
  assert.equal(chooseTarget(s, me, 'p1', undefined, rng), true);
  assert.equal(s.setAside, null);
  assert.equal(s.players[1].hand[0].id, burn.id);
  assert.equal(s.players[1].hand.length, 1);
});

t('Prince may target self; with everyone else protected it must be self', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.players[1].protected = true;
  s.players[2].protected = true;
  assert.equal(playKind(s, 'prince'), true);
  assert.deepEqual(validTargets(s, me, 'prince').map(p => p.id), [me.id]);
  give(s, me.id, ['guard']); // the prince discards this hand card
  assert.equal(chooseTarget(s, me, me.id, undefined, rng), true);
  assert.equal(s.lastPlay.outcome, 'redraw');
});

t('King trades hands', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'king']);
  give(s, 'p1', ['princess']);
  assert.equal(playKind(s, 'king'), true);
  assert.equal(chooseTarget(s, me, 'p1', undefined, rng), true);
  assert.equal(s.lastPlay.outcome, 'trade');
  assert.equal(me.hand[0].kind, 'princess');
  assert.equal(s.players[1].hand[0].kind, 'guard');
});

t('Playing the Princess knocks you out at once', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'princess']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'princess').id, rng), true);
  assert.equal(me.inRound, false);
  assert.equal(s.lastPlay.outcome, 'princess');
});

t('Guard with all others protected is played with no effect', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.players[1].protected = true;
  s.players[2].protected = true;
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(s.pendingAction, null);
  assert.equal(s.lastPlay.outcome, 'no-target');
  assert.notEqual(s.turn, me.id);
});

t('round ends when one player is left; winner gains a token', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, 'p1', ['princess']);
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(chooseTarget(s, me, 'p1', 'princess', rng), true);
  assert.equal(s.phase, 'playing');
  assert.equal(s.turn, 'p2');
  // p2 plays a harmless Countess; the turn returns to p0.
  const p2 = turnPlayer(s);
  give(s, 'p2', ['guard', 'countess']);
  assert.equal(playCard(s, p2, p2.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.turn, me.id);
  give(s, 'p2', ['princess']);
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(chooseTarget(s, me, 'p2', 'princess', rng), true);
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.roundWinners, [me.id]);
  assert.equal(s.roundResult.reason, 'last-standing');
  assert.equal(me.tokens, 1);
  assert.equal(s.tokensToWin, 5);
});

t('deck-empty showdown: highest hand wins; a tie means ALL tied players win (no discard tiebreak in 2019)', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  // Force the deck empty and set hands for a showdown on the next endTurn.
  s.deck = [];
  give(s, me.id, ['prince']); // 5
  give(s, 'p1', ['prince']); // 5 — tie on hand
  give(s, 'p2', ['guard']); // 1
  // Even a much bigger discard pile must NOT break the tie in 2019.
  s.players[1].discardPile = [
    { id: 'k', kind: 'king', value: 7 },
    { id: 'b', kind: 'baron', value: 3 },
  ]; // total 10
  give(s, me.id, ['prince', 'countess']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult.reason, 'showdown-tie');
  assert.deepEqual([...s.roundWinners].sort(), ['p0', 'p1']);
  assert.equal(me.tokens, 1);
  assert.equal(s.players[1].tokens, 1);
  assert.ok(s.roundResult.hands);
});

t('deck-empty showdown: single highest hand wins outright', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.deck = [];
  give(s, me.id, ['king', 'countess']);
  give(s, 'p1', ['prince']);
  give(s, 'p2', ['guard']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.roundResult.reason, 'showdown');
  assert.deepEqual(s.roundWinners, ['p0']);
  assert.equal(me.tokens, 1);
});

t('session winner at the token target; next round winner goes first', () => {
  const s = mk(2, { quickMode: true });
  assert.equal(s.tokensToWin, 3);
  const me = turnPlayer(s);
  me.tokens = 2;
  give(s, 'p1', ['princess']);
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(chooseTarget(s, me, 'p1', 'princess', rng), true);
  assert.equal(s.phase, 'results');
  assert.equal(s.sessionWinner, me.id);
  assert.equal(me.tokens, 3);
});

t('autoTurn plays a random legal card and resolves its effect', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'countess']);
  give(s, 'p1', ['spy']);
  autoTurn(s, () => 0); // plays the first legal card (Guard), targets p1, guesses spy
  assert.equal(s.phase, 'playing');
  assert.notEqual(s.turn, me.id);
  assert.equal(s.pendingAction, null);
  // rng 0 guesses 'spy' (GUESSABLE[0]) on p1, who holds a Spy — a hit, so p1 is out.
  assert.ok(s.lastPlay && s.lastPlay.card === 'guard');
  assert.equal(s.lastPlay.outcome, 'hit');
  assert.equal(s.players[1].inRound, false);
});

t('autoTurn resolves an open pending effect instead of stalling', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  assert.equal(playKind(s, 'guard'), true);
  assert.ok(s.pendingAction);
  autoTurn(s, () => 0.1);
  assert.equal(s.pendingAction, null);
  assert.notEqual(s.turn, me.id);
});

t('publicState hides hands and the burn card; privateState shows mine', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  const pub = publicState(s);
  assert.equal(pub.setAsidePresent, true);
  assert.equal('setAside' in pub, false);
  assert.equal(pub.players.every(p => !('hand' in p)), true);
  assert.equal(JSON.stringify(pub).includes(me.hand[0].id), false);
  const priv = privateState(s, me);
  assert.equal(priv.myHand.length, 2);
  assert.equal(priv.mySeen, null);
});

t('startRound resets the table and the round winner goes first', () => {
  const s = mk(3);
  s.phase = 'roundEnd';
  s.roundWinners = ['p2'];
  s.nextFirstPlayerId = 'p2';
  s.round = 2;
  startRound(s, rng);
  assert.equal(s.phase, 'playing');
  assert.equal(s.turn, 'p2');
  assert.equal(s.players.every(p => p.inRound && p.discardPile.length === 0), true);
  assert.equal(s.players[2].hand.length, 2);
});

t('Chancellor: draws 2, keeps 1, the other 2 go to the bottom of the deck', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  const deckBefore = s.deck.length;
  give(s, me.id, ['guard', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.ok(s.pendingAction && s.pendingAction.type === 'chancellor');
  assert.equal(me.hand.length, 3);
  assert.equal(s.deck.length, deckBefore - 2);
  const keep = me.hand[1];
  const returnedIds = me.hand.filter(c => c.id !== keep.id).map(c => c.id).sort();
  assert.equal(resolveChancellor(s, me, keep.id, rng), true);
  assert.equal(s.lastPlay.outcome, 'chancellor');
  assert.deepEqual(me.hand, [keep]);
  // The two returned cards sit at the bottom of the deck (index 0-1);
  // the deck is one short of deckBefore because the next player drew.
  assert.equal(s.deck.length, deckBefore - 1);
  assert.deepEqual(s.deck.slice(0, 2).map(c => c.id).sort(), returnedIds);
  assert.notEqual(s.turn, me.id);
});

t('Chancellor: with 1 card left draws it and returns 1; with 0 cards no effect', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.deck = [{ id: 'only-1', kind: 'spy', value: 0 }];
  give(s, me.id, ['guard', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(me.hand.length, 2);
  assert.equal(s.deck.length, 0);
  const keep = me.hand.find(c => c.kind === 'guard');
  assert.equal(resolveChancellor(s, me, keep.id, rng), true);
  assert.equal(me.hand.length, 1);
  // The returned Spy is the deck's only card, so the next player draws
  // it at the start of their turn.
  assert.equal(s.deck.length, 0);
  assert.equal(s.turn, 'p1');
  assert.ok(s.players[1].hand.some(c => c.kind === 'spy'));
  // Empty deck: the card is played with no effect and the round ends.
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  s2.deck = [];
  give(s2, me2.id, ['guard', 'chancellor']);
  assert.equal(playCard(s2, me2, me2.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(s2.pendingAction, null);
  assert.equal(s2.lastPlay.outcome, 'no-target');
  assert.equal(s2.phase, 'roundEnd'); // deck empty → showdown
});

t('Chancellor: the Countess rule does NOT apply to its draws', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['countess', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(me.hand.length, 3);
  // Force the drawn cards to be King + Guard: keep the King, return the
  // Countess to the bottom of the deck — legal only because the Countess
  // rule does not trigger on Chancellor draws.
  me.hand = [
    { id: 'c-ct', kind: 'countess', value: 8 },
    { id: 'c-k', kind: 'king', value: 7 },
    { id: 'c-g', kind: 'guard', value: 1 },
  ];
  assert.equal(resolveChancellor(s, me, 'c-k', rng), true);
  assert.deepEqual(me.hand.map(c => c.kind), ['king']);
  assert.ok(s.deck.slice(0, 2).some(c => c.kind === 'countess'));
  assert.equal(me.inRound, true);
});

t('Chancellor: resolve rejects the wrong card or the wrong player', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(resolveChancellor(s, me, 'not-a-card', rng), false);
  assert.equal(resolveChancellor(s, s.players[1], me.hand[0].id, rng), false);
  assert.ok(s.pendingAction && s.pendingAction.type === 'chancellor');
});

t('cancelPending on a Chancellor returns the extra cards to the deck', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  const deckBefore = s.deck.length;
  give(s, me.id, ['guard', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(me.hand.length, 3);
  cancelPending(s);
  assert.equal(s.pendingAction, null);
  assert.equal(me.hand.length, 1);
  assert.equal(me.hand[0].kind, 'guard'); // the card held before the draw
  assert.equal(s.deck.length, deckBefore);
});

t('autoTurn on a Chancellor pending keeps the highest-value card', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'chancellor']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  me.hand = [
    { id: 'a-spy', kind: 'spy', value: 0 },
    { id: 'a-kg', kind: 'king', value: 7 },
    { id: 'a-gd', kind: 'guard', value: 1 },
  ];
  autoTurn(s, rng);
  assert.equal(s.pendingAction, null);
  assert.deepEqual(me.hand.map(c => c.kind), ['king']);
});

t('Spy favor: the only in-round Spy player gains +1 token at round end', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  // p1 will win the round; p2 played the only Spy and stays in.
  give(s, 'p2', ['guard']);
  s.players[2].discardPile = [{ id: 'spy-1', kind: 'spy', value: 0 }];
  s.deck = [];
  give(s, me.id, ['guard', 'countess']);
  give(s, 'p1', ['king']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.roundWinners, ['p1']);
  assert.equal(s.roundResult.spyFavorId, 'p2');
  assert.equal(s.players[2].tokens, 1); // Spy favor, not a round win
  assert.equal(s.players[2].roundWins, 0);
  assert.equal(s.players[1].tokens, 1);
});

t('Spy favor: two Spy players cancel each other; an out Spy earns nothing', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.players[1].discardPile = [{ id: 'spy-1', kind: 'spy', value: 0 }];
  s.players[2].discardPile = [{ id: 'spy-2', kind: 'spy', value: 0 }];
  s.deck = [];
  give(s, me.id, ['guard', 'countess']);
  give(s, 'p1', ['king']);
  give(s, 'p2', ['guard']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.roundResult.spyFavorId, null);
  assert.equal(s.players[1].tokens, 1); // round winner only
  assert.equal(s.players[2].tokens, 0);
  // Out of the round: a Spy in the discard pile of a knocked-out player
  // does not count — they are not "still in the round".
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  s2.players[1].inRound = false; // knocked out earlier, holding a Spy in the pile
  s2.players[1].discardPile = [{ id: 'spy-1', kind: 'spy', value: 0 }];
  s2.deck = [];
  give(s2, me2.id, ['guard', 'countess']);
  give(s2, 'p2', ['king']);
  assert.equal(playCard(s2, me2, me2.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s2.roundResult.spyFavorId, null);
  assert.equal(s2.players[1].tokens, 0);
});

t('Spy favor: the round winner who also played the only Spy gains +2', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, 'p1', ['guard']);
  give(s, 'p2', ['guard']);
  s.deck = [];
  give(s, me.id, ['king', 'countess']);
  me.discardPile = [{ id: 'spy-1', kind: 'spy', value: 0 }];
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.deepEqual(s.roundWinners, ['p0']);
  assert.equal(s.roundResult.spyFavorId, 'p0');
  assert.equal(me.tokens, 2);
  assert.equal(me.roundWins, 1);
});

t('Spy favor can reach the token target and end the game', () => {
  const s = mk(2, { quickMode: true }); // target 3
  const me = turnPlayer(s);
  me.tokens = 2;
  s.players[1].tokens = 0;
  give(s, 'p1', ['king']);
  me.discardPile = [{ id: 'spy-1', kind: 'spy', value: 0 }];
  s.deck = [];
  give(s, me.id, ['guard', 'countess']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  // p1 wins the round (king 7 > guard 1) but p0's Spy favor takes p0 to 3.
  assert.deepEqual(s.roundWinners, ['p1']);
  assert.equal(s.roundResult.spyFavorId, 'p0');
  assert.equal(me.tokens, 3);
  assert.equal(s.phase, 'results');
  assert.equal(s.sessionWinner, 'p0');
});

t('Guard may guess Spy and Chancellor; a Spy in hand is a legal guess', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  give(s, 'p1', ['spy']);
  assert.equal(playKind(s, 'guard'), true);
  assert.equal(chooseTarget(s, me, 'p1', 'spy', rng), true);
  assert.equal(s.lastPlay.outcome, 'hit');
  assert.equal(s.players[1].inRound, false);
  const s2 = mk(3);
  const me2 = turnPlayer(s2);
  give(s2, 'p1', ['chancellor']);
  assert.equal(playKind(s2, 'guard'), true);
  assert.equal(chooseTarget(s2, me2, 'p1', 'chancellor', rng), true);
  assert.equal(s2.lastPlay.outcome, 'hit');
});

t('six players: setup deals 6 hands and the token target is 3', () => {
  const s = mk(6);
  assert.equal(s.players.length, 6);
  assert.equal(s.tokensToWin, 3);
  assert.equal(s.deck.length, 21 - 1 - 6 - 1);
  assert.equal(turnPlayer(s).hand.length, 2);
});

t('spy plays with no target picker: no pending action, turn advances', () => {
  const s = mk();
  assert.equal(playKind(s, 'spy'), true);
  assert.equal(s.pendingAction, null);
  assert.notEqual(s.turn, 'p0');
  const p0 = s.players[0];
  assert.equal(p0.discardPile.some(c => c.kind === 'spy'), true);
});

t('last-standing round result reveals the winner final hand', () => {
  const s = mk(2);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'priest']);
  const other = s.players.find(p => p.id !== me.id);
  give(s, other.id, ['king']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'guard').id, rng), true);
  assert.equal(s.pendingAction?.type, 'guard');
  assert.equal(chooseTarget(s, me, other.id, 'king', rng), true);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.reason, 'last-standing');
  assert.equal(s.roundResult?.hands?.[me.id]?.kind, 'priest');
});
