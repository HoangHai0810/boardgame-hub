// Coup engine unit tests.
// Run: esbuild games/coup/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, buildDeck, startGame, declareAction, respond, respondBlockWindow,
  respondBlock, chooseLose, chooseExchange, resolveAction, autoStep, markPassed,
  legalActions, publicState, privateState,
  CHAR_COUNT, CHARS, MIN_PLAYERS, MAX_PLAYERS, COUP_COST, ASSASSIN_COST,
} from '../games/coup/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
// rng 0: deterministic shuffle AND the first player is always p0
// (Math.floor(0 * n) = 0), so tests can reason about the turn player.
const rng = () => 0;
const mkPlayer = (id) => ({ id, name: id, isHost: id === 'p0', connected: true, hand: [], revealed: [], coins: 0, eliminated: false });
// A fresh game in 'playing', with the turn on p0.
const mk = (count = 4, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  for (let i = 0; i < count; i++) s.players.push(mkPlayer('p' + i));
  startGame(s, rng);
  return s;
};
const turnPlayer = (s) => s.players.find(p => p.id === s.turn);
const give = (s, playerId, kinds) => {
  const p = s.players.find(x => x.id === playerId);
  p.hand = kinds.map((kind, i) => ({ id: `${kind}-t${i}`, kind }));
  return p;
};
const setTurn = (s, playerId) => { s.turn = playerId; s.pending = null; };
const setCoins = (s, playerId, coins) => { s.players.find(x => x.id === playerId).coins = coins; };
// Declare `kind` from the turn player's hand (giving them that card first
// is unnecessary — Coup claims need no proof until challenged).
const declare = (s, kind, targetId) => {
  const me = turnPlayer(s);
  return declareAction(s, me, kind, targetId, rng);
};
// Everyone except the actor passes the open window.
const allPass = (s) => {
  const p = s.pending;
  assert.ok(p && (p.stage === 'respond' || p.stage === 'blockWindow' || p.stage === 'blockRespond'));
  const actor = p.stage === 'blockRespond' ? p.blockerId : p.action.actorId;
  for (const pl of s.players) {
    if (pl.id === actor || pl.eliminated) continue;
    if (p.stage === 'respond') respond(s, pl, 'pass', undefined, rng);
    else if (p.stage === 'blockWindow') respondBlockWindow(s, pl, 'pass', undefined, rng);
    else respondBlock(s, pl, 'pass', rng);
    if (!s.pending) break;
  }
};

t('deck is 15 with exactly 3 of each of the 5 characters', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 15);
  for (const k of CHARS) assert.equal(deck.filter(c => c.kind === k).length, CHAR_COUNT[k]);
  assert.equal(MIN_PLAYERS, 2);
  assert.equal(MAX_PLAYERS, 6);
});

t('setup: 2 cards + 2 coins each, court keeps the rest', () => {
  const s = mk(4);
  assert.equal(s.phase, 'playing');
  assert.equal(s.court.length, 15 - 8);
  for (const p of s.players) { assert.equal(p.hand.length, 2); assert.equal(p.coins, 2); assert.equal(p.eliminated, false); }
  assert.equal(s.turn, 'p0');
});

t('2-player game: the starting player gets only 1 coin', () => {
  const s = mk(2);
  assert.equal(s.court.length, 15 - 4);
  assert.equal(s.players[0].coins, 1); // p0 starts
  assert.equal(s.players[1].coins, 2);
});

t('income: +1 coin and the turn advances', () => {
  const s = mk();
  assert.equal(declare(s, 'income'), true);
  assert.equal(s.players[0].coins, 3);
  assert.equal(s.turn, 'p1');
  assert.equal(s.pending, null);
});

t('foreign aid: +2 after everyone passes; cannot be challenged', () => {
  const s = mk();
  assert.equal(declare(s, 'foreign-aid'), true);
  assert.equal(s.pending.stage, 'respond');
  // Foreign Aid claims no character: a challenge is rejected.
  assert.equal(respond(s, s.players[1], 'challenge', undefined, rng), false);
  allPass(s);
  assert.equal(s.players[0].coins, 4);
  assert.equal(s.turn, 'p1');
});

t('tax: +3 after everyone passes', () => {
  const s = mk();
  assert.equal(declare(s, 'tax'), true);
  allPass(s);
  assert.equal(s.players[0].coins, 5);
});

t('legal actions: assassinate needs 3 coins, coup needs 7', () => {
  const s = mk();
  const me = turnPlayer(s);
  assert.deepEqual(legalActions(s, me).sort(), ['exchange', 'foreign-aid', 'income', 'steal', 'tax']);
  setCoins(s, 'p0', 3);
  assert.ok(legalActions(s, me).includes('assassinate'));
  assert.ok(!legalActions(s, me).includes('coup'));
  setCoins(s, 'p0', 7);
  assert.ok(legalActions(s, me).includes('coup'));
  assert.equal(declareAction(s, me, 'assassinate', 'p1', rng), true);
  assert.equal(me.coins, 4); // 3 paid at declaration
});

t('forced coup at 10+ coins: only coup is legal', () => {
  const s = mk();
  const me = turnPlayer(s);
  setCoins(s, 'p0', 10);
  assert.deepEqual(legalActions(s, me), ['coup']);
  assert.equal(declareAction(s, me, 'income', undefined, rng), false);
  assert.equal(declareAction(s, me, 'tax', undefined, rng), false);
  assert.equal(declareAction(s, me, 'coup', 'p1', rng), true);
  assert.equal(me.coins, 3);
});

t('coup: target loses an influence at once (chooses which card)', () => {
  const s = mk();
  const me = turnPlayer(s);
  setCoins(s, 'p0', 7);
  give(s, 'p1', ['duke', 'captain']);
  assert.equal(declare(s, 'coup', 'p1'), true);
  assert.equal(s.pending.stage, 'chooseLose');
  assert.equal(s.pending.playerId, 'p1');
  const p1 = s.players[1];
  assert.equal(chooseLose(s, p1, 'captain-t1', rng), true);
  assert.equal(p1.hand.length, 1);
  assert.deepEqual(p1.revealed.map(c => c.kind), ['captain']);
  assert.equal(p1.eliminated, false);
  assert.equal(s.turn, 'p1');
});

t('coup on a 1-card target eliminates them at once', () => {
  const s = mk();
  setCoins(s, 'p0', 7);
  const p1 = s.players[1];
  p1.hand = [{ id: 'duke-x', kind: 'duke' }];
  assert.equal(declare(s, 'coup', 'p1'), true);
  assert.equal(s.pending, null); // auto-reveal, no choice
  assert.equal(p1.eliminated, true);
  assert.equal(p1.coins, 0); // coins return to the Treasury
  assert.deepEqual(s.eliminationOrder, ['p1']);
  assert.equal(s.turn, 'p2');
});

t('declareAction validation: wrong turn, bad target, self-target, unaffordable', () => {
  const s = mk();
  const p1 = s.players[1];
  assert.equal(declareAction(s, p1, 'income', undefined, rng), false); // not their turn
  assert.equal(declareAction(s, turnPlayer(s), 'coup', 'p0', rng), false); // self
  assert.equal(declareAction(s, turnPlayer(s), 'coup', 'p9', rng), false); // no such player
  assert.equal(declareAction(s, turnPlayer(s), 'coup', 'p1', rng), false); // only 2 coins
  assert.equal(declareAction(s, turnPlayer(s), 'steal', 'p1', rng), true);
});

t('steal: takes 2 coins, or 1 when the target has only 1', () => {
  const s = mk();
  setCoins(s, 'p1', 1);
  assert.equal(declare(s, 'steal', 'p1'), true);
  allPass(s);
  assert.equal(s.players[0].coins, 3); // 2 + 1 stolen
  assert.equal(s.players[1].coins, 0);
  const s2 = mk();
  setCoins(s2, 'p1', 5);
  setTurn(s2, 'p0');
  assert.equal(declareAction(s2, s2.players[0], 'steal', 'p1', rng), true);
  allPass(s2);
  assert.equal(s2.players[0].coins, 4);
  assert.equal(s2.players[1].coins, 3);
});

t('challenge on tax, actor proves it: challenger loses influence, tax pays, card replaced', () => {
  const s = mk();
  give(s, 'p0', ['duke', 'captain']);
  give(s, 'p1', ['assassin', 'contessa']);
  const courtBefore = s.court.length;
  assert.equal(declare(s, 'tax'), true);
  assert.equal(respond(s, s.players[1], 'challenge', undefined, rng), true);
  // Challenger must choose which influence to lose (2 cards).
  assert.equal(s.pending.stage, 'chooseLose');
  assert.equal(s.pending.playerId, 'p1');
  const p0 = s.players[0];
  assert.equal(p0.hand.length, 2); // shown Duke returned, replacement drawn
  assert.equal(s.court.length, courtBefore); // return 1, draw 1
  assert.ok(!p0.hand.some(c => c.id === 'duke-t0')); // the shown card left the hand
  chooseLose(s, s.players[1], 'assassin-t0', rng);
  assert.equal(s.players[0].coins, 5); // tax resolved
  assert.equal(s.players[1].revealed.map(c => c.kind).join(), 'assassin');
  assert.equal(s.turn, 'p1');
});

t('challenge on tax, actor bluffs: actor loses influence, action fails', () => {
  const s = mk();
  give(s, 'p0', ['captain', 'ambassador']); // no Duke
  give(s, 'p1', ['assassin', 'contessa']);
  assert.equal(declare(s, 'tax'), true);
  assert.equal(respond(s, s.players[1], 'challenge', undefined, rng), true);
  assert.equal(s.pending.stage, 'chooseLose');
  assert.equal(s.pending.playerId, 'p0');
  chooseLose(s, s.players[0], 'captain-t0', rng);
  assert.equal(s.players[0].coins, 2); // no tax
  assert.equal(s.players[0].revealed.map(c => c.kind).join(), 'captain');
  assert.equal(s.turn, 'p1');
});

t('challenge on assassinate, actor bluffs: 3 coins refunded, target safe', () => {
  const s = mk();
  give(s, 'p0', ['duke', 'captain']); // no Assassin
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  assert.equal(s.players[0].coins, 2); // 3 paid at declaration
  assert.equal(respond(s, s.players[2], 'challenge', undefined, rng), true);
  chooseLose(s, s.players[0], 'duke-t0', rng);
  assert.equal(s.players[0].coins, 5); // refunded
  assert.equal(s.players[1].hand.length, 2); // target untouched
  assert.equal(s.turn, 'p1');
});

t('challenge on assassinate, actor proves: block window opens, Contessa blocks, coins stay spent', () => {
  const s = mk();
  give(s, 'p0', ['assassin', 'captain']);
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  // p2 challenges; p0 proves the Assassin.
  assert.equal(respond(s, s.players[2], 'challenge', undefined, rng), true);
  assert.equal(s.pending.stage, 'chooseLose');
  chooseLose(s, s.players[2], s.players[2].hand[0].id, rng);
  // Block window: only the target (p1) may block.
  assert.equal(s.pending.stage, 'blockWindow');
  assert.equal(respondBlockWindow(s, s.players[2], 'block', 'contessa', rng), false); // not the target
  assert.equal(respondBlockWindow(s, s.players[1], 'block', 'contessa', rng), true);
  assert.equal(s.pending.stage, 'blockRespond');
  // Nobody challenges the block: it stands, the 3 coins stay spent.
  allPass(s);
  assert.equal(s.players[0].coins, 2);
  assert.equal(s.players[1].hand.length, 2);
  assert.equal(s.turn, 'p1');
});

t('block on foreign aid (Duke, any player) stops the +2', () => {
  const s = mk();
  assert.equal(declare(s, 'foreign-aid'), true);
  assert.equal(respond(s, s.players[3], 'block', 'duke', rng), true);
  assert.equal(s.pending.stage, 'blockRespond');
  allPass(s);
  assert.equal(s.players[0].coins, 2);
  assert.equal(s.turn, 'p1');
});

t('block challenge, blocker proves: challenger loses influence, block stands', () => {
  const s = mk();
  give(s, 'p3', ['duke', 'captain']);
  assert.equal(declare(s, 'foreign-aid'), true);
  assert.equal(respond(s, s.players[3], 'block', 'duke', rng), true);
  assert.equal(respondBlock(s, s.players[1], 'challenge', rng), true);
  assert.equal(s.pending.stage, 'chooseLose');
  assert.equal(s.pending.playerId, 'p1');
  chooseLose(s, s.players[1], s.players[1].hand[0].id, rng);
  assert.equal(s.players[0].coins, 2); // blocked
  assert.equal(s.turn, 'p1');
});

t('block challenge, blocker bluffs: blocker loses influence, action resolves', () => {
  const s = mk();
  give(s, 'p3', ['captain', 'ambassador']); // no Duke
  assert.equal(declare(s, 'foreign-aid'), true);
  assert.equal(respond(s, s.players[3], 'block', 'duke', rng), true);
  assert.equal(respondBlock(s, s.players[1], 'challenge', rng), true);
  assert.equal(s.pending.stage, 'chooseLose');
  assert.equal(s.pending.playerId, 'p3');
  chooseLose(s, s.players[3], 'captain-t0', rng);
  assert.equal(s.players[0].coins, 4); // foreign aid resolves
  assert.equal(s.turn, 'p1');
});

t('block on steal: Captain or Ambassador, target only', () => {
  const s = mk();
  setCoins(s, 'p1', 5);
  assert.equal(declare(s, 'steal', 'p1'), true);
  assert.equal(respond(s, s.players[2], 'block', 'captain', rng), false); // not the target
  assert.equal(respond(s, s.players[1], 'block', 'duke', rng), false); // Duke cannot block a steal
  assert.equal(respond(s, s.players[1], 'block', 'ambassador', rng), true);
  allPass(s);
  assert.equal(s.players[0].coins, 2);
  assert.equal(s.players[1].coins, 5);
});

t('first response wins: a challenge closes the window to blocks', () => {
  const s = mk();
  give(s, 'p0', ['assassin', 'captain']);
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  assert.equal(respond(s, s.players[2], 'challenge', undefined, rng), true);
  // The window is gone: a block now is rejected.
  assert.equal(respond(s, s.players[1], 'block', 'contessa', rng), false);
  assert.equal(respondBlockWindow(s, s.players[1], 'block', 'contessa', rng), false); // not in blockWindow yet
  // Resolve the challenger's influence loss; the block window opens.
  chooseLose(s, s.players[2], s.players[2].hand[0].id, rng);
  assert.equal(s.pending.stage, 'blockWindow');
  // A second challenge on the proven claim is rejected in the block window.
  assert.equal(respondBlockWindow(s, s.players[3], 'block', 'contessa', rng), false); // p3 is not the target
  assert.equal(respondBlockWindow(s, s.players[1], 'block', 'contessa', rng), true);
});

t('double danger: failed challenge against the assassin costs the target twice', () => {
  const s = mk();
  give(s, 'p0', ['assassin', 'captain']);
  give(s, 'p1', ['duke', 'contessa']);
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  // The target challenges and loses: -1 influence for the challenge…
  assert.equal(respond(s, s.players[1], 'challenge', undefined, rng), true);
  assert.equal(s.pending.stage, 'chooseLose');
  chooseLose(s, s.players[1], 'duke-t0', rng);
  // …then the block window opens, the target passes, and the assassination
  // takes the last influence.
  assert.equal(s.pending.stage, 'blockWindow');
  assert.equal(respondBlockWindow(s, s.players[1], 'pass', undefined, rng), true);
  assert.equal(s.players[1].eliminated, true);
  assert.deepEqual(s.eliminationOrder, ['p1']);
  assert.equal(s.turn, 'p2');
});

t('block window with no eligible blocker resolves at once', () => {
  const s = mk(3);
  give(s, 'p0', ['assassin', 'captain']);
  const p1 = s.players[1];
  p1.hand = [{ id: 'contessa-x', kind: 'contessa' }]; // 1 card
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  assert.equal(respond(s, p1, 'challenge', undefined, rng), true);
  // p1's failed challenge costs their last influence; with the target
  // gone nobody can block, so the action resolves at once instead of
  // opening a window nobody can answer.
  assert.equal(p1.eliminated, true);
  assert.equal(s.pending, null);
  assert.equal(s.phase, 'playing');
  assert.equal(s.turn, 'p2');
});

t('lose-influence choice: wrong player / wrong card rejected', () => {
  const s = mk();
  setCoins(s, 'p0', 7);
  give(s, 'p1', ['duke', 'captain']);
  assert.equal(declare(s, 'coup', 'p1'), true);
  assert.equal(chooseLose(s, s.players[2], 'duke-t0', rng), false); // not the loser
  assert.equal(chooseLose(s, s.players[1], 'nope', rng), false); // no such card
  assert.equal(chooseLose(s, s.players[1], 'duke-t0', rng), true);
  assert.equal(s.pending, null);
});

t('elimination + win: last player standing is crowned', () => {
  const s = mk(2);
  setCoins(s, 'p0', 7);
  const p1 = s.players[1];
  p1.hand = [{ id: 'duke-x', kind: 'duke' }];
  assert.equal(declare(s, 'coup', 'p1'), true);
  assert.equal(s.phase, 'results');
  assert.equal(s.winner, 'p0');
  assert.equal(s.turn, null);
  // No more actions after the game ends.
  assert.equal(declareAction(s, s.players[0], 'income', undefined, rng), false);
});

t('exchange: draw 2, keep 2, return 2 to the court', () => {
  const s = mk();
  give(s, 'p0', ['ambassador', 'captain']);
  const courtBefore = s.court.length;
  assert.equal(declare(s, 'exchange'), true);
  allPass(s);
  assert.equal(s.pending.stage, 'exchange');
  assert.equal(s.pending.keepCount, 2);
  assert.equal(s.players[0].hand.length, 4);
  const keep = s.players[0].hand.slice(0, 2).map(c => c.id);
  assert.equal(chooseExchange(s, s.players[0], keep, rng), true);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.court.length, courtBefore); // draw 2, return 2
  assert.equal(s.turn, 'p1');
});

t('exchange with 1 influence: keep 1, return 2', () => {
  const s = mk();
  const p0 = s.players[0];
  p0.hand = [{ id: 'ambassador-x', kind: 'ambassador' }];
  assert.equal(declare(s, 'exchange'), true);
  allPass(s);
  assert.equal(s.pending.keepCount, 1);
  assert.equal(p0.hand.length, 3);
  const keep = [p0.hand[2].id]; // keep a drawn card
  assert.equal(chooseExchange(s, p0, keep, rng), true);
  assert.equal(p0.hand.length, 1);
  assert.equal(p0.hand[0].id, keep[0]);
});

t('exchange validation: wrong count / wrong card / wrong player rejected', () => {
  const s = mk();
  assert.equal(declare(s, 'exchange'), true);
  allPass(s);
  const p0 = s.players[0];
  assert.equal(chooseExchange(s, s.players[1], [p0.hand[0].id], rng), false);
  assert.equal(chooseExchange(s, p0, [p0.hand[0].id], rng), false); // keepCount is 2
  assert.equal(chooseExchange(s, p0, [p0.hand[0].id, 'nope'], rng), false);
  assert.equal(s.pending.stage, 'exchange'); // still open
});

t('challenge on exchange, actor proves: exchange opens after the loss', () => {
  const s = mk();
  give(s, 'p0', ['ambassador', 'captain']);
  assert.equal(declare(s, 'exchange'), true);
  assert.equal(respond(s, s.players[1], 'challenge', undefined, rng), true);
  chooseLose(s, s.players[1], s.players[1].hand[0].id, rng);
  assert.equal(s.pending.stage, 'exchange');
  assert.equal(s.players[0].hand.length, 4);
});

t('autoStep: forgotten action → income; 10+ coins → coup the richest', () => {
  const s = mk();
  autoStep(s, rng);
  assert.equal(s.players[0].coins, 3);
  assert.equal(s.turn, 'p1');
  const s2 = mk();
  setCoins(s2, 'p0', 10);
  setCoins(s2, 'p1', 4);
  setCoins(s2, 'p2', 9);
  setCoins(s2, 'p3', 1);
  give(s2, 'p2', ['duke', 'captain']);
  autoStep(s2, rng);
  assert.equal(s2.players[0].coins, 3); // coup paid
  assert.equal(s2.pending.stage, 'chooseLose'); // richest target p2 must reveal
  assert.equal(s2.pending.playerId, 'p2');
});

t('autoStep: open respond window → all pass; chooseLose → leftmost; exchange → keep originals', () => {
  const s = mk();
  assert.equal(declare(s, 'tax'), true);
  autoStep(s, rng);
  assert.equal(s.players[0].coins, 5);
  const s2 = mk();
  setCoins(s2, 'p0', 7);
  give(s2, 'p1', ['duke', 'captain']);
  assert.equal(declare(s2, 'coup', 'p1'), true);
  autoStep(s2, rng);
  assert.deepEqual(s2.players[1].revealed.map(c => c.kind), ['duke']); // leftmost
  const s3 = mk();
  give(s3, 'p0', ['ambassador', 'captain']);
  assert.equal(declare(s3, 'exchange'), true);
  allPass(s3);
  const originals = s3.players[0].hand.slice(0, 2).map(c => c.kind);
  autoStep(s3, rng);
  assert.deepEqual(s3.players[0].hand.map(c => c.kind), originals);
});

t('markPassed: a disconnected player never holds a response window', () => {
  const s = mk();
  assert.equal(declare(s, 'tax'), true);
  markPassed(s, 'p1', rng);
  markPassed(s, 'p2', rng);
  assert.equal(s.pending.stage, 'respond'); // p3 still to answer
  markPassed(s, 'p3', rng);
  assert.equal(s.players[0].coins, 5); // window closed, tax resolved
  assert.equal(s.turn, 'p1');
});

t('respond validation: actor cannot respond, dead players cannot, double pass rejected', () => {
  const s = mk();
  assert.equal(declare(s, 'tax'), true);
  assert.equal(respond(s, s.players[0], 'pass', undefined, rng), false); // actor
  assert.equal(respond(s, s.players[1], 'pass', undefined, rng), true);
  assert.equal(respond(s, s.players[1], 'pass', undefined, rng), false); // already passed
  assert.equal(respond(s, s.players[2], 'block', 'duke', rng), false); // tax is unblockable
  assert.equal(respond(s, s.players[2], 'challenge', undefined, rng), true);
});

t('publicState hides hands and the court deck', () => {
  const s = mk();
  const pub = publicState(s);
  assert.equal(pub.courtCount, 7);
  assert.ok(!('court' in pub));
  assert.ok(!pub.players.some(p => 'hand' in p));
  for (const p of pub.players) assert.equal(p.handCount, 2);
  const priv = privateState(s, s.players[0]);
  assert.equal(priv.myHand.length, 2);
  assert.deepEqual(priv.myHand.map(c => c.kind).sort(), s.players[0].hand.map(c => c.kind).sort());
});

t('feed records actions, challenges, blocks and eliminations', () => {
  const s = mk();
  give(s, 'p0', ['assassin', 'captain']);
  setCoins(s, 'p0', 5);
  assert.equal(declare(s, 'assassinate', 'p1'), true);
  assert.equal(s.feed[0].kind, 'action');
  assert.equal(respond(s, s.players[1], 'block', 'contessa', rng), true);
  assert.equal(s.feed[0].kind, 'block');
  allPass(s);
  // The block stood unchallenged: no challenge feed entry appears, the
  // action simply failed.
  assert.equal(s.feed[0].kind, 'block');
  assert.ok(!s.feed.some(e => e.kind === 'block-challenge-win' || e.kind === 'block-challenge-fail'));
  assert.ok(s.feed.some(e => e.kind === 'action'));
});

console.log(`\n== ${n} coup logic tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
