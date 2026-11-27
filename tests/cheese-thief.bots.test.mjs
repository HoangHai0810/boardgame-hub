// Cheese Thief bot brains + bot-only simulation. Run:
//   ./client/node_modules/.bin/esbuild games/cheese-thief/logic.ts --format=esm --outfile=games/cheese-thief/logic.mjs
//   ./client/node_modules/.bin/esbuild games/cheese-thief/bots.ts --bundle --format=esm --outfile=games/cheese-thief/bots.mjs
//   ./client/node_modules/.bin/esbuild client/src/games/cheese-thief/hostEngine.ts --bundle --format=esm --outfile=games/cheese-thief/hostEngine.mjs
//   node tests/cheese-thief.bots.test.mjs
// then delete the generated .mjs files.
//
// The full-round simulation drives the validated logic functions directly
// (phase by phase, no wall clock): the engine's real timers are fixed
// constants (HOUR_MS 12s x 6 hours, DISCUSSION_MS, VOTE_MS), so a live
// engine run to results would take minutes. The engine-level wiring
// (addBot -> startGame -> bots ready -> night starts, no private state
// for bots) IS tested with real timers at the bottom of this file.
import { strict as assert } from 'node:assert';
import {
  createGame, assignRolesAndDice, addBot, removeBot, BOT_NAMES,
  canInspect, doInspect, doSteal, canSteal, castVote, resolveVotes,
  publicState, chooseFollower, followerKnowledge,
  recruitCount, followers, recordHour, autoInspectIdle,
  autoResolveFollowerChoice, thiefOf, MAX_PLAYERS,
} from '../games/cheese-thief/logic.mjs';
import { botInspectTarget, botFollowerPick, botVote } from '../games/cheese-thief/bots.mjs';
import { HostEngine } from '../games/cheese-thief/hostEngine.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const lcg = (seed) => { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32; }; };

function mkGame(nHumans, nBots, seed) {
  const s = createGame('BOT' + seed);
  for (let i = 0; i < nHumans; i++) s.players.push({
    id: 'h' + i, name: 'Human' + i, isHost: i === 0, connected: true,
    hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0,
  });
  for (let i = 0; i < nBots; i++) addBot(s, lcg(seed * 31 + i + 7));
  assignRolesAndDice(s, lcg(seed));
  return s;
}

/** A player object with a fixed role/dice, for targeted decision tests. */
function mkFixed(roles, dice) {
  const s = createGame('FIXED');
  roles.forEach((r, i) => s.players.push({
    id: 'p' + i, name: 'P' + i, isHost: i === 0, connected: true, isBot: i > 0,
    role: r, dice: dice[i], isFollower: false,
    hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0,
  }));
  s.cheeseStolen = false; s.cheeseStolenAtHour = null;
  s.stolenWitnessIds = []; s.pendingFollowerChoice = null; s.recap = [];
  return s;
}

/* ---------- addBot / removeBot / publicState ---------- */

t('addBot: Vietnamese names, unique, bot flags, counts toward MIN', () => {
  const s = createGame('T1');
  s.players.push({ id: 'h0', name: 'Human', isHost: true, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0 });
  const b1 = addBot(s, () => 0.5);
  const b2 = addBot(s, () => 0.25);
  assert.ok(b1 && b2);
  assert.equal(b1.name, 'Bot An');
  assert.equal(b2.name, 'Bot Bình');
  assert.ok(BOT_NAMES.includes('An') && BOT_NAMES.includes('Minh'));
  assert.equal(b1.isBot, true);
  assert.equal(b1.isHost, false);
  assert.equal(b1.connected, true);
  assert.equal(s.players.length, 3);
  assert.ok(new Set(s.players.map(p => p.name)).size === 3, 'names unique');
});

t('addBot: full room (8) returns null; removeBot only removes bots', () => {
  const s = createGame('T2');
  for (let i = 0; i < MAX_PLAYERS; i++) addBot(s, () => i / 10);
  assert.equal(s.players.length, 8);
  assert.equal(addBot(s), null);
  const botId = s.players[0].id;
  assert.equal(removeBot(s, botId), true);
  assert.equal(s.players.length, 7);
  assert.equal(removeBot(s, botId), false); // already gone
  assert.equal(removeBot(s, 'nope'), false);
  s.players.push({ id: 'human', name: 'Human', isHost: false, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0 });
  assert.equal(removeBot(s, 'human'), false, 'a human is not a bot');
});

t('publicState carries isBot and still leaks no secrets before results', () => {
  const s = mkGame(1, 3, 11);
  s.phase = 'night'; s.currentHour = 1;
  const pub = publicState(s);
  assert.equal(pub.players.filter(p => p.isBot).length, 3);
  assert.equal(pub.players.filter(p => !p.isBot).length, 1);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('"role"'));
  assert.ok(!json.includes('"dice"'));
  assert.ok(!json.includes('"vote"'));
});

/* ---------- botInspectTarget ---------- */

t('bot lone waker picks another player; the pick validates via doInspect', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4]);
  s.phase = 'night'; s.currentHour = 2; // only p1 wakes
  const target = botInspectTarget(s, s.players[1], () => 0);
  assert.equal(target, 'p0'); // first other player with rng 0
  assert.notEqual(target, 'p1');
  assert.equal(doInspect(s, s.players[1], target), 1);
  assert.equal(s.players[1].inspectedDice?.dice, 1);
});

t('bot inspect returns null when it may not inspect', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 2, 4]);
  s.phase = 'night'; s.currentHour = 2; // p1 AND p2 wake: no peeking
  assert.equal(botInspectTarget(s, s.players[1], () => 0), null);
  assert.equal(canInspect(s, s.players[1]), false);
  const s2 = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4]);
  s2.phase = 'night'; s2.currentHour = 3; // p1 is asleep this hour
  assert.equal(botInspectTarget(s2, s2.players[1], () => 0), null);
  const s3 = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4]);
  s3.phase = 'night'; s3.currentHour = 2; s3.players[1].hasActedThisHour = true;
  assert.equal(botInspectTarget(s3, s3.players[1], () => 0), null);
  const s4 = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4]);
  s4.phase = 'night'; s4.currentHour = 1; // the thief bot never inspects
  assert.equal(botInspectTarget(s4, s4.players[0], () => 0), null);
});

t('bot inspect prefers someone it has never peeked at', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4]);
  s.phase = 'night'; s.currentHour = 2;
  s.players[1].peeks = [{ targetId: 'p2', dice: 3 }];
  // Fresh targets are p0, p3 — rng 0 must land on p0, never the seen p2.
  assert.equal(botInspectTarget(s, s.players[1], () => 0), 'p0');
  s.players[1].peeks = [{ targetId: 'p0', dice: 1 }, { targetId: 'p2', dice: 3 }, { targetId: 'p3', dice: 4 }];
  assert.equal(botInspectTarget(s, s.players[1], () => 0), 'p0'); // all seen: any other is fine
});

/* ---------- botFollowerPick ---------- */

t('bot thief picks a 5p witness from the pending choice (validated)', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 1, 1, 3, 4]);
  s.players[0].isBot = true; // the thief under test is a bot
  s.phase = 'night'; s.currentHour = 1;
  assert.equal(doSteal(s, s.players[0]), true);
  assert.deepEqual([...s.pendingFollowerChoice].sort(), ['p1', 'p2']);
  const pick = botFollowerPick(s, s.players[0], () => 0);
  assert.ok(s.pendingFollowerChoice.includes(pick));
  assert.equal(chooseFollower(s, s.players[0], pick), true);
  assert.equal(s.pendingFollowerChoice, null);
  assert.equal(followers(s).length, 1);
});

t('bot follower pick: non-thief gets null; recruit phase picks a villager', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4, 5, 6]);
  s.players[0].isBot = true; // the thief under test is a bot
  s.phase = 'night'; s.currentHour = 1;
  assert.equal(botFollowerPick(s, s.players[1], () => 0), null);
  s.phase = 'recruit';
  const pick = botFollowerPick(s, s.players[0], () => 0);
  assert.ok(pick && pick !== 'p0');
  assert.equal(chooseFollower(s, s.players[0], pick), true);
  assert.equal(recruitCount(s), 1);
  assert.equal(followers(s).length, 1);
});

/* ---------- botVote ---------- */

t('bot vote never votes for itself', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = mkGame(1, 3, seed);
    s.phase = 'voting';
    for (const b of s.players.filter(p => p.isBot)) {
      const v = botVote(s, b, lcg(seed * 7 + b.id.length));
      assert.ok(v && v !== b.id, `seed ${seed}: bot voted for itself`);
    }
  }
});

t('bot witness votes for the thief it SAW steal', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 1, 3, 4]);
  s.phase = 'night'; s.currentHour = 1;
  assert.equal(doSteal(s, s.players[0]), true);
  assert.deepEqual(s.stolenWitnessIds, ['p1']);
  s.phase = 'voting';
  assert.equal(botVote(s, s.players[1]), 'p0');
});

t('bot thief never votes its follower or itself; bot follower never votes the thief it knows', () => {
  // 6p: thief bot p0, follower p1 (6p follower knows the thief).
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead'], [1, 2, 3, 4, 5, 6]);
  s.players[0].isBot = true; // the thief under test is a bot
  s.players[1].isFollower = true;
  assert.equal(followerKnowledge(s, s.players[1]).knownThiefId, 'p0');
  s.phase = 'voting';
  assert.equal(botVote(s, s.players[0], () => 0), 'p2'); // first non-follower villager
  const fv = botVote(s, s.players[1], () => 0);
  assert.notEqual(fv, 'p0');
  assert.notEqual(fv, 'p1');
});

t('bot fallmouse votes someone else (it cannot vote itself anyway)', () => {
  const s = mkFixed(['thief', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'sleepyhead', 'fallmouse'], [1, 2, 3, 4, 5, 6]);
  s.phase = 'voting';
  const v = botVote(s, s.players[5], () => 0);
  assert.ok(v && v !== 'p5');
});

/* ---------- full-round simulation: night + day + vote, driven by bot brains ---------- */

/** Drive one whole round through the validated logic only (no wall clock):
 *  bots ready, night hours 1-6 with bot peeks / thief-bot follower picks,
 *  recruit, day ready, then every bot votes via botVote + castVote. */
function simulateRound(s, rng) {
  const bots = () => s.players.filter(p => p.isBot);
  let botInspects = 0;
  let botFollowerPicks = 0;
  s.phase = 'roleReveal';
  for (const b of bots()) s.revealReady.push(b.id);
  s.phase = 'night';
  for (let h = 1; h <= 6; h++) {
    s.currentHour = h; recordHour(s);
    s.players.forEach(p => { p.hasActedThisHour = false; });
    const th = thiefOf(s);
    if (th && canSteal(s, th)) assert.equal(doSteal(s, th), true);
    if (s.pendingFollowerChoice?.length) {
      if (th.isBot) {
        const pick = botFollowerPick(s, th, rng);
        assert.ok(pick && s.pendingFollowerChoice.includes(pick));
        assert.equal(chooseFollower(s, th, pick), true);
        botFollowerPicks++;
      } else autoResolveFollowerChoice(s, rng);
    }
    for (const b of bots()) {
      const target = botInspectTarget(s, b, rng);
      if (target !== null) {
        assert.notEqual(doInspect(s, b, target), null, `bot ${b.id} hour ${h}: validated peek failed`);
        botInspects++;
      }
    }
    autoInspectIdle(s, rng); // a human lone waker who forgot gets the default peek
    autoResolveFollowerChoice(s, rng);
  }
  if (recruitCount(s) > 0) {
    s.phase = 'recruit';
    const th = thiefOf(s);
    while (followers(s).length < recruitCount(s)) {
      if (th.isBot) {
        const pick = botFollowerPick(s, th, rng);
        assert.ok(pick, 'thief bot must have a recruit candidate');
        assert.equal(chooseFollower(s, th, pick), true);
        botFollowerPicks++;
      } else { autoResolveFollowerChoice(s, rng); break; }
    }
    assert.equal(followers(s).length, recruitCount(s));
  }
  s.phase = 'day';
  for (const b of bots()) s.dayReady.push(b.id);
  s.phase = 'voting';
  for (const p of s.players) {
    if (p.isBot) {
      const v = botVote(s, p, rng);
      assert.ok(v && v !== p.id, `bot ${p.id} voted for itself`);
      assert.equal(castVote(s, p, v), true, `bot ${p.id} vote rejected by logic`);
    } else {
      const others = s.players.filter(o => o.id !== p.id);
      const v = others[Math.floor(rng() * others.length)].id;
      assert.equal(castVote(s, p, v), true);
    }
  }
  const tally = resolveVotes(s);
  return { botInspects, botFollowerPicks, tally };
}

t('full night/day round, 4p (1 human + 3 bots): reaches results', () => {
  const s = mkGame(1, 3, 42);
  assert.equal(s.players.filter(p => p.role === 'thief').length, 1);
  const { botInspects, tally } = simulateRound(s, lcg(42));
  assert.equal(s.phase, 'results');
  assert.ok(['sleepyheads', 'thief', 'fallmouse'].includes(s.winner));
  assert.ok(s.thiefId);
  assert.ok(s.players.every(p => p.hasVoted && p.vote && p.vote !== p.id));
  assert.ok(tally.topIds.length >= 1);
  // No secret leaked before results: check the recap only exists at results.
  assert.ok(Array.isArray(publicState(s).recap));
  console.log(`    (4p round: botInspects=${botInspects}, winner=${s.winner})`);
});

t('full games, 4-8 players x 3 seeds each: every game reaches results', () => {
  let totalInspects = 0;
  let winners = {};
  for (let n = 4; n <= 8; n++) {
    for (let seed = 100 + n; seed < 103 + n; seed++) {
      const s = mkGame(1, n - 1, seed);
      const { botInspects } = simulateRound(s, lcg(seed));
      totalInspects += botInspects;
      assert.equal(s.phase, 'results', `${n}p seed ${seed} did not finish`);
      assert.ok(s.winner, `${n}p seed ${seed}: no winner`);
      assert.ok(s.thiefId, `${n}p seed ${seed}: no thiefId`);
      assert.equal(s.players.filter(p => p.role === 'thief').length, 1);
      if (n >= 6) assert.equal(s.players.filter(p => p.role === 'fallmouse').length, 1);
      assert.ok(s.players.every(p => p.vote && p.vote !== p.id));
      winners[s.winner] = (winners[s.winner] ?? 0) + 1;
    }
  }
  assert.ok(totalInspects > 0, 'bots never peeked in 15 games — inspect path untested');
  console.log(`    (15 games: botInspects=${totalInspects}, winners=${JSON.stringify(winners)})`);
});

t('bot-only table (0 humans + 4 bots) also finishes a round', () => {
  const s = mkGame(0, 4, 7);
  simulateRound(s, lcg(7));
  assert.equal(s.phase, 'results');
  assert.ok(s.winner);
});

/* ---------- engine wiring (real timers) ---------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  const pubs = [];
  const privFor = new Map();
  const eng = new HostEngine('BOT', {
    sendPub: (pub) => pubs.push(pub),
    sendPriv: (id, priv) => { privFor.set(id, (privFor.get(id) ?? 0) + 1); },
  });
  const host = eng.addPlayer('h1', 'Human', true);
  eng.handle(host, { action: 'addBot' });
  eng.handle(host, { action: 'addBot' });
  eng.handle(host, { action: 'addBot' });
  assert.equal(eng.state.players.length, 4);
  assert.equal(eng.state.players.filter(p => p.isBot).length, 3);
  assert.ok(eng.state.players.every(p => p.connected));
  eng.handle(host, { action: 'startGame' });
  assert.equal(eng.state.phase, 'roleReveal');
  await sleep(4500); // bot reveal delay is 1000-2500ms; 3 of 4 ready starts the night
  assert.equal(eng.state.phase, 'night');
  assert.equal(eng.state.currentHour, 1);
  assert.ok(eng.state.revealReady.length >= 3, 'bots did not ready up');
  const lastPub = pubs[pubs.length - 1];
  assert.equal(lastPub.players.filter(p => p.isBot).length, 3);
  for (const b of eng.state.players.filter(p => p.isBot)) {
    assert.equal(privFor.get(b.id) ?? 0, 0, `bot ${b.name} received a private snapshot`);
  }
  assert.ok((privFor.get('h1') ?? 0) > 0, 'human received no private snapshot');
  eng.dispose();
  console.log('PASS engine: 1 human + 3 bots start, bots ready, night begins, bots get no private state');
  n++;
} catch (e) {
  console.log('FAIL engine: 1 human + 3 bots start, bots ready, night begins, bots get no private state', e.message);
  process.exitCode = 1;
  n++;
}

console.log(`\n${n} tests, ${process.exitCode ? 'FAILURES PRESENT' : 'all passed'}`);
