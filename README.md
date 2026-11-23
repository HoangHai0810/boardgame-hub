# 🧀 Chuột Phô Mai (Cheese Mouse)

A real-time multiplayer social deduction game for **4–8 players**, implementing the mechanics of *Cheese Thief* (2020) including the official **Follower** rules and the **Fall Mouse** variant. One secret Cheese Mouse steals the cheese at night; the Village Mice wake by dice number, investigate, discuss, and vote.

**▶ Play now: https://hoanghai0810.github.io/cheese-thief-game/** — create a room, share the invite link or 5-letter code, play. No install, works on mobile. Vietnamese + English UI.

## Roles
- 😈 **Chuột Phô Mai (Cheese Mouse)** — the thief. Steals the cheese on their dice hour.
- 🐭 **Chuột Làng (Village Mouse)** — wakes at their dice hour; a lone waker may peek at exactly one other player's dice.
- 💀 **Chuột Chết (Fall Mouse)** — 6–8 player games only: secretly replaces one Village Mouse card. Plays the night exactly like a Village Mouse, but **wins alone if they receive the most votes** (ties count, even as a Follower, even tied with the thief).
- 🤝 **Follower (đồng minh)** — a Village-side player recruited to the thief's team (see below). Wins and loses with the Chuột Phô Mai.

## How to play (1 minute)
1. Everyone secretly gets a **role** and a **dice number (1–6)**. Exactly one player is the Chuột Phô Mai.
2. **Night:** hours 1–6 are called in order (12 s each), starting only when **everyone** has confirmed their role card (45 s fallback). Players whose dice matches the hour wake up.
   - The **Chuột Phô Mai** steals the cheese on their hour.
   - A **villager who wakes up alone** may peek at exactly one other player's dice. If several wake together, no peeking — but they see each other awake, and whether the cheese is already gone.
3. **Followers (official rules):**
   - **5 players:** a villager who *witnesses* the steal (awake at the thief's hour) switches sides on the spot. One witness → they become the Follower; several witnesses → the thief secretly picks one, the others learn who it was.
   - **6 players:** after hour 6 the thief secretly recruits **1** Follower, who learns who the thief is.
   - **7 players:** the thief recruits **2** Followers; the two Followers learn each other but **not** who the thief is.
   - **8 players:** the thief recruits **2** Followers; all three learn each other.
4. **Day:** the cheese is gone! Discuss in the real-time chat (2 min). Discussion ends early only when **all** players press "ready to vote"; the host can also end it.
5. **Voting:** simultaneous secret vote (60 s), no self-vote, no changing. Most votes = accused.
   - Chuột Phô Mai accused → **villagers win**. Anyone else accused → **thief's team wins**.
   - **Tie rule:** a tie that includes the thief counts as caught; a tie without the thief → thief wins.
   - **Fall Mouse priority:** if the Chuột Chết is in the top-voted group, they win **alone**, ahead of every other outcome.
6. **Play Again** keeps the room, code and players; roles/dice are re-randomised. A session scoreboard (🏆) tracks rounds won per player for the whole room session.
7. **Chat** is open in the lobby, during the day discussion and on the results screen; it is locked at night, during recruitment and while voting.

## Architecture
- `shared/logic.ts` — the single authoritative rules engine (roles, dice, night actions, inspection eligibility, followers, Fall Mouse, voting, tie-breaks, win scoring, public/private state separation). `publicState()` contains no role/dice/vote secrets before results; `privateState()` is only ever sent point-to-point to its owner.
- `server/` — Node + TypeScript + **Socket.IO** dedicated server running the same engine server-side (room isolation, host migration, reconnection by session id, abandoned-room cleanup, chat spam guard). Run it with `npm install && npm run build && npm start` (port 3001).
- `client/` — React + TypeScript + Vite + Tailwind. Transports behind one interface:
  - **MQTT-over-WebSocket mode (default on the public site)** — see adaptation note below. The client races several public brokers **in parallel** and uses the first that connects (EMQX, HiveMQ, EMQX-CN, Eclipse, Mosquitto). Public state rides the room topic at **QoS 1**; private data is **ECDH (P-256) + AES-GCM** encrypted per player, so a passive observer of the bus cannot read roles/dice (Diffie–Hellman).
  - **Socket.IO mode** when opened as `?server=<your-server-url>` — dedicated-server play.
  - **PeerJS/WebRTC mode** with `?net=peer` — same host engine over WebRTC data channels (note: WebRTC is blocked outright in some networks/browsers).

## Digital adaptation (deliberate, documented)
The public site is hosted on static GitHub Pages, which cannot run a Socket.IO server. So in the default public mode the **host's browser runs the exact same authoritative engine** (`shared/logic.ts`) as a host-authoritative peer, with messages carried by a public MQTT broker over secure WebSocket: the host assigns roles/dice, validates every action, broadcasts only `publicState()` (which contains no secrets), and sends each player's secrets **only as ECDH+AES-GCM ciphertext addressed to that player** — clients cannot read each other's private state from any broadcast.

Honest consequences:
- The host must stay online for the room's life (host disconnect closes the room via MQTT last-will, and the UI says so). Session recovery works by rejoining with the same browser session.
- **A malicious host can cheat.** Because the host browser is authoritative in public mode, a modified host client could read or manipulate all game state. The encryption protects against *passive observers of the broker*, not against the host. For a fully trusted referee, deploy `server/` anywhere Node runs and open the client with `?server=` — there the dedicated server is authoritative.

Other adaptations vs. the physical game: fixed timers instead of a narrator (night hour 12 s, discussion 120 s, voting 60 s, recruit 20 s); the recruit phase is a timed secret UI instead of the physical hand-touch ritual; the thief is not forced to steal (if they don't act within their 12 s hour, the cheese stays and the game continues); wakers privately see whether the cheese is already gone when they wake (equivalent to opening your eyes at the table); chat is a continuous room conversation and is not wiped between rounds.

## Tests
- `tests/logic.test.mjs` — 25 rules tests (role/dice distribution, secret leakage, lone-waker inspection, multi-waker block, steal timing, vote integrity, all tie cases, follower witness/recruit/information rules per player count, Fall Mouse dealing + solo wins). Run: compile `shared/logic.ts` to `shared/logic.mjs` with esbuild, then `node tests/logic.test.mjs` (delete `shared/logic.mjs` afterwards — if left in place it shadows the `.ts` source for Vite and breaks the client build).
- `tests/mqtt.transport.test.mjs` — 14 checks: the shipped public transport itself (compiled from `client/src`), 4 simulated players against a real MQTT broker (aedes) play a complete round — join, encrypted role delivery, all-ready night start, steal, private inspection, ready-to-vote discussion skip, results. Note: some sandboxes' egress proxies block the public brokers, so this test runs against a local broker with identical protocol/topics/encryption.
- `tests/socket.integration.mjs` — 23 checks: real Socket.IO server, 5 simultaneous clients play a complete round (create/join/rejections, role secrecy, night steal + private inspection, live chat, voting, results, late-join rejection, play-again, reconnection). Run the server with fast-timer env (`CT_HOUR_MS=700 CT_DISCUSSION_MS=3000 CT_VOTE_MS=3000 CT_RECRUIT_MS=1500 PORT=3109`) then `node tests/socket.integration.mjs`.
- QA probe (8-player round + security/reliability assertions) and a 10-cycle improvement loop log live under `loop/`.

## Tech
React 18 · TypeScript · Vite · Tailwind CSS · Socket.IO · PeerJS (WebRTC) · MQTT.js. No database needed — rooms are ephemeral by design (PostgreSQL unnecessary for session-only state).
