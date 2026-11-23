# LOOP LOG — Cheese Thief 10-cycle improvement loop (started 2026-11-23)

| Cycle | Version | Improvement shipped | Battery (logic/socket/probe/mqtt/selfplay) | Live bundle |
|---|---|---|---|---|
| 01 | v14 | Session scoreboard (🏆 wins per player, lobby + results) + README rewritten to match reality + flaky inspect-assertion fixed | 30 / 23 / 26 / 14 / 9+8 | index-Pww2Q6Pz.js |
| 02 | v15 | WebAudio synthesized sound effects (8 event cues) behind the previously dead mute toggle; mute persisted | 30 / 23 / 26 / 14 / 9 + sound 2-round OK | index-_4qnQueh.js |
| 03 | v16 | Quick reactions (8 emoji, big render) + 4 preset quick-chat phrases sent as QC tokens, rendered localized per viewer | 30 / 23 / 26 / 14 / 9 + react OK | index-DSCOT0fP.js |
| 04 | v17 | Post-game night recap timeline (wakes/steal/witness/inspect/recruit), exposed only at results | 32 / 23 / 26 / 14 / 9 + full 10/10 | index-DeXHKApO.js |
| 05 | v18 | Host kick in the lobby (all 3 transports) + fixed rejoin-after-leave hang (joinedFired) and URL rewrites dropping transport overrides | 32 / 23 / 29 / 14 / 9 + kick 6/6 | index-DJFMS9mj.js |
| 06 | v19 | Room option: host sets discussion length (60/120/180s) in the lobby, live for everyone | 32 / 23 / 33 / 14 / 9 + options 3/3 | index-w47DCenk.js |
| 07 | v20 | All network error/status messages localized via language-neutral codes (15 new dict keys EN+VI) | 32 / 23 / 33 / 14 / 9 + hostgone 2/2 | index-Cl0C0Vmf.js |
| 08 | v21 | Personal session record (my W/L split by dealt role) on results + lobby | 32 / 23 / 33 / 14 / 9 + full 12/12 | index-aOFTf1-6.js |
| 09 | v22 | Shareable results summary (Wordle-style copy-to-clipboard, localized) | 32 / 23 / 33 / 14 / 9 + full 13/13 | index-Cw6vSN2M.js |
