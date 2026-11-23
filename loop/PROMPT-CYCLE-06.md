# PROMPT — Cycle 6: Room option — discussion length

## Goal
The host can set the discussion length for the room (60s / 120s / 180s) in the lobby. The setting applies to every round played in that room until changed, is visible to everyone, and takes effect in the day phase timer.

## Rules
- `GameState.discussionMs` (new field, default `DISCUSSION_MS` = 120000) lives in shared/logic `createGame`; `publicState` exposes it as `discussionMs` (public info, not a secret).
- Intent `setDiscussion { ms }`, handled identically by HostEngine and the Socket.IO server:
  - host-only, lobby-only (also allowed on the results screen, which returns to the lobby flow — keep it simple: lobby phase only);
  - `ms` must be one of 60000 / 120000 / 180000; anything else is ignored;
  - on success, broadcast.
- Both engines' `startDay` uses `state.discussionMs` for `discussionEndsAt` and the auto-advance timer instead of the constant.
  - Server exception: when the server is started with `CT_DISCUSSION_MS` (test harness), that env value initializes each new room's `discussionMs` (so fast test timers keep working); the host can still change it in the lobby afterwards.
  - The browser HostEngine always starts at the 120000 default.
- Net layer: add `setDiscussion(ms)` to the Net interface + all three transports (MQTT/PeerJS via intent, Socket.IO via emit).
- UI (lobby): host sees three toggle buttons (1:00 / 2:00 / 3:00) labelled with the localized "Discussion time" string, the current value highlighted; guests see a read-only line showing the current value. Changing it mid-lobby updates everyone live via broadcast.
- i18n: `discussionTime` label EN + VI; minute labels can reuse plain numerals.

## Edge cases
- Non-host or mid-round `setDiscussion`: ignored by both engines.
- Invalid values (0, 45000, "abc"): ignored.
- The day countdown display already derives from `discussionEndsAt` — no UI change needed there.
- Scoreboard/recap/etc. unaffected.

## Acceptance tests
- QA probe gains 2 checks (room B, before starting): non-host setDiscussion ignored; host sets 60000 → public state shows discussionMs 60000, and when the day phase starts, `discussionEndsAt - dayStartedAt` ≈ 60000 (tolerance ±3s, using state timestamps: assert `discussionEndsAt - Date.now()` at first day sighting is ≤ 63000 and > 30000 — with CT_DISCUSSION_MS=3000 env the room would default to 3000, so this check must run in a room where the host explicitly set 60000 before start; the delta between discussionEndsAt and the moment the night ended is what matters — capture `discussionEndsAt` on first day state and compare against the last night state's timestamp… simpler: assert discussionEndsAt - (time the probe first saw the day state) is between 40000 and 63000, since the probe polls every 120ms the first sighting is within ~1s of day start).
- Browser check (MQTT local, 2 pages enough): host changes the option in the lobby → guest's lobby shows the new value without rejoining.
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p).
