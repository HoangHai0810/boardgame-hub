# CYCLE 03 — Quick emoji reactions for chat phases

## 1. REPORT — production state at cycle start (v15, bundle `assets/index-_4qnQueh.js`)
Architecture unchanged (CYCLE-01 §1). Since then: session scoreboard (v14), WebAudio sound cues (v15).
Inspection: communication in the open-chat phases (lobby/day/results) is **type-only**. On a phone, composing a message during a 2-minute discussion is slow; players who want to signal "I saw that 👀" or "sus 🧀" often say nothing. There is no lightweight expression channel.

## 2. RE-TEST — full battery on v15 (baseline)
All green: **logic 30/30 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- No P0/P1 found this cycle. Gap addressed as the cycle improvement (P2-class UX gap): no quick-reaction channel in chat phases.

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Among Us Quick Chat** (Innersloth): introduced because preset messages "promote easier and faster communication without the need for typing"; the 2023.7.11 update rebuilt it (Quick Chat Builder, refined categories, favourites) — Innersloth's own patch notes call it making "accusing your friends a breeze". It is also an accessibility feature (players who type slowly, younger players, cross-language play) — phrases are picked from a list, not typed.
- Secondary coverage of the same feature stresses speed during timed discussions and inclusivity for players not comfortable typing in the group's language.
→ Chosen improvement: a **quick-bar in the chat panel** — 8 emoji reactions + 4 preset phrases. Phrases are sent as language-neutral tokens (QC1–QC4) and rendered in each viewer's own language, the same id-based approach as Among Us quick chat. See PROMPT-CYCLE-03.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-03.md)
- `ChatPanel` (App.tsx) gains a quick-bar above the input: 8 emoji buttons (👀 🧀 😱 🤔 👍 👎 😂 ❓) + 4 phrase chips; both send through the existing chat intent (engine spam guard + phase gating unchanged — zero protocol/engine changes).
- Rendering: a message that is exactly one reaction emoji renders BIG (36 px, verified); a `QCn` token renders as the localized phrase from i18n keys `qc1`–`qc4` (added to EN + VI).
- Receivers also hear the Cycle-2 'pop' cue for these messages, as for any chat.

## 6. RESULTS
- **Reactions self-play (new, real browser, 2 pages): ALL OK** — host's 👀 appears on the guest at 36 px; QC2 sent from a VI client renders "Giờ đó tui đang ngủ 😴" for the VI guest and, after the guest switches to EN, the SAME message renders "I was asleep at that hour 😴" (screenshot verified visually, guest lobby view).
- Battery after implementation: **logic 30/30 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9** (client-only change; tallies unchanged).
- Deployed as **v16**, bundle `assets/index-DSCOT0fP.js`, live hash verified by polling.
- Process note: two early runs of the new self-play failed on Playwright strict-mode selector collisions (👀 also appears inside the QC1 chip label; the QC2 phrase also appears on the guest's own chip) and one on a React node-swap during measurement — all test-harness issues, fixed in the script; the app behaved correctly in every run.
