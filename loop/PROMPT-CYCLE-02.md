# PROMPT — CYCLE 02: Real sound effects behind the (currently dead) mute toggle

## Goal
Implement synthesized sound effects with the Web Audio API — zero audio files —
and wire them to game events. The existing 🔊/🔇 toggle must actually control them.
Justification: (a) bug — the toggle currently controls nothing; (b) market —
Among Us analyses consistently credit *event audio cues* (meeting horn, vote tick,
reveal sting) with alerting players to game-changing moments while keeping music
minimal so players focus on each other; (c) playability — our night phase is
12 s/hour and players across the room get no cue when THEIR hour starts or when
morning comes. WebAudio synth practice (multiple shipped browser games): one
oscillator + gain envelope per cue, exponential ramps to 0.0001 (never 0),
schedule on ctx.currentTime, resume the context inside a user gesture.

## Design — new module `client/src/sound.ts`
- Lazy singleton AudioContext; `ensureCtx()` creates/resumes it. Browsers block
  audio before a user gesture: App installs a one-time pointerdown listener that
  calls `ensureCtx()`.
- `export type SfxKind = 'hour' | 'wake' | 'steal' | 'morning' | 'vote' | 'win' | 'lose' | 'pop'`
- `export function sfx(kind: SfxKind, muted: boolean)`: no-op when muted or when
  no context can be created; wrapped in try/catch (audio must NEVER crash the game).
- One tone helper: oscillator (type per cue) + gain envelope (attack 0.01 →
  exponential decay to 0.0001), master gain ≤ 0.2. Cues:
  - hour: single soft tick (660 Hz sine, 0.07 s) — a new night hour begins.
  - wake: two rising notes (523 → 784 Hz) — YOU woke up this hour.
  - steal: sneaky descending slide (392 → 196 Hz triangle, 0.25 s) — thief only,
    when their steal lands.
  - morning: bright 3-note arpeggio (523, 659, 784) — day phase begins.
  - vote: firm click (880 Hz square, 0.05 s, low gain) — your vote was recorded.
  - win: rising 4-note jingle (523, 659, 784, 1047).
  - lose: descending 2-note (392 → 262).
  - pop: very soft blip (1200 Hz, 0.03 s, gain 0.05) — someone else's chat message.
- Testability hook: increment `(window as any).__ctSfx = ((window as any).__ctSfx ?? 0) + 1`
  on every actually-played cue (after the muted check), so browser self-play can
  assert sounds fired. Harmless in production.

## Wiring — `client/src/App.tsx`
- Mute state: initialise from localStorage `ct_muted` ('1' = muted), persist on toggle.
- One effect watching game state transitions (track previous values in refs):
  - phase enters 'night', or currentHour changes while phase='night' → 'hour';
    if priv.awake is true at that moment → also 'wake'.
  - thief's priv.hasActedThisHour flips false→true → 'steal'.
  - phase enters 'day' → 'morning'.
  - priv.myVote changes null→value during 'voting' → 'vote'.
  - phase enters 'results' → 'win' if the local player won the round
    (winner 'fallmouse' → my role is fallmouse; 'thief' → my role is thief OR I'm a
    follower; 'sleepyheads' → I'm a villager-side non-follower), else 'lose'.
  - pub.chat grows AND last message is not mine AND phase is lobby/day/results → 'pop'.
- All effects must tolerate priv/pub being null and must not fire on first mount
  (initialise refs from the first observed state without playing).

## Rules / constraints
- NO audio files, NO new dependencies, NO Node-only APIs (v12 lesson).
- Sound must never throw into React rendering; every call path guarded.
- Volume conservative; the game is played in one room on multiple phones —
  cues are personal-device cues, kept short and quiet.

## Acceptance tests
- Full battery green (logic/socket/probe/MQTT/selfplay6) — client-only change,
  but the battery is the battery.
- Browser self-play (selfplay-full): zero pageerrors; `window.__ctSfx > 0` by the
  results screen (morning/vote/win cues fired); toggle click flips localStorage
  `ct_muted` and, while muted, playing a round fires no additional cues
  (assert counter does not increase after muting mid-game — check on the results
  screen of round 2 OR simply: mute before starting, counter stays 0 through
  results). Implement as a dedicated small script if simpler: selfplay-sound.mjs
  with two passes (unmuted full round → counter > 0; muted full round → counter 0).

## Out of scope
- Background music (deliberately: genre guidance says keep focus on players).
- Per-cue volume settings UI.
