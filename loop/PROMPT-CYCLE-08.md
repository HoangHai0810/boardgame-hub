# PROMPT — Cycle 8: Personal session record

## Goal
Each player sees their own record for this session on the results screen and in the lobby: total wins/losses plus a per-role breakdown (games and wins as Chuột Làng / Chuột Phô Mai / Chuột Chết), mirroring the role-split stats on Among Us player profiles. Purely client-side: no protocol, engine or logic changes.

## Rules
- The App records a round when the public state transitions INTO `results` (the same transition the Cycle 2 sound effect already detects): win/loss uses exactly the sound effect's existing `iWon` determination (winner vs my role/follower status — followers win/lose with the thief; Fall Mouse wins only alone).
- De-duplicate by `${roomCode}:${round}` in a ref set — re-renders, re-broadcasts or re-joining the same results screen must never double-count. A round is recorded only if `priv.role` is known (the player actually played it).
- The record is kept in React state (`{ w, l, roles: { [role]: { w, g } } }`), session-scoped (page lifetime), like the room scoreboard. It resets when the page reloads; it is NOT persisted (the room scoreboard isn't either).
- Display component `MyRecord`, rendered only when at least one round is recorded:
  - on the results screen under the room Standings;
  - in the lobby under the room Standings (so it greets you between rounds).
  - Content: title (recordTitle), the W–L line (recordLine), and one chip per role played: emoji + localized role name + `wins/games` (e.g. `🐭 Chuột Làng 2/3`).
- i18n: `recordTitle`, `recordLine(w, l)` in EN + VI. Role names reuse existing dict keys (thief/sleepy/fall).

## Edge cases
- Joining a room mid-session: only rounds the player actually played (priv.role known at results) count.
- Leaving and joining another room: the record keeps accumulating for the page session (it is *my* record, not the room's) — acceptable and documented here; the dedupe key includes the room code.
- Fall Mouse dealt but the round ends by another outcome: recorded as a loss unless the Fall Mouse won (handled by the shared iWon formula).

## Acceptance tests
- Browser full-round self-play extended: after results, the host page shows the record panel with a 1-round W or L line matching the actual outcome; after Play Again, the lobby still shows it.
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p).
