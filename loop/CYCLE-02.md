# CYCLE 02 — Sound effects (the mute button must stop being a lie)

## 1. REPORT — production state at cycle start (v14, bundle `assets/index-Pww2Q6Pz.js`)
Same architecture as Cycle 1 (see CYCLE-01.md §1). Changes since: session scoreboard live; README accurate.
New inspection finding: `client/src/App.tsx` renders a 🔊/🔇 sound toggle (`muted` state) but **no audio code exists anywhere in the client** — the button toggles a boolean that nothing reads. Users reasonably believe the game has sound.

## 2. RE-TEST — full battery on v14 (baseline)
All green: **logic 30/30 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- **P2 — Dead sound toggle:** the 🔊/🔇 button in the top bar controls nothing; there is no sound implementation at all. On a phone across the room, players also get NO audible cue when their night hour arrives or when morning comes — a real playability gap for a game whose core loop is "wake up at your hour". → Fixed this cycle by implementing real sound effects behind the toggle (PROMPT-CYCLE-02).
- (No P0/P1 found in this cycle's inspection.)

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Among Us sound-design analyses** (game-star.org review; sound-effect catalogues): "audio cues effectively alert players to completed tasks, impending dangers, or the arrival of game-changing meetings"; the voting screen has a soft *tick* when a vote is cast, followed by a dramatic reveal sound; music is deliberately minimal "so players focus on sound design and on each other" — i.e. **event cues, not background music**.
- **Shipped browser games that synthesize all audio** (Ant Games write-up; OmniPlay; Samudra Manthana dev log): zero audio files — every effect is an oscillator + envelope in Web Audio; keeps the game a single self-contained page and lets sound react to play. Load-bearing techniques: exponential ramps must target 0.0001 (never 0), schedule on `ctx.currentTime`, create a fresh OscillatorNode per cue, and **the autoplay policy will break you** — an AudioContext must be created/resumed inside a user gesture.
→ Chosen improvement: **event sound cues synthesized in Web Audio** (hour tick, wake chime, steal slide, morning arpeggio, vote click, win/lose jingles, soft chat pop), wired behind the existing toggle. See PROMPT-CYCLE-02.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-02.md)
- New module `client/src/sound.ts`: lazy AudioContext (resumed on first pointerdown), master gain 0.2, one tone helper (oscillator + exponential envelope to 0.0001), 8 cues, fully try/catch-guarded, `window.__ctSfx` counter hook for tests.
- `App.tsx`: transition-watching effect (phase/hour/awake/steal/vote/results/chat) plays the matching cue; "did I win" computed from winner + own role/follower status, mirroring the scoreboard rules. Mute toggle now persists to localStorage `ct_muted` and genuinely silences all cues.
- No audio files, no new dependencies, no Node-only APIs.

## 6. RESULTS
- **Sound self-play (new, real browser, 2 full rounds): ALL OK** — unmuted round: exactly 10 cues fired on every one of the 4 pages (6 hour ticks + wake/steal + morning + vote + result jingle); muted round: mute persisted to localStorage and **0 cues** on all pages; zero page errors.
- Battery after implementation: **logic 30/30 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9** (unchanged — client-only feature).
- Deployed as **v15**, bundle `assets/index-_4qnQueh.js`, live hash verified by polling.
