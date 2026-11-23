# PROMPT — Cycle 9: Shareable results summary

## Goal
The results screen gets a "📋 Share result" button that copies a compact, localized text summary of the round to the clipboard — ready to paste into the group's Messenger/Zalo/social chat (the Wordle pattern). Purely client-side; no protocol changes.

## Summary format (one line each, in the viewer's current language)
1. Header: `shareHeader(roomCode, round)` — game title + room + round.
2. The winner headline (existing dict keys: sleepyWin / thiefWin / fallWin).
3. `thiefWas(thiefName)` (existing key).
4. If a Fall Mouse was dealt: `fallWas(fallName)` (existing key).
5. If anyone has session wins: `🏆 Name ×N · Name ×N …` from the public scoreboard data, sorted desc.
6. If the viewer has a personal record (Cycle 8): `📊 ` + recordLine(w, l).
7. The game URL (origin + pathname, no room param — the front door, so friends can start their own room).

## Rules
- Button lives on the results screen under MyRecord. Click → `navigator.clipboard.writeText(summary)` → button label flips to the copied confirmation for ~1.5s (same pattern as the lobby invite-link copy).
- Everything in the text comes from data already public at results (winner, thiefId, roles, wins) plus the viewer's own record — no secrets, and results are final when the button exists.
- i18n: `shareResults`, `shareCopied`, `shareHeader(code, round)` in EN + VI. All other lines reuse existing dict keys so the summary matches the on-screen wording exactly.

## Acceptance tests
- Browser full-round self-play extended: on the results screen, click the share button and read the clipboard (Playwright clipboard permission) — assert it contains the room code, the winner headline and the thief line in Vietnamese.
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p).
