# CYCLE 05 — Host can kick a player from the lobby

## 1. REPORT — production state at cycle start (v17, bundle `assets/index-DeXHKApO.js`)
Architecture unchanged (CYCLE-01 §1). Since then: scoreboard (v14), sound (v15), reactions (v16), night recap (v17).
Inspection: the host has **no lobby management tool at all**. If a friend goes AFK before the game starts, a stranger with the invite link won't leave, or someone joins with an offensive name, the only remedy is for everyone to abandon the room and make a new one — the room code and all joined players are lost. Every mainstream party game gives the host a kick.

## 2. RE-TEST — full battery on v17 (baseline)
All green: **logic 32/32 · socket 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- Gap addressed (P1-class for a party product): host cannot remove a player from the lobby.
- **P1 found & fixed during implementation — rejoin after leaving silently hung (MQTT transport).** `net-mqtt.ts` kept a factory-level `joinedFired` flag that was never reset, so a second join in the same page session never fired `onJoined`. The normal Leave button masked it by reloading the page; the new kick flow (no reload) exposed it. Fixed: reset the flag in `startHost`/`startClient`.
- **P1 found & fixed during implementation — URL rewrites dropped transport overrides.** `App` rewrote the address bar to `?room=<code>` on join (and the new kick path rewrote it to the bare path), discarding `?broker=` / `?server=` / `?net=`; since `brokerList()` re-reads the URL on every connect, a later rejoin raced the default public brokers instead of the room's transport. Fixed: both rewrites now preserve all other params, and `brokerList()` caches the override on first read.
- **P2 found & fixed during implementation — kick control unclickable.** Lobby player chips render as `disabled` buttons (no `onPick`), and a disabled button swallows clicks on its children, so the new ✖ span could never be clicked. Fixed the chip `disabled` logic (`onPick ? pickable-check : !onKick`).

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Among Us** (Android Central / ScreenRant / Wiki): host kick/ban in the lobby is a core moderation feature — used for offensive names, chat spam and trolls. Crucially, **host-only removal exists only in the lobby; mid-game removal requires a player vote** "to ensure that the host doesn't abuse the power" / "cannot abuse this power during a game to help them win".
→ Chosen improvement: **host kick, lobby-only**, kicked player returns to the landing screen with a notice and may rejoin (kick ≠ ban). Mid-game removal stays with the vote. See PROMPT-CYCLE-05.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-05.md)
- New intent `kick {targetId}`, validated identically in both authorities: **host-only, lobby-only, target ≠ host** (mid-game removal stays with the vote). `HostEngine` (MQTT + PeerJS) removes the player and signals them via a new optional `EngineHooks.sendError(pid, 'KICKED')` (MQTT: plaintext error on the private topic, which the client already routes to `onError`; PeerJS: per-connection error message). The Socket.IO server mirrors it and force-disconnects the kicked socket after 250 ms so it can't act as a ghost (both host transports already drop intents from removed players).
- Client: `onError('KICKED')` leaves the room and returns to the landing screen, where the notice renders localized (`kickedMsg`, EN + VI). Kick is not a ban — the player may rejoin with the code.
- UI: host sees a "✖ Mời ra / Kick" pill on every other player's lobby chip; guests see none.

## 6. RESULTS
- **Browser kick test (MQTT, local broker, real Chromium): 6/6** — room created, guest joins, guest sees no kick control, host kicks → guest lands on the home screen with the localized notice (screenshot verified; name + code retained), host lobby back to 1, guest rejoins successfully.
- QA probe extended with 3 kick checks (non-host attempt ignored; guest receives KICKED; guest removed from lobby).
- Battery after implementation: **logic 32/32 · socket 23/23 · QA probe 29/29 · MQTT transport 14/14 · browser self-play 6p 9/9**.
- Deployed as **v18**, bundle `assets/index-DJFMS9mj.js`, live hash verified by polling.
