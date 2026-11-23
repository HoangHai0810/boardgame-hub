# PROMPT — Cycle 10: Release hardening (dead-broker cleanup + README accuracy)

## Goal
Close the loop's two oldest hygiene items and ship a clean final release: (1) remove the permanently dead Eclipse MQTT broker from the connection race; (2) bring the README back to an accurate description of the shipped game.

## Rules
- `client/src/net-mqtt.ts`: remove `'wss://mqtt.eclipseprojects.io:443/mqtt'` from `BROKERS`. Update the header comment so the history stays truthful (v11 raced in parallel because the sequential chain wasted ~9s on the retired Eclipse broker; Cycle 10 removes it from the list entirely). The remaining four brokers (EMQX, HiveMQ, EMQX-CN, Mosquitto) and the parallel-race logic are unchanged; `?broker=` override behavior unchanged.
- `README.md`: rewrite the feature/architecture/testing sections to the current shipped state (v22 + this cleanup):
  - features: roles incl. followers per player count + Fall Mouse, session scoreboard, sound effects, quick reactions + preset phrases, night recap, host kick, discussion-length option, localized network messages (EN/VI throughout), personal session record, shareable results summary;
  - transports: MQTT default (4 public brokers raced in parallel, ECDH + AES-GCM private channels, QoS 1), Socket.IO server mode (`?server=`), PeerJS (`?net=peer`); the honest malicious-host note stays;
  - testing: current battery tallies (logic 32, socket integration 23, QA probe 33, MQTT transport 14, browser self-plays) and how to run them;
  - keep the rules summary and the "how to play" content accurate (unchanged rules).
- No gameplay, protocol or UI changes in this cycle.

## Acceptance tests
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p) on the final build.
- The complete browser check suite passes once more on the final build: selfplay6 (MQTT round), selfplay-full (socket round incl. scoreboard/recap/record/share), kick, options, host-gone.
- Live bundle hash verified after deploy; LOOP-LOG completed; FINAL-REPORT.md written.
