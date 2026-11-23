# PROMPT — CYCLE 04: Post-game night recap (timeline of the night, revealed at results)

## Goal
Record the night's events as they happen and reveal them as a readable timeline
on the results screen: who woke each hour, when the cheese was stolen, who
witnessed it, who peeked at whose dice (and what they saw), who was recruited.
Justification: Goose Goose Duck's "more detailed previous-game summary … helps
untangle what actually happened after a particularly chaotic session" is a
praised feature; in the physical game the post-round retelling is the social
payoff. Our results screen currently reveals only static facts (roles, dice,
vote counts) — the story is unrecoverable.

## Design — recording in shared/logic.ts (single source for all transports)
- New type:
  `export interface RecapEvent { hour: number; kind: 'wake' | 'steal' | 'inspect' | 'witness' | 'recruit'; ids: string[]; targetId?: string; seen?: number }`
- `GameState.recap: RecapEvent[]` — init `[]` in createGame; reset in assignRolesAndDice.
- `export function recordHour(state)`: pushes `{ hour: state.currentHour, kind: 'wake', ids: wakers(state).map(p => p.id) }`. Called by BOTH engines right after `currentHour` is set for each hour (hostEngine hour step; server stepHour).
- Hooks inside existing logic functions (so every transport + auto-resolutions are covered):
  - `doSteal` on success: push `{hour, kind:'steal', ids:[thief.id]}`; if `stolenWitnessIds.length` push `{hour, kind:'witness', ids:[...stolenWitnessIds]}`; if the 5p single-witness instant conversion fires, also push `{hour, kind:'recruit', ids:[witnessId]}`.
  - `doInspect` on success: push `{hour, kind:'inspect', ids:[player.id], targetId, seen: target.dice}`.
  - `chooseFollower` on success (both branches): push `{hour: state.currentHour, kind:'recruit', ids:[targetId]}`. (autoResolve goes through chooseFollower → covered.)
- `publicState`: add `recap: inResults ? state.recap : undefined` — the recap
  must be **absent before results** (it contains dice values and the thief's
  identity-by-action; pre-results exposure would be a critical leak).

## UI — results screen (App.tsx)
- A "🌙 Night recap" panel (i18n `recapTitle`) under the vote counts:
  group events by hour 1..6 in order; per hour show the wake line
  (`recapWake(names)` or `recapNone` when nobody woke), then that hour's event
  lines: steal 🧀 (`recapSteal(name)`), witness 👀 (`recapWitness(names)`),
  inspect 🔍 (`recapInspect(byName, targetName, seen)`), recruit 🤝
  (`recapRecruit(name)`). Recruit events recorded at hour 6 / recruit phase
  render after hour 6 under `recapRecruitTitle` ("After the night") if their
  hour is 6 and phase was recruit — simplify: render recruit events in a final
  section regardless of hour, EXCEPT 5p witness conversions which belong to
  their night hour (distinguish: recruit events with hour < 6 or during 'night'
  … simplest robust rule: keep an `afterNight?: boolean` on the event set when
  phase==='recruit' at record time).
- i18n keys (BOTH dicts): recapTitle, recapHour(h), recapWake(names),
  recapNone, recapSteal(name), recapWitness(names), recapInspect(by, target, seen),
  recapRecruit(name), recapAfter.

## Edge cases
- Thief never steals → no steal/witness events; recap still shows wakes/inspects.
- Hours with no wakers → recapNone line.
- A player disconnects mid-night → events already recorded stay (they happened).
- Play again → assignRolesAndDice resets recap (assert in tests).
- Recap must not appear in ANY public state before results (logic test asserts
  JSON of publicState during night/day/voting contains no '"recap"' with content
  and no '"seen"').

## Acceptance tests
- Logic tests (add): scripted 5p night — recordHour at the steal hour, doSteal
  with a lone witness → recap has wake+steal+witness+recruit in order; a lone
  waker inspects → inspect event with correct `seen`; publicState pre-results
  hides recap; at results recap is present; assignRolesAndDice clears recap.
- Full battery green (probe leak checks must stay green — recap is results-only).
- Browser full-round self-play: results screen shows the recap panel with the
  steal line; screenshot verified visually.

## Out of scope
- Chat/discussion events in the recap (chat is already visible to all).
- Persisting recaps across rounds (the scoreboard already covers session memory).
