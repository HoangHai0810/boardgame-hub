# 🧀 Cheese Thief — Kẻ Trộm Phô Mai

A real-time multiplayer social deduction game for **4–8 players**, inspired by the core mechanics of *Cheese Thief* (2020). One secret Cheese Thief steals the cheese at night; the Sleepyheads wake by dice number, investigate, discuss, and vote.

**▶ Play now: https://hoanghai0810.github.io/cheese-thief-game/** — create a room, share the invite link or 5-letter code, play. No install, works on mobile.

## How to play (1 minute)
1. Everyone secretly gets a **role** and a **dice number (1–6)**. Exactly one player is the Thief.
2. **Night:** hours 1–6 are called in order (12s each). Players whose dice matches wake up.
   - The **Thief** steals the cheese on their hour.
   - A **Sleepyhead who wakes up alone** may peek at exactly one other player's dice. If several wake together, no peeking — but they see each other awake (and whether the cheese is already gone).
3. **Day:** the cheese is gone! Discuss in the real-time chat (2 min, host can end early).
4. **Voting:** simultaneous secret vote, no self-vote, no changing. Most votes = accused.
   - Thief accused → **Sleepyheads win**. Anyone else → **Thief wins**.
   - **Tie rule:** a tie that includes the Thief counts as caught; a tie without the Thief → Thief wins.
5. **Play Again** keeps the room, code and players; roles/dice are re-randomised.

## Architecture
- `shared/logic.ts` — the single authoritative rules engine (roles, dice, night actions, inspection eligibility, voting, tie-breaks, public/private state separation). `publicState()` provably contains no role/dice/vote secrets before results; `privateState()` is only ever sent point-to-point to its owner.
- `server/` — Node + TypeScript + **Socket.IO** dedicated server implementing the same engine server-side (room isolation, host migration, reconnection by session id, abandoned-room cleanup, chat spam guard). Run it with `npm install && npm run build && npm start` (port 3001).
- `client/` — React + TypeScript + Vite + Tailwind. Two transports behind one interface:
  - **Socket.IO mode** when opened as `?server=<your-server-url>` — dedicated-server play.
  - **PeerJS/WebRTC mode (default on the public site)** — see adaptation note below.

## Digital adaptation (deliberate, documented)
The public site is hosted on static GitHub Pages, which cannot run a Socket.IO server. So in the default public mode the **host's browser runs the exact same authoritative engine** (`shared/logic.ts`) as a host-authoritative peer over WebRTC (PeerJS Cloud signalling): the host assigns roles/dice, validates every action, and sends each player's secrets **only over that player's own encrypted data channel** — clients cannot read each other's private state from any broadcast, because broadcasts only ever contain `publicState()`. Consequences: the host must stay online for the room's life (host disconnect closes the room, and the UI says so), and session recovery works by rejoining with the same browser session. For fully independent hosting, deploy `server/` anywhere Node runs and open the client with `?server=`.

Other adaptations vs. the physical game: fixed timers instead of a narrator (night hour 12s, discussion 120s, voting 60s); the physical "followers" variant roles are not included in this MVP; wakers privately see whether the cheese is already gone when they wake (equivalent to opening your eyes at the table).

## Tests
- `tests/logic.test.mjs` — 13 rules tests (role/dice distribution, secret leakage, lone-waker inspection, multi-waker block, steal timing, vote integrity, all tie cases). Run: compile `shared/logic.ts` to `shared/logic.mjs` with tsc, then `node tests/logic.test.mjs`.
- `tests/socket.integration.mjs` — 20 checks: real Socket.IO server, 5 simultaneous clients play a complete round (create/join/rejections, role secrecy, night steal + private inspection, live chat, voting, results, late-join rejection, play-again, reconnection). Run the server with fast-timer env (`CT_HOUR_MS=700 CT_REVEAL_MS=1500 PORT=3109`) then `node tests/socket.integration.mjs`.

## Tech
React 18 · TypeScript · Vite · Tailwind CSS · Socket.IO · PeerJS (WebRTC) · Node/Express. No database needed — rooms are ephemeral by design (PostgreSQL unnecessary for session-only state).
