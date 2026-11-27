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
  playCard, chooseTarget, resolveChancellor, cancelPending, autoTurn, advanceTurn,
  addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS,
} from '../../../../games/love-letter/logic';
import { botAct } from '../../../../games/love-letter/bots';
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
  /** Bot actions already scheduled (one key per decision). driveBots()
   *  re-runs after every broadcast, so without this a bot would collect
   *  a new timer on every state change. Keys are scoped to the round /
   *  turn / pending effect, so a fresh decision always gets a fresh key. */
  private botPending = new Set<string>();
  private botPhaseKey = '';
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; this.botPending.clear(); }
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

  /** Make sure the bot that owes an action has one scheduled. Called
   *  after every broadcast (and again at the end of sync, because
   *  armTurnTimer's clear() wipes the timers broadcast just scheduled),
   *  so a bot whose timer was wiped by a phase transition is simply
   *  re-scheduled. */
  private driveBots() {
    const s = this.state;
    // No human host left (a bot inherited host after migration): advance
    // past the round-end screen instead of stalling there forever.
    if (s.phase === 'roundEnd') {
      const host = s.players.find(p => p.isHost);
      if (host?.isBot) this.scheduleBot(`nextround:${s.round}`, this.botDelay(1500, 1500), () => {
        if (this.state.phase !== 'roundEnd') return;
        this.state.round++;
        this.startRound();
      });
      return;
    }
    if (s.phase !== 'playing') return;
    const phaseKey = `${s.phase}:${s.round}:${s.turn}:${s.pendingAction?.type ?? ''}:${s.pendingAction?.actorId ?? ''}`;
    if (phaseKey !== this.botPhaseKey) { this.botPhaseKey = phaseKey; this.botPending.clear(); }
    const bots = s.players.filter(p => p.isBot && p.connected && p.inRound);
    if (!bots.length) return;
    // A bot with an open effect to resolve (its own play opened it).
    if (s.pendingAction) {
      const b = bots.find(p => p.id === s.pendingAction!.actorId);
      if (b) this.scheduleBot(`resolve:${s.round}:${b.id}:${s.pendingAction.type}`, this.botDelay(1000, 1500), () => this.botStep(b));
      return;
    }
    // Otherwise the bot whose turn it is plays a card.
    const actor = bots.find(p => p.id === s.turn);
    if (actor) this.scheduleBot(`play:${s.round}:${actor.id}`, this.botDelay(1000, 1500), () => this.botStep(actor));
  }

  /** One bot's turn step, run through the same validated logic a
   *  human's tap goes through (see games/love-letter/bots.ts). */
  private botStep(b: Player) {
    if (this.state.phase !== 'playing') return;
    if (botAct(this.state, b)) this.sync();
  }
  /** Broadcast + re-arm the turn timer (the only timer Love Letter has). */
  private sync() {
    this.broadcast();
    this.armTurnTimer();
    // armTurnTimer's clear() wiped the bot timers broadcast() scheduled
    // above (and their botPending keys) — re-schedule them now.
    this.driveBots();
  }
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
      case 'resolveChancellor':
        if (msg.keepCardId && resolveChancellor(s, player, msg.keepCardId)) this.sync();
        break;
      // Lobby setup (host only): bots fill the table when humans are
      // short, and count toward the minimum player count.
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
      // Host succession prefers a human: a bot host could never press
      // "start" / "next round" for the table.
      if (s.players.length && !s.players.some(x => x.isHost)) {
        const next = s.players.find(x => !x.isBot) ?? s.players[0];
        next.isHost = true;
      }
    } else if (p.isHost) {
      const next = s.players.find(x => x.connected && !x.isBot && x.id !== playerId)
        ?? s.players.find(x => x.connected && x.id !== playerId);
      if (next) s.players.forEach(x => { x.isHost = x.id === next.id; });
    }
    // A disconnected player never holds the turn: if they were mid-effect
    // choice, the effect fizzles; then the turn passes at once so the
    // table never stalls on an empty chair.
    if (s.phase === 'playing' && s.turn === playerId) {
      if (s.pendingAction?.actorId === playerId) {
        // cancelPending returns a Chancellor's extra drawn cards to the
        // bottom of the deck so the hand stays at one card.
        cancelPending(s);
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
