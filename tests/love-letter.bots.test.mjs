// Love Letter bot brains. Run:
//   ./client/node_modules/.bin/esbuild games/love-letter/logic.ts --format=esm --outfile=games/love-letter/logic.mjs
//   ./client/node_modules/.bin/esbuild games/love-letter/bots.ts --bundle --format=esm --outfile=games/love-letter/bots.mjs
//   node tests/love-letter.bots.test.mjs
// (then delete the generated .mjs files.)
import { strict as assert } from 'node:assert';
import {
  createGame, startRound, playCard, chooseTarget, autoTurn,
  legalPlays, validTargets, publicState, addBot, removeBot,
  CARD_VALUE, GUESSABLE, MIN_PLAYERS, MAX_PLAYERS, tokensFor,
} from '../games/love-letter/logic.mjs';
import {
  botChooseCard, botChooseTarget, botChooseChancellorKeep, botAct,
} from '../games/love-letter/bots.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
// Deterministic rng (mulberry32) so the bot-only simulations replay.
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const rng = () => 0;
const mkPlayer = (id, isBot = false) => ({
  id, name: id, isHost: id === 'p0', connected: true, isBot,
  hand: [], discardPile: [], protected: false, inRound: true, tokens: 0, roundWins: 0,
});
// A fresh game in 'playing', with the turn on p0 holding 2 cards.
const mk = (count = 4, config) => {
  const s = createGame('ABCDE');
  if (config) s.config = { ...s.config, ...config };
  for (let i = 0; i < count; i++) s.players.push(mkPlayer('p' + i, true));
  startRound(s, rng);
  return s;
};
const turnPlayer = (s) => s.players.find(p => p.id === s.turn);
const give = (s, playerId, kinds) => {
  const p = s.players.find(x => x.id === playerId);
  p.hand = kinds.map((kind, i) => ({ id: `${kind}-t${i}`, kind, value: CARD_VALUE[kind] }));
  return p;
};

/* ---------- lobby: addBot / removeBot ---------- */

t('addBot names bots Bot An/Bot Bình/… in order, never reusing a name in the room', () => {
  const s = createGame('ABCDE');
  s.players.push(mkPlayer('h0'));
  const b1 = addBot(s, () => 0.5);
  const b2 = addBot(s, () => 0.5);
  const b3 = addBot(s, () => 0.5);
  assert.equal(b1.name, 'Bot An');
  assert.equal(b2.name, 'Bot Bình');
  assert.equal(b3.name, 'Bot Chi');
  assert.equal(b1.isBot, true);
  assert.equal(b1.connected, true);
  assert.equal(b1.isHost, false);
  assert.notEqual(b1.id, b2.id);
});

t('addBot refuses past MAX_PLAYERS and removeBot only removes bots', () => {
  const s = createGame('ABCDE');
  s.players.push(mkPlayer('h0'));
  for (let i = 0; i < 5; i++) assert.ok(addBot(s, () => 0.1 + i * 0.1));
  assert.equal(s.players.length, MAX_PLAYERS);
  assert.equal(addBot(s), null);
  const botId = s.players.find(p => p.isBot).id;
  assert.equal(removeBot(s, 'h0'), false); // a human is not a bot
  assert.equal(removeBot(s, 'nobody'), false);
  assert.equal(removeBot(s, botId), true);
  assert.equal(s.players.length, MAX_PLAYERS - 1);
  assert.equal(s.players.some(p => p.id === botId), false);
});

t('publicState carries isBot so the UI can tag bots', () => {
  const s = createGame('ABCDE');
  s.players.push(mkPlayer('h0'));
  addBot(s, () => 0.5);
  const pub = publicState(s);
  assert.equal(pub.players.find(p => p.id === 'h0').isBot, false);
  assert.equal(pub.players.find(p => p.isBot).name, 'Bot An');
});

/* ---------- card choice ---------- */

t('bot never plays the Princess while another legal card exists', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  for (let i = 0; i < 200; i++) {
    give(s, me.id, ['princess', 'guard']);
    assert.equal(botChooseCard(s, me, () => 0.5).kind, 'guard');
    give(s, me.id, ['princess', 'spy']);
    assert.equal(botChooseCard(s, me, () => 0.5).kind, 'spy');
  }
});

t('bot plays the Princess only when it is the only legal card', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['princess', 'princess']);
  // Two Princesses cannot happen in a real deck, but the rule is the
  // same: with no other legal card the Princess is the only play.
  assert.equal(botChooseCard(s, me).kind, 'princess');
});

t('bot is forced to play the Countess when held with King/Prince', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['countess', 'king']);
  assert.equal(botChooseCard(s, me).kind, 'countess');
  give(s, me.id, ['countess', 'prince']);
  assert.equal(botChooseCard(s, me).kind, 'countess');
  // …and the choice goes through the validated logic, not around it.
  give(s, me.id, ['countess', 'king']);
  assert.equal(botAct(s, me, rng), true);
  assert.equal(s.lastPlay.card, 'countess');
});

t('botChooseCard only ever returns a legal play', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  const kinds = ['spy', 'guard', 'priest', 'baron', 'handmaid', 'prince', 'chancellor', 'king', 'countess', 'princess'];
  for (const a of kinds) for (const b of kinds) {
    give(s, me.id, [a, b]);
    const legal = legalPlays(s, me);
    const pick = botChooseCard(s, me, () => 0.5);
    assert.ok(legal.some(c => c.id === pick.id), `bot picked illegal ${pick.kind} from ${a}+${b}`);
  }
});

/* ---------- target choice ---------- */

t('Guard bot picks a valid target and a guessable card — never Guard', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'spy']);
  for (let i = 0; i < 50; i++) {
    const d = botChooseTarget(s, me, 'guard', () => (i * 0.37) % 1);
    assert.ok(d);
    assert.ok(validTargets(s, me, 'guard').some(p => p.id === d.targetId));
    assert.ok(GUESSABLE.includes(d.guess));
    assert.notEqual(d.guess, 'guard');
    assert.notEqual(d.targetId, me.id);
  }
});

t('Guard bot uses its own Priest peek: a peeked Princess is a certain hit', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'spy']);
  s.seenHands[me.id] = { targetId: 'p1', card: { id: 'princess-x', kind: 'princess', value: 9 } };
  const d = botChooseTarget(s, me, 'guard', () => 0.5);
  assert.equal(d.targetId, 'p1');
  assert.equal(d.guess, 'princess');
});

t('Prince bot never targets itself while another player is available', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['prince', 'spy']);
  for (let i = 0; i < 50; i++) {
    const d = botChooseTarget(s, me, 'prince', () => (i * 0.53) % 1);
    assert.ok(d);
    assert.notEqual(d.targetId, me.id);
  }
});

t('Prince bot prefers a peeked Princess (a knockout)', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['prince', 'spy']);
  s.seenHands[me.id] = { targetId: 'p2', card: { id: 'princess-x', kind: 'princess', value: 9 } };
  assert.equal(botChooseTarget(s, me, 'prince', () => 0.5).targetId, 'p2');
});

t('Priest/Baron/King bots only pick valid, in-round, unprotected targets', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  s.players[2].protected = true; // p2 cannot be targeted
  for (const type of ['priest', 'baron', 'king']) {
    give(s, me.id, [type, 'spy']);
    for (let i = 0; i < 20; i++) {
      const d = botChooseTarget(s, me, type, () => (i * 0.31) % 1);
      assert.ok(d);
      assert.ok(validTargets(s, me, type).some(p => p.id === d.targetId));
      assert.notEqual(d.targetId, 'p2');
      assert.notEqual(d.targetId, me.id);
    }
  }
});

t('Baron bot prefers a peeked card lower than the one it keeps', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['baron', 'king']); // keeps the King (7)
  s.seenHands[me.id] = { targetId: 'p1', card: { id: 'guard-x', kind: 'guard', value: 1 } };
  assert.equal(botChooseTarget(s, me, 'baron', () => 0.5).targetId, 'p1');
});

/* ---------- Chancellor ---------- */

t('Chancellor bot keeps the highest-value card in hand', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['princess', 'guard', 'king']);
  assert.equal(botChooseChancellorKeep(s, me).kind, 'princess');
  give(s, me.id, ['spy', 'guard', 'chancellor']);
  assert.equal(botChooseChancellorKeep(s, me).kind, 'chancellor');
});

t('botAct resolves a pending Chancellor through validated logic', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['chancellor', 'spy']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'chancellor').id, rng), true);
  assert.equal(s.pendingAction?.type, 'chancellor');
  const before = [...me.hand];
  const best = Math.max(...before.map(c => c.value));
  assert.equal(botAct(s, me, rng), true);
  assert.equal(s.pendingAction, null);
  assert.equal(me.hand.length, 1);
  assert.equal(me.hand[0].value, best);
});

t('botAct resolves a pending Guard through validated logic', () => {
  const s = mk(4);
  const me = turnPlayer(s);
  give(s, me.id, ['guard', 'spy']);
  assert.equal(playCard(s, me, me.hand.find(c => c.kind === 'guard').id, rng), true);
  assert.equal(s.pendingAction?.type, 'guard');
  assert.equal(botAct(s, me, rng), true);
  assert.equal(s.pendingAction, null);
  assert.ok(s.lastPlay && (s.lastPlay.outcome === 'hit' || s.lastPlay.outcome === 'miss'));
});

t('botAct does nothing when it is not the bot’s turn', () => {
  const s = mk(4);
  const other = s.players.find(p => p.id !== s.turn);
  assert.equal(botAct(s, other, rng), false);
});

/* ---------- full bot-only games (must reach a session winner) ---------- */

// Play a whole session with bots only: every turn goes through botAct
// (validated logic), rounds are re-dealt by the "host", and the loop
// fails loudly if a bot ever stalls (autoTurn would have to rescue it)
// or the step cap is hit.
const playBotOnlySession = (playerCount, quickMode, seed) => {
  const r = seeded(seed);
  const s = createGame('BOT' + playerCount);
  s.config.quickMode = quickMode;
  for (let i = 0; i < playerCount; i++) s.players.push(mkPlayer('p' + i, true));
  startRound(s, r);
  let steps = 0;
  let rounds = 1;
  let fallbacks = 0;
  const winners = [];
  while (s.phase !== 'results' && steps < 20000 && rounds <= 100) {
    steps++;
    if (s.phase === 'roundEnd') {
      winners.push([...s.roundWinners]);
      s.round++;
      rounds++;
      startRound(s, r);
      continue;
    }
    if (s.phase !== 'playing') break;
    const actor = s.pendingAction
      ? s.players.find(p => p.id === s.pendingAction.actorId)
      : turnPlayer(s);
    if (!actor) { fallbacks++; autoTurn(s, r); continue; }
    if (!botAct(s, actor, r)) { fallbacks++; autoTurn(s, r); }
  }
  return { s, steps, rounds, fallbacks, winners };
};

t('bot-only game, 2 players quick mode, reaches a session winner', () => {
  const { s, steps, rounds, fallbacks } = playBotOnlySession(2, true, 42);
  assert.equal(fallbacks, 0, `botAct stalled ${fallbacks} time(s)`);
  assert.equal(s.phase, 'results');
  assert.ok(s.sessionWinner, 'no session winner');
  assert.ok(s.players.some(p => p.id === s.sessionWinner && p.isBot));
  const w = s.players.find(p => p.id === s.sessionWinner);
  assert.ok(w.tokens >= tokensFor(2, true), `winner has ${w.tokens} tokens`);
  console.log(`    (2p quick: ${steps} bot steps, ${rounds} rounds, winner ${w.name} with ${w.tokens}❤)`);
});

t('bot-only game, 4 players quick mode, reaches a session winner', () => {
  const { s, steps, rounds, fallbacks } = playBotOnlySession(4, true, 7);
  assert.equal(fallbacks, 0, `botAct stalled ${fallbacks} time(s)`);
  assert.equal(s.phase, 'results');
  assert.ok(s.sessionWinner, 'no session winner');
  const w = s.players.find(p => p.id === s.sessionWinner);
  assert.ok(w.tokens >= tokensFor(4, true), `winner has ${w.tokens} tokens`);
  console.log(`    (4p quick: ${steps} bot steps, ${rounds} rounds, winner ${w.name} with ${w.tokens}❤)`);
});

t('bot-only game, 6 players standard mode, reaches a session winner', () => {
  const { s, steps, rounds, fallbacks } = playBotOnlySession(6, false, 99);
  assert.equal(fallbacks, 0, `botAct stalled ${fallbacks} time(s)`);
  assert.equal(s.phase, 'results');
  assert.ok(s.sessionWinner, 'no session winner');
  const w = s.players.find(p => p.id === s.sessionWinner);
  assert.ok(w.tokens >= tokensFor(6, false), `winner has ${w.tokens} tokens`);
  assert.ok(s.players.length <= MAX_PLAYERS && s.players.length >= MIN_PLAYERS);
  console.log(`    (6p standard: ${steps} bot steps, ${rounds} rounds, winner ${w.name} with ${w.tokens}❤)`);
});

console.log(`\n${n} bot tests run`);
