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
  giveFavorCard, autoTurn, autoResolvePending, advanceTurn,
  MIN_PLAYERS, MAX_PLAYERS, TURN_MS, NOPE_MS, DECISION_MS,
} from '../../../../games/meo-no/logic';
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
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  broadcast() {
    const pub = publicState(this.state);
    this.hooks.sendPub(pub);
    for (const p of this.state.players) this.hooks.sendPriv(p.id, privateState(this.state, p));
  }
  /** Broadcast + re-arm every timer the current state needs. */
  private sync() { this.broadcast(); this.armTimers(); }
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
  addPlayer(id: string, name: string, isHost: boolean): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hand: [], wins: 0, alive: true, explodedTurn: null };
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
      const next = s.players.find(x => x.connected && x.id !== playerId);
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
