// Authoritative host engine — the SAME rules as games/meo-no/logic.ts,
// run by the host player's browser in the peer/bus transports. All
// validation happens here; clients only send intents. Private snapshots
// leave the engine only through sendPriv(playerId, ...) — each transport
// must deliver them ONLY to that player (PeerJS: their data channel.
// MQTT: their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Mèo Nổ from Uno, Ma Sói or Cheese Thief.
import {
  GameState, Player, createGame, deal, publicState, privateState,
  playCard, playNope, resolvePendingAction, drawCard, defuse, reinsert,
  giveFavorCard, autoTurn, autoResolvePending, advanceTurn, addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS, TURN_MS, NOPE_MS, DECISION_MS,
} from '../../../../games/meo-no/logic';
import { botChooseAction, botShouldNope, botReinsertPos, botFavorGiveCardId } from '../../../../games/meo-no/bots';
import type { Config } from '../../../../games/meo-no/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mèo';

export class HostEngine {
  state: GameState;
  timers: ReturnType<typeof setTimeout>[] = [];
  lastChat = new Map<string, number>();
  /** Deadline for the current pending decision (defuse / reinsert /
   *  favor-give). Lives in the engine, not the state: a migrated host
   *  simply re-arms a fresh window. */
  decisionEndsAt: number | null = null;
  /** Bot actions already scheduled (one key per decision). driveBots()
   *  re-runs after every broadcast, so without this a bot would collect
   *  a new timer on every state change. Keys are scoped to the turn /
   *  pending state, so a fresh decision always gets a fresh key. */
  private botPending = new Set<string>();
  private botPhaseKey = '';
  /** Turn number in which each bot already played its one action card
   *  (a bot plays at most one action, then draws to end its turn). */
  private botActionTurn = new Map<string, number>();
  /** A bot's Nope appetite, decided ONCE per pending action: re-rolling
   *  on every broadcast would turn "~15%" into "almost surely". */
  private botNopeDecided = new Map<string, boolean>();
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
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
   *  transition is simply re-scheduled. Pending decisions come first —
   *  a bot never takes its turn while a defuse / reinsert / favor /
   *  Nope window is open. */
  private driveBots() {
    const s = this.state;
    if (s.phase !== 'playing') { this.botPending.clear(); this.botNopeDecided.clear(); return; }
    const phaseKey = `${s.turn}:${s.turnCount}:${s.debt}:`
      + `${s.pendingAction ? `${s.pendingAction.cardId}:${s.pendingAction.nopes.length}` : ''}:`
      + `${s.pendingExplode?.playerId ?? ''}:${s.pendingReinsert ?? ''}:`
      + `${s.pendingFavor?.targetId ?? ''}:${s.peekShownFor ?? ''}`;
    if (phaseKey !== this.botPhaseKey) { this.botPhaseKey = phaseKey; this.botPending.clear(); }
    if (!s.pendingAction) this.botNopeDecided.clear();
    const bots = s.players.filter(p => p.isBot && p.connected && p.alive);
    if (!bots.length) return;
    if (s.pendingExplode) {
      const b = bots.find(p => p.id === s.pendingExplode!.playerId);
      if (b) this.scheduleBot(`defuse:${s.turnCount}:${b.id}`, this.botDelay(1000, 1500), () => this.botDefuse(b));
      return;
    }
    if (s.pendingReinsert) {
      const b = bots.find(p => p.id === s.pendingReinsert);
      if (b) this.scheduleBot(`reinsert:${s.turnCount}:${b.id}`, this.botDelay(1000, 1500), () => this.botReinsert(b));
      return;
    }
    if (s.pendingFavor) {
      const b = bots.find(p => p.id === s.pendingFavor!.targetId);
      if (b) this.scheduleBot(`favor:${s.turnCount}:${b.id}`, this.botDelay(1000, 1500), () => this.botGiveFavor(b));
      return;
    }
    if (s.pendingAction) {
      for (const b of bots) {
        const decidedKey = `nope:${s.pendingAction.cardId}:${b.id}`;
        let want = this.botNopeDecided.get(decidedKey);
        if (want === undefined) { want = botShouldNope(s, b); this.botNopeDecided.set(decidedKey, want); }
        if (want) this.scheduleBot(`nope:${s.pendingAction.cardId}:${s.pendingAction.nopes.length}:${b.id}`, this.botDelay(1000, 1500), () => this.botNope(b));
      }
      return;
    }
    const me = bots.find(p => p.id === s.turn);
    if (me) this.scheduleBot(`turn:${s.turnCount}:${me.id}`, this.botDelay(1000, 1500), () => this.botTakeTurn(me));
  }

  /** One bot's turn, run through the same validated logic a human's tap
   *  goes through: at most one action card, then draw to end the turn.
   *  A card that opens a Nope window or a Favor wait ends the bot's
   *  move here — driveBots() picks it up again once that resolves. */
  private botTakeTurn(b: Player) {
    const s = this.state;
    if (s.phase !== 'playing' || s.turn !== b.id || !b.alive) return;
    if (s.pendingAction || s.pendingExplode || s.pendingReinsert || s.pendingFavor) return;
    const act = this.botActionTurn.get(b.id) === s.turnCount ? null : botChooseAction(s, b);
    if (act) {
      if (playCard(s, b, act.cardId, act.targetId)) {
        this.botActionTurn.set(b.id, s.turnCount);
        this.sync();
        if (s.pendingAction || s.pendingFavor || s.turn !== b.id) return;
      }
    }
    if (s.phase !== 'playing' || s.turn !== b.id || !b.alive) return;
    if (s.pendingAction || s.pendingExplode || s.pendingReinsert || s.pendingFavor) return;
    const card = drawCard(s, b);
    if (card !== null) this.sync();
    // card === null only when the deck is dry and cannot reshuffle:
    // nothing changed, so no broadcast (the turn timer still owns it).
  }
  private botDefuse(b: Player) {
    const s = this.state;
    if (s.pendingExplode?.playerId !== b.id) return;
    if (defuse(s, b)) this.sync();
  }
  private botReinsert(b: Player) {
    const s = this.state;
    if (s.pendingReinsert !== b.id) return;
    const pos = botReinsertPos(s);
    if (pos !== null && reinsert(s, b, pos)) this.sync();
  }
  private botGiveFavor(b: Player) {
    const s = this.state;
    if (s.pendingFavor?.targetId !== b.id) return;
    const cardId = botFavorGiveCardId(s, b);
    if (cardId && giveFavorCard(s, b, cardId)) this.sync();
  }
  private botNope(b: Player) {
    const s = this.state;
    // Re-check legality at fire time (rng () => 0 passes the 15% roll):
    // a Nope that landed since scheduling may have made this bot the
    // last noper, and a bot may never Nope its own Nope.
    if (botShouldNope(s, b, () => 0) && playNope(s, b)) this.sync();
  }

  /** Broadcast + re-arm every timer the current state needs. armTimers
   *  runs FIRST: it clears the timer list, and driveBots() (inside
   *  broadcast) schedules the bots' timers after that — the other order
   *  would wipe every bot timer the moment it was scheduled. */
  private sync() { this.armTimers(); this.broadcast(); }
  private armTimers() {
    this.clear();
    const s = this.state;
    if (s.phase !== 'playing') { this.decisionEndsAt = null; return; }
    if (s.pendingAction) {
      const ms = Math.max(0, s.pendingAction.endsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'playing' || !this.state.pendingAction) return;
        resolvePendingAction(this.state);
        this.sync();
      });
      return; // the Nope window owns the clock until it closes
    }
    if (s.pendingExplode || s.pendingReinsert || s.pendingFavor) {
      if (!this.decisionEndsAt) this.decisionEndsAt = Date.now() + DECISION_MS;
      const ms = Math.max(0, this.decisionEndsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'playing') return;
        this.decisionEndsAt = null;
        autoResolvePending(this.state);
        this.sync();
      });
      return;
    }
    this.decisionEndsAt = null;
    if (s.config.timerEnabled && s.turnEndsAt) {
      const ms = Math.max(0, s.turnEndsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'playing') return;
        autoTurn(this.state);
        this.sync();
      });
    }
  }
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hand: [], wins: 0, alive: true, explodedTurn: null, avatar };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear();
    this.decisionEndsAt = null;
    const s = this.state;
    s.phase = 'playing';
    deal(s);
    this.sync();
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): the
   *  deadlines live in the state itself, so the successor engine simply
   *  re-schedules whatever the dead host had pending. */
  resumeTimers() {
    if (this.state.phase === 'playing') this.armTimers();
  }
  /** Stop a superseded engine (its room migrated to a successor host). */
  dispose() { this.clear(); }
  handle(player: Player, msg: any) {
    const s = this.state;
    switch (msg.action) {
      case 'setConfig': {
        if (!player.isHost || s.phase !== 'lobby') return;
        const c = msg.config as Partial<Config> | undefined;
        if (!c) return;
        if (typeof c.nopeEnabled === 'boolean') s.config.nopeEnabled = c.nopeEnabled;
        if (typeof c.showCounts === 'boolean') s.config.showCounts = c.showCounts;
        if (typeof c.timerEnabled === 'boolean') s.config.timerEnabled = c.timerEnabled;
        this.broadcast();
        break;
      }
      // Lobby setup (host only): bots fill the table when humans are
      // short, so 1 human + bots can start a game.
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
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (s.players.filter(p => p.connected).length < MIN_PLAYERS) return;
        if (s.phase === 'results') s.round++;
        this.startRound(); break;
      }
      // Turn actions arrive as top-level actions (the transports forward
      // nightAction(kind) verbatim — see transport/net.ts).
      case 'playCard':
        if (msg.cardId && playCard(s, player, msg.cardId, msg.targetId)) this.sync();
        break;
      case 'playNope': if (playNope(s, player)) this.sync(); break;
      case 'drawCard': {
        const card = drawCard(s, player);
        if (card !== null || s.turn !== player.id) this.sync();
        break;
      }
      case 'defuse': if (defuse(s, player)) this.sync(); break;
      case 'reinsert':
        if (typeof msg.pos === 'number' && reinsert(s, player, msg.pos)) this.sync();
        break;
      case 'giveFavorCard':
        if (msg.cardId && giveFavorCard(s, player, msg.cardId)) this.sync();
        break;
      case 'chat': {
        const now = Date.now();
        if (now - (this.lastChat.get(player.id) ?? 0) < 400) return;
        this.lastChat.set(player.id, now);
        const text = String(msg.text ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
        if (text) { s.chat.push({ fromId: player.id, fromName: player.name, text, ts: now }); this.broadcast(); }
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
          s.players.forEach(p => { p.hand = []; p.alive = true; p.explodedTurn = null; });
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
      // Host migrates to a connected human when one is left (a bot
      // host could never press "start" for the next round); only when
      // no human remains does a bot hold the host flag.
      const next = s.players.find(x => x.connected && !x.isBot && x.id !== playerId)
        ?? s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    // A disconnected player never holds the table: resolve anything they
    // were deciding, then pass the turn on at once.
    if (s.phase === 'playing') {
      if (s.pendingExplode?.playerId === playerId || s.pendingReinsert === playerId
        || s.pendingFavor?.targetId === playerId) {
        this.decisionEndsAt = null;
        autoResolvePending(s);
      }
      if (s.turn === playerId) advanceTurn(s);
    }
    this.sync();
  }
  canAcceptJoin(playerId: string): 'ok' | 'started' | 'full' {
    if (this.state.players.some(p => p.id === playerId)) return 'ok';
    if (this.state.phase !== 'lobby') return 'started';
    if (this.state.players.length >= MAX_PLAYERS) return 'full';
    return 'ok';
  }
}
