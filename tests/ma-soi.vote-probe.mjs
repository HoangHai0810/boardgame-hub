// Wolf-vote probe (fake clock), v2: drives the REAL HostEngine + bot brains
// through full rounds and checks, at every day-vote, whether EVERY living
// player — human and bot, wolf and villager — actually gets a vote in
// BEFORE the 60s timer (i.e. genuinely, not via applyDefaultVotes).
//
// Coverage is observed in the engine's sendPub hook (fired synchronously
// on every broadcast, including right after each vote) — NOT by sampling
// the phase once a second, which misses a vote that lands and ends the
// phase inside the same clock step.
// Run: esbuild client/src/games/ma-soi/hostEngine.ts --bundle --format=esm
//      --outfile=client/src/games/ma-soi/hostEngine.mjs, then node this file.
//      Delete hostEngine.mjs afterwards (stale .mjs next to .ts is a hazard).
import { strict as assert } from 'node:assert';
import { HostEngine } from '../client/src/games/ma-soi/hostEngine.mjs';

// ---- fake clock (the engine only uses setTimeout/clearTimeout/Date.now) ----
let now = 1_000_000;
let timers = [];
let nextId = 1;
globalThis.setTimeout = (fn, ms) => { const id = nextId++; timers.push({ id, at: now + (ms || 0), fn }); return id; };
globalThis.clearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
Date.now = () => now;
const advance = (ms) => {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.find(x => x.at <= end);
    if (!t) break;
    timers = timers.filter(x => x !== t);
    now = t.at;
    t.fn();
  }
  now = end;
};

const ROLES_A = ['wolf', 'wolf', 'wolf', 'seer', 'guardian', 'witch', 'hunter', 'villager', 'villager', 'villager']; // human = wolf
const ROLES_B = ['villager', 'wolf', 'wolf', 'wolf', 'seer', 'guardian', 'witch', 'hunter', 'villager', 'villager']; // human = villager

function runGame(label, roles) {
  // key "round:night" -> { alive:Set, voted:Set }
  const coverage = new Map();
  const eng = new HostEngine('ABCDE', {
    sendPub(pub) {
      if (pub.phase !== 'voting') return;
      const key = `${pub.round}:${pub.night}`;
      let e = coverage.get(key);
      if (!e) { e = { alive: new Set(), voted: new Set() }; coverage.set(key, e); }
      for (const p of pub.players) {
        if (!p.alive) continue;
        e.alive.add(p.id);
        if (p.hasVoted) e.voted.add(p.id);
      }
    },
    sendPriv() {},
    sendError() {},
  });
  const human = eng.addPlayer('human', 'Hoang', true);
  for (let i = 0; i < 9; i++) eng.handle(human, { action: 'addBot' });
  assert.equal(eng.state.players.length, 10, label + ': 10 players');
  eng.handle(human, { action: 'startGame' });
  // Fix roles deterministically (assignRoles shuffled them).
  eng.state.players.forEach((p, i) => { p.role = roles[i]; });
  const me = () => eng.state.players.find(p => p.id === 'human');
  const roleOf = (id) => eng.state.players.find(p => p.id === id)?.role;
  const aliveVillager = () => eng.state.players.find(p => p.alive && p.role !== 'wolf' && p.id !== 'human')?.id
    ?? eng.state.players.find(p => p.alive && p.id !== 'human')?.id;

  let steps = 0;
  while (eng.state.phase !== 'results' && steps < 3000) {
    steps++;
    const s = eng.state;
    if (s.phase === 'roleReveal' && !s.revealReady.includes('human')) eng.handle(human, { action: 'ready' });
    else if (s.phase === 'night' && s.nightStep === 'wolves' && me().alive && me().role === 'wolf' && !me().wolfPick) {
      const t = aliveVillager();
      if (t) eng.handle(human, { action: 'wolfPick', targetId: t });
    } else if (s.phase === 'night' && s.nightStep === 'seer' && me().alive && me().role === 'seer' && !me().seerPeeks.length) {
      const t = eng.state.players.find(p => p.alive && p.id !== 'human')?.id;
      if (t) eng.handle(human, { action: 'seerPeek', targetId: t });
    } else if (s.phase === 'night' && s.nightStep === 'guardian' && me().alive && me().role === 'guardian' && !s.guardianTarget) {
      const t = eng.state.players.find(p => p.alive)?.id;
      if (t) eng.handle(human, { action: 'guardProtect', targetId: t });
    } else if (s.phase === 'day' && me().alive && !s.dayReady.includes('human')) {
      eng.handle(human, { action: 'readyVote' });
    } else if (s.phase === 'voting' && me().alive && !me().hasVoted) {
      const t = eng.state.players.find(p => p.alive && p.id !== 'human')?.id;
      if (t) eng.handle(human, { action: 'vote', targetId: t });
    }
    advance(1000);
  }
  console.log(`--- ${label}: phase=${eng.state.phase} winner=${eng.state.winner} rounds=${eng.state.round} votingPhases=${coverage.size}`);
  assert.ok(coverage.size >= 2, label + ': expected at least 2 voting phases, got ' + coverage.size);
  for (const [key, e] of coverage) {
    const missing = [...e.alive].filter(id => !e.voted.has(id))
      .map(id => `${eng.state.players.find(p => p.id === id)?.name ?? id}(${roleOf(id)}${eng.state.players.find(p => p.id === id)?.isBot ? ',bot' : ',human'})`);
    console.log(`  vote ${key}: ${e.voted.size}/${e.alive.size} voted genuinely; missing: ${missing.join(', ') || 'none'}`);
    assert.equal(missing.length, 0, `${label}: vote ${key} — these living players never voted: ${missing.join(', ')}`);
  }
  console.log(`PASS ${label}`);
}

runGame('A human=wolf', ROLES_A);
runGame('B human=villager', ROLES_B);
console.log('ALL VOTE-PROBE CHECKS PASSED');
