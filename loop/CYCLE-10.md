# CYCLE 10 — Release hardening: dead-broker cleanup + README accuracy

## 1. REPORT — production state at cycle start (v22, bundle `assets/index-Cw6vSN2M.js`)
Architecture unchanged (CYCLE-01 §1). The loop so far: scoreboard (v14), sound (v15), reactions (v16), night recap (v17), host kick + rejoin fixes (v18), discussion option (v19), localized network messages (v20), personal record (v21), share summary (v22).
Final-cycle inspection — two leftover hygiene items:
- **Dead broker in the race list (P2, open since Cycle 1):** `mqtt.eclipseprojects.io` no longer answers (noted in the code's own comment) yet every client still spends a parallel connection attempt on it at every connect. The race tolerates it, but it is dead weight and noise in every connection log.
- **README drift (P2):** the README was rewritten in Cycle 1 (v13/v14 state). Nine releases later it no longer mentions most shipped features and its test counts are stale — the same class of defect Cycle 1 fixed, re-accumulated.

## 2. RE-TEST — full battery on v22 (baseline)
All green: **logic 32/32 · socket 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p 9/9.**

## 3. BUG LIST
- P2: dead Eclipse broker still in the connection race (fix this cycle).
- P2: README stale again (fix this cycle).
- No P0/P1 found this cycle.

## 4. MARKET ANALYSIS
Findings (browser research, 2026-11-23):
- **Happy Eyeballs (RFC 8305)** validates the parallel-race design — race candidates, first success wins, losers are cancelled — and operational practice around it is to keep the candidate list full of *plausible* endpoints: a "DNS record pointing at a decommissioned host" is the canonical example of a candidate that should be pruned, since every connect still spends an attempt (socket, TLS state, log noise) on it. The remaining four brokers keep the race's resilience intact.
→ Chosen improvement: prune the dead Eclipse endpoint + refresh the README to the shipped truth. See PROMPT-CYCLE-10.md.

## 5. IMPROVEMENT (from PROMPT-CYCLE-10.md)
- `net-mqtt.ts`: Eclipse (`wss://mqtt.eclipseprojects.io:443/mqtt`) removed from `BROKERS`; header comment updated so the v11 history stays truthful. Race logic, QoS and the `?broker=` override unchanged.
- `README.md`: discussion length now documented as host-configurable (1/2/3 min); a new "Session & social features" section covers the scoreboard + personal record, night recap, sound, host tools, share-result and full bilingual coverage; architecture broker list corrected; test section updated (logic 32, probe 33, browser self-plays, loop docs).

## 6. RESULTS — final release gate, all on the v23 build
- Battery: **logic 32/32 · socket integration 23/23 · QA probe 33/33 · MQTT transport 14/14 · browser self-play 6p (MQTT) 9/9**.
- Full browser suite: **selfplay-full (Socket.IO round incl. scoreboard/recap/record/share) 13/13 · kick 6/6 · options 3/3 · host-gone localization 2/2**.
- Deployed as **v23**, bundle `assets/index-CToLKBqm.js`, live hash verified by polling.
