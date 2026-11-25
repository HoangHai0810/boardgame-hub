// Win-invariant probe (fake clock): drives the REAL HostEngine + bot brains
// through many full 12-player games (1 human + 11 bots) and checks the
// end-state invariant at results:
//   winner === 'wolves'  => at least one wolf alive
//   winner === 'villagers' => zero wolves alive
// A wolves-win with zero wolves alive (reported live 2026-11-25) breaks it.
// On failure, dumps the death trace for that game.
// Run: esbuild client/src/games/ma-soi/hostEngine.ts --bundle --format=esm
//      --outfile=client/src/games/ma-soi/hostEngine.mjs, then node this file.
//      Delete hostEngine.mjs afterwards (stale .mjs next to .ts is a hazard).
import { HostEngine } from '../client/src/games/ma-soi/hostEngine.mjs';

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

// Seeded PRNG so each game differs but is reproducible.
const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function runGame(seed) {
  const rng = mulberry(seed);
  const savedRandom = Math.random;
  Math.random = rng;
  const trace = [];
  let eng;
  try {
    eng = new HostEngine('ABCDE', {
      sendPub(pub) {
        if (pub.phase === 'results') {
          const wolvesAlive = pub.players.filter(p => p.alive && p.role === 'wolf').length;
          trace.push(`results winner=${pub.winner} wolvesAlive=${wolvesAlive} alive=${pub.players.filter(p => p.alive).length}`);
        }
      },
      sendPriv() {},
      sendError() {},
    });
    const human = eng.addPlayer('human', 'Hoang', true);
    for (let i = 0; i < 11; i++) eng.handle(human, { action: 'addBot' });
    eng.handle(human, { action: 'startGame' });
    const me = () => eng.state.players.find(p => p.id === 'human');
    const roleOf = (id) => eng.state.players.find(p => p.id === id)?.role;
    const aliveNonWolf = () => eng.state.players.find(p => p.alive && p.role !== 'wolf' && p.id !== 'human')?.id
      ?? eng.state.players.find(p => p.alive && p.id !== 'human')?.id;

    let steps = 0;
    let lastPhase = '';
    while (eng.state.phase !== 'results' && steps < 5000) {
      steps++;
      const s = eng.state;
      if (s.phase !== lastPhase) {
        trace.push(`night ${s.night} phase=${s.phase} step=${s.nightStep ?? ''} alive=${s.players.filter(p => p.alive).length} wolves=${s.players.filter(p => p.alive && p.role === 'wolf').length} deaths=${s.nightDeaths.map(d => d.name + ':' + d.cause).join(',') || '-'} voteOut=${s.lastVoteOut ? s.lastVoteOut.name : '-'}`);
        lastPhase = s.phase;
      }
      if (s.phase === 'roleReveal' && !s.revealReady.includes('human')) eng.handle(human, { action: 'ready' });
      else if (s.phase === 'night' && s.nightStep === 'wolves' && me().alive && me().role === 'wolf' && !me().wolfPick) {
        const t = aliveNonWolf();
        if (rng() < 0.1) eng.handle(human, { action: 'wolfPass' });
        else if (t) eng.handle(human, { action: 'wolfPick', targetId: t });
        if (me().wolfPick && rng() < 0.3) eng.handle(human, { action: 'wolfConfirm' });
      } else if (s.phase === 'night' && s.nightStep === 'seer' && me().alive && me().role === 'seer' && !me().seerPeeks.length) {
        const t = eng.state.players.find(p => p.alive && p.id !== 'human')?.id;
        if (t) eng.handle(human, { action: 'seerPeek', targetId: t });
      } else if (s.phase === 'night' && s.nightStep === 'guardian' && me().alive && me().role === 'guardian' && !s.guardianTarget) {
        const t = eng.state.players.find(p => p.alive && p.id !== me().guardianLastTarget)?.id;
        if (t) eng.handle(human, { action: 'guardProtect', targetId: t });
        else advance(1000);
      } else if (s.phase === 'night' && s.nightStep === 'witch' && me().alive && me().role === 'witch') {
        const r = rng();
        if (r < 0.3 && s.wolfTarget) eng.handle(human, { action: 'witchSave' });
        else if (r < 0.4 && s.night >= 3) {
          const opts = eng.state.players.filter(p => p.alive && p.id !== 'human');
          const t = opts[Math.floor(rng() * opts.length)];
          if (t) eng.handle(human, { action: 'witchKill', targetId: t.id });
          else eng.handle(human, { action: 'witchPass' });
        } else eng.handle(human, { action: 'witchPass' });
      } else if (s.phase === 'night' && s.nightStep === 'hunter' && s.pendingHunterShot === 'human') {
        const t = eng.state.players.find(p => p.alive && p.id !== 'human')?.id;
        if (t) eng.handle(human, { action: 'hunterShoot', targetId: t });
        else eng.handle(human, { action: 'hunterPass' });
      } else if (s.phase === 'day' && !s.dayReady.includes('human') && me().alive) {
        eng.handle(human, { action: 'readyVote' });
      } else if (s.phase === 'voting' && me().alive && !me().hasVoted) {
        const opts = eng.state.players.filter(p => p.alive && p.id !== 'human');
        const t = opts[Math.floor(rng() * opts.length)];
        if (t) eng.handle(human, { action: 'vote', targetId: t.id });
      } else {
        advance(1000);
      }
    }
    const s = eng.state;
    const wolvesAlive = s.players.filter(p => p.alive && p.role === 'wolf').length;
    const ok = s.phase === 'results'
      && ((s.winner === 'wolves' && wolvesAlive > 0) || (s.winner === 'villagers' && wolvesAlive === 0));
    return { ok, seed, winner: s.winner, wolvesAlive, phase: s.phase, trace };
  } finally {
    Math.random = savedRandom;
  }
}

let fails = 0;
const N = 200;
for (let seed = 1; seed <= N; seed++) {
  const r = runGame(seed);
  if (!r.ok) {
    fails++;
    console.log(`FAIL seed=${seed} winner=${r.winner} wolvesAlive=${r.wolvesAlive} phase=${r.phase}`);
    console.log(r.trace.join('\n'));
    if (fails >= 3) break;
  }
}
console.log(`\nwin-invariant: ${N - fails}/${N} games OK, ${fails} failures`);
process.exit(fails ? 1 : 0);
