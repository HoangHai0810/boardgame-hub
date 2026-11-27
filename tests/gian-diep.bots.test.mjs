// Ai là Gián Điệp? (Spyfall) bot tests.
// Run: esbuild games/gian-diep/logic.ts (plain) + games/gian-diep/bots.ts
// (--bundle, it imports ./logic with no extension), then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, dealRound, startQuestioning, askTarget,
  accuse, voteAccuse, spyGuess,
  startFinalPhase, finalPick, finalVote,
  nextRound, publicState, privateState, LOCATIONS,
  addBot, removeBot, BOT_NAMES, MIN_PLAYERS, MAX_PLAYERS,
} from '../games/gian-diep/logic.mjs';
import {
  BOT_QUESTIONS, BOT_ANSWERS,
  botPickQuestion, botPickAnswer, botAskTarget, botShouldAccuse,
  botVoteYes, botSpyGuessLocation, botFinalPick,
} from '../games/gian-diep/bots.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
// Deterministic rng (mulberry32) so the simulations are reproducible.
const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};
const mkPlayer = (id) => ({ id, name: id, isHost: id === 'p0', connected: true, score: 0, roundWins: 0 });
const byId = (s, id) => s.players.find(p => p.id === id);

/** Drive ONE questioning phase to a round result using ONLY bot
 *  decisions, each executed through the validated logic functions.
 *  The pure-logic sim has no wall clock, so after 60 ask-turns without
 *  a conviction the round timer is "expired" by hand (startFinalPhase)
 *  and the rotation plays out. Returns { steps, reason }. */
function driveRound(s, rng) {
  let steps = 0;
  let spySurvivedAccusation = false;
  while (s.phase === 'questioning' && steps < 500) {
    steps++;
    // A bot spy that survived being accused reveals and guesses blind
    // as soon as the vote closes (never during the vote itself).
    if (spySurvivedAccusation && !s.accusation && !s.finalVote) {
      spySurvivedAccusation = false;
      const spy = byId(s, s.spyId);
      assert.equal(spyGuess(s, spy, botSpyGuessLocation(rng)), true);
      continue;
    }
    if (s.accusation) {
      const suspectId = s.accusation.suspectId;
      const wasSpy = suspectId === s.spyId;
      for (const p of s.players) {
        if (p.id === suspectId) continue;
        assert.equal(voteAccuse(s, p, botVoteYes(s, p, rng, false)), true);
      }
      assert.equal(s.accusation, null); // all voted → vote resolved
      if (s.phase === 'questioning' && wasSpy) spySurvivedAccusation = true;
      continue;
    }
    if (s.finalVote) {
      const suspectId = s.finalVote.suspectId;
      for (const p of s.players) {
        if (p.id === suspectId) continue;
        assert.equal(finalVote(s, p, botVoteYes(s, p, rng, true)), true);
      }
      assert.equal(s.finalVote, null);
      continue;
    }
    if (s.finalPhase) {
      const accuser = byId(s, s.finalOrder[s.finalIdx]);
      assert.equal(finalPick(s, accuser, botFinalPick(s, accuser, rng)), true);
      continue;
    }
    if (steps >= 60) { startFinalPhase(s); continue; }
    const asker = byId(s, s.currentAskerId);
    const suspect = botShouldAccuse(s, asker, rng);
    if (suspect !== null) {
      assert.equal(accuse(s, asker, suspect), true);
    } else {
      const target = botAskTarget(s, asker, rng);
      assert.ok(target && target !== asker.id);
      assert.equal(askTarget(s, asker, target), true);
    }
  }
  assert.equal(s.phase, 'roundEnd', `round did not end after ${steps} steps`);
  assert.ok(s.roundResult && s.roundResult.reason);
  return { steps, reason: s.roundResult.reason };
}

/** 1 human + bots, dealt and questioning. */
const mkTable = (bots, config, seed = 42) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  s.players.push(mkPlayer('p0'));
  for (let i = 0; i < bots; i++) addBot(s, seeded(seed + i));
  const rng = seeded(seed);
  dealRound(s, rng);
  startQuestioning(s);
  return { s, rng: seeded(seed + 1000) };
};

t('addBot: Vietnamese names Bot An.., counts toward the table, caps at 8', () => {
  const s = createGame('ABCDE');
  s.players.push(mkPlayer('p0'));
  const b1 = addBot(s, () => 0.5);
  assert.equal(b1?.name, 'Bot An');
  assert.equal(b1?.isBot, true);
  assert.equal(b1?.isHost, false);
  assert.equal(b1?.connected, true);
  const names = [b1.name];
  let last = null;
  for (let i = 0; i < 10; i++) { const b = addBot(s, () => 0.5); if (b) names.push(b.name); else last = b; }
  assert.equal(s.players.length, MAX_PLAYERS);
  assert.equal(last, null); // room full
  assert.equal(new Set(names).size, names.length); // no duplicate names
  assert.deepEqual(names, BOT_NAMES.slice(0, 7).map(x => `Bot ${x}`)); // 1 human + 7 bots fill the room
  assert.equal(BOT_NAMES.length, 8);
  // An empty room fits all 8 bot names; the 9th add is refused.
  const empty = createGame('FGHIJ');
  const allNames = [];
  for (let i = 0; i < 9; i++) { const b = addBot(empty, () => 0.5); if (b) allNames.push(b.name); }
  assert.deepEqual(allNames, BOT_NAMES.map(x => `Bot ${x}`));
  assert.equal(addBot(empty, () => 0.5), null);
});

t('removeBot: removes only bots, never a human', () => {
  const s = createGame('ABCDE');
  s.players.push(mkPlayer('p0'));
  const b = addBot(s, () => 0.5);
  assert.equal(removeBot(s, 'nobody'), false);
  assert.equal(removeBot(s, 'p0'), false);
  assert.equal(s.players.length, 2);
  assert.equal(removeBot(s, b.id), true);
  assert.equal(s.players.length, 1);
  assert.equal(removeBot(s, b.id), false); // already gone
});

t('publicState carries isBot; privateState still hides the location from a bot spy', () => {
  const { s } = mkTable(3);
  const pub = publicState(s);
  const botPub = pub.players.find(p => p.isBot);
  assert.ok(botPub);
  assert.equal(pub.players.find(p => p.id === 'p0').isBot, false);
  assert.equal('spyId' in pub, false);
  const spy = byId(s, s.spyId);
  const priv = privateState(s, spy);
  assert.equal(priv.isSpy, true);
  assert.equal(priv.locationIdx, null); // even a bot spy sees no location
});

t('botAskTarget: random other player, never self, null when alone', () => {
  const { s } = mkTable(3);
  const asker = byId(s, s.currentAskerId);
  for (let i = 0; i < 20; i++) {
    const target = botAskTarget(s, asker, seeded(i));
    assert.ok(target && target !== asker.id);
    assert.equal(askTarget(s, asker, target), true);
    // The answerer becomes the next asker; keep the chain legal.
    s.currentAskerId = asker.id;
  }
  const solo = createGame('ABCDE');
  solo.players.push(mkPlayer('p0'));
  assert.equal(botAskTarget(solo, solo.players[0], () => 0), null);
});

t('botShouldAccuse: ~8% — fires on a low roll, never twice, never self', () => {
  const { s } = mkTable(3);
  const asker = byId(s, s.currentAskerId);
  const suspect = botShouldAccuse(s, asker, () => 0.01);
  assert.ok(suspect && suspect !== asker.id);
  assert.equal(accuse(s, asker, suspect), true);
  // The vote is still open: no second accusation from anyone.
  assert.equal(botShouldAccuse(s, asker, () => 0.01), null);
  assert.equal(botShouldAccuse(s, byId(s, s.players[1].id), () => 0.01), null);
  const s2 = mkTable(3).s;
  const asker2 = byId(s2, s2.currentAskerId);
  assert.equal(botShouldAccuse(s2, asker2, () => 0.5), null); // high roll: just asks
  // Already used the one accusation this round.
  s2.accusedOnce.push(asker2.id);
  assert.equal(botShouldAccuse(s2, asker2, () => 0.01), null);
});

t('botVoteYes: mostly NO in a normal vote, coin-flip in the final vote', () => {
  const { s } = mkTable(3);
  const bot = s.players.find(p => p.isBot);
  assert.equal(botVoteYes(s, bot, () => 0.1, false), true); // <25% yes
  assert.equal(botVoteYes(s, bot, () => 0.5, false), false); // usually NO
  assert.equal(botVoteYes(s, bot, () => 0.9, false), false);
  assert.equal(botVoteYes(s, bot, () => 0.4, true), true); // final: random
  assert.equal(botVoteYes(s, bot, () => 0.6, true), false);
});

t('botSpyGuessLocation: blind 1-in-12 pick, always a valid location', () => {
  for (let i = 0; i < 50; i++) {
    const loc = botSpyGuessLocation(seeded(i));
    assert.ok(Number.isInteger(loc) && loc >= 0 && loc < LOCATIONS.length);
  }
  assert.equal(botSpyGuessLocation(() => 0), 0);
  assert.equal(botSpyGuessLocation(() => 0.999), LOCATIONS.length - 1);
});

t('question/answer pools: 8 generic lines each, usable at any location', () => {
  assert.equal(BOT_QUESTIONS.length, 8);
  assert.equal(BOT_ANSWERS.length, 8);
  for (const q of [...BOT_QUESTIONS, ...BOT_ANSWERS]) assert.equal(typeof q, 'string'), assert.ok(q.length > 5);
  assert.ok(botPickQuestion(() => 0).length > 5);
  assert.ok(botPickAnswer(() => 0).length > 5);
});

t('botFinalPick: passes half the time, otherwise accuses someone else', () => {
  const { s } = mkTable(3);
  startFinalPhase(s);
  const accuser = byId(s, s.finalOrder[s.finalIdx]);
  assert.equal(botFinalPick(s, accuser, () => 0.1), null); // pass
  const pick = botFinalPick(s, accuser, () => 0.9);
  assert.ok(pick && pick !== accuser.id);
  assert.equal(finalPick(s, accuser, pick), true);
  // Not your turn → no pick.
  const other = s.players.find(p => p.id !== s.finalOrder[s.finalIdx]);
  assert.equal(botFinalPick(s, other, () => 0.9), null);
});

t('bot-only round: 1 human + 3 bots play a full round to a result', () => {
  const { s, rng } = mkTable(3);
  const { steps, reason } = driveRound(s, rng);
  assert.ok(steps > 0 && steps < 500);
  assert.ok(['spy-caught', 'innocent-convicted', 'spy-guess-right', 'spy-guess-wrong', 'timeout-spy-wins'].includes(reason));
  assert.equal(s.roundResult.spyId, s.spyId);
  assert.equal(s.roundResult.locationIdx, s.locationIdx);
  console.log(`    (round ended by ${reason} after ${steps} bot steps)`);
});

t('bot spy accused and surviving the vote reveals and guesses blind', () => {
  const { s } = mkTable(3);
  const spy = byId(s, s.spyId);
  const accuser = s.players.find(p => p.id !== spy.id);
  assert.equal(accuse(s, accuser, spy.id), true);
  // A spy CANNOT guess while the vote is open — the rules refuse it.
  assert.equal(spyGuess(s, spy, s.locationIdx), false);
  assert.equal(s.phase, 'questioning');
  // Every eligible voter votes NO (botVoteYes with a high roll).
  for (const p of s.players) {
    if (p.id === spy.id) continue;
    assert.equal(voteAccuse(s, p, botVoteYes(s, p, () => 0.9, false)), true);
  }
  assert.equal(s.accusation, null);
  assert.equal(s.phase, 'questioning'); // vote failed, clock resumed
  // Now the spy reveals: a deliberately WRONG blind guess.
  const wrong = (s.locationIdx + 1) % LOCATIONS.length;
  assert.equal(spyGuess(s, spy, wrong), true);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult.reason, 'spy-guess-wrong');
  assert.equal(s.roundResult.winner, 'locals');
});

t('bot ballots can convict: unanimous bot YES votes catch the spy', () => {
  const { s } = mkTable(3);
  const spy = s.spyId;
  const accuser = s.players.find(p => p.id !== spy);
  assert.equal(accuse(s, accuser, spy), true);
  for (const p of s.players) {
    if (p.id === spy) continue;
    assert.equal(voteAccuse(s, p, botVoteYes(s, p, () => 0.1, false)), true);
  }
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.roundResult.reason, 'spy-caught');
  assert.equal(s.roundResult.points[accuser.id], 2);
});

t('bot-only short game: 3 rounds to session results', () => {
  const { s } = mkTable(3, { roundsTotal: 3 });
  const rng = seeded(777);
  for (let r = 1; r <= 3; r++) {
    assert.equal(s.round, r);
    if (r > 1) startQuestioning(s);
    driveRound(s, rng);
    if (r < 3) nextRound(s, rng);
  }
  assert.equal(s.round, 3);
  nextRound(s, rng);
  assert.equal(s.phase, 'results');
  const total = s.players.reduce((a, p) => a + p.score, 0);
  assert.ok(total > 0, 'some points were awarded over 3 rounds');
  console.log(`    (3-round bot game done; scores: ${s.players.map(p => `${p.name}=${p.score}`).join(', ')})`);
});

console.log(`\n== ${n} gian-diep bot tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
