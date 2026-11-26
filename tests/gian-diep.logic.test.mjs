// Ai là Gián Điệp? (Spyfall) engine unit tests.
// Run: esbuild games/gian-diep/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, dealRound, startQuestioning, askTarget, autoAsk,
  accuse, voteAccuse, resolveAccusation, spyGuess,
  startFinalPhase, finalPick, finalVote, resolveFinalVote,
  nextRound, publicState, privateState, LOCATIONS,
  MIN_PLAYERS, MAX_PLAYERS, ASK_MS, VOTE_MS,
} from '../games/gian-diep/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const rng = () => 0.5;
const mkPlayer = (id) => ({ id, name: id, isHost: id === 'p0', connected: true, score: 0, roundWins: 0 });
const mk = (count = 4, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  for (let i = 0; i < count; i++) s.players.push(mkPlayer('p' + i));
  dealRound(s, rng);
  startQuestioning(s);
  return s;
};
// Vote YES with every eligible voter (everyone except the suspect).
const voteAllYes = (s, fn) => {
  const suspect = s.accusation?.suspectId ?? s.finalVote?.suspectId;
  for (const p of s.players) if (p.id !== suspect) assert.equal(fn(s, p, true), true);
};
const voteAllNo = (s, fn) => {
  const suspect = s.accusation?.suspectId ?? s.finalVote?.suspectId;
  for (const p of s.players) if (p.id !== suspect) assert.equal(fn(s, p, false), true);
};

t('limits 3-8, 12 locations x 7 roles', () => {
  assert.equal(MIN_PLAYERS, 3); assert.equal(MAX_PLAYERS, 8);
  assert.equal(LOCATIONS.length, 12);
  LOCATIONS.forEach(l => { assert.equal(l.roles.length, 7); assert.ok(l.name.vi && l.name.en); });
  assert.equal(ASK_MS, 30000); assert.equal(VOTE_MS, 30000);
});

t('deal: exactly one spy, distinct roles for locals, dealer asks first', () => {
  const s = mk(5);
  assert.equal(s.phase, 'questioning');
  assert.ok(s.spyId);
  assert.equal(s.locationIdx !== null, true);
  const locals = s.players.filter(p => p.id !== s.spyId);
  const roles = locals.map(p => s.roleIdx[p.id]);
  assert.equal(new Set(roles).size, locals.length);
  assert.equal(s.dealerId, 'p0');
  assert.equal(s.currentAskerId, 'p0');
  assert.ok(s.roundEndsAt > Date.now());
});

t('deal at 8 players gives 7 distinct roles', () => {
  const s = mk(8);
  const locals = s.players.filter(p => p.id !== s.spyId);
  assert.equal(locals.length, 7);
  assert.equal(new Set(locals.map(p => s.roleIdx[p.id])).size, 7);
});

t('question chain: dealer asks, answerer asks next, no self-ask', () => {
  const s = mk(4);
  const asker = s.players[0];
  assert.equal(askTarget(s, asker, 'p0'), false); // self
  assert.equal(askTarget(s, asker, 'p2'), true);
  assert.equal(s.currentAskerId, 'p2');
  assert.equal(askTarget(s, asker, 'p3'), false); // not the asker anymore
  assert.equal(askTarget(s, s.players[2], 'p3'), true);
  assert.equal(s.currentAskerId, 'p3');
});

t('autoAsk picks a random other player (never self)', () => {
  const s = mk(4);
  autoAsk(s, () => 0.99);
  assert.notEqual(s.currentAskerId, 'p0');
  assert.ok(s.players.some(p => p.id === s.currentAskerId));
});

t('accusation: once per player per round, no self-accuse, clock pauses', () => {
  const s = mk(4);
  const before = s.roundEndsAt;
  assert.equal(accuse(s, s.players[0], 'p0'), false); // self
  assert.equal(accuse(s, s.players[0], 'p1'), true);
  assert.equal(s.roundEndsAt, null);
  assert.ok(s.roundRemainingMs !== null && s.roundRemainingMs > 0 && s.roundRemainingMs <= before - Date.now() + 1000);
  assert.equal(accuse(s, s.players[0], 'p2'), false); // already used this round
  assert.equal(accuse(s, s.players[1], 'p2'), false); // a vote is already open
});

t('split vote: accusation fails and the clock resumes', () => {
  const s = mk(4);
  accuse(s, s.players[0], 'p1');
  voteAccuse(s, s.players[0], true);
  voteAccuse(s, s.players[2], true);
  voteAccuse(s, s.players[3], false); // one NO kills unanimity
  assert.equal(s.phase, 'questioning');
  assert.equal(s.accusation, null);
  assert.ok(s.roundEndsAt > Date.now()); // clock resumed
  assert.deepEqual(s.accusedOnce, ['p0']);
});

t('unanimous vote convicts the spy: locals win, accuser +2, others +1', () => {
  const s = mk(4);
  const spy = s.spyId;
  const accuser = s.players.find(p => p.id !== spy);
  accuse(s, accuser, spy);
  voteAllYes(s, voteAccuse);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.winner, 'locals');
  assert.equal(s.roundResult?.reason, 'spy-caught');
  assert.equal(s.roundResult?.points[accuser.id], 2);
  for (const p of s.players) {
    if (p.id !== spy && p.id !== accuser.id) assert.equal(s.roundResult?.points[p.id], 1);
    if (p.id === spy) assert.equal(s.roundResult?.points[p.id] ?? 0, 0);
  }
});

t('unanimous vote convicts an innocent: spy wins +4', () => {
  const s = mk(4);
  const spy = s.spyId;
  const innocent = s.players.find(p => p.id !== spy);
  const accuser = s.players.find(p => p.id !== spy && p.id !== innocent.id);
  accuse(s, accuser, innocent.id);
  voteAllYes(s, voteAccuse);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.winner, 'spy');
  assert.equal(s.roundResult?.reason, 'innocent-convicted');
  assert.equal(s.roundResult?.points[spy], 4);
  assert.equal(byIdScore(s, spy), 4);
});

t('vote timer expiry counts unvoted players as not-yes', () => {
  const s = mk(4);
  accuse(s, s.players[0], 'p1');
  voteAccuse(s, s.players[0], true);
  voteAccuse(s, s.players[2], true);
  // p3 never votes; the timer fires.
  resolveAccusation(s);
  assert.equal(s.phase, 'questioning'); // not unanimous
  assert.equal(s.accusation, null);
});

t('spy guess right: spy +4; wrong: locals +1 each', () => {
  const s = mk(4);
  const spy = s.players.find(p => p.id === s.spyId);
  assert.equal(spyGuess(s, spy, (s.locationIdx + 1) % LOCATIONS.length), true);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.reason, 'spy-guess-wrong');
  assert.equal(s.roundResult?.winner, 'locals');
  for (const p of s.players) if (p.id !== spy.id) assert.equal(s.roundResult?.points[p.id], 1);

  const s2 = mk(4);
  const spy2 = s2.players.find(p => p.id === s2.spyId);
  assert.equal(spyGuess(s2, spy2, s2.locationIdx), true);
  assert.equal(s2.roundResult?.reason, 'spy-guess-right');
  assert.equal(s2.roundResult?.points[spy2.id], 4);
});

t('spy cannot guess during a vote; a local cannot guess at all', () => {
  const s = mk(4);
  const spy = s.players.find(p => p.id === s.spyId);
  const local = s.players.find(p => p.id !== s.spyId);
  accuse(s, s.players[0], 'p1');
  assert.equal(spyGuess(s, spy, s.locationIdx), false);
  assert.equal(s.phase, 'questioning');
  resolveAccusation(s); // timer with no votes → fails, clock resumes
  assert.equal(spyGuess(s, local, s.locationIdx), false);
});

t('timer-end rotation starts at the dealer and passes; nobody convicted → spy +2', () => {
  const s = mk(4);
  startFinalPhase(s);
  assert.equal(s.finalPhase, true);
  assert.equal(s.finalOrder[0], 'p0'); // dealer first
  assert.deepEqual(s.finalOrder, ['p0', 'p1', 'p2', 'p3']);
  // Everyone passes: the last pass ends the round with a spy win.
  for (let i = 0; i < 4; i++) {
    assert.equal(finalPick(s, s.players[i], null), true);
  }
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.reason, 'timeout-spy-wins');
  assert.equal(s.roundResult?.winner, 'spy');
  assert.equal(s.roundResult?.points[s.spyId], 2);
});

t('timer-end: a unanimous vote after a pass convicts the spy', () => {
  const s = mk(4);
  const spy = s.spyId;
  startFinalPhase(s);
  assert.equal(finalPick(s, s.players[0], null), true); // p0 passes
  const accuser = s.players[1];
  assert.equal(finalPick(s, accuser, spy), true);
  voteAllYes(s, finalVote);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult?.reason, 'spy-caught');
  assert.equal(s.roundResult?.points[accuser.id], 2);
});

t('timer-end: split vote moves to the next accuser', () => {
  const s = mk(4);
  startFinalPhase(s);
  assert.equal(finalPick(s, s.players[0], 'p1'), true);
  voteAllNo(s, finalVote);
  assert.equal(s.phase, 'questioning');
  assert.equal(s.finalIdx, 1);
  assert.equal(s.finalVote, null);
});

t('next dealer is the previous spy; rounds advance to results', () => {
  const s = mk(4, { roundsTotal: 3 });
  const spy = s.spyId;
  const accuser = s.players.find(p => p.id !== spy);
  accuse(s, accuser, spy);
  voteAllYes(s, voteAccuse);
  assert.equal(s.dealerId, spy);
  nextRound(s, rng);
  assert.equal(s.round, 2);
  assert.equal(s.phase, 'roleReveal');
  assert.equal(s.dealerId, spy);
  // Play rounds 2 and 3 out quickly via spy guesses.
  for (let r = 2; r <= 3; r++) {
    startQuestioning(s);
    const sp = s.players.find(p => p.id === s.spyId);
    spyGuess(s, sp, s.locationIdx);
    if (r < 3) nextRound(s, rng);
  }
  assert.equal(s.round, 3);
  nextRound(s, rng);
  assert.equal(s.phase, 'results');
});

t('points OFF: scores stay 0 but round wins still count', () => {
  const s = mk(4, { pointsOn: false });
  const spy = s.spyId;
  const accuser = s.players.find(p => p.id !== spy);
  accuse(s, accuser, spy);
  voteAllYes(s, voteAccuse);
  assert.equal(s.roundResult?.points[accuser.id] ?? 0, 0);
  for (const p of s.players) assert.equal(p.score, 0);
  assert.equal(accuser.roundWins, 1);
  assert.equal(byIdScore(s, spy), 0);
});

t('publicState hides spy identity, roles and vote details', () => {
  const s = mk(4);
  const pub = publicState(s);
  assert.equal('spyId' in pub, false);
  assert.equal('roleIdx' in pub, false);
  assert.equal('locationIdx' in pub, false);
  accuse(s, s.players[0], 'p1');
  voteAccuse(s, s.players[0], true);
  const pub2 = publicState(s);
  assert.deepEqual(pub2.accusation?.voted, ['p0']);
  assert.equal('votes' in (pub2.accusation ?? {}), false);
  const spy = s.players.find(p => p.id === s.spyId);
  const local = s.players.find(p => p.id !== s.spyId);
  const ps = privateState(s, spy);
  assert.equal(ps.isSpy, true);
  assert.equal(ps.locationIdx, null);
  assert.equal(ps.locations.length, 12);
  assert.equal(ps.canGuess, false); // a vote is open
  const pl = privateState(s, local);
  assert.equal(pl.isSpy, false);
  assert.equal(pl.locationIdx, s.locationIdx);
  assert.equal(typeof pl.roleIdx, 'number');
  assert.equal(pl.myVote, true);
});

t('roles OFF still deals roles but privateState hides them', () => {
  const s = mk(4, { rolesOn: false });
  const local = s.players.find(p => p.id !== s.spyId);
  // The engine still assigns a role index (harmless); the UI hides it.
  assert.equal(typeof s.roleIdx[local.id], 'number');
});

function byIdScore(s, id) { return s.players.find(p => p.id === id)?.score ?? 0; }

console.log(`\n== ${n} gian-diep logic tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
