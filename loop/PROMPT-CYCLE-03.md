# PROMPT — CYCLE 03: Quick reactions + preset quick-chat phrases

## Goal
Give players a one-tap communication channel in every open-chat phase
(lobby / day / results): a quick-bar above the chat input with emoji reactions
and preset phrases, so nobody has to type during a timed discussion.
Justification: Among Us introduced Quick Chat because preset messages "promote
easier and faster communication without the need for typing", and Innersloth's
2023 update doubled down on it (categories, favourites) — it is also an
accessibility feature for players who type slowly or play across languages.
Our discussion is 2 minutes and most players are on phones.

## Design — client-only, zero protocol change
- Reactions travel through the EXISTING chat intent (the engines' 400 ms spam
  guard and phase gating apply unchanged). No engine, logic or server changes.
- **Emoji set:** 👀 🧀 😱 🤔 👍 👎 😂 ❓ — sent as the message text itself.
  ChatPanel renders a message that consists of exactly one of these emoji
  BIG (text-4xl, compact bubble) instead of body text size.
- **Preset phrases** are sent as opaque tokens `QC1`..`QC4` and rendered by
  ChatPanel in the VIEWER's language via new i18n keys `qc1`..`qc4`
  (this mirrors how Among Us sends phrase ids, not raw text — a Vietnamese
  sender's phrase reads in English on an English client and vice versa):
  - QC1 en "I saw something suspicious! 👀" / vi "Tui thấy có gì đó đáng ngờ! 👀"
  - QC2 en "I was asleep at that hour 😴" / vi "Giờ đó tui đang ngủ 😴"
  - QC3 en "Trust me! 🙏" / vi "Tin tui đi! 🙏"
  - QC4 en "Who else was awake then? 🤔" / vi "Còn ai thức giờ đó nữa không? 🤔"
  A user typing `QC1` manually gets the same rendering — harmless.
- **UI (ChatPanel in App.tsx):** a horizontally scrollable row above the input:
  8 emoji buttons (text-2xl, tap = send immediately) + 4 phrase chips
  (small rounded buttons with the localized phrase text, tap = send token).
  Buttons disabled state: none (spam guard is server-side/engine-side).
  Sending a reaction also triggers the existing 'pop' sound on receivers
  (chat path already does this) — no sound.ts change.
- i18n: add `qc1`..`qc4` to BOTH dicts (Dict type = typeof en, keys must match).

## Rules / constraints
- No changes to shared/logic.ts, hostEngine.ts, server, net*.ts.
- Chat phases unchanged: quick-bar exists only inside ChatPanel, which is only
  rendered where chat is open (lobby/day/results).
- No Node-only APIs; no new dependencies.

## Acceptance tests
- Full battery green (logic/socket/probe/MQTT/selfplay6) — must be untouched.
- Browser check (extend selfplay style): two pages in one lobby —
  host taps 👀 → guest's chat shows the emoji rendered at big size
  (assert the element with text 👀 has font-size ≥ 30px or class text-4xl);
  host taps the QC2 phrase chip → guest (VI UI) sees "Giờ đó tui đang ngủ 😴";
  switch guest to EN → the same message now renders "I was asleep at that hour 😴"
  (proves token-based localization). Screenshot the lobby chat.

## Out of scope
- Customisable favourites (Among Us has them; needs persistence design — later).
- Reactions during night/voting (chat is locked there by design).
