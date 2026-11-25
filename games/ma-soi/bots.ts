// Bot brains for Ma Sói — pure decisions, no timers or transport. The
// host engine (client/src/games/ma-soi/hostEngine.ts) calls these when a
// bot is the actor, then runs the result through the same validated
// logic functions a human's tap goes through, so a bot can never do
// anything a player couldn't.
//
// The bots are deliberately "a bit smart", not omniscient: they only use
// information their role actually has (a wolf knows its pack, a seer
// remembers its peeks, a witch sees tonight's victim, a hunter knows
// nothing). Everything else is a reasoned guess.

import { GameState, Player, alive, wolvesAlive } from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

/** A bot wolf hunts with its pack: copy a fellow wolf's pick when one
 *  exists (majority rules), otherwise a random living non-wolf. */
export function botWolfPick(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const pack = wolvesAlive(s).filter(p => p.id !== bot.id && p.wolfPick);
  if (pack.length) return pack[0].wolfPick!;
  const prey = alive(s).filter(p => p.role !== 'wolf');
  return pick(prey, rng)?.id ?? null;
}

/** A bot seer inspects a random living player it has never peeked
 *  (never itself). */
export function botSeerPeek(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const seen = new Set(bot.seerPeeks.map(x => x.targetId));
  const opts = alive(s).filter(p => p.id !== bot.id && !seen.has(p.id));
  return pick(opts, rng)?.id ?? null;
}

/** A bot guardian protects a random living player — anyone, including
 *  itself — except the one it protected last night. */
export function botGuardPick(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const opts = alive(s).filter(p => p.id !== bot.guardianLastTarget);
  return pick(opts, rng)?.id ?? null;
}

export type WitchDecision = { action: 'save' } | { action: 'kill'; targetId: string } | { action: 'pass' };

/** A bot witch: saves tonight's victim most of the time (a rescue is
 *  almost always worth it), and only reaches for the poison late in the
 *  game when the table is small — never a blind kill on night one. */
export function botWitch(s: GameState, bot: Player, rng: () => number = Math.random): WitchDecision {
  if (s.wolfTarget && bot.witchSaveLeft && rng() < 0.65) return { action: 'save' };
  if (bot.witchKillLeft && s.night >= 3 && alive(s).length <= 5 && rng() < 0.25) {
    const victim = pick(alive(s).filter(p => p.id !== bot.id), rng);
    if (victim) return { action: 'kill', targetId: victim.id };
  }
  return { action: 'pass' };
}

/** A bot hunter fires its last shot blind: a random living player
 *  (never itself). It has no information, so random is the honest play. */
export function botHunterShot(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  return pick(alive(s).filter(p => p.id !== bot.id), rng)?.id ?? null;
}

/** A bot's ballot. A seer votes for a wolf it already found (its best
 *  information). A wolf copies a fellow wolf's vote — the pack votes as
 *  one — or picks a villager target. Everyone else votes at random
 *  (never for itself). */
export function botVote(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  if (bot.role === 'seer') {
    const known = bot.seerPeeks.filter(x => {
      const t = s.players.find(p => p.id === x.targetId);
      return x.isWolf && t?.alive;
    });
    if (known.length) return known[0].targetId;
  }
  if (bot.role === 'wolf') {
    // Copy a packmate's vote — but never one that targets this bot
    // itself: a self-vote is rejected by castVote, so copying it would
    // leave the bot voteless for the whole ballot (live report
    // 2026-11-25: a wolf that never votes). A packmate may vote for a
    // fellow wolf (bussing, or a mistake), so the exclusion lives here,
    // not in the voter.
    const packVote = wolvesAlive(s).find(p => p.id !== bot.id && p.vote && p.vote !== bot.id);
    if (packVote?.vote) return packVote.vote;
    const prey = alive(s).filter(p => p.role !== 'wolf');
    return pick(prey, rng)?.id ?? null;
  }
  return pick(alive(s).filter(p => p.id !== bot.id), rng)?.id ?? null;
}
