// Bot brains for Uno — pure decisions, no timers or transport. The
// host engine (client/src/games/uno/hostEngine.ts) calls these when a
// bot is the actor, then runs the result through the same validated
// logic functions a human's tap goes through, so a bot can never do
// anything a player couldn't.
//
// The bots are deliberately "a bit smart", not omniscient: they only use
// their own hand, the top discard and the current color — never another
// player's hand or the deck.

import { Card, Color, COLORS, GameState, Player, isPlayable, topCard } from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

/** The color the bot holds most of (ties broken at random). A hand with
 *  no colored card left falls back to a random color. */
export function botChooseColor(hand: Card[], rng: () => number = Math.random): Color {
  const count = new Map<Color, number>();
  for (const c of hand) {
    if (c.color === 'wild') continue;
    count.set(c.color as Color, (count.get(c.color as Color) ?? 0) + 1);
  }
  let best = 0;
  for (const n of count.values()) best = Math.max(best, n);
  const leaders = [...count.entries()].filter(([, n]) => n === best).map(([c]) => c);
  return pick(leaders, rng) ?? COLORS[Math.floor(rng() * COLORS.length)];
}

export interface BotPlay { cardId: string; color?: Color }

/**
 * The card this bot would play right now, or null when it has nothing
 * legal (so it must draw). Priority: action cards (skip / reverse /
 * draw2) first, then numbers, then Wild, then Wild Draw 4 last — wilds
 * are kept as a last resort. Within the best tier the pick is random,
 * so the bot does not play the same way every hand.
 *
 * After drawing, only the drawn card may be played this turn, so a bot
 * that already drew only ever considers that one card.
 */
export function botPickCard(s: GameState, bot: Player, rng: () => number = Math.random): BotPlay | null {
  if (s.phase !== 'playing' || s.turn !== bot.id) return null;
  if (s.pendingDraw4 || s.colorPickPending) return null; // decision turns only
  let playable = bot.hand.filter(c => isPlayable(c, topCard(s), s.currentColor));
  if (s.turnDrawn && s.drawnCardId) playable = playable.filter(c => c.id === s.drawnCardId);
  if (!playable.length) return null;
  const tier = (c: Card): number =>
    c.kind === 'skip' || c.kind === 'reverse' || c.kind === 'draw2' ? 3
    : c.kind === 'number' ? 2
    : c.kind === 'wild' ? 1
    : 0; // wild4
  let best = -1;
  for (const c of playable) best = Math.max(best, tier(c));
  const top = playable.filter(c => tier(c) === best);
  const card = pick(top, rng)!;
  if (card.kind === 'wild' || card.kind === 'wild4') {
    // Pick the color from the hand that REMAINS after playing the wild.
    const rest = bot.hand.filter(c => c.id !== card.id);
    return { cardId: card.id, color: botChooseColor(rest, rng) };
  }
  return { cardId: card.id };
}

/** Challenge a Wild Draw 4 about 30% of the time — a bluff call is a
 *  gamble either way (right: the +4 player draws 4; wrong: I draw 6). */
export function botShouldChallenge(rng: () => number = Math.random): boolean {
  return rng() < 0.3;
}

/** The player this bot would catch for a forgotten UNO, if any: anyone
 *  sitting on 1 card without calling UNO — never itself. */
export function botCatchTarget(s: GameState, bot: Player): string | null {
  if (s.phase !== 'playing' || !s.unoPending || s.unoPending === bot.id) return null;
  return s.unoPending;
}
