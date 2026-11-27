// Authoritative host engine — the SAME rules as games/love-letter/logic.ts,
// run by the host player's browser in the peer/bus transports. All
// validation happens here; clients only send intents. Private snapshots
// leave the engine only through sendPriv(playerId, ...) — each transport
// must deliver them ONLY to that player (PeerJS: their data channel.
// MQTT: their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Love Letter from Uno or Ma Sói.
import {
  GameState, Player, createGame, startRound, publicState, privateState,
  playCard, chooseTarget, autoTurn, advanceTurn,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../../../../games/love-letter/logic';
import type { CardKind } from '../../../../games/love-letter/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Love';

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
  /** Broadcast + re-arm the turn timer (the only timer Love Letter has). */
  private sync() { this.broadcast(); this.armTurnTimer(); }
  private armTurnTimer() {
    this.clear();
    const s = this.state;
    if (s.phase !== 'playing' || !s.turnEndsAt) return;
    const ms = Math.max(0, s.turnEndsAt - Date.now());
    this.later(ms, () => {
      if (this.state.phase !== 'playing') return;
      autoTurn(this.state);
      this.sync();
    });
  }
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hand: [], discardPile: [], protected: false, inRound: true, tokens: 0, roundWins: 0, avatar };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear();
    const s = this.state;
    startRound(s);
    this.sync();
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
        const c = msg.config as Partial<{ turnSeconds: number; quickMode: boolean }> | undefined;
        if (!c) return;
        if (c.turnSeconds === 30 || c.turnSeconds === 60 || c.turnSeconds === 90) s.config.turnSeconds = c.turnSeconds;
        if (typeof c.quickMode === 'boolean') s.config.quickMode = c.quickMode;
        this.broadcast();
        break;
      }
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (s.players.filter(p => p.connected).length < MIN_PLAYERS) return;
        if (s.phase === 'results') {
          // A fresh session: tokens reset, round 1.
          s.round = 1;
          s.sessionWinner = null;
          s.players.forEach(p => { p.tokens = 0; p.roundWins = 0; });
        }
        this.startRound(); break;
      }
      case 'nextRound': {
        if (!player.isHost || s.phase !== 'roundEnd') return;
        s.round++;
        this.startRound(); break;
      }
      // Turn actions arrive as top-level actions (the transports forward
      // nightAction(kind) verbatim — see transport/net.ts).
      case 'playCard':
        if (msg.cardId && playCard(s, player, msg.cardId)) this.sync();
        break;
      case 'chooseTarget':
        if (msg.targetId && chooseTarget(s, player, msg.targetId, msg.guess as CardKind | undefined)) this.sync();
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
          s.round = 1; s.phase = 'lobby'; s.turn = null; s.turnEndsAt = null;
          s.sessionWinner = null; s.roundWinners = []; s.roundResult = null;
          s.players.forEach(p => { p.hand = []; p.discardPile = []; p.tokens = 0; p.roundWins = 0; p.protected = false; p.inRound = true; });
          this.broadcast();
        }
        break;
    }
  }
  disconnect(playerId: string) {
    const s = this.state; const p = s.players.find(x => x.id === playerId); if (!p) return;
    p.connected = false;
    if (s.phase === 'lobby' || s.phase === 'roundEnd' || s.phase === 'results') {
      s.players = s.players.filter(x => x.id !== playerId);
      if (s.players.length && !s.players.some(x => x.isHost)) s.players[0].isHost = true;
    } else if (p.isHost) {
      const next = s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    // A disconnected player never holds the turn: if they were mid-effect
    // choice, the effect fizzles; then the turn passes at once so the
    // table never stalls on an empty chair.
    if (s.phase === 'playing' && s.turn === playerId) {
      if (s.pendingAction?.actorId === playerId) {
        s.pendingAction = null;
        if (s.lastPlay) s.lastPlay.outcome = 'no-target';
      }
      advanceTurn(s);
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
