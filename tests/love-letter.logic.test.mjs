// Love Letter engine unit tests.
// Run: esbuild games/love-letter/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, buildDeck, startRound, playCard, chooseTarget, autoTurn,
  legalPlays, validTargets, tokensFor, knockOut, publicState, privateState,
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

t('limits 2-4, deck is 16 with the exact official counts', () => {
  assert.equal(MIN_PLAYERS, 2); assert.equal(MAX_PLAYERS, 4);
  const deck = buildDeck();
  assert.equal(deck.length, 16);
  assert.equal(CARD_COUNT.guard, 5); assert.equal(CARD_COUNT.priest, 2);
  assert.equal(CARD_COUNT.baron, 2); assert.equal(CARD_COUNT.handmaid, 2);
  assert.equal(CARD_COUNT.prince, 2); assert.equal(CARD_COUNT.king, 1);
  assert.equal(CARD_COUNT.countess, 1); assert.equal(CARD_COUNT.princess, 1);
  assert.equal(new Set(deck.map(c => c.id)).size, 16);
  assert.deepEqual(GUESSABLE, ['priest', 'baron', 'handmaid', 'prince', 'king', 'countess', 'princess']);
});

t('tokens to win: 2p=7, 3p=5, 4p=4, quick mode 3', () => {
  assert.equal(tokensFor(2, false), 7);
  assert.equal(tokensFor(3, false), 5);
  assert.equal(tokensFor(4, false), 4);
  assert.equal(tokensFor(2, true), 3);
  assert.equal(tokensFor(4, true), 3);
});

t('setup: 1 burn card, 1 card each, first player draws a second', () => {
  const s = mk(4);
  assert.equal(s.phase, 'playing');
  assert.ok(s.setAside);
  assert.equal(s.faceUpRemoved.length, 0);
  assert.equal(s.deck.length, 16 - 1 - 4 - 1);
  assert.equal(turnPlayer(s).hand.length, 2);
  s.players.filter(p => p.id !== s.turn).forEach(p => assert.equal(p.hand.length, 1));
});

t('setup 2-player: 1 burn + 3 face-up removed, all public', () => {
  const s = mk(2);
  assert.equal(s.faceUpRemoved.length, 3);
  assert.equal(s.deck.length, 16 - 1 - 3 - 2 - 1);
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
  assert.equal(s.lastPlay.outcome, 'lose'); // guard(1) < princess(8): I am out
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

t('deck-empty showdown: highest hand wins; tie broken by discard total', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  // Force the deck empty and set hands for a showdown on the next endTurn.
  s.deck = [];
  give(s, me.id, ['prince']); // 5
  give(s, 'p1', ['prince']); // 5 — tie on hand
  give(s, 'p2', ['guard']); // 1
  // p0's pile will be [countess] = 7 after the play below; p1's pile must
  // beat it for the tiebreak.
  s.players[1].discardPile = [
    { id: 'k', kind: 'king', value: 6 },
    { id: 'b', kind: 'baron', value: 3 },
  ]; // total 9
  give(s, me.id, ['prince', 'countess']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult.reason, 'showdown-tiebreak');
  assert.deepEqual(s.roundWinners, ['p1']);
  assert.equal(s.players[1].tokens, 1);
  assert.ok(s.roundResult.hands);
});

t('deck-empty showdown: full tie means all tied players win', () => {
  const s = mk(3);
  const me = turnPlayer(s);
  s.deck = [];
  give(s, me.id, ['prince', 'countess']);
  give(s, 'p1', ['prince']);
  give(s, 'p2', ['guard']);
  // Both tied players' discard piles must total the same: p0's pile will
  // be [countess] = 7 after the play, so p1's pile is set to 5 + 2 = 7.
  s.players[1].discardPile = [
    { id: 'pr', kind: 'prince', value: 5 },
    { id: 'pp', kind: 'priest', value: 2 },
  ];
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'countess').id, rng), true);
  assert.equal(s.roundResult.reason, 'showdown-tie');
  assert.deepEqual([...s.roundWinners].sort(), ['p0', 'p1']);
  assert.equal(me.tokens, 1);
  assert.equal(s.players[1].tokens, 1);
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
  give(s, 'p1', ['priest']);
  autoTurn(s, () => 0); // plays the first legal card (Guard), targets p1, guesses priest
  assert.equal(s.phase, 'playing');
  assert.notEqual(s.turn, me.id);
  assert.equal(s.pendingAction, null);
  // rng 0 guesses 'priest' on p1, who holds a Priest — a hit, so p1 is out.
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
