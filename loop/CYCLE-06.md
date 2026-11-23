# CYCLE 06 — Room option: discussion length

## 1. REPORT — production state at cycle start (v18, bundle `assets/index-DJFMS9mj.js`)
Architecture unchanged (CYCLE-01 §1). Since then: scoreboard (v14), sound (v15), reactions (v16), night recap (v17), host kick + rejoin fixes (v18).
Inspection: all rounds run with hard-coded timers — discussion is always 2 minutes. Groups that know each other well find 2 minutes drags once the table talk dies down; new groups sometimes want longer. The host (who already manages the lobby after Cycle 5) has no way to tune this. Every tabletop-style platform lets the host configure the table before starting.

Note on process: the sandbox service restarted during this loop and wiped `/tmp`, destroying the test harness. The harness has been rebuilt under `~/workspace/ct-harness/` (persistent) with equivalent coverage — the rebuilt QA probe and self-play scripts were validated check-by-check (three probe failures and three self-play failures during the rebuild were all traced to bugs in the rebuilt scripts, not the game; each was diagnosed from server logic/screenshots before fixing).

## 2. RE-TEST — full battery on v18 (baseline)
All green: **logic 32/32 · socket 23/23 · QA probe 29/29 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- No P0/P1/P2 defects found this cycle. Gap addressed: no host-configurable room options (discussion length fixed at 2 minutes).

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Board Game Arena** table model: when creating a table the host configures player count, rule variants and speed; for timed games "game options are available while creating your table if you wish to extend or turn off the timer" (BGA Now Boarding help). BGA Werewolf hosting guides treat **Speed** and role settings as the host's first decisions — pacing is a host responsibility.
→ Chosen improvement: the host sets the **discussion length (60/120/180s)** in the lobby; it applies to the room's rounds and is visible to everyone. See PROMPT-CYCLE-06.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-06.md)
- `GameState.discussionMs` (default 120000) in shared/logic, exposed via `publicState`. New intent `setDiscussion {ms}` validated identically in HostEngine and the Socket.IO server: host-only, lobby-only, value ∈ {60000, 120000, 180000}. Both engines' `startDay` now derives `discussionEndsAt` and the auto-advance timer from `state.discussionMs`. The server's `CT_DISCUSSION_MS` env value seeds each new room's option (test speed preserved; host can override in the lobby).
- UI: lobby shows "💬 Thời gian thảo luận / Discussion time" — host gets 1:00 / 2:00 / 3:00 toggle pills (current highlighted), guests a read-only value, updated live via broadcast.

## 6. RESULTS
- QA probe extended with 4 checks: non-host attempt ignored, invalid value (45000) ignored, host set to 60s applied to public state, and the day-phase timer actually spans ~60s. **Probe: 33/33.**
- **Browser options check (MQTT, local broker): 3/3** — guest sees the default 2:00, then 3:00 and 1:00 live as the host clicks.
- Battery after implementation: **logic 32/32 · socket 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p 9/9**.
- Deployed as **v19**, bundle `assets/index-w47DCenk.js`, live hash verified by polling.
