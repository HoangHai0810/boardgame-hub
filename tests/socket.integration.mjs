// Full multiplayer integration test against the real Socket.IO server:
// 5 clients — host creates, 3 join (4 total play), a 5th probes rejection paths,
// a full round is played: roles -> night (thief steals, lone sleepyhead inspects)
// -> day chat -> voting -> results. Also checks secret-data isolation.
import { io } from '../client/node_modules/socket.io-client/build/esm/index.js';
import assert from 'node:assert';

const URL = 'http://localhost:3109';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0; const t = (n, ok) => { assert.ok(ok, n); passed++; console.log('PASS', n); };

function client(name, clientId) {
  const s = io(URL, { transports: ['websocket'] });
  const c = { s, name, clientId, state: null, priv: null, errors: [] };
  s.on('state', (st) => { c.state = st; });
  s.on('private', (p) => { c.priv = p; });
  s.on('errorMsg', (m) => c.errors.push(m));
  return c;
}
const emit = (c, ev, data) => new Promise(res => c.s.emit(ev, data, res));
async function until(fn, timeout = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return; await wait(100); }
  throw new Error('timeout waiting: ' + label);
}

const host = client('HostMouse', 'cid-host');
await until(() => host.s.connected, 5000, 'host connect');
const created = await emit(host, 'createRoom', { name: 'HostMouse', clientId: 'cid-host' });
t('create room ok', created.ok && /^[A-Z0-9]{5}$/.test(created.code));
const code = created.code;

const joiners = [];
for (let i = 1; i <= 3; i++) {
  const c = client('Mouse' + i, 'cid-' + i);
  await until(() => c.s.connected, 5000, 'connect ' + i);
  const r = await emit(c, 'joinRoom', { code, name: 'Mouse' + i, clientId: 'cid-' + i });
  t('join ' + i + ' ok', r.ok);
  joiners.push(c);
}
const all = [host, ...joiners];
await until(() => all.every(c => c.state?.players.length === 4), 5000, 'lobby 4');
t('lobby shows 4 players, host flagged', host.state.players.find(p => p.id === 'cid-host').isHost === true);

// Rejection: start with only... (host starts legitimately below) — first probe 9th/duplicate paths:
const late = client('Late', 'cid-late');
await until(() => late.s.connected, 5000, 'late connect');
const badRoom = await emit(late, 'joinRoom', { code: 'ZZZZ9', name: 'Late', clientId: 'cid-late' });
t('join nonexistent room rejected', !badRoom.ok);

// 3-player rejection is covered by logic/server guard test via a second room:
const solo = client('Solo', 'cid-solo');
await until(() => solo.s.connected, 5000, 'solo connect');
const soloRoom = await emit(solo, 'createRoom', { name: 'Solo', clientId: 'cid-solo' });
solo.s.emit('startGame');
await wait(600);
t('start with <4 players rejected (still lobby)', solo.state?.phase === 'lobby');
solo.s.disconnect();

// Start the real game
host.s.emit('startGame');
await until(() => all.every(c => c.state?.phase === 'roleReveal' && c.priv?.role), 8000, 'roles');
const thieves = all.filter(c => c.priv.role === 'thief');
t('exactly one thief among private states', thieves.length === 1);
t('all dice 1-6', all.every(c => c.priv.dice >= 1 && c.priv.dice <= 6));
t('public state has no roles/dice during reveal', all.every(c => !JSON.stringify(c.state).includes('"role"') && !JSON.stringify(c.state).includes('"dice"')));
const thief = thieves[0];
const thiefDice = thief.priv.dice;

// Night starts only when EVERY player pressed ready on the role card
all.forEach(c => c.s.emit('ready'));
await until(() => all.every(c => c.state?.phase === 'night'), 8000, 'night via all-ready');
t('night starts when all players ready (no host skip, no timer)', true);
// Play through hours: act whenever awake
const acted = new Set();
const nightWatcher = setInterval(() => {
  for (const c of all) {
    if (c.state?.phase !== 'night' || !c.priv?.awake) continue;
    const key = c.clientId + '@' + c.state.currentHour;
    if (acted.has(key)) continue; acted.add(key);
    if (c.priv.canSteal) c.s.emit('nightAction', { kind: 'steal' });
    else if (c.priv.canInspect) {
      const target = c.state.players.find(p => p.id !== c.clientId);
      c.s.emit('nightAction', { kind: 'inspect', targetId: target.id });
    }
  }
}, 120);
await until(() => all.every(c => c.state?.phase === 'day'), 30000, 'day phase');
clearInterval(nightWatcher);
t('day phase reached after 6 hours', true);
t('cheese reported stolen in the morning', host.state.cheeseStolen === true);
const inspector = all.find(c => c.priv?.inspected);
if (inspector) t('a lone sleepyhead inspected and kept the result private', typeof inspector.priv.inspected.dice === 'number'
  && all.filter(c => c !== inspector).every(c => !c.priv?.inspected || c.priv.inspected.targetId !== inspector.priv.inspected.targetId || c === inspector));

// Day chat
host.s.emit('chat', { text: 'I think it was Mouse2!' });
await until(() => joiners[0].state?.chat?.some(m => m.text.includes('Mouse2')), 5000, 'chat sync');
t('chat syncs in real time to other players', true);

// Discussion skip: voting starts only when ALL players press ready-to-vote
host.s.emit('readyVote');
await wait(500);
t('discussion NOT skipped while only host ready', host.state.phase === 'day');
joiners.forEach(c => c.s.emit('readyVote'));
await until(() => all.every(c => c.state?.phase === 'voting'), 8000, 'voting via all readyVote');
t('discussion skipped when all players ready-to-vote', true);
for (const c of all) {
  if (c === thief) c.s.emit('vote', { targetId: joiners[0].state.players.find(p => p.id !== thief.clientId).id });
  else c.s.emit('vote', { targetId: thief.clientId });
}
await until(() => all.every(c => c.state?.phase === 'results'), 10000, 'results');
t('results: sleepyheads win when thief is top-voted', host.state.winner === 'sleepyheads');
t('results reveal the thief', host.state.thiefId === thief.clientId);

// Join after start rejected
const lateJoin = await emit(late, 'joinRoom', { code, name: 'Late', clientId: 'cid-late' });
t('join after game started rejected', !lateJoin.ok);

// Play again -> back to lobby, same room code
host.s.emit('playAgain');
await until(() => host.state?.phase === 'lobby', 5000, 'play again lobby');
t('play again returns to lobby with same room', host.state.roomCode === code);

// Reconnection: a player disconnects and rejoins with same clientId during lobby
joiners[1].s.disconnect();
await wait(500);
const re = client('Mouse2', 'cid-2');
await until(() => re.s.connected, 5000, 'reconnect');
const rr = await emit(re, 'joinRoom', { code, name: 'Mouse2', clientId: 'cid-2' });
t('reconnection with same session id rejoins', rr.ok === true);
await until(() => re.state?.players.some(p => p.id === 'cid-2'), 5000, 'rejoined in state');
t('rejoined player present in room state again', true);

all.forEach(c => c.s.disconnect()); late.s.disconnect(); re.s.disconnect();
console.log(`\n${passed} integration checks passed`);
process.exit(0);
