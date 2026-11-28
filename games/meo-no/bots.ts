// Bot brains for Mèo Nổ — pure decisions, no timers or transport. The
// host engine (client/src/games/meo-no/hostEngine.ts) calls these when a
// bot is the actor, then runs the result through the same validated
// logic functions a human's tap goes through, so a bot can never do
// anything a player couldn't.
//
// The bots are deliberately simple, not omniscient: they only use their
// own hand plus public table info (whose turn it is, who is alive, the
// Attack debt, the pending action). They NEVER read the deck or another
// player's hand — not even the top cards a Peek would show a human.
// (reinsertPositions only reads the deck's length, which is public.)

import { GameState, Player, reinsertPositions } from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

const ACTION_KINDS = ['skip', 'shuffle', 'peek', 'attack', 'favor'] as const;

/** Is it this bot's turn with nothing waiting on the table? */
function botFreeToAct(s: GameState, bot: Player): boolean {
  return (
    s.phase === 'playing' &&
    s.turn === bot.id &&
    bot.alive &&
    !s.pendingAction &&
    !s.pendingExplode &&
    !s.pendingReinsert &&
    !s.pendingFavor
  );
}

export type BotAction = { cardId: string; cardId2?: string; targetId?: string };

/** A matching cat pair in the bot's hand, if any (first variant with 2+). */
export function botPair(s: GameState, bot: Player): { cardId: string; cardId2: string } | null {
  const byVariant = new Map<string, string[]>();
  for (const c of bot.hand) {
    if (c.kind !== 'cat' || !c.variant) continue;
    const list = byVariant.get(c.variant) ?? [];
    list.push(c.id);
    byVariant.set(c.variant, list);
  }
  for (const ids of byVariant.values()) if (ids.length >= 2) return { cardId: ids[0], cardId2: ids[1] };
  return null;
}

/** A bot's Favor target: a random living opponent (never itself). */
export function botFavorTarget(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  const opts = s.players.filter(p => p.id !== bot.id && p.alive);
  return pick(opts, rng)?.id ?? null;
}

/** The card a bot hands over when it is Favored: a random card from its
 *  own hand. (A human chooses; a bot has no preference worth modelling.) */
export function botFavorGiveCardId(s: GameState, bot: Player, rng: () => number = Math.random): string | null {
  return pick(bot.hand, rng)?.id ?? null;
}

/** What a bot does on its turn, if anything: at most ONE action card,
 *  then the engine draws to end the turn (a separate step — the bot
 *  never draws in this function).
 *
 *  - Owing Attack draws: answer with an Attack (pass the debt on) most
 *    of the time, or burn a Skip to cancel one owed draw; otherwise
 *    just draw and pay the debt.
 *  - Otherwise: ~35% of turns it plays one random action card from its
 *    hand; the rest of the time it draws straight away. */
export function botChooseAction(s: GameState, bot: Player, rng: () => number = Math.random): BotAction | null {
  if (!botFreeToAct(s, bot)) return null;
  const playable = bot.hand.filter(c => (ACTION_KINDS as readonly string[]).includes(c.kind));
  if (!playable.length) return null;

  if (s.debt > 0) {
    const attack = playable.find(c => c.kind === 'attack');
    if (attack && rng() < 0.6) return { cardId: attack.id };
    const skip = playable.find(c => c.kind === 'skip');
    if (skip && rng() < 0.5) return { cardId: skip.id };
    return null;
  }

  // A matching cat pair steals a random card — the cats' only use, so
  // bots reach for it about half the time they hold one.
  const pair = botPair(s, bot);
  if (pair) {
    const victim = pick(s.players.filter(p => p.id !== bot.id && p.alive && p.hand.length > 0), rng);
    if (victim && rng() < 0.5) return { ...pair, targetId: victim.id };
  }

  if (rng() >= 0.35) return null;
  const card = pick(playable, rng);
  if (!card) return null;
  if (card.kind === 'favor') {
    const targetId = botFavorTarget(s, bot, rng);
    if (!targetId) return null;
    return { cardId: card.id, targetId };
  }
  return { cardId: card.id };
}

/** May this bot Nope the pending action, and does it want to (~15%)?
 *  Legality mirrors logic.playNope: the actor may not Nope its own
 *  card first, and nobody may Nope their own Nope. The 15% roll is
 *  the LAST check, so a stubbed rng of 0.1 means "wants to" and 0.9
 *  means "lets it pass" in tests. */
export function botShouldNope(s: GameState, bot: Player, rng: () => number = Math.random): boolean {
  const pa = s.pendingAction;
  if (!pa || s.phase !== 'playing' || !bot.alive) return false;
  if (pa.nopes.length === 0 && bot.id === pa.actorId) return false;
  if (pa.nopes.length > 0 && bot.id === pa.nopes[pa.nopes.length - 1]) return false;
  if (!bot.hand.some(c => c.kind === 'nope')) return false;
  return rng() < 0.15;
}

/** Where a bot reinserts a defused kitten: a random one of the 5 fixed
 *  positions the rules allow (top / 2nd / 3rd / middle / bottom). */
export function botReinsertPos(s: GameState, rng: () => number = Math.random): number | null {
  return pick(reinsertPositions(s), rng)?.pos ?? null;
}
