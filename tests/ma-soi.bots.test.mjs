// Ma Sói bot brains. Run: esbuild games/ma-soi/bots.ts --bundle, then node this file.
import { strict as assert } from 'node:assert';
import { botWolfPick, botSeerPeek, botGuardPick, botWitch, botHunterShot, botVote } from '../games/ma-soi/bots.mjs';
import { createGame } from '../games/ma-soi/logic.mjs';

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

t('wolf bot copies the pack pick', () => {
  const s = mk(['wolf', 'wolf', 'villager', 'villager']);
  s.players[0].wolfPick = 'p2';
  assert.equal(botWolfPick(s, s.players[1]), 'p2');
});
t('wolf bot picks a non-wolf at random', () => {
  const s = mk(['wolf', 'wolf', 'villager', 'villager']);
  const pick = botWolfPick(s, s.players[0], () => 0.99);
  assert.ok(['p2', 'p3'].includes(pick));
});
t('seer bot never peeks itself or twice', () => {
  const s = mk(['seer', 'wolf', 'villager']);
  s.players[0].seerPeeks = [{ targetId: 'p1', isWolf: true }];
  assert.equal(botSeerPeek(s, s.players[0], () => 0), 'p2');
});
t('guardian bot avoids last night target', () => {
  const s = mk(['guardian', 'villager', 'villager']);
  s.players[0].guardianLastTarget = 'p1';
  const pick = botGuardPick(s, s.players[0], () => 0.99);
  assert.notEqual(pick, 'p1');
});
t('witch bot saves the victim most of the time', () => {
  const s = mk(['witch', 'villager']); s.night = 1; s.wolfTarget = 'p1';
  assert.deepEqual(botWitch(s, s.players[0], () => 0.1), { action: 'save' });
  assert.deepEqual(botWitch(s, s.players[0], () => 0.9), { action: 'pass' });
});
t('witch bot only poisons late in the game', () => {
  const s = mk(['witch', 'villager', 'villager', 'villager']); s.night = 3; s.wolfTarget = null;
  assert.equal(botWitch(s, s.players[0], () => 0.1).action, 'kill');
  assert.equal(botWitch(s, s.players[0], () => 0.9).action, 'pass');
});
t('hunter bot shoots someone else', () => {
  const s = mk(['hunter', 'wolf', 'villager']);
  assert.notEqual(botHunterShot(s, s.players[0], () => 0), 'p0');
});
t('seer bot votes a wolf it found', () => {
  const s = mk(['seer', 'wolf', 'villager']);
  s.players[0].seerPeeks = [{ targetId: 'p1', isWolf: true }];
  assert.equal(botVote(s, s.players[0]), 'p1');
});
t('wolf bot copies the pack vote', () => {
  const s = mk(['wolf', 'wolf', 'villager', 'villager']);
  s.players[0].vote = 'p3';
  assert.equal(botVote(s, s.players[1]), 'p3');
});
t('wolf bot never copies a pack vote that targets itself', () => {
  // A packmate may vote for a fellow wolf (bussing / a mistake) — but a
  // self-vote is rejected by castVote, so copying it would leave the bot
  // voteless for the whole ballot. It must fall back to a villager.
  const s = mk(['wolf', 'wolf', 'villager', 'villager']);
  s.players[0].vote = 'p1';
  assert.equal(botVote(s, s.players[1], () => 0), 'p2');
  assert.notEqual(botVote(s, s.players[1]), 'p1');
});
t('villager bot votes someone else at random', () => {
  const s = mk(['villager', 'wolf', 'villager']);
  assert.notEqual(botVote(s, s.players[0], () => 0), 'p0');
});
