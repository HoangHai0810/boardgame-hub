# 🎲 Sảnh Board Game

A multi-boardgame platform that runs in the browser — no install, works on mobile. Pick a game, create a room, share the link or 5-letter code, play.

**▶ Play now: https://hoanghai0810.github.io/boardgame-hub/** — Vietnamese + English UI.

## Games
- 🧀 **Chuột Phô Mai (Cheese Mouse)** — LIVE. Real-time multiplayer social deduction for **4–8 players** (see below).
- 🐺 **Ma Sói (Werewolf)** — LIVE. Classic Werewolf for **6–12 players**: wolves hunt at night, the village votes by day (see below).
- 🃏 **Uno** — LIVE. Classic Uno for **2–10 players** (see below).
- 🐱 **Mèo Nổ (Exploding Kittens)** — LIVE. Exploding Kittens for **2–5 players** (see below).
- 🕵️ **Ai là Gián Điệp? (Who's the Spy?)** — coming soon.

## Layout
- `client/src/platform/` — the shell: hub (`Hub.tsx`), game registry (`games.ts`), routing (`PlatformApp.tsx`, `?game=<id>`).
- `client/src/games/cheese-thief/` — the Cheese Thief game (UI, engine host, i18n).
- `client/src/games/ma-soi/` — the Ma Sói game (UI, engine host, i18n, wolf avatars, bots).
- `client/src/games/uno/` — the Uno game (UI, engine host, i18n).
- `client/src/games/meo-no/` — the Mèo Nổ game (UI, engine host, i18n, cat avatars).
- `client/src/transport/` — the shared multiplayer transport (MQTT default, PeerJS, Socket.IO), voice and sound.
- `games/cheese-thief/logic.ts` — the Cheese Thief rules engine, shared by the browser host and the dedicated server.
- `games/ma-soi/logic.ts` — the Ma Sói rules engine (browser-hosted; the dedicated server still runs Cheese Thief only for now — Ma Sói rooms opened with `?server=` get `GAME_NOT_SUPPORTED`).
- `games/uno/logic.ts` — the Uno rules engine (browser-hosted; same `?server=` limitation as Ma Sói).
- `games/meo-no/logic.ts` — the Mèo Nổ rules engine (browser-hosted; same `?server=` limitation as Ma Sói/Uno).
- `server/` — Socket.IO server, one process for all games; rooms are namespaced `(game, code)`.

Adding a game = one entry in `client/src/platform/games.ts` + its component (and, for server mode, an engine in `games/<id>/` + an id in the server's `GAME_IDS` set). Rooms never collide across games: MQTT/voice topics live under `ct1/<game>/<code>/`, PeerJS ids under `ct-<game>-v1-`.

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
   - **8 players (house rule):** the thief recruits **2** Followers; the two Followers learn each other but **not** who the thief is (same as 7p).
4. **Day:** the cheese is gone! Discuss in the real-time chat (default 2 min — the host can set 1, 2 or 3 minutes in the lobby). Discussion ends early only when **all** players press "ready to vote"; the host can also end it.
5. **Voting:** simultaneous secret vote (60 s), no self-vote, no changing. Most votes = accused.
   - Chuột Phô Mai accused → **villagers win**. Anyone else accused → **thief's team wins**.
   - **Tie rule:** a tie that includes the thief counts as caught; a tie without the thief → thief wins.
   - **Fall Mouse priority:** if the Chuột Chết is in the top-voted group, they win **alone**, ahead of every other outcome.
6. **Play Again** keeps the room, code and players; roles/dice are re-randomised. A session scoreboard (🏆) tracks rounds won per player for the whole room session, and your own record (wins/losses split by the role you were dealt) is shown on the results screen and in the lobby.
7. **Chat** is open in the lobby, during the day discussion and on the results screen; it is locked at night, during recruitment and while voting. One-tap emoji reactions and preset quick phrases (rendered in each viewer's own language) keep phone players in the conversation.

## Ma Sói — roles & flow
- **Roles** (6–12 players): 🐺 Sói (2 at 6–8p, 3 at 9–12p by default), 🔮 Tiên Tri (peeks one player per night), 🛡️ Bảo Vệ (protects one per night, never the same player twice running), 🧪 Phù Thủy (8p+: one save potion + one kill potion per game, max one potion per night), 🏹 Thợ Săn (10p+: one shot when killed), 🧑 Dân Làng. The **host can change the role setup in the lobby** — wolves 2 or 3, witch and hunter on/off — and the game auto-fits the table to the player count (never fewer than 1 villager). The host can also **add smart bots** (they vote, hunt, peek, protect and use potions like human players), so 1 human + 5 bots can start a game.
- **Night** (each step 30 s, steps with no living actor are skipped): Thợ Săn (only if a hunter died with a shot pending) → Sói (majority pick, tie → earliest pick) → Tiên Tri → Bảo Vệ → Phù Thủy → dawn. A wolf kill is blocked if the Guardian protected the same player or the Witch used her save. Forgotten night actions default to the safe option (no kill / no peek / no protect / no potion / no shot) — never a random irreversible action.
- **Day:** deaths are announced by name and cause only — roles stay secret during play, even for the dead (the table must deduce, not be told); discussion (host picks 60/120/180 s, ends early when all living players press ready-to-vote); secret vote (60 s, no self-vote); a tie eliminates nobody. The hunter's shot, if pending, resolves before the next night.
- **Win:** villagers win when no wolf remains; wolves win at parity (wolves ≥ villagers). All roles are revealed at results.
- **Chat is locked at night** (a villager could blurt their role) and open in the lobby, during the day and at results. Voice works the same as Cheese Thief: speaker auto-on (listen-only), mic manual.

## Uno — rules & flow
- **Classic Uno** (2–10 players, 108 cards, 7 dealt each). Match by color, number or symbol; wilds always playable. Skip skips the next player; Reverse flips direction (acts as Skip with 2 players); Draw 2 makes the next player draw 2 and lose the turn (no stacking).
- **Wild Draw 4 with challenge:** the next player may take 4 cards or challenge — judged on whether the +4 player had a card matching the pre-play color. Bluff caught → the +4 player draws 4 and the challenger keeps the turn; wrong challenge → the challenger draws 6.
- **UNO call-out:** playing down to 1 card marks you UNO — call it before the next player acts, or any other player may catch you (+2 cards). Drawing while marked UNO clears the mark.
- **Draw flow:** one draw per turn; a playable drawn card may be played at once (only that card) or kept by passing; an unplayable draw passes the turn immediately. Empty deck reshuffles the discard pile (minus the top card).
- **Win & points:** first to empty their hand wins the round; points = the value of opponents' remaining hands (number = face value, Skip/Reverse/Draw 2 = 20, Wild/Wild Draw 4 = 50). Turn timer 30 s — a timed-out turn resolves safely (draw 1 + pass, or the safe default on a decision). Chat is open in all phases.

## Mèo Nổ — rules & flow
- **Exploding Kittens** (2–5 players, 7 cards each incl. 1 Defuse). Deck: Exploding Kittens = players − 1, Defuse 6 total, Nope / Skip / Shuffle / See the Future / Attack / Favor 4 each, Cat cards 5 types × 4 = 20. Cat cards have no standalone effect in v1.
- **Turn:** play any number of action cards, then draw 1 to end the turn. Skip ends the turn without drawing; Attack ends it and makes the next player draw twice — answering an Attack with an Attack adds 2 and passes the debt on. A Skip cancels one owed draw.
- **Drawing an Exploding Kitten:** with a Defuse, use it and put the kitten back at one of 5 fixed positions (top / 2nd / 3rd / middle / bottom — only you see the choice); without one, you explode at once — hand discarded, out of the game. The danger meter always shows pile size, kittens left in the pile and the explosion risk %.
- **Nope!** (lobby toggle, default on): when someone plays an action card, any other player holding a Nope gets 5 s to block it; a Nope may itself be Noped, restarting the 5 s window — an odd number of Nopes cancels the action. See the Future shows the top 3 cards privately, with a hint when one of them is a kitten. Favor: pick a player; they choose one card from their hand to give you.
- **Lobby toggles** (host): allow Nope (default on), show everyone's card counts (default on), 30 s turn limit (default **off** — a forgotten turn still auto-draws, and a forgotten defuse/reinsert/favor decision resolves to a safe default after 60 s). No bots in v1 — the design has no bot button.
- **Win:** the last player standing wins the round; the results screen ranks survivors first, then the exploded by turn of explosion. The laptop table has an event feed ("Diễn biến") beside the chat. Chat is open in all phases.

## Session & social features
- 🏆 **Session scoreboard** — rounds won per player in this room, leader crowned; plus your **personal record** (W/L split by dealt role).
- 🌙 **Night recap** — after each round, the results screen replays the night hour by hour (who woke, the steal, witnesses, inspections, recruitments). It is only revealed at results; mid-game state never contains it.
- 🔊 **Sound effects** — synthesized WebAudio cues (hour chimes, wake, steal, morning, vote, win/lose, chat pop) with a persistent mute toggle. No audio files.
- 👢 **Host tools** — kick a player from the lobby (they can rejoin; mid-game removal stays with the vote), set the discussion length, force-start the night/vote.
- 📋 **Share result** — one tap copies a compact localized summary of the round (winner, who the Cheese Mouse was, standings, your record, game link) for the group's chat app.
- 🌐 **Fully bilingual** — every UI string, including network error/status messages (delivered as language-neutral codes and localized at render), exists in Vietnamese and English.

## Architecture
- `shared/logic.ts` — the single authoritative rules engine (roles, dice, night actions, inspection eligibility, followers, Fall Mouse, voting, tie-breaks, win scoring, public/private state separation). `publicState()` contains no role/dice/vote secrets before results; `privateState()` is only ever sent point-to-point to its owner.
- `server/` — Node + TypeScript + **Socket.IO** dedicated server running the same engine server-side (room isolation, host migration, reconnection by session id, abandoned-room cleanup, chat spam guard). Run it with `npm install && npm run build && npm start` (port 3001).
- `client/` — React + TypeScript + Vite + Tailwind. Transports behind one interface:
  - **MQTT-over-WebSocket mode (default on the public site)** — see adaptation note below. The client races several public brokers **in parallel** and uses the first that connects (EMQX, HiveMQ, EMQX-CN, Mosquitto). Public state rides the room topic at **QoS 1**; private data is **ECDH (P-256) + AES-GCM** encrypted per player, so a passive observer of the bus cannot read roles/dice (Diffie–Hellman).
  - **Socket.IO mode** when opened as `?server=<your-server-url>` — dedicated-server play.
  - **PeerJS/WebRTC mode** with `?net=peer` — same host engine over WebRTC data channels (note: WebRTC is blocked outright in some networks/browsers).

## Digital adaptation (deliberate, documented)
The public site is hosted on static GitHub Pages, which cannot run a Socket.IO server. So in the default public mode the **host's browser runs the exact same authoritative engine** (`shared/logic.ts`) as a host-authoritative peer, with messages carried by a public MQTT broker over secure WebSocket: the host assigns roles/dice, validates every action, broadcasts only `publicState()` (which contains no secrets), and sends each player's secrets **only as ECDH+AES-GCM ciphertext addressed to that player** — clients cannot read each other's private state from any broadcast.

Honest consequences:
- The host must stay online for the room's life (host disconnect closes the room via MQTT last-will, and the UI says so). Session recovery works by rejoining with the same browser session.
- **A malicious host can cheat.** Because the host browser is authoritative in public mode, a modified host client could read or manipulate all game state. The encryption protects against *passive observers of the broker*, not against the host. For a fully trusted referee, deploy `server/` anywhere Node runs and open the client with `?server=` — there the dedicated server is authoritative.

Other adaptations vs. the physical game: fixed timers instead of a narrator (night hour 12 s, discussion 120 s, voting 60 s, recruit 20 s); the recruit phase is a timed secret UI instead of the physical hand-touch ritual; the thief is not forced to steal (if they don't act within their 12 s hour, the cheese stays and the game continues); wakers privately see whether the cheese is already gone when they wake (equivalent to opening your eyes at the table); chat is a continuous room conversation and is not wiped between rounds.

## Tests
- `tests/logic.test.mjs` — 32 rules tests (including the session-scoreboard scoring and the night-recap recording introduced by the improvement loop) (role/dice distribution, secret leakage, lone-waker inspection, multi-waker block, steal timing, vote integrity, all tie cases, follower witness/recruit/information rules per player count, Fall Mouse dealing + solo wins). Run: compile `shared/logic.ts` to `shared/logic.mjs` with esbuild, then `node tests/logic.test.mjs` (delete `shared/logic.mjs` afterwards — if left in place it shadows the `.ts` source for Vite and breaks the client build).
- `tests/mqtt.transport.test.mjs` — 14 checks: the shipped public transport itself (compiled from `client/src`), 4 simulated players against a real MQTT broker (aedes) play a complete round — join, encrypted role delivery, all-ready night start, steal, private inspection, ready-to-vote discussion skip, results. Note: some sandboxes' egress proxies block the public brokers, so this test runs against a local broker with identical protocol/topics/encryption.
- `tests/socket.integration.mjs` — 23 checks: real Socket.IO server, 5 simultaneous clients play a complete round (create/join/rejections, role secrecy, night steal + private inspection, live chat, voting, results, late-join rejection, play-again, reconnection). Run the server with fast-timer env (`CT_HOUR_MS=700 CT_DISCUSSION_MS=3000 CT_VOTE_MS=3000 CT_RECRUIT_MS=1500 PORT=3109`) then `node tests/socket.integration.mjs`.
- `tests/ma-soi.logic.test.mjs` — 26 rules tests for Ma Sói (role tables 6–12p, role-config overrides/clamps, wolf majority/tie, seer peek rules, guardian repeat rule, witch potions, night resolution incl. both saves and a hunter shot surviving `resolveNight` into the dawn announcement, hunter shot, vote tie, win checks, default votes, public/private secrecy — roles stay hidden until results). `tests/ma-soi.bots.test.mjs` — 11 tests for the bot decisions (wolf pack picks, seer/guardian/witch/hunter/vote — incl. a wolf bot never copying a pack vote that targets itself). `tests/ma-soi.vote-probe.mjs` — fake-clock probe driving the real HostEngine + bots through full games: every living player (human/bot, wolf/villager) gets a genuine vote in every round, before the timer. `tests/ma-soi.win-probe.mjs` — fake-clock probe, 200 full 12-player games: the winner at results always matches who is actually alive (wolves win ⇒ ≥1 wolf alive, villagers win ⇒ 0 wolves alive); `finishGame` re-derives the winner from the live board. Browser checks: `check/verify-ma-soi.mjs` (12 checks — full 6-player round incl. wolf chat + pick lock, in real Chromium over a local aedes broker), `check/verify-ma-soi-bots.mjs` (7 checks — 1 human + 5 bots finish a full game), `check/join-hop.mjs` (5 checks — a guest whose first broker has no host hops to the next broker and joins; a nonexistent room shows the host-unreachable message in ~12s) and `check/visual36.mjs` (30 checks — hub with three live games, Ma Sói landing/lobby, Uno landing/lobby/table/results, all screens fitted to one viewport).
- `tests/uno.logic.test.mjs` — 23 rules tests for Uno (deck composition, matching, skip/reverse/draw2, wild draw 4 + challenge both ways, UNO call/catch/settle, draw-then-play-or-pass, reshuffle, win + points). Browser check: `check/verify-uno.mjs` (6 checks — 4 players play a full game to results over a local aedes broker).
- `tests/meo-no.logic.test.mjs` — 25 rules tests for Mèo Nổ (deck composition, deal incl. 1 Defuse each, skip/attack debt + stacking, shuffle, peek, favor give, Nope chain both parities + who may nope, defuse + 5 reinsert positions, explosion + elimination, last-player-standing win, auto defaults, hand-count hiding). Browser check: `check/verify-meo-no.mjs` (hub 4 live + 1 coming-soon, full 4-player game to results with defuse + Nope seen, all screens fitted to one viewport).
- QA probe — 33 checks (two simultaneous rooms: an 8-player round with leakage/unauthorized-action assertions, host-kick validation, the discussion-length option, disconnect-during-voting). Real-browser self-plays (Playwright) drive complete rounds over both the MQTT and Socket.IO transports, including the scoreboard, night recap, personal record and share-summary flows. The 10-cycle improvement loop that shipped v14–v23 is documented under `loop/` (one CYCLE file + one implementation prompt per cycle).

## Tech
React 18 · TypeScript · Vite · Tailwind CSS · Socket.IO · PeerJS (WebRTC) · MQTT.js. No database needed — rooms are ephemeral by design (PostgreSQL unnecessary for session-only state).
