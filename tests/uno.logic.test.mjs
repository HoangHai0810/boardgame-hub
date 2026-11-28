// Uno engine unit tests. Run: esbuild games/uno/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, buildDeck, deal, isPlayable, cardPoints,
  playCard, drawCard, passTurn, callUno, catchUno,
  takeDraw4, challengeWild4, pickColor, autoTurn, advanceTurn,
  publicState, privateState,
  MIN_PLAYERS, MAX_PLAYERS, TURN_MS,
} from '../games/uno/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const mkPlayer = (id, hand) => ({ id, name: id, isHost: id === 'p0', connected: true, hand, wins: 0, points: 0 });
const mk = (hands) => {
  const s = createGame('ABCDE');
  s.players = hands.map((h, i) => mkPlayer('p' + i, h));
  s.phase = 'playing'; s.turn = 'p0'; s.discard = [{ id: 'r5-0', color: 'red', kind: 'number', value: 5 }];
  s.currentColor = 'red'; s.deck = buildDeck().slice(0, 20);
  return s;
};
const C = (id, color, kind, value) => ({ id, color, kind, ...(value !== undefined ? { value } : {}) });

t('limits 2-10, 30s turns', () => { assert.equal(MIN_PLAYERS, 2); assert.equal(MAX_PLAYERS, 10); assert.equal(TURN_MS, 30000); });
t('deck is 108 cards', () => {
  const d = buildDeck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map(c => c.id)).size, 108);
  assert.equal(d.filter(c => c.kind === 'wild').length, 4);
  assert.equal(d.filter(c => c.kind === 'wild4').length, 4);
  assert.equal(d.filter(c => c.color === 'red' && c.kind === 'number' && c.value === 0).length, 1);
  assert.equal(d.filter(c => c.color === 'red' && c.kind === 'number' && c.value === 5).length, 2);
  assert.equal(d.filter(c => c.kind === 'skip').length, 8);
});
t('deal gives 7 each', () => {
  const s = createGame('X');
  for (let i = 0; i < 4; i++) s.players.push(mkPlayer('p' + i, []));
  s.phase = 'playing'; // deal() deals; the phase is the hostEngine's job
  deal(s, () => 0.5);
  s.players.forEach(p => assert.equal(p.hand.length, 7));
  assert.equal(s.discard.length, 1);
  assert.equal(s.deck.length, 108 - 28 - 1);
  assert.ok(s.turn);
});
t('playable: color, number, symbol, wild', () => {
  const top = C('r5', 'red', 'number', 5);
  assert.equal(isPlayable(C('r7', 'red', 'number', 7), top, 'red'), true); // color
  assert.equal(isPlayable(C('b5', 'blue', 'number', 5), top, 'red'), true); // number
  assert.equal(isPlayable(C('b7', 'blue', 'number', 7), top, 'red'), false);
  assert.equal(isPlayable(C('w', 'wild', 'wild'), top, 'red'), true);
  const skipTop = C('rs', 'red', 'skip');
  assert.equal(isPlayable(C('bs', 'blue', 'skip'), skipTop, 'red'), true); // symbol
  assert.equal(isPlayable(C('br', 'blue', 'reverse'), skipTop, 'red'), false);
});
t('play a number card, turn advances', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'r7'), true);
  assert.equal(s.players[0].hand.length, 0); // won the round (1 card was the whole hand)
  assert.equal(s.phase, 'results');
  assert.equal(s.winner, 'p0');
});
t('illegal plays are rejected', () => {
  const s = mk([[C('b7', 'blue', 'number', 7)], [C('r1', 'red', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'b7'), false); // blue 7 on red 5
  assert.equal(playCard(s, s.players[1], 'r1'), false); // not their turn
  assert.equal(playCard(s, s.players[0], 'nope'), false); // no such card
});
t('skip skips the next player', () => {
  const s = mk([[C('rs', 'red', 'skip'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'rs'), true);
  assert.equal(s.turn, 'p2');
});
t('reverse flips direction; in 2-player it acts as skip', () => {
  const s = mk([[C('rr', 'red', 'reverse'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'rr'), true);
  assert.equal(s.direction, -1);
  assert.equal(s.turn, 'p2'); // 3 players: reverse goes to p2
  const s2 = mk([[C('rr', 'red', 'reverse'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(playCard(s2, s2.players[0], 'rr'), true);
  assert.equal(s2.turn, 'p0'); // 2 players: same player again
});
t('draw2 makes the next player draw 2 and lose the turn', () => {
  const s = mk([[C('rd', 'red', 'draw2'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)]]);
  const before = s.players[1].hand.length;
  assert.equal(playCard(s, s.players[0], 'rd'), true);
  assert.equal(s.players[1].hand.length, before + 2);
  assert.equal(s.turn, 'p2');
});
t('wild needs a color and sets it', () => {
  const s = mk([[C('w', 'wild', 'wild'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'w'), false); // no color
  assert.equal(playCard(s, s.players[0], 'w', 'blue'), true);
  assert.equal(s.currentColor, 'blue');
  assert.equal(s.turn, 'p1');
});
t('wild4 opens a challenge; take 4 loses the turn', () => {
  const s = mk([[C('w4', 'wild', 'wild4'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'w4', 'green'), true);
  assert.ok(s.pendingDraw4);
  assert.equal(s.turn, 'p1');
  const before = s.players[1].hand.length;
  assert.equal(takeDraw4(s, s.players[1]), true);
  assert.equal(s.players[1].hand.length, before + 4);
  assert.equal(s.turn, 'p2');
});
t('challenge: bluffer held the color, so THEY draw 4 and the challenger keeps the turn', () => {
  const s = mk([[C('w4', 'wild', 'wild4'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  // p0 still holds a red card after the +4 -> the challenge succeeds
  assert.equal(playCard(s, s.players[0], 'w4', 'green'), true);
  assert.equal(s.pendingDraw4.hadColor, true);
  const before = s.players[0].hand.length;
  assert.equal(challengeWild4(s, s.players[1]), true);
  assert.equal(s.players[0].hand.length, before + 4);
  assert.equal(s.turn, 'p1'); // challenger keeps the turn
});
t('challenge: no color held, the challenger draws 6', () => {
  const s = mk([[C('w4', 'wild', 'wild4'), C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)], [C('y1', 'yellow', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'w4', 'green'), true);
  assert.equal(s.pendingDraw4.hadColor, false);
  const before = s.players[1].hand.length;
  assert.equal(challengeWild4(s, s.players[1]), true);
  assert.equal(s.players[1].hand.length, before + 6);
  assert.equal(s.turn, 'p2');
});
t('UNO: playing to 1 card sets the pending foul', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(playCard(s, s.players[0], 'r7'), true);
  assert.equal(s.unoPending, 'p0');
  assert.equal(callUno(s, s.players[0]), true);
  assert.equal(s.unoPending, null);
});
t('UNO: caught by another player draws 2', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  playCard(s, s.players[0], 'r7');
  assert.equal(catchUno(s, s.players[1], 'p0'), true);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.unoPending, null);
});
t('UNO: the next player acting first draws 2 automatically', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('r2', 'red', 'number', 2), C('b1', 'blue', 'number', 1)]]);
  playCard(s, s.players[0], 'r7');
  assert.equal(s.unoPending, 'p0');
  assert.equal(playCard(s, s.players[1], 'r2'), true);
  assert.equal(s.players[0].hand.length, 3); // 1 + 2 penalty
  assert.equal(s.unoPending, 'p1'); // p1 also played down to 1 card
});
t('UNO bell: pre-call with 2 cards on your turn arms, playing down to 1 creates no foul', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(callUno(s, s.players[0]), true);
  assert.equal(s.unoArmed, 'p0');
  assert.equal(s.unoPending, null);
  assert.equal(playCard(s, s.players[0], 'r7'), true);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.unoPending, null); // pre-called: no foul
  assert.equal(s.unoArmed, null); // consumed
  assert.equal(publicState(s).unoArmed, null);
});
t('UNO bell: pre-call needs exactly 2 cards and your turn', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1), C('r2', 'red', 'number', 2)], [C('b1', 'blue', 'number', 1)]]);
  assert.equal(callUno(s, s.players[0]), false); // 3 cards
  assert.equal(callUno(s, s.players[1]), false); // not p1's turn
  assert.equal(s.unoArmed, null);
});
t('UNO bell: drawing a card voids the pre-call', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)]]);
  callUno(s, s.players[0]);
  assert.equal(s.unoArmed, 'p0');
  s.deck = [C('g9', 'green', 'number', 9)];
  drawCard(s, s.players[0]);
  assert.equal(s.unoArmed, null);
  assert.equal(s.players[0].hand.length, 3);
});
t('UNO bell: a +2 on the armed player voids the pre-call', () => {
  const s = mk([[C('r7', 'red', 'number', 7), C('r1', 'red', 'number', 1)], [C('r2', 'red', 'draw2'), C('b1', 'blue', 'number', 1)]]);
  callUno(s, s.players[0]);
  assert.equal(s.unoArmed, 'p0');
  s.turn = 'p1';
  assert.equal(playCard(s, s.players[1], 'r2'), true); // +2 hits p0
  assert.equal(s.unoArmed, null);
  assert.equal(s.players[0].hand.length, 4);
});
t('draw: unplayable card passes the turn at once', () => {
  const s = mk([[C('b7', 'blue', 'number', 7)], [C('r1', 'red', 'number', 1)]]);
  s.deck = [C('g9', 'green', 'number', 9)]; // drawn card cannot play on red 5
  const card = drawCard(s, s.players[0]);
  assert.equal(card?.id, 'g9');
  assert.equal(s.turn, 'p1'); // passed immediately
  assert.equal(s.players[0].hand.length, 2);
});
t('draw: a playable card may be played at once, or kept with a pass', () => {
  const s = mk([[C('b7', 'blue', 'number', 7)], [C('r1', 'red', 'number', 1)]]);
  s.deck = [C('r9', 'red', 'number', 9)];
  const card = drawCard(s, s.players[0]);
  assert.equal(card?.id, 'r9');
  assert.equal(s.turn, 'p0'); // still my turn
  assert.equal(s.drawnCardId, 'r9');
  assert.equal(playCard(s, s.players[0], 'b7'), false); // only the drawn card may be played now
  assert.equal(passTurn(s, s.players[0]), true);
  assert.equal(s.turn, 'p1');
});
t('win scores the points left in the other hands', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1), C('w', 'wild', 'wild'), C('rd', 'red', 'draw2')]]);
  assert.equal(cardPoints(C('w', 'wild', 'wild')), 50);
  assert.equal(cardPoints(C('rd', 'red', 'draw2')), 20);
  assert.equal(playCard(s, s.players[0], 'r7'), true);
  assert.equal(s.winner, 'p0');
  assert.equal(s.roundPoints, 1 + 50 + 20);
  assert.equal(s.players[0].points, 71);
  assert.equal(s.players[0].wins, 1);
});
t('autoTurn: a forgotten turn draws 1 and passes', () => {
  const s = mk([[C('b7', 'blue', 'number', 7)], [C('r1', 'red', 'number', 1)]]);
  s.deck = [C('g9', 'green', 'number', 9)];
  autoTurn(s);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.turn, 'p1');
});
t('autoTurn: a forgotten +4 decision takes the 4', () => {
  const s = mk([[C('w4', 'wild', 'wild4'), C('r1', 'red', 'number', 1)], [C('b1', 'blue', 'number', 1)], [C('g1', 'green', 'number', 1)]]);
  playCard(s, s.players[0], 'w4', 'green');
  autoTurn(s);
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.turn, 'p2');
});
t('publicState hides hands; privateState shows only mine', () => {
  const s = mk([[C('r7', 'red', 'number', 7)], [C('b1', 'blue', 'number', 1)]]);
  const pub = publicState(s);
  assert.equal(pub.players[0].handCount, 1);
  assert.equal(pub.players[0].hand, undefined);
  assert.equal(pub.topCard?.id, 'r5-0');
  const priv = privateState(s, s.players[0]);
  assert.equal(priv.myHand[0].id, 'r7');
  assert.equal(privateState(s, s.players[1]).myHand[0].id, 'b1');
});
t('pickColor resolves a first-card wild', () => {
  const s = createGame('X');
  for (let i = 0; i < 2; i++) s.players.push(mkPlayer('p' + i, []));
  s.phase = 'playing'; s.turn = 'p0'; s.colorPickPending = 'p0';
  assert.equal(pickColor(s, s.players[0], 'blue'), true);
  assert.equal(s.currentColor, 'blue');
  assert.equal(s.colorPickPending, null);
});

console.log(`\n== ${n} uno logic tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
