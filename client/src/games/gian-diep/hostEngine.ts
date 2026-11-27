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
  publicState, privateState, connectedPlayers, addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS, REVEAL_MS,
} from '../../../../games/gian-diep/logic';
import type { Config } from '../../../../games/gian-diep/logic';
import {
  botAskTarget, botShouldAccuse, botVoteYes, botSpyGuessLocation,
  botFinalPick, botPickQuestion, botPickAnswer,
} from '../../../../games/gian-diep/bots';

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
  /** Bot actions already scheduled (one key per decision). driveBots()
   *  re-runs after every broadcast, so without this a bot would collect
   *  a new timer on every state change. Keys are scoped to the phase /
   *  asker / vote, so a fresh decision always gets a fresh key. */
  private botPending = new Set<string>();
  private botPhaseKey = '';
  /** Bot timers live apart from the phase timers: armTimers() clears
   *  this.timers on every sync, and a bot decision must survive that. */
  private botTimers: ReturnType<typeof setTimeout>[] = [];
  /** Bots that were asked a question and owe an (vague) answer before
   *  they ask the next player. */
  private botWasAsked = new Set<string>();
  /** Bot spies that survived being accused: they reveal and guess blind
   *  as soon as the vote closes (a guess DURING a vote is refused by
   *  the rules, so this cannot fire while the vote is open). */
  private spyGuessPending = new Set<string>();
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private laterBot(ms: number, fn: () => void) { this.botTimers.push(setTimeout(fn, ms)); }
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
    this.laterBot(ms, () => { this.botPending.delete(key); fn(); });
  }
  private botDelay(min: number, spread: number) { return min + Math.random() * spread; }
  private botChat(b: Player, text: string) {
    this.state.chat.push({ fromId: b.id, fromName: b.name, text, ts: Date.now() });
    if (this.state.chat.length > 100) this.state.chat = this.state.chat.slice(-100);
  }

  /** Make sure every bot that owes an action has one scheduled. Called
   *  after every broadcast, so a bot whose turn just came up is picked
   *  up at once. */
  private driveBots() {
    const s = this.state;
    // No human host left (a bot inherited host after migration): advance
    // past the round-end screen instead of stalling there forever.
    if (s.phase === 'roundEnd') {
      const host = s.players.find(p => p.isHost);
      if (host?.isBot) this.scheduleBot(`nextround:${s.round}`, this.botDelay(1500, 1500), () => {
        if (this.state.phase !== 'roundEnd') return;
        nextRound(this.state);
        this.sync();
      });
      return;
    }
    if (s.phase !== 'questioning') { this.botWasAsked.clear(); this.spyGuessPending.clear(); }
    const phaseKey = `${s.phase}:${s.round}:${s.currentAskerId ?? ''}:${s.accusation?.suspectId ?? ''}:${s.finalPhase}:${s.finalIdx}:${s.finalVote?.suspectId ?? ''}:${s.revealReady.length}`;
    if (phaseKey !== this.botPhaseKey) { this.botPhaseKey = phaseKey; this.botPending.clear(); }
    const bots = s.players.filter(p => p.isBot && p.connected);
    if (!bots.length) return;
    if (s.phase === 'roleReveal') {
      for (const b of bots) {
        if (s.revealReady.includes(b.id)) continue;
        this.scheduleBot(`reveal:${s.round}:${b.id}`, this.botDelay(1000, 1500), () => this.botRevealReady(b));
      }
      return;
    }
    if (s.phase !== 'questioning') return;
    // A bot spy that survived an accusation reveals and guesses blind
    // as soon as the vote is closed (never during the vote itself).
    if (!s.accusation && !s.finalVote) {
      for (const b of bots) {
        if (!this.spyGuessPending.has(b.id) || s.spyId !== b.id) continue;
        this.scheduleBot(`spyguess:${s.round}:${b.id}`, this.botDelay(1000, 1500), () => this.botSpyGuessAct(b));
      }
    }
    if (s.accusation) {
      const suspect = s.players.find(p => p.id === s.accusation!.suspectId);
      if (suspect?.isBot && suspect.id === s.spyId) this.spyGuessPending.add(suspect.id);
      for (const b of bots) {
        if (b.id === s.accusation.suspectId || s.accusation.votes[b.id] !== undefined) continue;
        this.scheduleBot(`vote:${s.round}:${s.accusation.accuserId}:${b.id}`, this.botDelay(1000, 1500), () => this.botVoteCast(b));
      }
      return;
    }
    if (s.finalVote) {
      for (const b of bots) {
        if (b.id === s.finalVote.suspectId || s.finalVote.votes[b.id] !== undefined) continue;
        this.scheduleBot(`fvote:${s.round}:${s.finalOrder[s.finalIdx]}:${b.id}`, this.botDelay(1000, 1500), () => this.botVoteCast(b));
      }
      return;
    }
    if (s.finalPhase) {
      const accuser = s.players.find(p => p.id === s.finalOrder[s.finalIdx]);
      if (accuser?.isBot) {
        this.scheduleBot(`final:${s.round}:${s.finalIdx}:${accuser.id}`, this.botDelay(1000, 1500), () => this.botFinalPickAct(accuser));
      }
      return;
    }
    const asker = s.players.find(p => p.id === s.currentAskerId);
    if (asker?.isBot) {
      this.scheduleBot(`ask:${s.round}:${asker.id}`, this.botDelay(1000, 1500), () => this.botAskTurn(asker));
    }
  }

  /** One bot's decision, run through the same validated logic a
   *  human's tap goes through. */
  private botRevealReady(b: Player) {
    const s = this.state;
    if (s.phase !== 'roleReveal' || s.revealReady.includes(b.id)) return;
    s.revealReady.push(b.id);
    const pool = connectedPlayers(s);
    if (s.revealReady.filter(id => pool.some(p => p.id === id)).length >= Math.max(1, pool.length - 1)) {
      startQuestioning(s);
    }
    this.sync();
  }
  private botAskTurn(b: Player) {
    const s = this.state;
    if (s.phase !== 'questioning' || s.finalPhase || s.accusation || s.finalVote) return;
    if (s.currentAskerId !== b.id || !b.connected) return;
    // Answer first if this bot was asked a question (vague by design).
    if (this.botWasAsked.has(b.id)) {
      this.botWasAsked.delete(b.id);
      this.botChat(b, botPickAnswer());
    }
    const suspect = botShouldAccuse(s, b);
    if (suspect && accuse(s, b, suspect)) { this.sync(); return; }
    const target = botAskTarget(s, b);
    if (target && askTarget(s, b, target)) {
      const t = s.players.find(p => p.id === target);
      if (t?.isBot) this.botWasAsked.add(target);
      this.botChat(b, botPickQuestion());
      this.sync();
    }
  }
  private botVoteCast(b: Player) {
    const s = this.state;
    if (s.phase !== 'questioning') return;
    const a = s.accusation;
    const fv = s.finalVote;
    if (!a && !fv) return;
    const suspectId = a?.suspectId ?? fv?.suspectId;
    if (!suspectId || b.id === suspectId || !b.connected) return;
    if ((a ? a.votes[b.id] : fv!.votes[b.id]) !== undefined) return;
    const yes = botVoteYes(s, b, Math.random, !!fv);
    if (a) voteAccuse(s, b, yes);
    else finalVote(s, b, yes);
    this.sync();
  }
  private botFinalPickAct(b: Player) {
    const s = this.state;
    if (s.phase !== 'questioning' || !s.finalPhase || s.finalVote) return;
    if (s.finalOrder[s.finalIdx] !== b.id || !b.connected) return;
    if (finalPick(s, b, botFinalPick(s, b))) this.sync();
  }
  private botSpyGuessAct(b: Player) {
    const s = this.state;
    if (s.phase !== 'questioning' || s.accusation || s.finalVote) return;
    if (s.spyId !== b.id || !b.connected) return;
    this.spyGuessPending.delete(b.id);
    if (spyGuess(s, b, botSpyGuessLocation())) this.sync();
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
  dispose() { this.clear(); this.botTimers.forEach(clearTimeout); this.botTimers = []; this.botPending.clear(); }
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
        if (typeof msg.targetId === 'string' && askTarget(s, player, msg.targetId)) {
          const t = s.players.find(p => p.id === msg.targetId);
          if (t?.isBot) this.botWasAsked.add(t.id);
          this.sync();
        }
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
