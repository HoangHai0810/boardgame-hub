// Mèo Nổ engine unit tests. Run: esbuild games/meo-no/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, buildDeck, deal, shuffle,
  playCard, playPair, playNope, passNope, nopePassProgress, canResolveNopeEarly, resolvePendingAction, drawCard, defuse, reinsert,
  reinsertPositions, giveFavorCard, autoTurn, autoResolvePending, advanceTurn,
  publicState, privateState, ekInDeck,
  MIN_PLAYERS, MAX_PLAYERS, TURN_MS, NOPE_MS,
} from '../games/meo-no/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const rng = () => 0.5;
const mkPlayer = (id, hand) => ({ id, name: id, isHost: id === 'p0', connected: true, hand, wins: 0, alive: true, explodedTurn: null });
const C = (id, kind, variant) => ({ id, kind, ...(variant ? { variant } : {}) });
const mk = (hands, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  s.players = hands.map((h, i) => mkPlayer('p' + i, h));
  s.phase = 'playing'; s.turn = 'p0'; s.turnCount = 1;
  s.deck = [C('d1', 'cat', 'tabby'), C('d2', 'cat', 'black'), C('d3', 'skip')];
  return s;
};

t('limits 2-5, 30s turns, 5s nope window', () => {
  assert.equal(MIN_PLAYERS, 2); assert.equal(MAX_PLAYERS, 5);
  assert.equal(TURN_MS, 30000); assert.equal(NOPE_MS, 5000);
});

t('deck is 50 cards before EKs (6 defuse, 4x6 actions, 20 cats)', () => {
  const d = buildDeck();
  assert.equal(d.length, 50);
  assert.equal(new Set(d.map(c => c.id)).size, 50);
  assert.equal(d.filter(c => c.kind === 'defuse').length, 6);
  assert.equal(d.filter(c => c.kind === 'nope').length, 4);
  assert.equal(d.filter(c => c.kind === 'attack').length, 4);
  assert.equal(d.filter(c => c.kind === 'cat').length, 20);
  assert.equal(d.filter(c => c.kind === 'cat' && c.variant === 'tabby').length, 4);
});

t('deal gives 7 each incl 1 defuse; EKs = players-1', () => {
  const s = createGame('X');
  for (let i = 0; i < 4; i++) s.players.push(mkPlayer('p' + i, []));
  s.phase = 'playing';
  deal(s, rng);
  s.players.forEach(p => {
    assert.equal(p.hand.length, 7);
    assert.equal(p.hand.filter(c => c.kind === 'defuse').length, 1);
  });
  assert.equal(ekInDeck(s), 3);
  assert.equal(s.turn, 'p0');
});

t('cat cards and defuse are not playable; nope is not played via playCard', () => {
  const s = mk([[C('c1', 'cat', 'tabby'), C('df', 'defuse'), C('np', 'nope'), C('sk', 'skip')]]);
  assert.equal(playCard(s, s.players[0], 'c1'), false);
  assert.equal(playCard(s, s.players[0], 'df'), false);
  assert.equal(playCard(s, s.players[0], 'np'), false);
  assert.equal(s.players[0].hand.length, 4);
});

t('skip ends the turn without drawing (nope off)', () => {
  const s = mk([[C('sk', 'skip'), C('c1', 'cat', 'tabby')]], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'sk'), true);
  assert.equal(s.turn, 'p0'); // only 1 player in mk() — advanceTurn wraps to self
  assert.equal(s.deck.length, 3); // nothing drawn
});

t('skip with attack debt cancels one owed draw', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('a1', 'attack')],
  ], { nopeEnabled: false });
  s.debt = 2; // p0 owes 2 draws
  assert.equal(playCard(s, s.players[0], 'sk'), true);
  assert.equal(s.debt, 1);
  assert.equal(s.turn, 'p0'); // still owes 1
});

t('attack gives the next player a debt of 2 and passes the turn', () => {
  const s = mk([
    [C('a1', 'attack')],
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'a1'), true);
  assert.equal(s.turn, 'p1');
  assert.equal(s.debt, 2);
});

t('attack answers attack: debt stacks to 4 and passes on', () => {
  const s = mk([
    [C('a1', 'attack')],
    [C('a2', 'attack')],
    [C('c1', 'cat', 'tabby')],
  ], { nopeEnabled: false });
  s.turn = 'p0'; s.debt = 2; // p0 was attacked, answers with attack
  assert.equal(playCard(s, s.players[0], 'a1'), true);
  assert.equal(s.turn, 'p1');
  assert.equal(s.debt, 4);
});

t('drawing twice clears a debt of 2, then the turn passes', () => {
  const s = mk([
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ]);
  s.debt = 2;
  drawCard(s, s.players[0], rng);
  assert.equal(s.debt, 1);
  assert.equal(s.turn, 'p0');
  drawCard(s, s.players[0], rng);
  assert.equal(s.debt, 0);
  assert.equal(s.turn, 'p1');
});

t('shuffle reshuffles the deck but keeps its size', () => {
  const s = mk([[C('sh', 'shuffle')]], { nopeEnabled: false });
  const before = s.deck.map(c => c.id).join(',');
  assert.equal(playCard(s, s.players[0], 'sh'), true);
  assert.equal(s.deck.length, 3);
  assert.deepEqual([...s.deck.map(c => c.id)].sort(), [...before.split(',')].sort());
});

t('peek shows the top 3 privately, leftmost is drawn first', () => {
  const s = mk([[C('pk', 'peek')]], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'pk'), true);
  assert.equal(s.peekShownFor, 'p0');
  const priv = privateState(s, s.players[0]);
  assert.equal(priv.peekCards.length, 3);
  assert.equal(priv.peekCards[0].id, 'd3'); // deck top (end) is first
  assert.equal(privateState(s, s.players[0]).peekCards[0].id, 'd3');
});

t('favor: target hands over a card of their choice', () => {
  const s = mk([
    [C('fv', 'favor')],
    [C('c1', 'cat', 'tabby'), C('c2', 'cat', 'black')],
  ], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'fv', 'p1'), true);
  assert.deepEqual(s.pendingFavor, { fromId: 'p0', targetId: 'p1' });
  assert.equal(giveFavorCard(s, s.players[1], 'c2'), true);
  assert.equal(s.pendingFavor, null);
  assert.equal(s.players[0].hand.some(c => c.id === 'c2'), true);
  assert.equal(s.players[1].hand.length, 1);
});

t('favor to self or a dead player is rejected', () => {
  const s = mk([
    [C('fv', 'favor')],
    [C('c1', 'cat', 'tabby')],
  ], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'fv', 'p0'), false);
  s.players[1].alive = false;
  assert.equal(playCard(s, s.players[0], 'fv', 'p1'), false);
});

t('nope: one nope cancels the action, two nopes let it through', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('np', 'nope')],
    [C('np2', 'nope')],
  ]); // nopeEnabled defaults true
  assert.equal(playCard(s, s.players[0], 'sk'), true);
  assert.equal(s.pendingAction?.kind, 'skip');
  assert.equal(s.players[0].hand.length, 0); // card held out of hand
  // The actor may not nope their own card.
  s.players[0].hand.push(C('np0', 'nope'));
  assert.equal(playNope(s, s.players[0]), false);
  // p1 nopes it.
  assert.equal(playNope(s, s.players[1]), true);
  assert.equal(s.pendingAction.nopes.length, 1);
  // p1 may not nope their own nope.
  s.players[1].hand.push(C('np1b', 'nope'));
  assert.equal(playNope(s, s.players[1]), false);
  // p2 nopes the nope.
  assert.equal(playNope(s, s.players[2]), true);
  assert.equal(s.pendingAction.nopes.length, 2);
  resolvePendingAction(s, rng);
  assert.equal(s.pendingAction, null);
  // Even nopes: the skip resolves — turn passed (only p0 alive-turns here;
  // with 3 players the turn moves to p1).
  assert.equal(s.turn, 'p1');
});

t('nope: a single unanswered nope blocks the action', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('np', 'nope')],
  ]);
  playCard(s, s.players[0], 'sk');
  assert.equal(playNope(s, s.players[1]), true);
  resolvePendingAction(s, rng);
  assert.equal(s.turn, 'p0'); // skip never happened
  assert.equal(s.discard.some(c => c.id === 'sk'), true); // noped card is discarded
});

t('nope: early resolve when nobody holds a Nope', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ]);
  playCard(s, s.players[0], 'sk');
  assert.equal(canResolveNopeEarly(s), true);
  const pub = publicState(s);
  assert.equal(pub.pendingAction.passed, 0);
  assert.equal(pub.pendingAction.passNeeded, 0);
});

t('nope: pass ends the window early once every Nope-holder passes', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('np', 'nope')],
    [C('c2', 'cat', 'black')],
  ]);
  playCard(s, s.players[0], 'sk');
  assert.equal(canResolveNopeEarly(s), false);
  assert.deepEqual(nopePassProgress(s), { passed: 0, needed: 1 });
  assert.equal(passNope(s, s.players[1]), true);
  assert.equal(passNope(s, s.players[1]), false); // already passed
  assert.equal(canResolveNopeEarly(s), true);
  // The non-holder (p2, no Nope in hand) never blocks and needs no pass.
  assert.deepEqual(nopePassProgress(s), { passed: 1, needed: 1 });
});

t('nope: passing is binding for the round — a passer cannot Nope after', () => {
  const s = mk([[C('sk', 'skip')], [C('np', 'nope')]]);
  playCard(s, s.players[0], 'sk');
  assert.equal(passNope(s, s.players[1]), true);
  assert.equal(playNope(s, s.players[1]), false);
});

t('nope: a new Nope resets passes — actor and first passer must pass again', () => {
  const s = mk([
    [C('sk', 'skip'), C('np0', 'nope')],
    [C('np', 'nope')],
    [C('np2', 'nope')],
  ]);
  playCard(s, s.players[0], 'sk');
  assert.equal(passNope(s, s.players[1]), true);
  assert.equal(canResolveNopeEarly(s), false); // p2 still owes a pass
  // p2 nopes the skip — fresh round, passes reset.
  assert.equal(playNope(s, s.players[2]), true);
  assert.equal(s.pendingAction.passes.length, 0);
  assert.equal(canResolveNopeEarly(s), false); // p0 (actor) and p1 can both nope the nope
  assert.deepEqual(nopePassProgress(s), { passed: 0, needed: 2 });
  assert.equal(passNope(s, s.players[0]), true);
  assert.equal(canResolveNopeEarly(s), false); // p1 still owes a pass
  assert.equal(passNope(s, s.players[1]), true);
  assert.equal(canResolveNopeEarly(s), true);
});

t('nope: a disconnected Nope-holder does not block early resolve', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('np', 'nope')],
  ]);
  playCard(s, s.players[0], 'sk');
  assert.equal(canResolveNopeEarly(s), false);
  s.players[1].connected = false;
  assert.equal(canResolveNopeEarly(s), true);
  assert.deepEqual(nopePassProgress(s), { passed: 0, needed: 0 });
});

t('nope disabled: actions resolve at once', () => {
  const s = mk([[C('sk', 'skip')]], { nopeEnabled: false });
  assert.equal(playCard(s, s.players[0], 'sk'), true);
  assert.equal(s.pendingAction, null);
});

t('drawing an EK with a defuse opens the defuse flow', () => {
  const s = mk([[C('df', 'defuse')]]);
  s.deck = [C('c9', 'cat', 'white'), { id: 'ek-0', kind: 'exploding' }];
  const drawn = drawCard(s, s.players[0], rng);
  assert.equal(drawn?.kind, 'exploding');
  assert.deepEqual(s.pendingExplode, { playerId: 'p0', hasDefuse: true });
  assert.equal(s.players[0].alive, true);
  assert.equal(s.turn, 'p0'); // turn waits for the defuse choice
});

t('defuse + reinsert at the top: the next player draws the EK', () => {
  const s = mk([[C('df', 'defuse')]]);
  s.deck = [C('c9', 'cat', 'white'), { id: 'ek-0', kind: 'exploding' }];
  drawCard(s, s.players[0], rng);
  assert.equal(defuse(s, s.players[0]), true);
  assert.equal(s.pendingReinsert, 'p0');
  assert.equal(s.players[0].hand.some(c => c.kind === 'defuse'), false);
  const opts = reinsertPositions(s);
  assert.deepEqual(opts.map(o => o.pos), [1, 2]);
  assert.equal(reinsert(s, s.players[0], 1), true);
  assert.equal(s.deck[s.deck.length - 1].kind, 'exploding'); // top of deck
  assert.equal(s.pendingReinsert, null);
});

t('reinsert positions for a 17-card deck are 1/2/3/9/18', () => {
  const s = mk([[]]);
  s.deck = Array.from({ length: 17 }, (_, i) => C('d' + i, 'cat', 'tabby'));
  assert.deepEqual(reinsertPositions(s).map(o => o.pos), [1, 2, 3, 9, 18]);
});

t('drawing an EK without a defuse eliminates at once', () => {
  const s = mk([
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
    [C('c3', 'cat', 'white')],
  ]);
  s.deck = [C('c9', 'cat', 'white'), { id: 'ek-0', kind: 'exploding' }];
  drawCard(s, s.players[0], rng);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.players[0].explodedTurn, 1);
  assert.equal(s.players[0].hand.length, 0); // hand discarded
  assert.equal(s.turn, 'p1');
  assert.equal(s.phase, 'playing'); // 2 alive left
});

t('last player standing wins; wins increment', () => {
  const s = mk([
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ]);
  s.deck = [{ id: 'ek-0', kind: 'exploding' }];
  drawCard(s, s.players[0], rng);
  assert.equal(s.phase, 'results');
  assert.equal(s.winner, 'p1');
  assert.equal(s.players[1].wins, 1);
});

t('autoTurn defuses and reinserts mid-deck by default', () => {
  const s = mk([[C('df', 'defuse')]]);
  s.deck = [C('c9', 'cat', 'white'), C('c8', 'cat', 'black'), { id: 'ek-0', kind: 'exploding' }];
  drawCard(s, s.players[0], rng);
  autoTurn(s, rng);
  assert.equal(s.pendingExplode, null);
  assert.equal(s.pendingReinsert, null);
  assert.equal(ekInDeck(s), 1);
});

t('autoResolvePending gives a random card for a forgotten favor', () => {
  const s = mk([
    [C('fv', 'favor')],
    [C('c1', 'cat', 'tabby'), C('c2', 'cat', 'black')],
  ], { nopeEnabled: false });
  playCard(s, s.players[0], 'fv', 'p1');
  autoResolvePending(s, () => 0);
  assert.equal(s.pendingFavor, null);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[1].hand.length, 1);
});

t('publicState hides hands and other players counts when showCounts is off', () => {
  const s = mk([
    [C('c1', 'cat', 'tabby'), C('c2', 'cat', 'black')],
    [C('c3', 'cat', 'white')],
  ], { showCounts: false });
  const pub = publicState(s);
  assert.equal(pub.players[0].handCount, null);
  assert.equal(pub.players[1].handCount, null);
  assert.equal(pub.deckCount, 3);
  assert.equal(pub.ekInDeck, 0);
  assert.equal(privateState(s, s.players[0]).myHand.length, 2);
});

t('dead players are skipped in turn order', () => {
  const s = mk([
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
    [C('c3', 'cat', 'white')],
  ]);
  s.players[1].alive = false;
  advanceTurn(s);
  assert.equal(s.turn, 'p2');
});

console.log(`\n== ${n} meo-no logic tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);

t('pair: two matching cats steal one random card from the target', () => {
  const stolen = C('x1', 'skip');
  const s = mk([
    [C('a1', 'cat', 'tabby'), C('a2', 'cat', 'tabby'), C('df', 'defuse')],
    [stolen, C('y2', 'peek')],
  ]);
  assert.equal(playPair(s, s.players[0], 'a1', 'a2', 'p1', () => 0), true);
  // actor: -2 cats +1 stolen = 2 cards; target lost its first card (rng 0)
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.players[0].hand.some(c => c.id === 'x1'), true);
  assert.equal(s.players[1].hand.length, 1);
  assert.equal(s.discard.length, 2);
  assert.equal(s.feed[s.feed.length - 1].kind, 'steal');
});

t('pair: mismatched variants, same card twice, non-cats rejected', () => {
  const s = mk([
    [C('a1', 'cat', 'tabby'), C('a2', 'cat', 'black'), C('sk', 'skip'), C('sk2', 'skip')],
    [C('x1', 'skip')],
  ]);
  assert.equal(playPair(s, s.players[0], 'a1', 'a2', 'p1'), false);
  assert.equal(playPair(s, s.players[0], 'a1', 'a1', 'p1'), false);
  assert.equal(playPair(s, s.players[0], 'sk', 'sk2', 'p1'), false);
  assert.equal(s.players[0].hand.length, 4);
  assert.equal(s.players[1].hand.length, 1);
});

t('pair: self-target, empty-handed target, wrong turn rejected', () => {
  const s = mk([
    [C('a1', 'cat', 'tabby'), C('a2', 'cat', 'tabby')],
    [C('x1', 'skip')],
    [],
  ]);
  assert.equal(playPair(s, s.players[0], 'a1', 'a2', 'p0'), false);
  assert.equal(playPair(s, s.players[0], 'a1', 'a2', 'p2'), false);
  assert.equal(playPair(s, s.players[1], 'a1', 'a2', 'p0'), false);
  assert.equal(s.players[0].hand.length, 2);
});
