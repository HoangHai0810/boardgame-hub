# PROMPT — Cycle 7: Localize all network error/status messages

## Goal
No English sentence from the transport layer ever reaches the screen. Transports and the Socket.IO server emit short language-neutral CODES; the App translates codes to the current UI language at render time (so switching language re-renders a pending message correctly — same principle as the QC chat tokens in Cycle 3 and the KICKED notice in Cycle 5).

## Code table (code → dict key)
- `HOST_GONE` → errHostGone
- `ROOM_FULL` → errRoomFull
- `GAME_STARTED` → errGameStarted
- `ROOM_NOT_FOUND` → errRoomNotFound
- `HOST_UNREACHABLE` → errHostUnreachable (MQTT join timeout)
- `NET_UNREACHABLE` → errNetUnreachable (MQTT connect failure)
- `SERVER_UNREACHABLE` → errServerUnreachable (Socket.IO connect_error)
- `HOST_DISCONNECTED` → errHostDisconnected (PeerJS host connection closed)
- `PEER_BLOCKED` → errPeerBlocked (PeerJS could not open a data connection)
- `CONN_ERROR:<detail>` → errConnError(detail) (PeerJS generic error; detail is a technical token, kept as-is)
- `NEED_MORE_PLAYERS` → errNeedMore (server startGame with <4 players)
- `FAILED` → errFailed (generic fallback)
- `KICKED` → kickedMsg (already localized since Cycle 5 — keep)
- Statuses: `STATUS_CREATING` → statusCreating; `STATUS_CONNECTING:<code>` → statusConnecting(code); the loading screen's hard-coded 'Connecting…' fallback → dict key `connecting`.

## Rules
- Replace the literal strings at every site: client/src/net.ts (PeerJS + Socket.IO), client/src/net-mqtt.ts (host/client), server/src/index.ts (ack errors 'Room not found'/'Game already started'/'Room is full (8)' → codes; startGame errorMsg → NEED_MORE_PLAYERS).
- App: one `localizeMsg(m)` helper used at both error render sites and both status render sites. Unknown messages (not matching any code) render verbatim — never swallow information.
- Dict: add all keys above to BOTH the EN and VI dicts, with the current English text as the EN values (no wording changes in English).
- No protocol/behavior change beyond the message payloads; the MQTT transport test and socket integration must stay green (they don't assert these strings — verify).

## Acceptance tests
- Browser check (MQTT local broker, 2 pages, VI default): guest joins; host page closes (last-will fires) → guest sees the VI host-left message 'Chủ phòng đã rời — phòng đã đóng. 🏠'. Also: joining with a wrong code → VI host-unreachable message after the timeout is too slow (25s) — instead assert the wrong-code path differently: skip (covered by code inspection + the host-gone live check).
- Full battery green (logic / socket integration / probe / MQTT transport / self-play 6p).
- Grep gate: no remaining hard-coded English sentences in onError/onStatus call sites in net.ts/net-mqtt.ts.
