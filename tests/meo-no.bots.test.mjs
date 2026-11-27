// Mèo Nổ bot brains + bot-only full-game simulation.
// Run: esbuild games/meo-no/logic.ts --format=esm --outfile=games/meo-no/logic.mjs
//      esbuild games/meo-no/bots.ts --bundle --format=esm --outfile=games/meo-no/bots.mjs
//      then node this file. Delete the generated .mjs files afterwards.
import { strict as assert } from 'node:assert';
import {
  createGame, deal, playCard, playNope, resolvePendingAction, drawCard,
  defuse, reinsert, reinsertPositions, giveFavorCard,
  addBot, removeBot, BOT_NAMES, publicState,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../games/meo-no/logic.mjs';
import {
  botChooseAction, botShouldNope, botReinsertPos, botFavorGiveCardId, botFavorTarget,
} from '../games/meo-no/bots.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const C = (id, kind, variant) => ({ id, kind, ...(variant ? { variant } : {}) });
const mkPlayer = (id, hand) => ({ id, name: id, isHost: id === 'p0', connected: true, hand, wins: 0, alive: true, explodedTurn: null });
const mk = (hands, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  s.players = hands.map((h, i) => mkPlayer('p' + i, h));
  s.phase = 'playing'; s.turn = 'p0'; s.turnCount = 1;
  s.deck = [C('d1', 'cat', 'tabby'), C('d2', 'cat', 'black'), C('d3', 'skip')];
  return s;
};
/** Deterministic rng (mulberry32) so the bot-only games replay. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

t('addBot picks unused Vietnamese names, isBot, connected, never host', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('p0', []));
  const b = addBot(s, () => 0.5);
  assert.ok(b && b.isBot && b.connected && !b.isHost);
  assert.ok(BOT_NAMES.some(nm => b.name === `Bot ${nm}`), b.name);
  const b2 = addBot(s, () => 0.5);
  assert.notEqual(b2.name, b.name);
  assert.equal(s.players.length, 3);
});

t('addBot stops at MAX_PLAYERS; removeBot only removes bots', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('p0', []));
  for (let i = 0; i < 4; i++) assert.ok(addBot(s, () => 0.1 + i * 0.01));
  assert.equal(s.players.length, MAX_PLAYERS);
  assert.equal(addBot(s), null);
  const botId = s.players[1].id;
  assert.equal(removeBot(s, botId), true);
  assert.equal(s.players.length, MAX_PLAYERS - 1);
  assert.equal(removeBot(s, 'p0'), false); // a human is not a bot
  assert.equal(removeBot(s, 'nope'), false);
});

t('1 human + 1 bot meets MIN_PLAYERS; publicState carries isBot', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('p0', []));
  addBot(s, () => 0.5);
  assert.ok(s.players.filter(p => p.connected).length >= MIN_PLAYERS);
  const pub = publicState(s);
  assert.equal(pub.players[1].isBot, true);
  assert.equal(pub.players[0].isBot, false);
});

t('botChooseAction is null when it is not the bot turn, or a window is open', () => {
  const s = mk([[C('sk', 'skip')], [C('sk2', 'skip')]]);
  assert.equal(botChooseAction(s, s.players[1], () => 0), null); // not p1's turn
  s.pendingAction = { cardId: 'x', kind: 'skip', actorId: 'p1', nopes: [], endsAt: Date.now() + 8000 };
  assert.equal(botChooseAction(s, s.players[0], () => 0), null);
});

t('botChooseAction never picks a cat / defuse / nope card', () => {
  const s = mk([[C('c1', 'cat', 'tabby'), C('df', 'defuse'), C('np', 'nope'), C('sk', 'skip')]]);
  for (const r of [0, 0.1, 0.34, 0.5, 0.99]) {
    const act = botChooseAction(s, s.players[0], () => r);
    if (act) assert.ok(['skip', 'shuffle', 'peek', 'attack', 'favor'].includes(s.players[0].hand.find(c => c.id === act.cardId)?.kind ?? ''));
  }
  const onlyCats = mk([[C('c1', 'cat', 'tabby'), C('df', 'defuse'), C('np', 'nope')]]);
  assert.equal(botChooseAction(onlyCats, onlyCats.players[0], () => 0), null);
});

t('botChooseAction with attack debt answers with Attack, else Skip, else draws', () => {
  const atk = mk([[C('a1', 'attack')], [C('c1', 'cat', 'tabby')]]);
  atk.debt = 2;
  assert.deepEqual(botChooseAction(atk, atk.players[0], () => 0), { cardId: 'a1' });
  assert.equal(botChooseAction(atk, atk.players[0], () => 0.9), null); // too timid: pays the debt by drawing
  const skp = mk([[C('sk', 'skip')], [C('c1', 'cat', 'tabby')]]);
  skp.debt = 2;
  assert.deepEqual(botChooseAction(skp, skp.players[0], () => 0), { cardId: 'sk' });
});

t('botChooseAction plays one action ~35% of turns; Favor picks a living opponent', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ]);
  s.players[2].alive = false;
  assert.deepEqual(botChooseAction(s, s.players[0], () => 0.1), { cardId: 'sk' });
  assert.equal(botChooseAction(s, s.players[0], () => 0.9), null); // 0.9 >= 0.35: just draws
  const fv = mk([
    [C('fv', 'favor')],
    [C('c1', 'cat', 'tabby')],
    [C('c2', 'cat', 'black')],
  ]);
  fv.players[2].alive = false;
  assert.deepEqual(botChooseAction(fv, fv.players[0], () => 0), { cardId: 'fv', targetId: 'p1' });
  assert.equal(botFavorTarget(fv, fv.players[0], () => 0), 'p1');
});

t('botShouldNope: ~15% roll, needs a Nope, never its own card or own Nope', () => {
  const s = mk([
    [C('sk', 'skip')],
    [C('np', 'nope')],
    [C('np2', 'nope')],
  ]);
  assert.equal(playCard(s, s.players[0], 'sk'), true); // pending skip by p0
  assert.equal(botShouldNope(s, s.players[1], () => 0.1), true);
  assert.equal(botShouldNope(s, s.players[1], () => 0.2), false); // 0.2 >= 0.15: lets it pass
  assert.equal(botShouldNope(s, s.players[0], () => 0), false); // actor may not nope its own card
  s.players[1].hand = [C('c9', 'cat', 'white')];
  assert.equal(botShouldNope(s, s.players[1], () => 0), false); // no Nope in hand
  s.players[1].hand = [C('np', 'nope')];
  assert.equal(playNope(s, s.players[1]), true);
  assert.equal(botShouldNope(s, s.players[1], () => 0), false); // may not nope its own Nope
  assert.equal(botShouldNope(s, s.players[2], () => 0), true); // p2 may nope the Nope
});

t('botReinsertPos is one of the 5 legal positions; favor-give is a card from its hand', () => {
  const s = mk([[C('df', 'defuse')]]);
  s.deck = Array.from({ length: 17 }, (_, i) => C('d' + i, 'cat', 'tabby'));
  assert.deepEqual(reinsertPositions(s).map(o => o.pos), [1, 2, 3, 9, 18]);
  assert.ok([1, 2, 3, 9, 18].includes(botReinsertPos(s, () => 0.99)));
  const gv = mk([[], [C('c1', 'cat', 'tabby'), C('c2', 'cat', 'black')]]);
  assert.equal(botFavorGiveCardId(gv, gv.players[1], () => 0), 'c1');
  assert.equal(botFavorGiveCardId(gv, gv.players[1], () => 0.99), 'c2');
});

/* ---------- full bot-only games, driven only through validated logic ---------- */
function runBotOnlyGame(seed, nBots, config) {
  const rng = mulberry32(seed);
  const s = createGame('BOT');
  if (config) s.config = { ...s.config, ...config };
  for (let i = 0; i < nBots; i++) addBot(s, rng);
  s.phase = 'playing'; // deal() itself does not flip the phase (startRound does)
  deal(s, rng);
  let steps = 0, actions = 0, nopes = 0, defuses = 0, draws = 0;
  while (s.phase === 'playing' && steps < 10000) {
    steps++;
    if (s.pendingExplode) {
      const p = s.players.find(x => x.id === s.pendingExplode.playerId);
      assert.ok(defuse(s, p), 'bot defuse must land');
      defuses++;
      const pos = botReinsertPos(s, rng);
      assert.ok(pos !== null && reinsertPositions(s).some(o => o.pos === pos), 'reinsert pos must be legal');
      assert.ok(reinsert(s, p, pos), 'bot reinsert must land');
      continue;
    }
    if (s.pendingReinsert) {
      const p = s.players.find(x => x.id === s.pendingReinsert);
      const pos = botReinsertPos(s, rng);
      assert.ok(reinsert(s, p, pos), 'bot reinsert must land');
      continue;
    }
    if (s.pendingFavor) {
      const t = s.players.find(x => x.id === s.pendingFavor.targetId);
      const id = botFavorGiveCardId(s, t, rng);
      assert.ok(id && giveFavorCard(s, t, id), 'bot favor-give must land');
      continue;
    }
    if (s.pendingAction) {
      let noped = false;
      for (const b of s.players.filter(p => p.alive)) {
        if (botShouldNope(s, b, rng) && playNope(s, b)) { nopes++; noped = true; break; }
      }
      if (!noped) resolvePendingAction(s, rng);
      continue;
    }
    const me = s.players.find(p => p.id === s.turn);
    assert.ok(me && me.alive, 'turn must belong to a living bot');
    const act = botChooseAction(s, me, rng);
    if (act) {
      assert.ok(playCard(s, me, act.cardId, act.targetId), 'bot action must be legal');
      actions++;
      continue;
    }
    const drawn = drawCard(s, me, rng);
    assert.ok(drawn !== null, 'bot draw must return a card');
    draws++;
  }
  return { s, steps, actions, nopes, defuses, draws };
}

t('bot-only game (4 bots, Nope on) runs to a winner', () => {
  const r = runBotOnlyGame(12345, 4);
  assert.equal(r.s.phase, 'results');
  assert.ok(r.s.winner, 'must have a winner');
  assert.equal(r.s.players.filter(p => p.alive).length, 1);
  assert.equal(r.s.players.find(p => p.id === r.s.winner).alive, true);
  assert.ok(r.steps < 10000, `finished in ${r.steps} steps`);
  console.log(`    (4-bot game: ${r.steps} steps, ${r.actions} actions, ${r.draws} draws, ${r.nopes} nopes, ${r.defuses} defuses, winner ${r.s.players.find(p => p.id === r.s.winner).name})`);
});

t('bot-only game (2 bots, Nope on) runs to a winner', () => {
  const r = runBotOnlyGame(777, 2);
  assert.equal(r.s.phase, 'results');
  assert.ok(r.s.winner);
  assert.equal(r.s.players.filter(p => p.alive).length, 1);
  console.log(`    (2-bot game: ${r.steps} steps, winner ${r.s.players.find(p => p.id === r.s.winner).name})`);
});

t('bot-only game (5 bots, Nope off) runs to a winner', () => {
  const r = runBotOnlyGame(2026, 5, { nopeEnabled: false });
  assert.equal(r.s.phase, 'results');
  assert.ok(r.s.winner);
  assert.equal(r.s.players.filter(p => p.alive).length, 1);
  console.log(`    (5-bot game, nope off: ${r.steps} steps, ${r.actions} actions, winner ${r.s.players.find(p => p.id === r.s.winner).name})`);
});

console.log(`\n== ${n} meo-no bot tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
