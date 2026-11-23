# CYCLE 08 — Personal session record (my wins/losses by role)

## 1. REPORT — production state at cycle start (v20, bundle `assets/index-Cl0C0Vmf.js`)
Architecture unchanged (CYCLE-01 §1). Since then: scoreboard (v14), sound (v15), reactions (v16), night recap (v17), host kick + rejoin fixes (v18), discussion option (v19), localized network messages (v20).
Inspection: the Cycle 1 scoreboard shows the ROOM's standings (who won the most rounds), but a player has no view of their own trajectory: how many rounds *I* won or lost tonight, and whether I'm any good as the Cheese Mouse vs as a villager. Social-deduction regulars track exactly this ("my impostor win rate") — it's the personal-progression hook that makes a group play "one more round" with roles re-dealt.

## 2. RE-TEST — full battery on v20 (baseline)
All green: **logic 32/32 · socket 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- No P0/P1/P2 defects found this cycle. Gap addressed: no personal progression view (only the room standings exist).

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Among Us player profiles** (e.g. the Ranked/GoodLoss stat pages) headline a player's record **split by role**: "Crewmate 269 wins / 348 games (77%) · Impostor 13 wins / 82 games (16%)" plus an overall win rate — the per-role record is the identity stat regulars compare, and the game's own statistics screen tracks role counts and win types the same way.
→ Chosen improvement: a **personal session record** — my W/L total plus wins/games per dealt role — on the results screen and in the lobby. See PROMPT-CYCLE-08.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-08.md)
- Purely client-side (no protocol/engine change): the App records each round at the transition into `results`, reusing the exact win determination the Cycle 2 sound cue already computes (followers win/lose with the thief; Fall Mouse only alone). De-duplicated per `${roomCode}:${round}` so re-broadcasts never double-count; rounds only count when the player's role is known (they actually played).
- New `MyRecord` panel (results screen + lobby, under the room Standings): "📊 Thành tích của bạn — Thắng W · Thua L" plus per-role chips (🐭 Chuột Làng w/g · 😈 Chuột Phô Mai w/g · 💀 Chuột Chết w/g). Session-scoped like the room scoreboard. i18n keys in EN + VI.

## 6. RESULTS
- **Browser full-round self-play extended: 12/12** — record panel on results matches the actual outcome (screenshot verified: host was the thief, "Thắng 0 · Thua 1 — 😈 CHUỘT PHÔ MAI 0/1") and persists into the round-2 lobby. (Two driver-side fixes during verification: phase sampling moved inside the driver loop, and the steal assertion now confirms via the morning "bị TRỘM" headline instead of trusting a click that can race the 1.5s test hour.)
- Battery after implementation: **logic 32/32 · socket 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p 9/9**.
- Deployed as **v21**, bundle `assets/index-aOFTf1-6.js`, live hash verified by polling.
