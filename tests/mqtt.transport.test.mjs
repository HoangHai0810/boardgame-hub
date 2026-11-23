// End-to-end test of the SHIPPED public transport (net-mqtt + HostEngine +
// ECDH crypto), compiled from the real client sources, against a real MQTT
// broker (aedes, local — the sandbox egress proxy blocks public brokers, so
// the public-broker leg cannot be exercised from inside this environment;
// the protocol, topics and encryption exercised here are identical).
// 4 simulated players play a FULL round: create/join, roles (encrypted
// private channel), all-ready night start, steal, lone-waker inspect,
// day ready-to-vote skip, voting, results.
import assert from 'node:assert';

// --- browser shims (must exist before importing the compiled modules) ---
const store = {};
globalThis.sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.location = { search: '?broker=ws://127.0.0.1:9001' };

const { createServer } = await import('node:http');
const { Aedes } = await import('aedes');
const wsStream = (await import('websocket-stream')).default;
const aedes = await Aedes.createBroker();
const server = createServer();
wsStream.createServer({ server }, aedes.handle);
await new Promise(r => server.listen(9001, r));
console.log('local MQTT broker on ws://127.0.0.1:9001');

const { createMqttNet } = await import('../client/.testbuild/client/src/net-mqtt.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 20000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return; await wait(120); }
  throw new Error('timeout: ' + label);
}
let passed = 0; const t = (n, ok) => { assert.ok(ok, n); passed++; console.log('PASS', n); };

function makePlayer(name, clientId) {
  store['ct_client_id'] = clientId; // getClientId() reads this at construction
  const P = { name, clientId, state: null, priv: null, errors: [], joined: null, net: null };
  P.net = createMqttNet({
    onState: s => { P.state = s; },
    onPrivate: p => { P.priv = p; },
    onJoined: (code, pid, isHost) => { P.joined = { code, pid, isHost }; },
    onError: m => { P.errors.push(m); },
    onStatus: () => {},
  });
  return P;
}

const host = makePlayer('HostA', 'mqtt-host-1');
host.net.createRoom('HostA');
await until(() => host.joined && host.state?.players.length === 1, 15000, 'host room');
const code = host.joined.code;
t('host created room via MQTT transport: ' + code, /^[A-Z0-9]{5}$/.test(code));

const others = [];
for (let i = 2; i <= 4; i++) {
  const P = makePlayer('P' + i, 'mqtt-c-' + i);
  P.net.joinRoom(code, 'P' + i);
  others.push(P);
}
await until(() => host.state?.players.length === 4 && others.every(p => p.joined), 20000, 'all joined');
t('3 players joined over MQTT; host sees 4/8', true);
t('joiners received public lobby state', others.every(p => p.state?.players.length === 4));

host.net.startGame();
await until(() => [host, ...others].every(p => p.state?.phase === 'roleReveal' && p.priv?.role), 20000, 'roles delivered');
const all = [host, ...others];
const thieves = all.filter(p => p.priv.role === 'thief');
t('exactly one thief (private channels decrypted per player)', thieves.length === 1);
t('dice 1-6 for all', all.every(p => p.priv.dice >= 1 && p.priv.dice <= 6));
t('no secrets in public MQTT state', all.every(p => !JSON.stringify(p.state).includes('"role"') && !JSON.stringify(p.state).includes('"dice"')));
const thief = thieves[0];

// Night starts only when ALL press ready
all.forEach(p => p.net.ready());
await until(() => all.every(p => p.state?.phase === 'night'), 15000, 'night via all-ready');
t('night started via all-ready over MQTT', true);
t('persistent private info present at night (role+dice in priv)', all.every(p => p.priv.role && p.priv.dice));

const acted = new Set();
const watcher = setInterval(() => {
  for (const p of all) {
    if (p.state?.phase !== 'night' || !p.priv?.awake) continue;
    const key = p.clientId + '@' + p.state.currentHour;
    if (acted.has(key)) continue; acted.add(key);
    if (p.priv.canSteal) p.net.nightAction('steal');
    else if (p.priv.canInspect) {
      const target = p.state.players.find(x => x.id !== p.clientId);
      p.net.nightAction('inspect', target.id);
    }
  }
}, 150);
await until(() => all.every(p => p.state?.phase === 'day'), 120000, 'day phase');
clearInterval(watcher);
t('day reached after 6 hours', true);
t('cheese stolen during the night', host.state.cheeseStolen === true);

// Discussion skip: only when ALL ready-to-vote
host.net.readyVote();
await wait(700);
t('discussion not skipped with 1/4 ready', host.state.phase === 'day');
others.forEach(p => p.net.readyVote());
await until(() => all.every(p => p.state?.phase === 'voting'), 15000, 'voting via all readyVote');
t('discussion skipped when all ready-to-vote', true);

for (const p of all) {
  if (p === thief) p.net.vote(p.state.players.find(x => x.id !== thief.clientId).id);
  else p.net.vote(thief.clientId);
}
await until(() => all.every(p => p.state?.phase === 'results'), 20000, 'results');
t('results: sleepyheads win, thief revealed', host.state.winner === 'sleepyheads' && host.state.thiefId === thief.clientId);
t('no transport errors during the whole round', all.every(p => p.errors.length === 0));

all.forEach(p => p.net.leave());
server.close();
console.log(`\n${passed} MQTT transport checks passed`);
process.exit(0);
