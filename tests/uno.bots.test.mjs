// Uno bot brains + bot-only full-game simulation.
// Run: ./client/node_modules/.bin/esbuild games/uno/logic.ts --format=esm --outfile=games/uno/logic.mjs
//      ./client/node_modules/.bin/esbuild games/uno/bots.ts --bundle --format=esm --outfile=games/uno/bots.mjs
//      node tests/uno.bots.test.mjs   (then delete the generated .mjs files)
import { strict as assert } from 'node:assert';
import { botPickCard, botChooseColor, botShouldChallenge, botCatchTarget } from '../games/uno/bots.mjs';
import {
  createGame, buildDeck, deal, playCard, drawCard, passTurn, callUno, catchUno,
  takeDraw4, challengeWild4, pickColor, addBot, removeBot,
  publicState, MIN_PLAYERS, MAX_PLAYERS,
} from '../games/uno/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const C = (id, color, kind, value) => ({ id, color, kind, ...(value !== undefined ? { value } : {}) });
const mkPlayer = (id, hand) => ({ id, name: id, isHost: id === 'p0', connected: true, hand, wins: 0, points: 0 });
const mk = (hands) => {
  const s = createGame('ABCDE');
  s.players = hands.map((h, i) => mkPlayer('p' + i, h));
  s.phase = 'playing'; s.turn = 'p0'; s.discard = [{ id: 'r5-0', color: 'red', kind: 'number', value: 5 }];
  s.currentColor = 'red'; s.deck = buildDeck().slice(0, 20);
  return s;
};
// Deterministic rng (mulberry32) so the bot-only game is reproducible.
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

t('addBot names bots Bot An, Bot Bình… and counts toward the table', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('human', []));
  const b1 = addBot(s, () => 0.5);
  const b2 = addBot(s, () => 0.5);
  assert.equal(b1.name, 'Bot An');
  assert.equal(b2.name, 'Bot Bình');
  assert.equal(b1.isBot, true);
  assert.equal(b1.isHost, false);
  assert.equal(b1.connected, true);
  assert.equal(s.players.length, 3);
  assert.ok(s.players.length >= MIN_PLAYERS);
});

t('addBot picks an unused name and stops at MAX_PLAYERS', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('p0', []));
  // A human already called "Bot An" — the bot must not collide with it.
  s.players.push({ id: 'p1', name: 'Bot An', isHost: false, connected: true, hand: [], wins: 0, points: 0 });
  assert.equal(addBot(s, () => 0.5).name, 'Bot Bình');
  while (s.players.length < MAX_PLAYERS) assert.ok(addBot(s, () => 0.5));
  assert.equal(addBot(s, () => 0.5), null);
  assert.equal(s.players.length, MAX_PLAYERS);
});

t('removeBot removes only bots', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('human', []));
  const b = addBot(s, () => 0.5);
  assert.equal(removeBot(s, 'human'), false);
  assert.equal(removeBot(s, 'nope'), false);
  assert.equal(removeBot(s, b.id), true);
  assert.equal(s.players.length, 1);
});

t('publicState carries isBot', () => {
  const s = createGame('X');
  s.players.push(mkPlayer('human', []));
  addBot(s, () => 0.5);
  const pub = publicState(s);
  assert.equal(pub.players[0].isBot, false);
  assert.equal(pub.players[1].isBot, true);
});

t('bot prefers an action card over a number, a number over a wild, a wild over +4', () => {
  const s = mk([
    [C('r7', 'red', 'number', 7), C('rs', 'red', 'skip'), C('w0', 'wild', 'wild'), C('w4', 'wild', 'wild4')],
    [C('b1', 'blue', 'number', 1)],
  ]);
  assert.equal(botPickCard(s, s.players[0], () => 0).cardId, 'rs'); // skip beats number/wild/+4
  const s2 = mk([
    [C('r7', 'red', 'number', 7), C('w0', 'wild', 'wild'), C('w4', 'wild', 'wild4')],
    [C('b1', 'blue', 'number', 1)],
  ]);
  assert.equal(botPickCard(s2, s2.players[0], () => 0).cardId, 'r7'); // number beats wild/+4
  const s3 = mk([
    [C('w0', 'wild', 'wild'), C('w4', 'wild', 'wild4')],
    [C('b1', 'blue', 'number', 1)],
  ]);
  const p3 = botPickCard(s3, s3.players[0], () => 0);
  assert.equal(p3.cardId, 'w0'); // plain wild beats +4
  assert.ok(['red', 'yellow', 'green', 'blue'].includes(p3.color));
});

t('bot returns null with no playable card, and never plays an illegal card', () => {
  const s = mk([
    [C('b7', 'blue', 'number', 7), C('g3', 'green', 'number', 3)],
    [C('b1', 'blue', 'number', 1)],
  ]);
  assert.equal(botPickCard(s, s.players[0], () => 0), null);
  const s2 = mk([
    [C('b5', 'blue', 'number', 5), C('b7', 'blue', 'number', 7)],
    [C('b1', 'blue', 'number', 1)],
  ]);
  // Only the 5 matches the top 5 by number; the 7 is illegal.
  assert.equal(botPickCard(s2, s2.players[0], () => 0).cardId, 'b5');
});

t('bot picks the color it holds most of', () => {
  const hand = [C('r1', 'red', 'number', 1), C('r2', 'red', 'number', 2), C('b3', 'blue', 'number', 3)];
  assert.equal(botChooseColor(hand, () => 0), 'red');
  assert.ok(['red', 'yellow', 'green', 'blue'].includes(botChooseColor([], () => 0)));
});

t('bot only considers the drawn card after drawing', () => {
  const s = mk([
    [C('r7', 'red', 'number', 7), C('b5', 'blue', 'number', 5)],
    [C('b1', 'blue', 'number', 1)],
  ]);
  // Drawn card is the blue 5 (playable by number); the red 7 must not be picked.
  s.turnDrawn = true; s.drawnCardId = 'b5';
  assert.equal(botPickCard(s, s.players[0], () => 0).cardId, 'b5');
});

t('bot challenges a +4 about 30% of the time', () => {
  assert.equal(botShouldChallenge(() => 0.29), true);
  assert.equal(botShouldChallenge(() => 0.30), false);
  assert.equal(botShouldChallenge(() => 0.99), false);
});

t('bot catches a forgotten UNO — never its own', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1)]]);
  s.unoPending = 'p1';
  assert.equal(botCatchTarget(s, s.players[0]), 'p1');
  assert.equal(botCatchTarget(s, s.players[1]), null);
  s.unoPending = null;
  assert.equal(botCatchTarget(s, s.players[0]), null);
});

t('bot catch goes through the validated catchUno (target draws 2)', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1)]]);
  s.unoPending = 'p1';
  const before = s.players[1].hand.length;
  assert.equal(catchUno(s, s.players[0], botCatchTarget(s, s.players[0])), true);
  assert.equal(s.players[1].hand.length, before + 2);
  assert.equal(s.unoPending, null);
});

t('bot callUno goes through the validated callUno', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1)]]);
  s.unoPending = 'p0';
  assert.equal(callUno(s, s.players[0]), true);
  assert.equal(s.unoPending, null);
});

t('bot-only game: 4 bots play through validated logic to a winner', () => {
  const rng = mulberry32(20261127);
  const s = createGame('BOT');
  for (let i = 0; i < 4; i++) addBot(s, rng);
  s.phase = 'playing';
  deal(s, rng);
  let turns = 0;
  const MAX_TURNS = 5000;
  while (s.phase === 'playing' && turns < MAX_TURNS) {
    turns++;
    const me = s.players.find(p => p.id === s.turn);
    assert.ok(me, 'turn player must exist');
    if (s.colorPickPending === me.id) {
      assert.equal(pickColor(s, me, botChooseColor(me.hand, rng)), true);
      continue;
    }
    if (s.pendingDraw4) {
      const ok = botShouldChallenge(rng) ? challengeWild4(s, me, rng) : takeDraw4(s, me, rng);
      assert.equal(ok, true, 'bot +4 decision must land');
      continue;
    }
    // A bot that just played down to 1 card calls UNO at once, before
    // the next player acts (the engine schedules this on a short delay).
    if (s.unoPending) {
      const pending = s.players.find(p => p.id === s.unoPending);
      assert.equal(callUno(s, pending), true);
    }
    const pick = botPickCard(s, me, rng);
    if (pick) {
      assert.equal(playCard(s, me, pick.cardId, pick.color, rng), true, 'bot play must land');
    } else if (!s.turnDrawn) {
      drawCard(s, me, rng);
      // Drawn card playable -> turn stays and the loop re-runs so the
      // bot plays it; not playable -> drawCard advanced the turn.
    } else {
      assert.equal(passTurn(s, me), true, 'bot pass must land');
    }
  }
  assert.equal(s.phase, 'results', `game must finish within ${MAX_TURNS} turns (ran ${turns})`);
  assert.ok(s.winner, 'a winner must exist');
  const winner = s.players.find(p => p.id === s.winner);
  assert.equal(winner.hand.length, 0);
  assert.ok(winner.isBot);
  console.log(`  (bot-only game finished in ${turns} turns — winner: ${winner.name}, +${s.roundPoints} points)`);
});

console.log(`\n${n} tests`);
