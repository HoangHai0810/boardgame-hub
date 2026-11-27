// Authoritative host engine — the SAME rules as games/gian-diep/
// logic.ts, run by the host player's browser in the peer/bus
// transports. All validation happens here; clients only send intents.
// Private snapshots leave the engine only through sendPriv(playerId,
// ...) — each transport must deliver them ONLY to that player (PeerJS:
// their data channel. MQTT: their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Spyfall from Mèo Nổ, Uno, Ma Sói or Cheese Thief.
import {
  GameState, Player, createGame, dealRound, startQuestioning, askTarget, autoAsk,
  accuse, voteAccuse, resolveAccusation, maybeResolveAccusation, cancelAccusation,
  spyGuess, startFinalPhase, finalPick, finalVote, resolveFinalVote,
  maybeResolveFinalVote, cancelFinalVote, advanceFinal, nextRound,
  publicState, privateState, connectedPlayers,
  MIN_PLAYERS, MAX_PLAYERS, REVEAL_MS,
} from '../../../../games/gian-diep/logic';
import type { Config } from '../../../../games/gian-diep/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Gián điệp';

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
  /** Broadcast + re-arm every timer the current state needs. */
  private sync() { this.broadcast(); this.armTimers(); }
  private armTimers() {
    this.clear();
    const s = this.state;
    if (s.phase === 'roleReveal') {
      this.later(REVEAL_MS, () => {
        if (this.state.phase !== 'roleReveal') return;
        startQuestioning(this.state);
        this.sync();
      });
      return;
    }
    if (s.phase !== 'questioning') return;
    if (s.accusation) {
      const ms = Math.max(0, s.accusation.endsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'questioning' || !this.state.accusation) return;
        resolveAccusation(this.state);
        this.sync();
      });
      return; // the vote owns the clock until it closes
    }
    if (s.finalVote) {
      const ms = Math.max(0, s.finalVote.endsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'questioning' || !this.state.finalVote) return;
        resolveFinalVote(this.state);
        this.sync();
      });
      return;
    }
    if (s.finalPhase) {
      if (s.finalPickEndsAt) {
        const ms = Math.max(0, s.finalPickEndsAt - Date.now());
        this.later(ms, () => {
          if (this.state.phase !== 'questioning' || !this.state.finalPhase || this.state.finalVote) return;
          advanceFinal(this.state);
          this.sync();
        });
      }
      return;
    }
    if (s.roundEndsAt) {
      const ms = Math.max(0, s.roundEndsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'questioning' || this.state.finalPhase || this.state.accusation) return;
        startFinalPhase(this.state);
        this.sync();
      });
      // The ask window runs inside the round clock.
      if (s.askEndsAt) {
        const ams = Math.max(0, s.askEndsAt - Date.now());
        this.later(ams, () => {
          if (this.state.phase !== 'questioning' || this.state.finalPhase || this.state.accusation) return;
          autoAsk(this.state);
          this.sync();
        });
      }
      return;
    }
    if (s.askEndsAt) {
      const ms = Math.max(0, s.askEndsAt - Date.now());
      this.later(ms, () => {
        if (this.state.phase !== 'questioning' || this.state.finalPhase || this.state.accusation) return;
        autoAsk(this.state);
        this.sync();
      });
    }
  }
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, score: 0, roundWins: 0, avatar };
    this.state.players.push(p); return p;
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): the
   *  deadlines live in the state itself, so the successor engine simply
   *  re-schedules whatever the dead host had pending. */
  resumeTimers() {
    if (this.state.phase === 'roleReveal' || this.state.phase === 'questioning') this.armTimers();
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
        if (c.roundMinutes === 6 || c.roundMinutes === 8 || c.roundMinutes === 12) s.config.roundMinutes = c.roundMinutes;
        if (c.roundsTotal === 3 || c.roundsTotal === 5 || c.roundsTotal === 7) s.config.roundsTotal = c.roundsTotal;
        if (typeof c.rolesOn === 'boolean') s.config.rolesOn = c.rolesOn;
        if (typeof c.pointsOn === 'boolean') s.config.pointsOn = c.pointsOn;
        this.broadcast();
        break;
      }
      case 'startGame': {
        if (!player.isHost) return;
        if (s.phase !== 'lobby' && s.phase !== 'results') return;
        if (connectedPlayers(s).length < MIN_PLAYERS) return;
        if (s.phase === 'results') {
          s.round = 1;
          s.players.forEach(p => { p.score = 0; p.roundWins = 0; });
          s.dealerId = null;
        }
        dealRound(s);
        this.sync();
        break;
      }
      case 'ready': {
        if (s.phase !== 'roleReveal' || !player.connected) return;
        if (!s.revealReady.includes(player.id)) s.revealReady.push(player.id);
        // All but one ready is enough — one slow reader never holds the
        // table (the 30s reveal fallback covers the rest).
        const pool = connectedPlayers(s);
        if (s.revealReady.filter(id => pool.some(p => p.id === id)).length >= Math.max(1, pool.length - 1)) {
          startQuestioning(s);
        }
        this.sync();
        break;
      }
      // Turn actions arrive as top-level actions (the transports forward
      // nightAction(kind) verbatim — see transport/net.ts).
      case 'askTarget':
        if (typeof msg.targetId === 'string' && askTarget(s, player, msg.targetId)) this.sync();
        break;
      case 'accuse':
        if (typeof msg.targetId === 'string' && accuse(s, player, msg.targetId)) this.sync();
        break;
      case 'voteAccuse':
        if (typeof msg.yes === 'boolean' && voteAccuse(s, player, msg.yes)) this.sync();
        break;
      case 'spyGuess':
        if (typeof msg.locationIdx === 'number' && spyGuess(s, player, msg.locationIdx)) this.sync();
        break;
      case 'finalPick': {
        // msg.targetId === null means "pass".
        const target = msg.targetId === null ? null : (typeof msg.targetId === 'string' ? msg.targetId : undefined);
        if (target !== undefined && finalPick(s, player, target)) this.sync();
        break;
      }
      case 'finalVote':
        if (typeof msg.yes === 'boolean' && finalVote(s, player, msg.yes)) this.sync();
        break;
      case 'nextRound':
        if (player.isHost && s.phase === 'roundEnd') { nextRound(s); this.sync(); }
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
          s.round = 1;
          s.players.forEach(p => { p.score = 0; p.roundWins = 0; });
          s.dealerId = null;
          s.locationIdx = null; s.spyId = null; s.roleIdx = {};
          s.roundResult = null; s.phase = 'lobby';
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
    // A disconnected player never holds the table.
    if (s.phase === 'roleReveal') {
      s.revealReady = s.revealReady.filter(id => id !== playerId);
      const pool = connectedPlayers(s);
      if (s.revealReady.length >= Math.max(1, pool.length - 1)) startQuestioning(s);
    } else if (s.phase === 'questioning') {
      if (s.accusation?.suspectId === playerId) cancelAccusation(s);
      else maybeResolveAccusation(s);
      if (s.finalVote?.suspectId === playerId) cancelFinalVote(s);
      else maybeResolveFinalVote(s);
      if (s.phase === 'questioning' && s.finalPhase && s.finalOrder[s.finalIdx] === playerId && !s.finalVote) {
        advanceFinal(s);
      }
      if (s.phase === 'questioning' && !s.finalPhase && !s.accusation && s.currentAskerId === playerId) {
        const others = connectedPlayers(s);
        if (others.length) {
          s.currentAskerId = others[Math.floor(Math.random() * others.length)].id;
          s.askEndsAt = Date.now() + 30000;
        }
      }
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
