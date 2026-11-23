# CYCLE 01 — Production QA audit baseline + README truth fix + session scoreboard

## 1. REPORT — production state at cycle start (v13, bundle `assets/index-DDaGwDQH.js`)

### Actual production architecture (source-inspected + previously executed tests)
- **Hosting:** static GitHub Pages from repo `HoangHai0810/cheese-thief-game`. No server runs in production by default.
- **Default transport: MQTT over WSS.** The host player's browser runs the authoritative engine (`client/src/hostEngine.ts` over `shared/logic.ts`); the public MQTT broker is only a message bus.
- **Brokers:** raced **in parallel**, first connection wins (v11): EMQX `wss://broker.emqx.io:8084/mqtt`, HiveMQ `wss://broker.hivemq.com:8884/mqtt`, EMQX-CN `wss://broker-cn.emqx.io:8084/mqtt`, Eclipse `wss://mqtt.eclipseprojects.io:443/mqtt` (believed retired — kept as a harmless extra racer), Mosquitto `wss://test.mosquitto.org:8081`. All publishes/subscribes **QoS 1**.
- **Alternate transports:** Socket.IO dedicated server (`server/`, same engine) only when the URL carries `?server=<url>`; PeerJS/WebRTC with `?net=peer`.
- **Private data:** per-player ECDH P-256 key exchange + AES-GCM encrypted private snapshots on per-player MQTT topics. Public state is plaintext on the room topic but contains **no secrets by construction** (`publicState()` never includes role/dice/vote targets before results) — verified by leakage assertions in logic tests, socket integration and the QA probe.
- **Host disconnect:** the host's MQTT last-will publishes `hostGone`; the room closes. Host must stay online — stated in UI/README.
- **Reconnection:** by browser session id (sessionStorage clientId); a rejoining player is re-attached to their seat.

### Security truth (stated, not hidden)
- A **passive observer** of the broker cannot read roles/dice/inspection results (ECDH+AES-GCM) and learns nothing from public state before results.
- A **malicious host CAN cheat**: the host browser is authoritative — it deals roles/dice and could in principle read or manipulate all state. This is an inherent limit of the host-authoritative design on static hosting, NOT complete anti-cheat. The dedicated Socket.IO server mode removes this (server is authoritative) but is not the public default.

### Rules implemented (vs official Cheese Thief)
- 4–8 players, 1 thief (**Chuột Phô Mai**), villagers (**Chuột Làng**), dice 1–6 = wake hour; night hours 1–6, 12 s each; night starts only when ALL players ready (45 s fallback).
- Lone waker may inspect exactly one other player's dice; multiple wakers = no inspect, they see each other.
- **Followers (official):** 5p — a lone witness of the steal converts instantly; multiple witnesses → thief picks one during that hour (timeout auto-picks). 6p — recruit phase after hour 6, thief picks 1, follower knows the thief. 7p — picks 2, followers know each other but NOT the thief. 8p — picks 2, all three know each other. Followers win/lose with the thief.
- **Fall Mouse (Chuột Chết):** dealt only at 6–8p (replaces one villager card); plays the night like a villager; if top-voted (ties count, even as a follower) wins ALONE, priority over catching the thief.
- Day: 2 min discussion (chat open; skips early only when ALL players press ready-to-vote), 60 s simultaneous secret vote, no self-vote, no changes. Tie incl. thief = thief caught; tie without thief = thief wins (unless Fall Mouse is in the top group → Fall Mouse wins alone).
- Chat open in lobby/day/results; locked at night/recruit/voting (v13).
- Digital adaptations: fixed timers instead of a narrator; thief is not forced to steal (if they don't press steal in their 12 s hour, the cheese stays and the game proceeds); recruit phase is a 20 s timed UI instead of the physical hand-touch ritual.

### Environment limitation (honest)
This sandbox's egress proxy breaks WSS to the public brokers, so a live production multiplayer round **cannot be executed from here**. Production verification = local equivalents with identical code/protocol (MQTT transport test against a local broker, browser self-play of the shipped bundle over a local broker / local Socket.IO server) + live bundle-hash polling. No production multiplayer result is claimed beyond that.

## 2. RE-TEST — full battery on v13 (baseline)
All green: **logic 25/25 · socket integration 23/23 · QA probe 26/26 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- **P1 — README.md stale (documentation lies about the product):** says followers variant "not included in this MVP" (implemented in v10), uses retired names (Thief/Sleepyheads, title "Kẻ Trộm Phô Mai" instead of Chuột Phô Mai / Chuột Làng / Chuột Chết), describes the OLD sequential broker order (Eclipse 443 first) instead of the parallel race, says logic tests = 13 (now 25), tie-rule text omits Fall Mouse priority, no mention of lobby chat (v13) or the recruit phase. → Fixed in this cycle (full README rewrite to match v13).
- **P2 — QA probe hang (test tooling, not the game):** `/tmp/ctv/qa-probe.mjs` awaited Socket.IO ack callbacks for events the server never acks (only createRoom/joinRoom are acked; the real client emits the rest fire-and-forget). It hung silently forever (a background interval kept the process alive). Diagnosed from the parent's hung run (0 CPU, stuck after "lobby holds 8 players"). → Fixed: fire-and-forget `send()` for non-acked events + 200 s watchdog. Probe now completes: **26/26 PASS in ~13 s** (8-player round incl. recruit, leakage checks, unauthorized actions, room isolation, disconnect-during-voting).
- **P2 — Eclipse broker entry is dead weight:** `mqtt.eclipseprojects.io` no longer answers (probed: timeout; EMQX answers HTTP 400). Harmless inside the parallel race but misleading. → Kept for now (zero cost in a race); noted for a future cleanup cycle.

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Goose Goose Duck** (Steam/store listings + reviews): post-match displays and a previous-game summary are valued for untangling chaotic rounds; session continuity keeps groups playing.
- **KallanCop** (social-deduction party game, uthakkan.in): headline features include "real-time score tracking" and an "automated multi-round scoreboard [that] tracks points across the whole evening so no one has to keep score on paper".
- **Friends That Game** (friendsthat.app): live leaderboard with Before/This Round/After breakdown, round winners get a 👑, "Play again — one tap from the final scoreboard", shareable results.
- **Werewolf Cup**: multi-game score tracking with per-role points is its core selling point.
- **Party-game design literature** (gamedesign.gg, "Social and Party Game Design"): the "one-more-round loop" — short rounds, a legible result, and a low-friction path to going again — is what keeps a group playing for hours.
→ Our game already had one-tap Play Again in the same room but forgot every result instantly. **Chosen improvement: a session scoreboard** (rounds won per player, 👑 for the leader, shown in lobby + results). See PROMPT-CYCLE-01.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-01.md)
- **Session scoreboard** implemented in `shared/logic.ts` (`Player.wins`, scored inside `resolveVotes()` with a double-call guard; exposed via `publicState()`), so all three transports get it with zero engine changes. UI: 🏆 ×N on player chips, standings box (sorted, 👑 leader) in lobby and on results, i18n keys in EN + VI.
- **README.md fully rewritten** to match v13 reality (P1 fix): correct names (Chuột Phô Mai / Chuột Làng / Chuột Chết), followers + Fall Mouse rules per player count, parallel broker race, honest malicious-host statement, lobby chat, current test counts (25/14/23).
- **Bonus test-tooling fix (P2):** the flaky socket-integration inspection assertion (see §3 addendum) replaced with an exact sender-set privacy assertion; suite re-run 3× → 23/22/23, no failures (22 = no lone waker that round, conditional check skipped).

### §3 addendum — flaky test found during this cycle's re-test
- **P2 — socket integration "lone sleepyhead inspected" assertion was wrong, not the game:** the old assertion failed whenever two lone wakers in one night peeked at the SAME target (each legitimately holds their own result). Dice-dependent → flaky (failed 1 of 2 battery runs; baseline had passed). Fixed by tracking which clients actually sent an inspect action and asserting the result-holder set equals the sender set exactly. The game's privacy behaviour was correct throughout (probe leakage checks also green).

## 6. RESULTS
- Battery after implementation: **logic 30/30** (25 + 5 new scoreboard tests) · **socket 23/23** (×3 stability runs: 23/22/23, no failures) · **QA probe 26/26** · **MQTT transport 14/14** · **browser self-play 6p 9/9** · **browser full-round self-play 4p 8/8** (new script `selfplay-full`: steal → vote → results → play again).
- Screenshot evidence (visually verified): results screen shows "🏆 Số ván thắng cả buổi — BF3 👑 — 🏆 ×1" and the winner's chip carries 🏆 ×1; round-2 lobby keeps the standings.
- Deployed as **v14**, bundle `assets/index-Pww2Q6Pz.js`, live hash verified by polling.
