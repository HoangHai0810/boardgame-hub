# CYCLE 04 — Post-game night recap ("what actually happened last night?")

## 1. REPORT — production state at cycle start (v16, bundle `assets/index-DSCOT0fP.js`)
Architecture unchanged (CYCLE-01 §1). Since then: scoreboard (v14), sound cues (v15), quick reactions + preset phrases (v16).
Inspection: when a round ends, the results screen reveals roles/dice and vote counts — but the *story of the night* is lost: who woke when, who peeked at whom, when exactly the cheese vanished, who witnessed it. In the physical game this is the best part — everyone recounts the night around the table. Digitally, players currently have to reconstruct it from memory and chat claims (which may be lies — that's fine during the game, but after results the truth should be tellable).

## 2. RE-TEST — full battery on v16 (baseline)
All green: **logic 30/30 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- No P0/P1 found this cycle. Gap addressed (P2-class): no post-game recap — results reveal static facts, not the night's timeline.

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Goose Goose Duck**: "post-match displays show earned tokens. A more detailed previous-game summary, available through the 'i' button, **helps untangle what actually happened after a particularly chaotic session**" — reviewers single this out as a reason chaotic rounds stay fun instead of frustrating.
- The same pattern (post-game event log / replay) is standard in digital Werewolf/Mafia implementations: after hidden information is revealed, players re-read the night to learn and to retell it — the social payoff of the genre.
→ Chosen improvement: a **night recap timeline** on the results screen (wakes per hour, steal moment, witnesses, inspections with the dice seen, recruitments). See PROMPT-CYCLE-04.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-04.md)
- `shared/logic.ts`: `GameState.recap: RecapEvent[]` recorded inside the authoritative functions themselves — `recordHour()` (called by both engines at each hour start), hooks in `doSteal` (steal + witnesses + 5p instant conversion), `doInspect` (target + dice seen), `chooseFollower` (incl. auto-resolutions, which funnel through it; recruit-phase picks flagged `afterNight`). Reset per round in `assignRolesAndDice`.
- **Security-critical:** `publicState()` exposes `recap` ONLY at results — it contains dice values and actions that would be a critical leak mid-game. Logic tests assert it is absent (and no `"seen"` field leaks) before results.
- UI: results screen gains a "🌙 Diễn biến đêm qua / Night recap" panel grouping events by hour (wake line or "everyone asleep", then steal/witness/inspect/recruit lines), with an "After the night" section for recruit-phase picks. i18n keys in EN + VI.

## 6. RESULTS
- Logic tests: **32/32** (30 + 2 recap tests: ordered recording + pre-results hiding + per-round reset; afterNight flagging).
- **Browser full-round self-play: 10/10** (extended with recap assertions) — results screenshot visually verified: per-hour wake lines render ("Giờ 1: thức dậy: BF1", "Giờ 4: mọi người đều ngủ", …) and the steal line is present.
- Battery after implementation: **logic 32/32 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9** (probe leakage checks stay green — recap is results-only).
- Deployed as **v17**, bundle `assets/index-DeXHKApO.js`, live hash verified by polling.
