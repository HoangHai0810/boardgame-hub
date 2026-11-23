# PROMPT — Cycle 5: Host kick in the lobby

## Goal
The room host can remove any other player while in the **lobby** (before a round starts). The kicked player is returned to the landing screen with a clear notice. Works on all three transports (MQTT host engine, PeerJS host engine, Socket.IO server).

## Rules
- Intent `kick { targetId }`. Valid only when: sender is the host, phase is `lobby`, target exists, target ≠ host. Anything else is silently ignored (no state change).
- On a valid kick (host-authoritative engines, i.e. HostEngine used by MQTT + PeerJS):
  - Remove the target from `state.players`.
  - Deliver an out-of-band error signal with the exact payload `KICKED` to that player via a new optional engine callback `sendError(playerId, msg)`; then broadcast public state.
  - net-mqtt host: publish `{type:'error', msg:'KICKED'}` on the target's private topic (the client already routes this to onError). net.ts (PeerJS): `conns.get(pid)?.send({type:'error', msg:'KICKED'})`.
- Socket.IO server mirrors it: `socket.on('kick')` with the same validation; emit `errorMsg` `KICKED` to the target's socket, remove the player and their socket mapping, broadcast.
- Client App: `onError` treats the exact message `KICKED` specially — leave the room (net.leave(), clear joined/pub/priv state) and show the localized `kickedMsg` on the landing screen. Other error messages keep current behavior.
- A kicked player may rejoin with the code (kick ≠ ban; matches Among Us). No persistent ban list.
- UI: in the lobby player list, when the viewer is the host, every other player's chip shows a small ✖ control (a span with click handler + stopPropagation inside the chip — never a nested button). Clicking it sends the kick intent. Non-hosts see no ✖. Kicking is NOT available outside the lobby (no mid-game host removal — that would let a host rig a round; the vote already handles removal in-game).

## Edge cases
- Kicking a disconnected (greyed) lobby player: allowed, same path (no error signal needed but harmless).
- Host tries to kick themselves / a non-existent id / during a round: ignored.
- Non-host sends kick intent: ignored by both engines.
- Kicked player's later disconnect event must not corrupt state (player already removed; disconnect handlers must no-op for unknown players — verify existing behavior).

## Acceptance tests
- QA probe gains: host kicks a lobby guest → guest receives `KICKED` and vanishes from the host's public state; a non-host kick attempt changes nothing.
- Browser check (local MQTT broker, 2 pages): host sees ✖ on the guest chip, clicks it → guest returns to the landing screen showing the kicked notice (VI), host lobby shows 1 player; guest can rejoin with the code.
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p).
