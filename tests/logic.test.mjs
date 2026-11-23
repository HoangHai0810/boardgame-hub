// Logic tests run against the TypeScript source transpiled on the fly by esbuild (bundled with vite install) —
// fallback: we compile with tsc in the test runner script. This file imports the compiled JS.
import assert from 'node:assert';
import { createGame, assignRolesAndDice, canInspect, doInspect, doSteal, castVote, resolveVotes, publicState, privateState, MIN_PLAYERS, MAX_PLAYERS } from '../shared/logic.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('PASS', name); };
// deterministic rng
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

function gameWith(n, rngVals) {
  const g = createGame('TEST1');
  for (let i = 0; i < n; i++) g.players.push({ id: 'p' + i, name: 'P' + i, isHost: i === 0, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null });
  assignRolesAndDice(g, seq(rngVals));
  return g;
}

t('limits constants 4-8', () => { assert.equal(MIN_PLAYERS, 4); assert.equal(MAX_PLAYERS, 8); });

t('exactly one thief, dice 1-6 (4p)', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  assert.equal(g.players.filter(p => p.role === 'thief').length, 1);
  g.players.forEach(p => assert.ok(p.dice >= 1 && p.dice <= 6));
});
t('exactly one thief (8p)', () => {
  const g = gameWith(8, [0.99, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15, 0.35, 0.55]);
  assert.equal(g.players.filter(p => p.role === 'thief').length, 1);
});

t('public state leaks no secrets before results', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  g.phase = 'night'; g.currentHour = 1;
  const pub = JSON.stringify(publicState(g));
  assert.ok(!pub.includes('"role"')); assert.ok(!pub.includes('"dice"')); assert.ok(!pub.includes('"vote"'));
});

t('lone sleepyhead can inspect, gets target dice privately', () => {
  // thief idx0 dice: rng after thief pick: p0 dice .0->1, p1 .2->2, p2 .4->3, p3 .6->4
  const g = gameWith(4, [0.0, 0.0, 0.2, 0.4, 0.6]);
  g.phase = 'night'; g.currentHour = 2; // only p1 wakes
  const p1 = g.players[1];
  assert.equal(canInspect(g, p1), true);
  const d = doInspect(g, p1, 'p2');
  assert.equal(d, 3);
  assert.equal(doInspect(g, p1, 'p3'), null); // exactly one inspection
});

t('two sleepyheads same hour cannot inspect', () => {
  const g = gameWith(4, [0.0, 0.0, 0.2, 0.2, 0.6]); // p1,p2 both dice 2
  g.phase = 'night'; g.currentHour = 2;
  assert.equal(canInspect(g, g.players[1]), false);
  assert.equal(canInspect(g, g.players[2]), false);
});

t('thief steals only on own hour, only once', () => {
  const g = gameWith(4, [0.0, 0.0, 0.2, 0.4, 0.6]); // thief p0 dice1
  g.phase = 'night'; g.currentHour = 2;
  assert.equal(doSteal(g, g.players[0]), false);
  g.currentHour = 1;
  assert.equal(doSteal(g, g.players[0]), true);
  assert.equal(g.cheeseStolen, true);
  assert.equal(doSteal(g, g.players[0]), false);
});

t('waker after theft privately sees cheese gone; public night state hides it', () => {
  const g = gameWith(4, [0.0, 0.0, 0.2, 0.4, 0.6]);
  g.phase = 'night'; g.currentHour = 1; doSteal(g, g.players[0]);
  g.currentHour = 3; g.players.forEach(p => p.hasActedThisHour = false);
  const priv = privateState(g, g.players[2]);
  assert.equal(priv.awake, true); assert.equal(priv.cheesePresentWhenAwake, false);
  assert.equal(publicState(g).cheeseStolen, false);
});

t('voting: no self vote, no double vote, no change', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  g.phase = 'voting';
  assert.equal(castVote(g, g.players[1], 'p1'), false);
  assert.equal(castVote(g, g.players[1], 'p0'), true);
  assert.equal(castVote(g, g.players[1], 'p2'), false);
});

t('thief top-voted => sleepyheads win', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]); // thief p0
  g.phase = 'voting';
  castVote(g, g.players[1], 'p0'); castVote(g, g.players[2], 'p0'); castVote(g, g.players[3], 'p1'); castVote(g, g.players[0], 'p1');
  const r = resolveVotes(g);
  assert.equal(r.caught, true); assert.equal(g.winner, 'sleepyheads');
});
t('tie involving thief => caught', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  g.phase = 'voting';
  castVote(g, g.players[1], 'p0'); castVote(g, g.players[2], 'p1'); castVote(g, g.players[3], 'p0'); castVote(g, g.players[0], 'p1');
  assert.equal(resolveVotes(g).caught, true);
});
t('tie without thief => thief wins', () => {
  const g = gameWith(5, [0.0, 0.1, 0.3, 0.5, 0.9, 0.7]);
  g.phase = 'voting';
  castVote(g, g.players[0], 'p1'); castVote(g, g.players[1], 'p2'); castVote(g, g.players[2], 'p1'); castVote(g, g.players[3], 'p2'); castVote(g, g.players[4], 'p3');
  const r = resolveVotes(g);
  assert.equal(r.caught, false); assert.equal(g.winner, 'thief');
});
t('innocent top-voted => thief wins', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  g.phase = 'voting';
  castVote(g, g.players[0], 'p1'); castVote(g, g.players[1], 'p1'); castVote(g, g.players[2], 'p1'); castVote(g, g.players[3], 'p0');
  assert.equal(resolveVotes(g).caught, false);
});

console.log(`\n${passed} logic tests passed`);
