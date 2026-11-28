// Authoritative host engine — the SAME rules as games/coup/logic.ts, run
// by the host player's browser in the peer/bus transports. All validation
// happens here; clients only send intents. Private snapshots leave the
// engine only through sendPriv(playerId, ...) — each transport must
// deliver them ONLY to that player (PeerJS: their data channel. MQTT:
// their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Coup from Uno or Ma Sói.
import {
  GameState, Player, createGame, startGame, publicState, privateState,
  declareAction, respond, respondBlockWindow, respondBlock, chooseLose,
  chooseExchange, autoStep, advanceTurn, markPassed,
  legalActions, MIN_PLAYERS, MAX_PLAYERS,
} from '../../../../games/coup/logic';
import type { ActionKind, CharKind } from '../../../../games/coup/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Coup';

export class HostEngine {
  state: GameState;
  timers: ReturnType<typeof setTimeout>[] = [];
  lastChat = new Map<string, number>();
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  broadcast() {
    const pub = publicState(this.state);
    this.hooks.sendPub(pub);
    for (const p of this.state.players) this.hooks.sendPriv(p.id, privateState(this.state, p));
  }
  /** Broadcast + re-arm the turn timer (the only timer Coup has). */
  private sync() {
    this.broadcast();
    this.armTurnTimer();
  }
  private armTurnTimer() {
    this.clear();
    const s = this.state;
    if (s.phase !== 'playing' || !s.turnEndsAt) return;
    const ms = Math.max(0, s.turnEndsAt - Date.now());
    this.later(ms, () => {
      if (this.state.phase !== 'playing') return;
      autoStep(this.state);
      this.sync();
    });
  }
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hand: [], revealed: [], coins: 0, eliminated: false, avatar };
    this.state.players.push(p); return p;
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): the
   *  turn deadline lives in the state itself, so the successor engine
   *  simply re-schedules whatever the dead host had pending. */
  resumeTimers() {
    if (this.state.phase === 'playing') this.armTurnTimer();
  }
  /** Stop a superseded engine (its room migrated to a successor host). */
  dispose() { this.clear(); }
  handle(player: Player, msg: any) {
    const s = this.state;
    switch (msg.action) {
      case 'setConfig': {
        if (!player.isHost || s.phase !== 'lobby') return;
        const c = msg.config as Partial<{ turnSeconds: number }> | undefined;
        if (!c) return;
        if (c.turnSeconds === 30 || c.turnSeconds === 60 || c.turnSeconds === 90) s.config.turnSeconds = c.turnSeconds;
        this.broadcast();
        break;
      }
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (s.players.filter(p => p.connected).length < MIN_PLAYERS) return;
        this.clear();
        startGame(s);
        this.sync();
        break;
      }
      // Turn actions arrive as top-level actions (the transports forward
      // nightAction(kind) verbatim — see transport/net.ts).
      case 'declareAction':
        if (typeof msg.kind === 'string' && declareAction(s, player, msg.kind as ActionKind, msg.targetId)) this.sync();
        break;
      case 'respond':
        if (typeof msg.move === 'string' && respond(s, player, msg.move, msg.blockChar as CharKind | undefined)) this.sync();
        break;
      case 'respondBlockWindow':
        if (typeof msg.move === 'string' && respondBlockWindow(s, player, msg.move, msg.blockChar as CharKind | undefined)) this.sync();
        break;
      case 'respondBlock':
        if (typeof msg.move === 'string' && respondBlock(s, player, msg.move)) this.sync();
        break;
      case 'chooseLose':
        if (msg.cardId && chooseLose(s, player, msg.cardId)) this.sync();
        break;
      case 'chooseExchange':
        if (Array.isArray(msg.keepCardIds) && chooseExchange(s, player, msg.keepCardIds)) this.sync();
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
          s.phase = 'lobby'; s.turn = null; s.turnEndsAt = null; s.pending = null;
          s.winner = null; s.eliminationOrder = []; s.feed = [];
          s.players.forEach(p => { p.hand = []; p.revealed = []; p.coins = 0; p.eliminated = false; });
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
      if (s.players.length && !s.players.some(x => x.isHost)) {
        const next = s.players[0];
        next.isHost = true;
      }
    } else if (p.isHost) {
      const next = s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    // A disconnected player never holds the table: an open choice of
    // theirs resolves to its default at once; in a response window they
    // count as passed; if it was their turn to act, the turn passes.
    if (s.phase === 'playing') {
      const pending = s.pending;
      if ((pending?.stage === 'chooseLose' && pending.playerId === playerId)
        || (pending?.stage === 'exchange' && pending.actorId === playerId)) {
        autoStep(s);
      } else if (pending?.stage === 'respond' || pending?.stage === 'blockWindow' || pending?.stage === 'blockRespond') {
        markPassed(s, playerId);
      }
      if (s.turn === playerId && s.pending === null) advanceTurn(s);
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

// Re-exported so GameApp can mirror the engine's legality in the UI
// (the engine still enforces everything; this only dims buttons).
export { legalActions };
