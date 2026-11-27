// Bot brains for Ai là Gián Điệp? (Spyfall) — pure decisions, no timers
// or transport. The host engine (client/src/games/gian-diep/
// hostEngine.ts) calls these when a bot is the actor, then runs the
// result through the same validated logic functions a human's tap goes
// through, so a bot can never do anything a player couldn't.
//
// LIMITATION (by design): these bots do NOT really deduce. They ask
// generic questions that fit every location, give vague answers, accuse
// rarely and at random, and vote mostly NO. A bot spy only knows what
// the rules let it know: nothing about the location — until it reveals
// and guesses, which is a blind 1-in-12 pick. A bot local only knows
// its own role. No bot ever reads another player's role, location, or
// hidden state.

import { GameState, Player, LOCATIONS, connectedPlayers } from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

/** Generic questions a bot asks — deliberately usable at any of the 12
 *  locations, so the bot never leaks (or needs) the real one. */
export const BOT_QUESTIONS = [
  'Chỗ này thường đông người không?',
  'Ở đây người ta làm việc gì là chính?',
  'Chỗ này ồn ào hay yên tĩnh?',
  'Bạn hay tới chỗ này vào lúc nào trong ngày?',
  'Ở đây có cần mặc đồ đặc biệt gì không?',
  'Chỗ này có mùi gì đặc trưng không?',
  'Người ở đây thường mang theo thứ gì?',
  'Chỗ này mở cửa cả ngày hay chỉ một lúc thôi?',
];

/** Vague answers: true of almost any location, so a bot local sounds
 *  plausible without giving the location away — and a bot spy sounds
 *  exactly the same. */
export const BOT_ANSWERS = [
  'Cũng bình thường thôi, tuỳ lúc.',
  'Chắc là ai cũng từng tới một lần rồi.',
  'Tôi thấy cũng giống mọi chỗ khác thôi.',
  'Khó nói lắm, để tôi nghĩ đã…',
  'Cũng đông, nhưng không chen chúc lắm.',
  'Tôi hay đi buổi sáng, lúc đó dễ chịu nhất.',
  'Có nhiều người ra vào lắm.',
  'Tuỳ hôm, hôm thì ồn, hôm thì vắng.',
];

export function botPickQuestion(rng: () => number = Math.random): string {
  return pick(BOT_QUESTIONS, rng) ?? BOT_QUESTIONS[0];
}

export function botPickAnswer(rng: () => number = Math.random): string {
  return pick(BOT_ANSWERS, rng) ?? BOT_ANSWERS[0];
}

/** A bot asks a random other connected player (never itself). Returns
 *  the target id, or null when there is nobody to ask. */
export function botAskTarget(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const others = connectedPlayers(s).filter(p => p.id !== bot.id);
  return pick(others, rng)?.id ?? null;
}

/** Chance a bot accuses on its own ask turn instead of asking. Rare on
 *  purpose (~8%): a bot has no real suspicion, so a random accusation
 *  is usually a wrong one — and a wrong conviction hands the spy +4. */
export const BOT_ACCUSE_CHANCE = 0.08;

/** Who this bot accuses on its ask turn, or null when it just asks a
 *  question instead. Never itself, never someone it already cannot
 *  accuse (one accusation per player per round). */
export function botShouldAccuse(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  if (s.phase !== 'questioning' || s.finalPhase || s.accusation || s.finalVote) return null;
  if (!bot.connected || s.accusedOnce.includes(bot.id)) return null;
  if (rng() >= BOT_ACCUSE_CHANCE) return null;
  const others = connectedPlayers(s).filter(p => p.id !== bot.id);
  return pick(others, rng)?.id ?? null;
}

/** A bot's secret YES/NO ballot on an open accusation. A bot has no
 *  evidence, so it usually votes NO (~75%): a unanimous YES is what
 *  convicts, and a bot should not be the one to rubber-stamp a random
 *  accusation. In the timer-end final vote the bot just picks at
 *  random — the round is ending either way. */
export function botVoteYes(s: GameState, bot: Player, rng: () => number = Math.random, isFinal = false): boolean {
  void s; void bot;
  return isFinal ? rng() < 0.5 : rng() < 0.25;
}

/** What a bot spy does when it reveals and guesses: a blind pick —
 *  1 in 12 — because the spy genuinely does not know the location. */
export function botSpyGuessLocation(rng: () => number = Math.random): number {
  return Math.floor(rng() * LOCATIONS.length);
}

/** A bot's move when its turn comes in the timer-end rotation: pass
 *  half the time, accuse a random other player the other half. */
export function botFinalPick(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  if (s.phase !== 'questioning' || !s.finalPhase || s.finalVote) return null;
  if (s.finalOrder[s.finalIdx] !== bot.id || !bot.connected) return null;
  if (rng() < 0.5) return null; // pass
  const others = connectedPlayers(s).filter(p => p.id !== bot.id);
  return pick(others, rng)?.id ?? null;
}
