# FINAL REPORT — Cheese Thief 10-Cycle Improvement Loop

**Product:** Chuột Phô Mai (Cheese Thief) — https://hoanghai0810.github.io/cheese-thief-game/
**Repo:** HoangHai0810/cheese-thief-game
**Loop span:** v13 → **v23** · **Final live bundle: `assets/index-CToLKBqm.js`** (verified by polling the live site)
**Method per cycle:** production report → full test battery → prioritized bug list (P0/P1 fixed before features) → cited market research → self-contained implementation prompt (`loop/PROMPT-CYCLE-NN.md`) → implement → full battery + real-browser self-play → deploy → live-hash verification. One improvement per cycle; no cycle ever deployed a red build.

## The 10 cycles

| # | Version | What shipped | Headline verification |
|---|---------|--------------|-----------------------|
| 1 | v14 | Production QA audit; stale README rewritten (it claimed followers were cut and used pre-v10 names/counts); QA-probe hang diagnosed (it awaited acks the server never sends — probe bug, fixed with fire-and-forget + watchdog); flaky socket-integration assertion fixed. **Feature: session scoreboard** (🏆 wins per player, scored inside `resolveVotes`, shown on chips + lobby/results standings) | Logic 25→30 tests; battery 30/23/26/14/9; full-round browser self-play with screenshot-verified standings |
| 2 | v15 | **Synthesized sound effects** — the 🔊 toggle was dead UI controlling nothing (P2). WebAudio synth cues (hour/wake/steal/morning/vote/win/lose/pop), persistent mute | Sound self-play: exactly 10 cues unmuted across 2 rounds on all pages, 0 muted |
| 3 | v16 | **Quick reactions + preset phrases** — 8 emoji reactions (big-render) and 4 quick-chat phrases sent as QC tokens, rendered in each viewer's own language (zero protocol change) | Cross-language re-render verified live (VI-sent phrase renders EN after language switch) |
| 4 | v17 | **Post-game night recap** — hour-by-hour timeline (wakes, steal, witnesses, inspections, recruitments) recorded inside the authoritative logic; exposed in `publicState` **only at results** (it contains dice values — leakage-tested) | Logic 32; full self-play 10/10 with recap assertions + screenshot |
| 5 | v18 | **Host kick in the lobby** (host-only, lobby-only, all 3 transports; kicked player lands on the home screen with a localized notice and may rejoin). Fixed two real P1s found en route: rejoin-after-leave silently hung on MQTT (`joinedFired` never reset), and App URL rewrites dropped `?broker=`/`?server=`/`?net=` overrides; plus a P2 (kick control unclickable inside a disabled chip button) | Browser kick test 6/6; probe +3 kick checks (29) |
| 6 | v19 | **Room option: discussion length** — host picks 60/120/180s in the lobby; both engines' day timers honor it; guests see it live | Probe +4 checks (33) incl. day-timer delta; browser options check 3/3 |
| 7 | v20 | **All network error/status messages localized** — transports + server emit language-neutral codes (HOST_GONE, ROOM_FULL, …), App localizes at render (15 new dict keys EN+VI); pending messages now re-render on language switch | Browser host-gone check 2/2 (VI message via MQTT last-will) |
| 8 | v21 | **Personal session record** — my W/L split by dealt role (Among-Us-profile format), client-side, de-duplicated per round, reusing the sound cue's win determination | Full self-play 12/12; screenshot-verified panel |
| 9 | v22 | **Shareable results summary** — Wordle-style copy-to-clipboard text (header, winner, thief, standings, my record, game link), fully localized | Full self-play 13/13 incl. real clipboard read-back |
| 10 | v23 | **Release hardening** — dead Eclipse broker pruned from the connection race; README refreshed to the shipped feature set and current test tallies | Entire gate re-run green on the final build (below) |

## Final test tallies (v23 build, all run at the end of Cycle 10)
- Logic tests: **32/32**
- Socket.IO integration: **23/23**
- QA probe (2 rooms, 8p round, security + reliability): **33/33**
- MQTT transport (shipped client code vs real broker): **14/14**
- Browser self-play, 6 players over MQTT: **9/9**
- Browser self-play, full round over Socket.IO (scoreboard/recap/record/share assertions): **13/13**
- Browser checks: kick **6/6** · discussion option **3/3** · host-gone localization **2/2**
- **Total: 145 checks green, 0 failing.**

## Bugs found & fixed across the loop
P1: rejoin-after-leave hang (MQTT `joinedFired`); URL rewrites dropping transport overrides. P2: stale README (twice — Cycles 1 and 10); hung QA probe (ack misuse); flaky integration assertion (same-target double inspection); dead sound toggle; unclickable kick control (disabled-button click swallowing); dead Eclipse broker in the race; English-only transport messages. No P0s were found; production rules/security posture (no secrets in public state, verified by leakage assertions every cycle) held throughout.

## Remaining limitations (honest)
1. **Production multiplayer cannot be executed from this sandbox** — the egress proxy TLS-intercepts and breaks WSS to the public brokers. All multiplayer verification uses local equivalents running the *identical* shipped code and protocol (local aedes broker for MQTT mode, local Socket.IO server), plus live bundle-hash polling. A real-device production round remains the one check only a human on the open internet can do.
2. **A malicious host can cheat in the default MQTT mode** — the host browser is authoritative (documented in-game and in the README). The dedicated Socket.IO server mode (`?server=`) removes this and is the trusted-referee option; it is not the public default because GitHub Pages cannot host it.
3. **PeerJS mode** is verified by code inspection + the shared HostEngine tests; WebRTC is blocked in this sandbox, so it has no live browser verification.
4. Timers/scoring are session-scoped by design (no accounts, no persistence) — the scoreboard and personal record reset on page reload.

## Release recommendation
**Ship v23 as the stable release.** The full 145-check gate is green on the exact deployed bundle (`assets/index-CToLKBqm.js`), the feature set is coherent (lobby management, pacing options, communication, feedback, progression, sharing), and the known limitations are architectural and documented rather than defects. Suggested next steps if the loop continues: a human production-multiplayer smoke test on real devices, then persistent stats only if accounts are ever introduced.
