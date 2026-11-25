// v24: defaults for forgotten actions + witness visibility of the steal.
import assert from 'node:assert';
import { createGame, doSteal, privateState, publicState, applyDefaultVotes, autoInspectIdle } from '../games/cheese-thief/logic.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

function manualGame(n) {
  const g = createGame('TEST2');
  for (let i = 0; i < n; i++) g.players.push({ id: 'p' + i, name: 'P' + i, isHost: i === 0, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, wins: 0 });
  return g;
}

t('steal is witnessed: stealById for wakers that hour, witnessedThiefId kept, sleepers see nothing', () => {
  const g = manualGame(4);
  g.players[0].role = 'thief'; g.players[0].dice = 3;
  g.players[1].role = 'sleepyhead'; g.players[1].dice = 3; // witness
  g.players[2].role = 'sleepyhead'; g.players[2].dice = 1;
  g.players[3].role = 'sleepyhead'; g.players[3].dice = 5;
  g.phase = 'night'; g.currentHour = 3;
  assert.equal(doSteal(g, g.players[0]), true);
  const wit = privateState(g, g.players[1]);
  assert.equal(wit.stealById, 'p0');
  assert.equal(wit.witnessedThiefId, 'p0');
  const thiefPriv = privateState(g, g.players[0]);
  assert.equal(thiefPriv.stealById, 'p0'); // thief sees their own steal effect
  const sleeper = privateState(g, g.players[2]);
  assert.equal(sleeper.stealById, null);
  assert.equal(sleeper.witnessedThiefId, null);
  // witnessedThiefId persists after the hour moves on
  g.currentHour = 4;
  assert.equal(privateState(g, g.players[1]).witnessedThiefId, 'p0');
  assert.equal(privateState(g, g.players[1]).stealById, null); // effect is that-hour only
  // public state never carries the witness fields
  assert.ok(!JSON.stringify(publicState(g)).includes('stealById'));
  assert.ok(!JSON.stringify(publicState(g)).includes('witnessedThiefId'));
});

t('default votes: connected non-voters get a random non-self vote at expiry; disconnected skipped', () => {
  const g = manualGame(4);
  g.phase = 'voting';
  g.players[0].hasVoted = true; g.players[0].vote = 'p1';
  g.players[3].connected = false;
  const applied = applyDefaultVotes(g, seq([0.0, 0.99]));
  assert.equal(applied, 2);
  assert.ok(g.players[1].hasVoted && g.players[1].vote && g.players[1].vote !== 'p1');
  assert.ok(g.players[2].hasVoted && g.players[2].vote && g.players[2].vote !== 'p2');
  assert.equal(g.players[3].vote, null);
  assert.equal(g.players[0].vote, 'p1'); // real votes untouched
});

t('default inspect: an idle lone waker gets a random peek as the hour ends', () => {
  const g = manualGame(4);
  g.players[0].role = 'thief'; g.players[0].dice = 5;
  g.players[1].role = 'sleepyhead'; g.players[1].dice = 2; // lone waker at 2
  g.players[2].role = 'sleepyhead'; g.players[2].dice = 1;
  g.players[3].role = 'sleepyhead'; g.players[3].dice = 4;
  g.phase = 'night'; g.currentHour = 2;
  assert.equal(autoInspectIdle(g, seq([0.0])), true);
  assert.equal(g.players[1].hasActedThisHour, true);
  assert.ok(g.players[1].inspectedDice && g.players[1].inspectedDice.targetId !== 'p1');
  assert.equal(autoInspectIdle(g, seq([0.0])), false); // already acted
  // two wakers -> nobody can inspect -> no default
  const g2 = manualGame(4);
  g2.players[0].role = 'thief'; g2.players[0].dice = 5;
  g2.players[1].role = 'sleepyhead'; g2.players[1].dice = 2;
  g2.players[2].role = 'sleepyhead'; g2.players[2].dice = 2;
  g2.players[3].role = 'sleepyhead'; g2.players[3].dice = 4;
  g2.phase = 'night'; g2.currentHour = 2;
  assert.equal(autoInspectIdle(g2, seq([0.0])), false);
});

console.log(`\n${passed} default-action tests passed`);
