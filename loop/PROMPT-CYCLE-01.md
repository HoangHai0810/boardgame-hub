# PROMPT — CYCLE 01: Session scoreboard (bảng điểm cả buổi chơi)

## Goal
Track how many rounds each player has WON during the lifetime of a room, and show it
in the lobby and on the results screen, with a 👑 next to the session leader.
Justification: multi-round scoreboards are a headline retention feature in party /
social-deduction games (KallanCop advertises an "automated multi-round scoreboard";
Friends That Game shows a live leaderboard + 👑 for round winners + one-tap play
again; party-game design literature calls this the "one-more-round loop"). Our game
already has Play Again in the same room but forgets every result instantly.

## Rules
- A player "wins a round" when the round result matches their side:
  - winner = 'sleepyheads' → every non-follower villager-side player wins
    (roles 'sleepyhead' and 'fallmouse' who is NOT a follower and did not win alone;
    note: if winner is 'sleepyheads' the fall mouse did not top the vote, so a
    non-follower fall mouse wins with the village).
  - winner = 'thief' → the thief and all followers win.
  - winner = 'fallmouse' → ONLY the fall mouse wins (solo win), even if follower.
- Score lives on the player record (`wins`), starts at 0, increments exactly once
  per finished round, and is NEVER reset by assignRolesAndDice / playAgain —
  it resets only when a brand-new room/game state is created.
- `wins` is public information: expose it in publicState() player entries at all
  phases (it is not a secret). Do not expose it in a way that leaks role info —
  wins only change at results, when roles are revealed anyway.
- UI: 
  - PlayerChips: under the player name show `🏆 ×N` when N > 0.
  - Lobby: a compact standings line sorted by wins desc (only if any wins > 0).
  - Results: standings list sorted by wins desc, 👑 on the top scorer(s).
  - i18n: add keys in BOTH en and vi (Dict type requires identical keys):
    `standings` ("Session wins" / "Số ván thắng"), keep 🏆 emoji in the label text.
- Both engines (hostEngine for MQTT/PeerJS, server for Socket.IO) share
  shared/logic.ts — implement scoring inside resolveVotes() in shared/logic.ts so
  both transports get it with zero engine changes. Verify server/src/index.ts uses
  the shared resolveVotes (it keeps its own engine copy — check and mirror if needed).

## Edge cases
- Disconnected players still get their win counted (they were part of the round).
- A player who joins mid-session starts at 0 — fine.
- Play Again → round increments, wins persist (assert in tests).
- resolveVotes must stay idempotent-safe: it is called once per round by engines;
  do not double-count if called twice on the same finished state (guard: if
  state.winner already set, return existing result without re-scoring).

## Acceptance tests
- Logic tests (add to tests/logic.test.mjs):
  1. sleepyheads win → all non-follower villagers +1, thief/followers +0.
  2. thief win → thief +1 and each follower +1, others +0.
  3. fallmouse solo win → only fall mouse +1 (even when follower).
  4. wins persist across assignRolesAndDice (round 2 setup does not reset).
  5. calling resolveVotes twice does not double-count.
  6. publicState exposes wins.
- Full battery green: logic (25 + new), socket integration, QA probe, MQTT transport,
  browser self-play 6p.
- Browser self-play screenshot of results or lobby showing 🏆 counts after a round.

## Out of scope
- No persistence across rooms or page reloads (session-only, like the room itself).
- No points system beyond win counts (keep it legible — party-game design guidance).
