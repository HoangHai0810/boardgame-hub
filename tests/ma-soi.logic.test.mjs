// Ma Sói engine unit tests. Run: esbuild games/ma-soi/logic.ts, then node this file.
import { strict as assert } from 'node:assert';
import {
  createGame, assignRoles, roleTable, effectiveRoleConfig, publicState, privateState,
  wolfPick, resolveWolfTarget, seerPeek, guardianProtect, witchSave, witchKill,
  hunterShoot, resolveNight, castVote, resolveVotes, applyDefaultVotes, checkWin,
  wolfChatMsg, wolfConfirm, addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../games/ma-soi/logic.mjs';

let n = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const mk = (roles) => {
  const s = createGame('ABCDE');
  roles.forEach((r, i) => s.players.push({
    id: 'p' + i, name: 'P' + i, isHost: i === 0, connected: true, role: r, alive: true,
    hasVoted: false, vote: null, wins: 0, seerPeeks: [], witchSaveLeft: true, witchKillLeft: true, witchActedNight: 0,
  }));
  return s;
};
const night = (s, step) => { s.phase = 'night'; s.nightStep = step; s.night++; };

t('limits 6-12', () => { assert.equal(MIN_PLAYERS, 6); assert.equal(MAX_PLAYERS, 12); });
t('role tables', () => {
  assert.deepEqual(roleTable(6).map(x => x.count), [2, 1, 1, 2]);
  assert.deepEqual(roleTable(8).map(x => x.count), [2, 1, 1, 1, 3]);
  assert.deepEqual(roleTable(10).map(x => x.count), [3, 1, 1, 1, 1, 3]);
  assert.deepEqual(roleTable(12).map(x => x.count), [3, 1, 1, 1, 1, 5]);
  for (let n = 6; n <= 12; n++) assert.equal(roleTable(n).reduce((a, x) => a + x.count, 0), n);
});
t('assignRoles deals the table', () => {
  const s = createGame('X'); for (let i = 0; i < 8; i++) s.players.push({ id: 'p' + i, name: 'P' + i, isHost: false, connected: true, alive: true, hasVoted: false, vote: null, wins: 0, seerPeeks: [], witchSaveLeft: true, witchKillLeft: true, witchActedNight: 0 });
  assignRoles(s, () => 0.5);
  const counts = {};
  s.players.forEach(p => { counts[p.role] = (counts[p.role] || 0) + 1; });
  assert.deepEqual(counts, { wolf: 2, seer: 1, guardian: 1, witch: 1, villager: 3 });
});
t('wolves cannot eat their own', () => {
  const s = mk(['wolf', 'wolf', 'villager']); night(s, 'wolves');
  assert.equal(wolfPick(s, s.players[0], 'p1'), false);
  assert.equal(wolfPick(s, s.players[0], 'p2'), true);
});
t('wolf majority wins; tie falls to earliest pick', () => {
  const s = mk(['wolf', 'wolf', 'villager', 'villager']); night(s, 'wolves');
  wolfPick(s, s.players[0], 'p2'); s.players[0].wolfPickTs = 100;
  wolfPick(s, s.players[1], 'p3'); s.players[1].wolfPickTs = 200;
  assert.equal(resolveWolfTarget(s), 'p2'); // tie 1-1 -> earliest
  wolfPick(s, s.players[1], 'p2');
  assert.equal(resolveWolfTarget(s), 'p2'); // 2-0
});
t('no wolf picks -> no victim', () => {
  const s = mk(['wolf', 'villager']); night(s, 'wolves');
  assert.equal(resolveWolfTarget(s), null);
});
t('seer learns wolf or not, once per target', () => {
  const s = mk(['seer', 'wolf', 'villager']); night(s, 'seer');
  assert.equal(seerPeek(s, s.players[0], 'p1'), true);
  assert.equal(s.players[0].seerPeeks[0].isWolf, true);
  assert.equal(seerPeek(s, s.players[0], 'p2'), true);
  assert.equal(s.players[0].seerPeeks[1].isWolf, false);
  assert.equal(seerPeek(s, s.players[0], 'p1'), false); // already peeked
  assert.equal(seerPeek(s, s.players[0], 'p0'), false); // no self-peek
});
t('guardian cannot protect the same player twice running', () => {
  const s = mk(['guardian', 'villager']); night(s, 'guardian');
  assert.equal(guardianProtect(s, s.players[0], 'p1'), true);
  s.night++; // next night
  assert.equal(guardianProtect(s, s.players[0], 'p1'), false);
  assert.equal(guardianProtect(s, s.players[0], 'p0'), true);
});
t('witch: one potion per night, save needs a victim', () => {
  const s = mk(['witch', 'villager']); night(s, 'witch');
  assert.equal(witchSave(s, s.players[0]), false); // no victim tonight
  s.wolfTarget = 'p1';
  assert.equal(witchSave(s, s.players[0]), true);
  assert.equal(s.players[0].witchSaveLeft, false);
  assert.equal(witchKill(s, s.players[0], 'p1'), false); // already acted tonight
  s.night++;
  assert.equal(witchKill(s, s.players[0], 'p1'), true);
  assert.equal(s.players[0].witchKillLeft, false);
});
t('night resolution: guardian save, witch save, witch kill', () => {
  const s = mk(['wolf', 'guardian', 'witch', 'villager', 'villager']);
  night(s, 'witch'); s.wolfTarget = 'p3'; s.guardianTarget = 'p3';
  assert.deepEqual(resolveNight(s).map(d => d.id), []); // guardian saved
  const s2 = mk(['wolf', 'guardian', 'witch', 'villager', 'villager']);
  night(s2, 'witch'); s2.wolfTarget = 'p3'; s2.witchSaved = true;
  assert.deepEqual(resolveNight(s2).map(d => d.id), []); // witch saved
  const s3 = mk(['wolf', 'guardian', 'witch', 'villager', 'villager']);
  night(s3, 'witch'); s3.wolfTarget = 'p3'; s3.witchKillTarget = 'p4';
  assert.deepEqual(resolveNight(s3).map(d => [d.id, d.cause]), [['p3', 'wolves'], ['p4', 'witch']]);
});
t('hunter shoots on death, then is spent', () => {
  const s = mk(['hunter', 'villager', 'villager']); night(s, 'hunter');
  s.players[0].alive = false; s.pendingHunterShot = 'p0';
  assert.equal(hunterShoot(s, s.players[0], 'p1'), true);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.pendingHunterShot, null);
  assert.equal(hunterShoot(s, s.players[0], 'p2'), false); // no longer pending
});
t('vote: no self-vote, tie eliminates nobody', () => {
  const s = mk(['wolf', 'villager', 'villager', 'villager']); s.phase = 'voting';
  assert.equal(castVote(s, s.players[1], 'p1'), false);
  castVote(s, s.players[0], 'p1'); castVote(s, s.players[1], 'p0');
  castVote(s, s.players[2], 'p1'); castVote(s, s.players[3], 'p0');
  assert.equal(resolveVotes(s), null);
  assert.equal(s.voteTie, true);
  assert.equal(s.lastVoteOut, null);
});
t('vote: majority eliminates, hunter shot pending', () => {
  const s = mk(['wolf', 'villager', 'hunter', 'villager']); s.phase = 'voting';
  castVote(s, s.players[0], 'p2'); castVote(s, s.players[1], 'p2'); castVote(s, s.players[3], 'p2');
  const out = resolveVotes(s);
  assert.equal(out.id, 'p2');
  assert.equal(s.pendingHunterShot, 'p2');
});
t('win checks', () => {
  const s = mk(['wolf', 'villager', 'villager']);
  assert.equal(checkWin(s), null);
  s.players[2].alive = false;
  assert.equal(checkWin(s), 'wolves'); // 1 wolf vs 1 villager = parity
  s.players[0].alive = false;
  assert.equal(checkWin(s), 'villagers');
});
t('defaults vote randomly but never for self', () => {
  const s = mk(['wolf', 'villager', 'villager', 'villager']); s.phase = 'voting';
  applyDefaultVotes(s, () => 0);
  for (const p of s.players) { assert.equal(p.hasVoted, true); assert.notEqual(p.vote, p.id); }
});
t('publicState hides roles of the living; privateState keeps my secrets', () => {
  const s = mk(['wolf', 'villager', 'seer']);
  const pub = publicState(s);
  assert.equal(pub.players[0].role, undefined);
  assert.equal(pub.players[1].role, undefined);
  const priv = privateState(s, s.players[0]);
  assert.equal(priv.myRole, 'wolf');
  assert.equal(priv.wolfTeam.length, 1);
  const priv2 = privateState(s, s.players[1]);
  assert.equal(priv2.wolfTeam.length, 0);
  assert.equal(priv2.myRole, 'villager');
});
t('wolf chat: wolves only, night only, private to wolves', () => {
  const s = mk(['wolf', 'wolf', 'villager']); night(s, 'wolves');
  assert.equal(wolfChatMsg(s, s.players[0], 'Ăn Lan đi'), true);
  assert.equal(s.wolfChat.length, 1);
  assert.equal(privateState(s, s.players[0]).wolfChat.length, 1);
  assert.equal(privateState(s, s.players[1]).wolfChat.length, 1); // fellow wolf sees it
  assert.equal(privateState(s, s.players[2]).wolfChat.length, 0); // villager never sees it
  assert.equal(wolfChatMsg(s, s.players[2], 'tôi là sói'), false); // villager cannot send
  assert.equal(wolfChatMsg(s, s.players[0], '   '), false); // empty message
  s.phase = 'day';
  assert.equal(wolfChatMsg(s, s.players[0], 'ban ngày'), false); // night only
});
t('wolf confirm locks the pick', () => {
  const s = mk(['wolf', 'wolf', 'villager', 'villager']); night(s, 'wolves');
  assert.equal(wolfConfirm(s, s.players[0]), false); // nothing picked yet
  wolfPick(s, s.players[0], 'p2');
  assert.equal(wolfConfirm(s, s.players[0]), true);
  assert.equal(privateState(s, s.players[0]).wolfConfirmed, true);
  assert.equal(wolfPick(s, s.players[0], 'p3'), false); // locked: cannot change pick
  assert.equal(s.players[0].wolfPick, 'p2');
  assert.equal(resolveWolfTarget(s), 'p2');
  assert.equal(wolfConfirm(s, s.players[1]), false); // second wolf has no pick
});
t('dead players reveal their role in publicState', () => {
  const s = mk(['wolf', 'villager']);
  s.players[0].alive = false;
  assert.equal(publicState(s).players[0].role, 'wolf');
});


t('role config: defaults unchanged', () => {
  assert.deepEqual(effectiveRoleConfig(6, {}), { wolves: 2, witch: false, hunter: false });
  assert.deepEqual(effectiveRoleConfig(10, {}), { wolves: 3, witch: true, hunter: true });
});
t('role config: host overrides apply', () => {
  assert.deepEqual(roleTable(6, { wolves: 3 }).map(x => x.count), [3, 1, 1, 1]);
  assert.deepEqual(roleTable(6, { witch: true }).map(x => x.count), [2, 1, 1, 1, 1]);
  assert.deepEqual(roleTable(6, { hunter: true }).map(x => x.count), [2, 1, 1, 1, 1]);
});
t('role config: clamps to keep >= 1 villager', () => {
  // 6 players, everything on: 3 wolves + seer + guardian + witch + hunter
  // = 7 specials > 5 slots -> hunter dropped, then witch.
  assert.deepEqual(effectiveRoleConfig(6, { wolves: 3, witch: true, hunter: true }), { wolves: 3, witch: false, hunter: false });
  for (let n = 6; n <= 12; n++) assert.equal(roleTable(n, { wolves: 3, witch: true, hunter: true }).reduce((a, x) => a + x.count, 0), n);
});
t('assignRoles respects the host config', () => {
  const s = createGame('X');
  for (let i = 0; i < 6; i++) s.players.push({ id: 'p' + i, name: 'P' + i, isHost: false, connected: true, alive: true, hasVoted: false, vote: null, wins: 0, seerPeeks: [], witchSaveLeft: true, witchKillLeft: true, witchActedNight: 0 });
  s.roleOverrides = { witch: true };
  assignRoles(s, () => 0.5);
  const counts = {};
  s.players.forEach(p => { counts[p.role] = (counts[p.role] || 0) + 1; });
  assert.deepEqual(counts, { wolf: 2, seer: 1, guardian: 1, witch: 1, villager: 1 });
});
t('bots: add/remove', () => {
  const s = createGame('X');
  const b = addBot(s, () => 0.5);
  assert.ok(b && b.isBot && b.connected && b.name.startsWith('Bot '));
  assert.equal(s.players.length, 1);
  assert.equal(removeBot(s, b.id), true);
  assert.equal(s.players.length, 0);
  assert.equal(removeBot(s, 'nope'), false);
  s.players.push({ id: 'h', name: 'H', isHost: true, connected: true, alive: true, hasVoted: false, vote: null, wins: 0, seerPeeks: [], witchSaveLeft: true, witchKillLeft: true, witchActedNight: 0 });
  assert.equal(removeBot(s, 'h'), false); // humans cannot be removed as bots
});
t('bots: publicState marks them', () => {
  const s = createGame('X'); addBot(s, () => 0.5);
  assert.equal(publicState(s).players[0].isBot, true);
});

console.log(`== ${n} ma-soi logic tests, exit ${process.exitCode ? 'FAIL' : 'PASS'}`);
