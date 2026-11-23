# CYCLE 07 — Localize all network error/status messages

## 1. REPORT — production state at cycle start (v19, bundle `assets/index-w47DCenk.js`)
Architecture unchanged (CYCLE-01 §1). Since then: scoreboard (v14), sound (v15), reactions (v16), night recap (v17), host kick + rejoin fixes (v18), discussion-length room option (v19).
Inspection: the UI is fully bilingual (EN/VI) — except the transport layer. Every connection error and status string is hard-coded English in `net.ts` / `net-mqtt.ts` (host-left, room-full, game-started, host-unreachable, network-unreachable, room-not-found, disconnect, WebRTC-blocked, connection-error, creating/connecting statuses), plus the Socket.IO server's ack errors ('Room not found', 'Game already started', 'Room is full (8)') and its 'Need at least 4 players' message. For the game's primary Vietnamese audience, the most stressful moments (a failed join, a dropped host) are exactly the ones that show a foreign language.

## 2. RE-TEST — full battery on v19 (baseline)
All green: **logic 32/32 · socket 23/23 · QA probe 33/33** (baseline run) · **MQTT transport 14/14 · browser self-play 6p 9/9** (v19 state, identical to the Cycle 6 after-run). Process note: the baseline run's MQTT stage was starved by a manually-started test broker holding port 9001 and was killed; the affected stages were re-verified in the after-run below.

## 3. BUG LIST
- **P2 (i18n defect): all transport error/status messages are English-only** — listed in §1. Fixed this cycle by converting them to language-neutral codes rendered through the i18n dict (the same pattern Cycle 3 used for quick-chat tokens and Cycle 5 for KICKED).
- No P0/P1 found this cycle.

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- Game-localization best practice (TranscribeLingo guide; developer localization notes): localization covers "menus, items, quests, tutorials, **system messages**, achievements" — the working rule is **"if the player can see it, localize it"**, explicitly including **alerts, status messages and error messages**; and strings should be referenced by **stable identifiers (keys), not by the current English phrase** — precisely the code-based indirection this cycle adopts.
→ Chosen improvement: convert every transport error/status string to a language-neutral code, localized at render. See PROMPT-CYCLE-07.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-07.md)
- Codes emitted by all transports + server: HOST_GONE, ROOM_FULL, GAME_STARTED, ROOM_NOT_FOUND, HOST_UNREACHABLE, NET_UNREACHABLE, SERVER_UNREACHABLE, HOST_DISCONNECTED, PEER_BLOCKED, CONN_ERROR:<detail>, NEED_MORE_PLAYERS, FAILED, STATUS_CREATING, STATUS_CONNECTING:<code> (KICKED already coded in Cycle 5). Server ack errors and its startGame errorMsg converted too.
- App: one `localizeMsg()` helper applied at both error render sites, the status line and the loading fallback; unknown messages render verbatim. Dict gained 15 keys in EN + VI (English wording unchanged). Bonus: a pending message now re-renders correctly when the player switches language, since state holds codes, not sentences.

## 6. RESULTS
- **Browser host-gone check (MQTT, local broker): 2/2** — guest joins, host page closes (last-will fires), guest sees "Chủ phòng đã rời — phòng đã đóng. 🏠" in Vietnamese.
- Grep gate: no hard-coded English sentences remain in onError/onStatus call sites in net.ts / net-mqtt.ts.
- Battery after implementation: **logic 32/32 · socket 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p 9/9**.
- Deployed as **v20**, bundle `assets/index-Cl0C0Vmf.js`, live hash verified by polling.
