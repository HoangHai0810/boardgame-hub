// Bot brains for Love Letter — pure decisions, no timers or transport.
// The host engine (client/src/games/love-letter/hostEngine.ts) calls
// botAct() when a bot is the actor, then the decision runs through the
// same validated logic functions a human's tap goes through, so a bot
// can never do anything a player couldn't.
//
// The bots are deliberately simple, not omniscient: they only use
// information they actually have — their own hand, the public board
// (discard piles, who is protected / out, deck count) and their own
// Priest peeks (state.seenHands[bot.id]). They never read another
// player's hand, the deck, or the set-aside card.
import {
  GameState, Player, Card, CardKind, PendingType,
  GUESSABLE, legalPlays, validTargets,
  playCard, chooseTarget, resolveChancellor,
} from './logic';

const pick = <T,>(arr: T[], rng: () => number): T | null =>
  arr.length ? arr[Math.floor(rng() * arr.length)] : null;

/** The card this bot's own Priest peek revealed, if it saw this target
 *  and the peek is still fresh (the logic clears peeks when the hand
 *  changes, so a stored peek is always the target's current card). */
function knownCard(s: GameState, bot: Player, targetId: string): Card | null {
  const seen = s.seenHands[bot.id];
  return seen && seen.targetId === targetId ? seen.card : null;
}

/** Score a legal card: the bot plays the highest-scoring one. Princess
 *  is scored far below everything else, so it is only played when it is
 *  the only legal card (legalPlays already forces the Countess when she
 *  is held with the King or Prince). */
export function botChooseCard(s: GameState, bot: Player, rng: () => number = Math.random): Card | null {
  const legal = legalPlays(s, bot);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];
  const others = (c: Card) => legal.filter(x => x.id !== c.id);
  const bestOtherValue = (c: Card) => Math.max(...others(c).map(x => x.value), -1);
  const scored = legal.map(c => {
    let score: number;
    switch (c.kind) {
      case 'countess': score = 100; break; // only reachable when forced
      case 'handmaid': score = 55; break; // protection is always useful
      case 'spy': score = 50; break; // no effect, and may earn the Spy favor
      case 'guard': score = 45; break;
      case 'priest': score = 40; break;
      case 'prince': score = 35; break;
      case 'chancellor': score = 30; break;
      // Baron compares the card left in hand: good with a high card, a
      // gamble with a low one.
      case 'baron': score = bestOtherValue(c) >= 6 ? 45 : bestOtherValue(c) <= 3 ? 10 : 25; break;
      // King trades the card left in hand: good when it is low, terrible
      // when it is the Princess or the King himself.
      case 'king': score = bestOtherValue(c) <= 3 ? 45 : bestOtherValue(c) >= 7 ? 5 : 20; break;
      case 'princess': score = -100; break;
      default: score = 0;
    }
    return { card: c, score };
  });
  const best = Math.max(...scored.map(x => x.score));
  const tied = scored.filter(x => x.score === best).map(x => x.card);
  return pick(tied, rng);
}

export interface BotTargetDecision { targetId: string; guess?: CardKind }

/** Pick a target (and, for the Guard, a guess) for the open effect.
 *  Uses only public info plus this bot's own Priest peek: a peeked
 *  Princess is the Prince's dream target, a peeked high card is the
 *  King's, a peeked low card is the Baron's, and a peeked non-Guard
 *  card is a guaranteed Guard hit. */
export function botChooseTarget(
  s: GameState, bot: Player, type: PendingType, rng: () => number = Math.random,
): BotTargetDecision | null {
  const targets = validTargets(s, bot, type);
  if (!targets.length) return null;
  const myCard = bot.hand[0];
  const myValue = myCard?.value ?? -1;
  // Prince: never target itself while another player is available.
  let pool = targets;
  if (type === 'prince') {
    const others = targets.filter(p => p.id !== bot.id);
    if (others.length) pool = others;
  }
  let target: Player | null = null;
  if (type === 'guard') {
    // A peeked non-Guard card is a certain hit.
    target = pick(pool.filter(p => {
      const k = knownCard(s, bot, p.id);
      return k && k.kind !== 'guard';
    }), rng);
  } else if (type === 'prince') {
    // A peeked Princess is knocked out by the Prince.
    target = pick(pool.filter(p => knownCard(s, bot, p.id)?.kind === 'princess'), rng);
  } else if (type === 'king') {
    // Trade for a peeked card better than the one kept.
    const better = pool.filter(p => (knownCard(s, bot, p.id)?.value ?? -1) > myValue);
    target = pick(better, rng);
  } else if (type === 'baron') {
    // Compare against a peeked card lower than the one kept; never pick
    // a peeked card known to beat it while an unknown target exists.
    const lower = pool.filter(p => {
      const k = knownCard(s, bot, p.id);
      return k && k.value < myValue;
    });
    target = pick(lower, rng);
    if (!target) {
      const unknown = pool.filter(p => {
        const k = knownCard(s, bot, p.id);
        return !k || k.value <= myValue;
      });
      target = pick(unknown, rng);
    }
  }
  if (!target) target = pick(pool, rng);
  if (!target) return null;
  if (type === 'guard') {
    const known = knownCard(s, bot, target.id);
    const guess: CardKind = known && known.kind !== 'guard'
      ? known.kind
      : GUESSABLE[Math.floor(rng() * GUESSABLE.length)];
    return { targetId: target.id, guess };
  }
  if (type === 'priest') {
    // Prefer a player never peeked before (peeking the same hand twice
    // teaches nothing new).
    const unpeeked = pool.filter(p => s.seenHands[bot.id]?.targetId !== p.id);
    const t = pick(unpeeked, rng) ?? target;
    return { targetId: t.id };
  }
  return { targetId: target.id };
}

/** Chancellor: keep the highest-value card in hand (the rulebook lets
 *  the Countess go back to the deck here — no forced play). */
export function botChooseChancellorKeep(s: GameState, bot: Player, rng: () => number = Math.random): Card | null {
  if (!bot.hand.length) return null;
  const best = Math.max(...bot.hand.map(c => c.value));
  return pick(bot.hand.filter(c => c.value === best), rng);
}

/** One bot's whole turn step, run through the same validated logic
 *  functions a human's tap goes through: play a card, then resolve any
 *  effect it opened (target/guess, or the Chancellor keep-one). Returns
 *  false when the bot has nothing to do right now (not its turn, not
 *  in the round, no legal move) — the engine then leaves the turn to
 *  the turn timer's autoTurn fallback. */
export function botAct(s: GameState, bot: Player, rng: () => number = Math.random): boolean {
  if (s.phase !== 'playing' || !bot.inRound || !bot.connected) return false;
  const pending = s.pendingAction;
  if (pending && pending.actorId === bot.id) {
    if (pending.type === 'chancellor') {
      const keep = botChooseChancellorKeep(s, bot, rng);
      return keep ? resolveChancellor(s, bot, keep.id, rng) : false;
    }
    const d = botChooseTarget(s, bot, pending.type, rng);
    return d ? chooseTarget(s, bot, d.targetId, d.guess, rng) : false;
  }
  if (s.turn !== bot.id || pending) return false;
  const card = botChooseCard(s, bot, rng);
  if (!card) return false;
  if (!playCard(s, bot, card.id, rng)) return false;
  // The play may have opened a pending effect — resolve it at once.
  if (s.pendingAction?.actorId === bot.id) return botAct(s, bot, rng);
  return true;
}
