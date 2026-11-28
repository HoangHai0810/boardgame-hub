// Authoritative host engine — the SAME rules as games/uno/logic.ts,
// run by the host player's browser in the peer/bus transports. All
// validation happens here; clients only send intents. Private snapshots
// leave the engine only through sendPriv(playerId, ...) — each transport
// must deliver them ONLY to that player (PeerJS: their data channel.
// MQTT: their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Uno from Ma Sói or Cheese Thief.
import {
  GameState, Player, createGame, deal, publicState, privateState,
  playCard, drawCard, passTurn, callUno, catchUno,
  takeDraw4, challengeWild4, pickColor, autoTurn, advanceTurn,
  addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../../../../games/uno/logic';
import type { Color } from '../../../../games/uno/logic';
import { botPickCard, botChooseColor, botShouldChallenge, botCatchTarget } from '../../../../games/uno/bots';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Uno';

export class HostEngine {
  state: GameState;
  timers: ReturnType<typeof setTimeout>[] = [];
  lastChat = new Map<string, number>();
  /** The turn timer lives apart from `timers`: re-arming it must never
   *  wipe a bot decision already scheduled (sync() re-arms it after
   *  every broadcast, and driveBots() schedules into `timers`). */
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bot actions already scheduled (one key per decision). driveBots()
   *  re-runs after every broadcast, so without this a bot would collect
   *  a new timer on every state change. Keys are scoped to the turn /
   *  decision, so a fresh decision always gets a fresh key. */
  private botPending = new Set<string>();
  private botPhaseKey = '';
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() {
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.botPending.clear();
  }
  broadcast() {
    const pub = publicState(this.state);
    this.hooks.sendPub(pub);
    // Bots live inside the engine — they read the state directly and have
    // no connection to send a private snapshot to.
    for (const p of this.state.players) if (!p.isBot) this.hooks.sendPriv(p.id, privateState(this.state, p));
    this.driveBots();
  }
  /** Schedule one bot decision (guarded by botPending). The delay is
   *  human-like on purpose: an instant bot betrays that it is a bot. */
  private scheduleBot(key: string, ms: number, fn: () => void) {
    if (this.botPending.has(key)) return;
    this.botPending.add(key);
    this.later(ms, () => { this.botPending.delete(key); fn(); });
  }
  private botDelay(min: number, spread: number) { return min + Math.random() * spread; }

  /** Make sure every bot that owes an action has one scheduled. Called
   *  after every broadcast, so a bot whose timer was wiped by a phase
   *  transition is simply re-scheduled. */
  private driveBots() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const phaseKey = `${s.phase}:${s.turn ?? ''}:${s.round}:${s.pendingDraw4 ? 'd4' : ''}:${s.colorPickPending ?? ''}:${s.unoPending ?? ''}:${s.unoArmed ?? ''}:${s.turnDrawn}:${s.drawnCardId ?? ''}`;
    if (phaseKey !== this.botPhaseKey) { this.botPhaseKey = phaseKey; this.botPending.clear(); }
    const bots = s.players.filter(p => p.isBot && p.connected);
    if (!bots.length) return;
    // A bot sitting on 1 card calls UNO at once (faster than a turn
    // decision — the next player acts within ~1s, so a slow call would
    // almost always be a foul).
    for (const b of bots) {
      if (s.unoPending === b.id) {
        this.scheduleBot(`uno:${s.round}:${b.id}`, this.botDelay(600, 600), () => this.botCallUno(b));
      }
    }
    // Any other bot may catch a forgotten UNO before the turn moves on.
    for (const b of bots) {
      const target = botCatchTarget(s, b);
      if (target) {
        this.scheduleBot(`catch:${s.round}:${target}:${b.id}`, this.botDelay(1200, 1800), () => this.botCatch(b));
      }
    }
    // First-card Wild: the first player picks the starting color.
    if (s.colorPickPending) {
      const b = bots.find(p => p.id === s.colorPickPending);
      if (b) this.scheduleBot(`color:${s.round}:${b.id}`, this.botDelay(1000, 1500), () => this.botPickColor(b));
      return;
    }
    const turnBot = bots.find(p => p.id === s.turn);
    if (!turnBot) return;
    // A Wild Draw 4 awaits this bot's decision: take 4, or challenge.
    if (s.pendingDraw4) {
      this.scheduleBot(`d4:${s.round}:${turnBot.id}`, this.botDelay(1000, 1500), () => this.botDraw4(turnBot));
      return;
    }
    this.scheduleBot(`turn:${s.round}:${turnBot.id}:${s.turnDrawn ? 'drawn' : 'fresh'}`, this.botDelay(1000, 1500), () => this.botTurn(turnBot));
  }

  /** One bot's turn, run through the same validated logic a human's tap
   *  goes through. Play a card when one is legal, draw when none is —
   *  and a drawn card that is playable gets played at once. */
  private botTurn(b: Player) {
    const s = this.state;
    if (s.phase !== 'playing' || s.turn !== b.id || s.pendingDraw4 || s.colorPickPending) return;
    // Ring the bell before the 2nd-to-last card, like a human would.
    if (b.hand.length === 2 && s.unoArmed !== b.id) callUno(s, b);
    const pick = botPickCard(s, b);
    if (pick) {
      if (playCard(s, b, pick.cardId, pick.color)) this.sync();
      return;
    }
    if (!s.turnDrawn) {
      // drawCard() advances the turn itself when the drawn card is not
      // playable; when it IS playable the turn stays and driveBots()
      // (via the broadcast below) schedules the play-or-pass decision.
      if (drawCard(s, b) !== null) this.sync();
      return;
    }
    if (passTurn(s, b)) this.sync();
  }
  private botPickColor(b: Player) {
    const s = this.state;
    if (s.phase !== 'playing' || s.colorPickPending !== b.id) return;
    if (pickColor(s, b, botChooseColor(b.hand))) this.sync();
  }
  private botDraw4(b: Player) {
    const s = this.state;
    if (s.phase !== 'playing' || s.turn !== b.id || !s.pendingDraw4) return;
    if (botShouldChallenge() ? challengeWild4(s, b) : takeDraw4(s, b)) this.sync();
  }
  private botCallUno(b: Player) {
    if (this.state.unoPending !== b.id) return;
    if (callUno(this.state, b)) this.broadcast();
  }
  private botCatch(b: Player) {
    const s = this.state;
    const target = botCatchTarget(s, b);
    if (!target) return;
    if (catchUno(s, b, target)) this.broadcast();
  }

  /** Broadcast + re-arm the turn timer (the only timer Uno has). */
  private sync() { this.broadcast(); this.armTurnTimer(); }
  private armTurnTimer() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    const s = this.state;
    if (s.phase !== 'playing' || !s.turnEndsAt) return;
    const ms = Math.max(0, s.turnEndsAt - Date.now());
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (this.state.phase !== 'playing') return;
      autoTurn(this.state);
      this.sync();
    }, ms);
  }
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hand: [], wins: 0, points: 0, avatar };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear();
    const s = this.state;
    s.phase = 'playing';
    deal(s);
    this.sync();
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): the
   *  turn deadline lives in the state itself, so the successor engine
   *  simply re-schedules whatever the dead host had pending. */
  resumeTimers() {
    if (this.state.phase === 'playing') { this.armTurnTimer(); this.driveBots(); }
  }
  /** Stop a superseded engine (its room migrated to a successor host). */
  dispose() { this.clear(); }
  handle(player: Player, msg: any) {
    const s = this.state;
    switch (msg.action) {
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (s.players.filter(p => p.connected).length < MIN_PLAYERS) return;
        if (s.phase === 'results') s.round++;
        this.startRound(); break;
      }
      // Turn actions arrive as top-level actions (the transports forward
      // nightAction(kind) verbatim — see transport/net.ts). playCard
      // carries the wild's chosen color in msg.color.
      case 'playCard':
        if (msg.cardId && playCard(s, player, msg.cardId, msg.color as Color | undefined)) this.sync();
        break;
      case 'drawCard': {
        const card = drawCard(s, player);
        if (card !== null || s.turn !== player.id) this.sync();
        break;
      }
      case 'passTurn': if (passTurn(s, player)) this.sync(); break;
      case 'callUno': if (callUno(s, player)) this.sync(); break;
      case 'catchUno': if (msg.targetId && catchUno(s, player, msg.targetId)) this.sync(); break;
      case 'takeDraw4': if (takeDraw4(s, player)) this.sync(); break;
      case 'challengeWild4': if (challengeWild4(s, player)) this.sync(); break;
      case 'pickColor': if (msg.color && pickColor(s, player, msg.color as Color)) this.sync(); break;
      case 'chat': {
        // Uno is a chatty game — chat stays open in every phase. Hands
        // are secret, but a player can only leak their own cards by
        // typing them, same as Cheese Thief's night chat.
        const now = Date.now();
        if (now - (this.lastChat.get(player.id) ?? 0) < 400) return;
        this.lastChat.set(player.id, now);
        const text = String(msg.text ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
        if (text) { s.chat.push({ fromId: player.id, fromName: player.name, text, ts: now }); this.broadcast(); }
        break;
      }
      // Lobby setup (host only): bots fill the table when humans are
      // short — they count toward the minimum player count.
      case 'addBot': {
        if (!player.isHost || s.phase !== 'lobby') break;
        if (addBot(s)) this.broadcast();
        break;
      }
      case 'removeBot': {
        if (!player.isHost || s.phase !== 'lobby' || !msg.targetId) break;
        if (removeBot(s, msg.targetId)) this.broadcast();
        break;
      }
      case 'kick': {
        if (!player.isHost || s.phase !== 'lobby' || !msg.targetId || msg.targetId === player.id) break;
        const target = s.players.find(p => p.id === msg.targetId);
        if (!target || target.isHost) break;
        s.players = s.players.filter(p => p.id !== target.id);
        this.hooks.sendError?.(target.id, 'KICKED');
        this.broadcast();
        break;
      }
      case 'playAgain':
        if (player.isHost && s.phase === 'results') {
          s.round++; s.phase = 'lobby'; s.turn = null; s.turnEndsAt = null;
          s.players.forEach(p => { p.hand = []; });
          this.broadcast();
        }
        break;
    }
  }
  disconnect(playerId: string) {
    const s = this.state; const p = s.players.find(x => x.id === playerId); if (!p) return;
    p.connected = false;
    if (s.phase === 'lobby' || s.phase === 'results') {
      s.players = s.players.filter(x => x.id !== playerId);
      if (s.players.length && !s.players.some(x => x.isHost)) s.players[0].isHost = true;
    } else if (p.isHost) {
      const next = s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    // A disconnected player never holds the turn: pass it on at once so
    // the table never stalls on an empty chair.
    if (s.phase === 'playing' && s.turn === playerId) advanceTurn(s, 1);
    this.sync();
  }
  canAcceptJoin(playerId: string): 'ok' | 'started' | 'full' {
    if (this.state.players.some(p => p.id === playerId)) return 'ok';
    if (this.state.phase !== 'lobby') return 'started';
    if (this.state.players.length >= MAX_PLAYERS) return 'full';
    return 'ok';
  }
}
