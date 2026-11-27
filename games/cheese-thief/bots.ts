// Bot brains for Chuột Phô Mai (Cheese Thief) — pure decisions, no timers
// or transport. The host engine (client/src/games/cheese-thief/hostEngine.ts)
// calls these when a bot is the actor, then runs the result through the same
// validated logic functions a human's tap goes through, so a bot can never
// do anything a player couldn't.
//
// The bots are deliberately "a bit smart", not omniscient: they only use
// information their role actually has. A lone waker remembers the dice it
// peeked at; a witness remembers the thief it SAW steal; a follower knows
// what the official information rules let it know (see followerKnowledge).
// Everything else is a reasoned guess — a bot never reads another player's
// role, dice, or vote out of the raw state.

import {
  GameState, Player, canInspect, followerCandidates, followerKnowledge, thiefOf,
} from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

/** A bot that woke up ALONE peeks at one other player's dice: prefer
 *  someone it has never peeked at (it remembers its own peeks), never
 *  itself. Returns null when the bot may not inspect this hour. */
export function botInspectTarget(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  if (!canInspect(s, bot)) return null;
  const seen = new Set((bot.peeks ?? []).map(x => x.targetId));
  const fresh = s.players.filter(p => p.id !== bot.id && !seen.has(p.id));
  const opts = fresh.length ? fresh : s.players.filter(p => p.id !== bot.id);
  return pick(opts, rng)?.id ?? null;
}

/** A bot thief picks a follower from the candidates the rules offer it
 *  right now (5p witnesses, or the post-night recruit pool). Returns null
 *  when there is no choice to make. */
export function botFollowerPick(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  if (bot.role !== 'thief') return null;
  const cands = followerCandidates(s, bot);
  if (!cands?.length) return null;
  const opts = s.players.filter(p => cands.includes(p.id));
  return pick(opts, rng)?.id ?? null;
}

/** What this bot legitimately knows about the thief's identity (if
 *  anything): the thief itself, a follower who knows the thief under the
 *  information rules, or a witness who SAW the theft. Anyone else knows
 *  nothing — and must not be handed the answer from the raw state. */
function botKnownThiefId(s: GameState, bot: Player): string | null {
  if (bot.role === 'thief') return bot.id;
  const know = followerKnowledge(s, bot);
  if (know.knownThiefId) return know.knownThiefId;
  if (s.stolenWitnessIds.includes(bot.id)) return thiefOf(s)?.id ?? null;
  return null;
}

/** A bot's ballot. The thief and its followers vote to protect their side
 *  (a villager, never the thief or a fellow follower they know about); a
 *  witness votes for the thief it saw; everyone else votes at random —
 *  never for itself (castVote would reject a self-vote and leave the bot
 *  voteless for the whole ballot). */
export function botVote(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const others = s.players.filter(p => p.id !== bot.id);
  if (!others.length) return null;
  const thiefId = botKnownThiefId(s, bot);
  const know = followerKnowledge(s, bot);
  const ownSide = new Set<string>([bot.id, ...(bot.role === 'thief' ? know.knownFollowerIds : [])]);
  if (bot.role === 'thief' || bot.isFollower) {
    // Protect the thief's side: vote a villager who is not a known
    // follower. A 7–8p follower does NOT know the thief, so it may
    // (honestly) vote for the thief by accident — that is the rule.
    const prey = others.filter(p => !ownSide.has(p.id) && p.id !== thiefId && !know.knownFollowerIds.includes(p.id));
    if (prey.length) return pick(prey, rng)?.id ?? null;
    // Corner case (a table of only thief + followers): any other vote is
    // as good as any — but never the thief itself when we know who it is.
    const fallback = others.filter(p => p.id !== thiefId);
    return pick(fallback.length ? fallback : others, rng)?.id ?? null;
  }
  if (thiefId) return thiefId; // witness: vote the thief you saw
  return pick(others, rng)?.id ?? null;
}
