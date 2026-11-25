// Authoritative host engine — the SAME rules as games/ma-soi/logic.ts,
// run by the host player's browser in the peer/bus transports. All
// validation happens here; clients only send intents. Private snapshots
// leave the engine only through sendPriv(playerId, ...) — each transport
// must deliver them ONLY to that player (PeerJS: their data channel.
// MQTT: their ECDH-encrypted topic).
//
// The engine satisfies the platform's EngineLike surface (see
// client/src/transport/engines.ts) so the generic transports can run it
// without knowing Ma Sói from Cheese Thief.
import {
  GameState, Player, createGame, assignRoles, publicState, privateState,
  wolfPick, resolveWolfTarget, seerPeek, guardianProtect,
  witchSave, witchKill, hunterShoot, resolveNight,
  castVote, resolveVotes, applyDefaultVotes, checkWin,
  wolfChatMsg, wolfConfirm,
  MIN_PLAYERS, MAX_PLAYERS, NIGHT_STEP_MS, DISCUSSION_MS, VOTE_MS,
} from '../../../../games/ma-soi/logic';
import type { NightStep } from '../../../../games/ma-soi/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Wolf';

const STEP_ORDER: NightStep[] = ['hunter', 'wolves', 'seer', 'guardian', 'witch'];

export class HostEngine {
  state: GameState;
  timers: ReturnType<typeof setTimeout>[] = [];
  lastChat = new Map<string, number>();
  /** Wolves who explicitly passed this night (a pass is not a pick, so it
   *  must never reach resolveWolfTarget as a fake victim id). */
  private wolfPassed = new Set<string>();
  constructor(code: string, private hooks: EngineHooks) { this.state = createGame(code); }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }
  private clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  broadcast() {
    const pub = publicState(this.state);
    this.hooks.sendPub(pub);
    for (const p of this.state.players) this.hooks.sendPriv(p.id, privateState(this.state, p));
  }
  addPlayer(id: string, name: string, isHost: boolean): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; return p; }
    p = {
      id, name: cleanName(name), isHost, connected: true,
      alive: true, hasVoted: false, vote: null, wins: 0,
      seerPeeks: [], witchSaveLeft: true, witchKillLeft: true, witchActedNight: 0,
    };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear(); assignRoles(this.state); this.state.phase = 'roleReveal'; this.broadcast();
    this.later(45000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
  }
  startNight() {
    const s = this.state;
    s.night++; s.phase = 'night';
    s.nightDeaths = []; s.voteTie = false;
    s.wolfTarget = null; s.guardianTarget = null; s.witchKillTarget = null; s.witchSaved = false;
    s.players.forEach(p => { p.wolfPick = null; p.hasVoted = false; p.vote = null; });
    s.wolfChat = []; s.wolfConfirmed = [];
    this.wolfPassed.clear();
    // A hunter killed by the last vote shoots first, before the wolves.
    this.runNightStep(s.pendingHunterShot ? 'hunter' : 'wolves');
  }
  /** Begin one night step: deadline in the state, timer armed, broadcast. */
  private runNightStep(step: NightStep) {
    const s = this.state;
    if (s.phase !== 'night') return;
    if (step === 'hunter' && !s.pendingHunterShot) { this.runNightStep('wolves'); return; }
    // A step with no living actor is dead air — skip it at once instead of
    // burning the full 30s (e.g. a 6-player game has no witch at all).
    const alive = s.players.filter(p => p.alive);
    const hasActor =
      step === 'wolves' ? alive.some(p => p.role === 'wolf')
      : step === 'seer' ? alive.some(p => p.role === 'seer')
      : step === 'guardian' ? alive.some(p => p.role === 'guardian')
      : step === 'witch' ? alive.some(p => p.role === 'witch')
      : true;
    if (!hasActor) { this.advanceNightStepFrom(step); return; }
    s.nightStep = step; s.nightEndsAt = Date.now() + NIGHT_STEP_MS;
    this.broadcast();
    this.later(NIGHT_STEP_MS, () => this.advanceNightStep());
  }
  /** End the current step: resolve its outcome, move to the next step —
   *  or to day when the witch's step ends. Also the re-entry point for
   *  resumeTimers() after a host migration. */
  advanceNightStep() {
    const s = this.state;
    if (s.phase !== 'night' || !s.nightStep) return;
    this.advanceNightStepFrom(s.nightStep);
  }
  /** End one step (current or just-skipped) and move to the next. */
  private advanceNightStepFrom(step: NightStep) {
    const s = this.state;
    if (step === 'hunter') {
      s.pendingHunterShot = null; // the hunter never shot: no shot, by rule
      this.runNightStep('wolves');
      return;
    }
    if (step === 'wolves') {
      s.wolfTarget = resolveWolfTarget(s);
      this.runNightStep('seer');
      return;
    }
    if (step === 'seer') { this.runNightStep('guardian'); return; }
    if (step === 'guardian') { this.runNightStep('witch'); return; }
    // witch step ends the night: resolve deaths, then day (or results).
    resolveNight(s);
    const w = checkWin(s);
    if (w) { this.finishGame(w); return; }
    this.startDay();
  }
  /** Everyone who must act in this step already acted — move on early
   *  instead of burning the whole 30s. */
  private maybeAdvance(step: NightStep) {
    const s = this.state;
    if (s.phase !== 'night' || s.nightStep !== step) return;
    const alive = s.players.filter(p => p.alive);
    if (step === 'wolves') {
      const wolves = alive.filter(p => p.role === 'wolf');
      if (wolves.length && wolves.every(p => p.wolfPick || this.wolfPassed.has(p.id))) { this.clear(); this.advanceNightStep(); }
    } else if (step === 'seer') {
      const seer = alive.find(p => p.role === 'seer');
      if (!seer || seer.seerPeeks.length) { this.clear(); this.advanceNightStep(); }
    } else if (step === 'guardian') {
      const g = alive.find(p => p.role === 'guardian');
      if (!g || s.guardianTarget) { this.clear(); this.advanceNightStep(); }
    }
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): every
   *  phase deadline lives in the state itself, so the successor engine
   *  simply re-schedules whatever the dead host had pending. */
  resumeTimers() {
    const s = this.state;
    const remain = (ts?: number | null) => Math.max(0, (ts ?? 0) - Date.now());
    if (s.phase === 'roleReveal') {
      this.later(45000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
    } else if (s.phase === 'night') {
      this.later(remain(s.nightEndsAt), () => this.advanceNightStep());
    } else if (s.phase === 'day') {
      this.later(remain(s.discussionEndsAt), () => { if (this.state.phase === 'day') this.startVoting(); });
    } else if (s.phase === 'voting') {
      this.later(remain(s.voteEndsAt), () => { if (this.state.phase === 'voting') this.finishVoting(); });
    }
  }
  /** Stop a superseded engine (its room migrated to a successor host). */
  dispose() { this.clear(); }
  startDay() {
    const s = this.state;
    s.phase = 'day'; s.dayReady = []; s.discussionEndsAt = Date.now() + s.discussionMs; this.broadcast();
    this.later(s.discussionMs, () => { if (s.phase === 'day') this.startVoting(); });
  }
  startVoting() {
    this.clear(); const s = this.state;
    s.phase = 'voting'; s.voteEndsAt = Date.now() + VOTE_MS; this.broadcast();
    this.later(VOTE_MS, () => { if (s.phase === 'voting') this.finishVoting(); });
  }
  finishVoting() {
    this.clear(); applyDefaultVotes(this.state);
    resolveVotes(this.state);
    const w = checkWin(this.state);
    if (w) { this.finishGame(w); return; }
    this.startNight();
  }
  private finishGame(w: 'wolves' | 'villagers') {
    this.clear(); const s = this.state;
    s.winner = w; s.phase = 'results';
    for (const p of s.players) {
      const won = w === 'wolves' ? p.role === 'wolf' : p.role !== 'wolf';
      if (won) p.wins++;
    }
    this.broadcast();
  }
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
      case 'beginNight': if (player.isHost && s.phase === 'roleReveal') { this.clear(); this.startNight(); } break;
      case 'ready': {
        if (s.phase !== 'roleReveal') break;
        if (!s.revealReady.includes(player.id)) s.revealReady.push(player.id);
        if (s.players.filter(p => p.connected).every(p => s.revealReady.includes(p.id))) { this.clear(); this.startNight(); }
        else this.broadcast();
        break;
      }
      case 'readyVote': {
        if (s.phase !== 'day') break;
        if (!s.dayReady.includes(player.id)) s.dayReady.push(player.id);
        if (s.players.filter(p => p.connected && p.alive).every(p => s.dayReady.includes(p.id))) this.startVoting();
        else this.broadcast();
        break;
      }
      // Night actions arrive as top-level actions (the transports
      // forward nightAction(kind) verbatim — see transport/net.ts).
      // A pass moves a single-actor step on at once; a wolf pass counts
      // toward the wolves' consensus and retracts that wolf's pick.
      case 'wolfPick':
        // The lock lives in logic.wolfPick: a confirmed pick cannot change.
        if (msg.targetId && wolfPick(s, player, msg.targetId)) { this.maybeAdvance('wolves'); this.broadcast(); }
        break;
      case 'wolfConfirm': if (wolfConfirm(s, player)) this.broadcast(); break;
      case 'wolfChat': {
        // Wolves-only night chat (v35 mockup): same 400ms guard as public
        // chat; the messages ride privateState, so only wolves ever get them.
        if (s.phase !== 'night' || !player.alive || player.role !== 'wolf') break;
        const now = Date.now();
        if (now - (this.lastChat.get(player.id) ?? 0) < 400) break;
        this.lastChat.set(player.id, now);
        if (wolfChatMsg(s, player, String(msg.text ?? ''))) this.broadcast();
        break;
      }
      case 'wolfPass':
        if (s.phase === 'night' && s.nightStep === 'wolves' && player.alive && player.role === 'wolf') {
          player.wolfPick = null; s.wolfConfirmed = s.wolfConfirmed.filter(id => id !== player.id);
          this.wolfPassed.add(player.id);
          const wolves = s.players.filter(p => p.alive && p.role === 'wolf');
          if (wolves.every(p => p.wolfPick || this.wolfPassed.has(p.id))) { this.clear(); this.advanceNightStep(); } else this.broadcast();
        }
        break;
      case 'seerPeek': if (msg.targetId && seerPeek(s, player, msg.targetId)) { this.maybeAdvance('seer'); this.broadcast(); } break;
      case 'seerPass': if (s.phase === 'night' && s.nightStep === 'seer') { this.clear(); this.advanceNightStep(); } break;
      case 'guardProtect': if (msg.targetId && guardianProtect(s, player, msg.targetId)) { this.maybeAdvance('guardian'); this.broadcast(); } break;
      case 'guardPass': if (s.phase === 'night' && s.nightStep === 'guardian') { this.clear(); this.advanceNightStep(); } break;
      case 'witchSave': if (witchSave(s, player)) { this.clear(); this.advanceNightStep(); } break;
      case 'witchKill': if (msg.targetId && witchKill(s, player, msg.targetId)) { this.clear(); this.advanceNightStep(); } break;
      case 'witchPass': if (s.phase === 'night' && s.nightStep === 'witch') { this.clear(); this.advanceNightStep(); } break;
      case 'hunterShoot':
        if (msg.targetId && hunterShoot(s, player, msg.targetId)) {
          const w = checkWin(s);
          if (w) { this.finishGame(w); return; }
          this.clear(); this.advanceNightStep();
        }
        break;
      case 'hunterPass': if (s.phase === 'night' && s.nightStep === 'hunter') { this.clear(); this.advanceNightStep(); } break;
      case 'chat': {
        // Chat is open in the lobby, during the day and on results. It is
        // LOCKED at night (a villager could blurt out their role), during
        // the secret ballot and while roles are being revealed.
        if (s.phase === 'night' || s.phase === 'voting' || s.phase === 'roleReveal') return;
        const now = Date.now();
        if (now - (this.lastChat.get(player.id) ?? 0) < 400) return;
        this.lastChat.set(player.id, now);
        const text = String(msg.text ?? '').replace(/[<>]/g, '').trim().slice(0, 300);
        if (text) { s.chat.push({ fromId: player.id, fromName: player.name, text, ts: now }); this.broadcast(); }
        break;
      }
      case 'toVoting': if (player.isHost && s.phase === 'day') this.startVoting(); break;
      case 'vote':
        if (castVote(s, player, msg.targetId)) {
          this.broadcast();
          if (s.players.every(p => !p.connected || !p.alive || p.hasVoted)) this.finishVoting();
        }
        break;
      case 'kick': {
        if (!player.isHost || s.phase !== 'lobby' || !msg.targetId || msg.targetId === player.id) break;
        const target = s.players.find(p => p.id === msg.targetId);
        if (!target || target.isHost) break;
        s.players = s.players.filter(p => p.id !== target.id);
        this.hooks.sendError?.(target.id, 'KICKED');
        this.broadcast();
        break;
      }
      case 'setDiscussion': {
        if (!player.isHost || s.phase !== 'lobby') break;
        if (![60000, 120000, 180000].includes(msg.ms)) break;
        s.discussionMs = msg.ms;
        this.broadcast();
        break;
      }
      case 'playAgain':
        if (player.isHost && s.phase === 'results') {
          s.round++; s.phase = 'lobby';
          s.players.forEach(p => { p.role = undefined; p.alive = true; p.vote = null; p.hasVoted = false; });
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
    if (s.phase === 'voting' && s.players.filter(x => x.connected && x.alive).every(x => x.hasVoted) && s.players.some(x => x.connected && x.alive)) this.finishVoting();
    else this.broadcast();
  }
  canAcceptJoin(playerId: string): 'ok' | 'started' | 'full' {
    if (this.state.players.some(p => p.id === playerId)) return 'ok';
    if (this.state.phase !== 'lobby') return 'started';
    if (this.state.players.length >= MAX_PLAYERS) return 'full';
    return 'ok';
  }
}
