// Logic tests run against the TypeScript source transpiled on the fly by esbuild (bundled with vite install) —
// fallback: we compile with tsc in the test runner script. This file imports the compiled JS.
import assert from 'node:assert';
import { createGame, assignRolesAndDice, canInspect, doInspect, doSteal, castVote, resolveVotes, publicState, privateState, MIN_PLAYERS, MAX_PLAYERS, chooseFollower, followerKnowledge, recruitCount, followers } from '../shared/logic.mjs';

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

/* ---------------- Followers (official rules) ---------------- */

t('5p: lone witness of the theft becomes follower immediately', () => {
  // thief p0 dice3, witness p1 dice3, others 1/2/4
  const g = gameWith(5, [0.0, 0.4, 0.4, 0.0, 0.2, 0.5]);
  const thief = g.players[0]; assert.equal(thief.role, 'thief');
  g.phase = 'night'; g.currentHour = 3;
  assert.equal(doSteal(g, thief), true);
  assert.equal(g.players[1].isFollower, true);
  assert.equal(g.pendingFollowerChoice, null);
  // follower saw the theft -> knows the thief; thief knows the follower
  assert.equal(followerKnowledge(g, g.players[1]).knownThiefId, 'p0');
  assert.deepEqual(followerKnowledge(g, thief).knownFollowerIds, ['p1']);
  assert.equal(privateState(g, g.players[1]).isFollower, true);
});

t('5p: multiple witnesses -> thief must choose one; other witness knows', () => {
  const g = gameWith(5, [0.0, 0.4, 0.4, 0.4, 0.0, 0.2]);
  const thief = g.players[0];
  g.phase = 'night'; g.currentHour = 3;
  doSteal(g, thief);
  assert.deepEqual(g.pendingFollowerChoice, ['p1', 'p2']);
  assert.equal(chooseFollower(g, thief, 'p3'), false); // not a witness
  assert.equal(chooseFollower(g, thief, 'p2'), true);
  assert.equal(g.players[2].isFollower, true);
  assert.equal(g.pendingFollowerChoice, null);
  // the other witness knows who the follower is
  assert.deepEqual(followerKnowledge(g, g.players[1]).knownFollowerIds, ['p2']);
});

t('6p: recruit phase picks exactly 1 follower, who knows the thief', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  assert.equal(recruitCount(g), 1);
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'recruit';
  const target = g.players.find(p => p.role === 'sleepyhead');
  assert.equal(chooseFollower(g, thief, target.id), true);
  assert.equal(followers(g).length, 1);
  const other = g.players.find(p => p.role === 'sleepyhead' && !p.isFollower);
  assert.equal(chooseFollower(g, thief, other.id), false); // quota full
  assert.equal(followerKnowledge(g, target).knownThiefId, thief.id);
});

t('7p: two followers know each other but NOT the thief', () => {
  const g = gameWith(7, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15, 0.35]);
  assert.equal(recruitCount(g), 2);
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'recruit';
  const vs = g.players.filter(p => p.role === 'sleepyhead');
  chooseFollower(g, thief, vs[0].id); chooseFollower(g, thief, vs[1].id);
  const k = followerKnowledge(g, vs[0]);
  assert.equal(k.knownThiefId, null);
  assert.deepEqual(k.knownFollowerIds, [vs[1].id]);
  assert.deepEqual(followerKnowledge(g, thief).knownFollowerIds, [vs[0].id, vs[1].id]);
});

t('8p: followers know the thief and each other', () => {
  const g = gameWith(8, [0.99, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15, 0.35, 0.55, 0.75]);
  assert.equal(recruitCount(g), 2);
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'recruit';
  const vs = g.players.filter(p => p.role === 'sleepyhead');
  chooseFollower(g, thief, vs[0].id); chooseFollower(g, thief, vs[1].id);
  const k = followerKnowledge(g, vs[0]);
  assert.equal(k.knownThiefId, thief.id);
  assert.deepEqual(k.knownFollowerIds, [vs[1].id]);
});

t('4p/5p: no recruit phase followers', () => {
  assert.equal(recruitCount(gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9])), 0);
  assert.equal(recruitCount(gameWith(5, [0.0, 0.1, 0.3, 0.5, 0.9, 0.7])), 0);
});

t('follower top-voted but thief safe -> thief team wins', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const thief = g.players.find(p => p.role === 'thief');
  const fol = g.players.find(p => p.role === 'sleepyhead'); fol.isFollower = true;
  g.phase = 'voting';
  g.players.forEach((p, i) => castVote(g, p, i < 4 ? fol.id : thief.id === p.id ? fol.id : g.players[2].id));
  assert.equal(resolveVotes(g).caught, false);
  assert.equal(g.winner, 'thief');
});

/* ---------------- Fall Mouse (Chuột Chết) ---------------- */

t('fall mouse dealt only at 6-8p, exactly one, never the thief', () => {
  const g5 = gameWith(5, [0.0, 0.1, 0.3, 0.5, 0.9, 0.7]);
  assert.equal(g5.players.filter(p => p.role === 'fallmouse').length, 0);
  const g6 = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const falls = g6.players.filter(p => p.role === 'fallmouse');
  assert.equal(falls.length, 1);
  assert.notEqual(falls[0].id, g6.players.find(p => p.role === 'thief').id);
});

t('fall mouse top-voted -> wins alone, even tied with the thief', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const fall = g.players.find(p => p.role === 'fallmouse');
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'voting';
  // 2 votes fall, 2 votes thief, 2 votes someone else -> tie at top incl. fall
  // (nobody can vote for themselves, so the fall mouse's own vote goes elsewhere)
  const others = g.players.filter(p => p.id !== fall.id && p.id !== thief.id);
  castVote(g, g.players[0], fall.id); castVote(g, g.players[2], fall.id);
  castVote(g, g.players[3], thief.id); castVote(g, g.players[4], thief.id);
  castVote(g, g.players[1], others[0].id); castVote(g, g.players[5], others[0].id);
  resolveVotes(g);
  assert.equal(g.winner, 'fallmouse');
});

t('fall mouse wins alone even as a follower', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const fall = g.players.find(p => p.role === 'fallmouse');
  fall.isFollower = true;
  g.phase = 'voting';
  g.players.forEach((p, i) => castVote(g, p, i === 5 ? g.players[0].id : fall.id));
  resolveVotes(g);
  assert.equal(g.winner, 'fallmouse');
});

t('fall mouse plays the night like a villager (lone peek works)', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const fall = g.players.find(p => p.role === 'fallmouse');
  g.players.forEach(p => { p.dice = 5; });
  fall.dice = 2;
  g.phase = 'night'; g.currentHour = 2; // fall mouse alone awake
  assert.equal(canInspect(g, fall), true);
  const seen = doInspect(g, fall, g.players.find(p => p.id !== fall.id).id);
  assert.equal(seen, 5);
});

t('fall mouse can be recruited as a follower', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const thief = g.players.find(p => p.role === 'thief');
  const fall = g.players.find(p => p.role === 'fallmouse');
  g.phase = 'recruit';
  assert.equal(chooseFollower(g, thief, fall.id), true);
  assert.equal(fall.isFollower, true);
});

/* ---------------- Session scoreboard (Cycle 1) ---------------- */

t('scoreboard: sleepyheads win -> non-follower villagers +1 only', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'voting';
  g.players.forEach(p => castVote(g, p, p === thief ? g.players.find(x => x !== thief).id : thief.id));
  resolveVotes(g);
  assert.equal(g.winner, 'sleepyheads');
  g.players.forEach(p => assert.equal(p.wins ?? 0, p === thief ? 0 : 1, p.name));
});

t('scoreboard: thief win -> thief and followers +1', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const thief = g.players.find(p => p.role === 'thief');
  const fol = g.players.find(p => p.role === 'sleepyhead'); fol.isFollower = true;
  const victim = g.players.find(p => p.role === 'sleepyhead' && !p.isFollower);
  g.phase = 'voting';
  g.players.forEach(p => castVote(g, p, p === victim ? thief.id : victim.id));
  resolveVotes(g);
  assert.equal(g.winner, 'thief');
  assert.equal(thief.wins, 1); assert.equal(fol.wins, 1);
  g.players.filter(p => p !== thief && p !== fol).forEach(p => assert.equal(p.wins ?? 0, 0, p.name));
});

t('scoreboard: fall mouse solo win -> only the fall mouse +1, even as follower', () => {
  const g = gameWith(6, [0.0, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.15]);
  const fall = g.players.find(p => p.role === 'fallmouse');
  fall.isFollower = true;
  g.phase = 'voting';
  g.players.forEach((p, i) => castVote(g, p, i === 5 ? g.players[0].id : fall.id));
  resolveVotes(g);
  assert.equal(g.winner, 'fallmouse');
  assert.equal(fall.wins, 1);
  g.players.filter(p => p !== fall).forEach(p => assert.equal(p.wins ?? 0, 0, p.name));
});

t('scoreboard: wins persist across rounds and never double-count', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  const thief = g.players.find(p => p.role === 'thief');
  g.phase = 'voting';
  g.players.forEach(p => castVote(g, p, p === thief ? g.players[1].id : thief.id));
  resolveVotes(g); resolveVotes(g); // second call must not re-score
  const before = g.players.map(p => p.wins ?? 0);
  assert.deepEqual(before, g.players.map(p => p === thief ? 0 : 1));
  assignRolesAndDice(g, seq([0.5, 0.1, 0.3, 0.5, 0.9])); // round 2 setup
  assert.deepEqual(g.players.map(p => p.wins ?? 0), before);
});

t('scoreboard: publicState exposes wins', () => {
  const g = gameWith(4, [0.0, 0.1, 0.3, 0.5, 0.9]);
  g.players[0].wins = 3;
  const pub = publicState(g);
  assert.equal(pub.players[0].wins, 3);
  assert.equal(pub.players[1].wins, 0);
});

console.log(`\n${passed} logic tests passed`);
