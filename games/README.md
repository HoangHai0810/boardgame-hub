# games/ — per-game rules engines

One folder per game. The engine here is the **single source of truth** for that
game's rules, used by both sides:

- the **browser host** (`client/src/games/<id>/hostEngine.ts`) in the default
  MQTT/PeerJS transports, and
- the **dedicated server** (`server/src/index.ts`, Socket.IO mode).

## Layout

```
games/
  <game-id>/
    logic.ts   — createGame, publicState, privateState, actions, timers…
```

## Rules for a new game

1. Add `games/<id>/logic.ts` with the engine (mirror the Cheese Thief
   module's shape: `createGame(code)`, `publicState(state)`,
   `privateState(state, playerId)`, plus the action functions).
2. Add the client game under `client/src/games/<id>/` (UI + host engine +
   voice, reusing `client/src/transport/`).
3. Register it in `client/src/platform/games.ts`.
4. Add the id to the server's `GAME_IDS` set.
5. Rooms are namespaced by game everywhere, so no new game can collide
   with an existing room code: MQTT/voice topics `ct1/<game>/<code>/`,
   PeerJS ids `ct-<game>-v1-`, server rooms keyed `(game, code)`.
