// Authoritative host engine — the SAME rules as the Socket.IO server, run by
// the host player's browser in the peer/bus transports. All validation happens
// here; clients only send intents. Private snapshots leave the engine only
// through sendPriv(playerId, ...) — each transport must deliver them ONLY to
// that player (PeerJS: their data channel. MQTT: their ECDH-encrypted topic).
import {
  GameState, Player, createGame, assignRolesAndDice, publicState, privateState,
  doSteal, doInspect, castVote, resolveVotes, canSteal, thiefOf,
  autoInspectIdle, applyDefaultVotes,
  chooseFollower, autoResolveFollowerChoice, recruitCount, followers, recordHour,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, RECRUIT_MS, DISCUSSION_MS, VOTE_MS,
} from '../../../../games/cheese-thief/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
  /** Out-of-band error signal to one player (e.g. 'KICKED'). Optional. */
  sendError?(playerId: string, msg: string): void;
}

const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';

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
  addPlayer(id: string, name: string, isHost: boolean, avatar?: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; if (avatar) p.avatar = avatar; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null, peeks: [], wins: 0, avatar };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear(); assignRolesAndDice(this.state); this.state.phase = 'roleReveal'; this.broadcast();
    this.later(30000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
  }
  startNight() {
    this.state.phase = 'night';
    this.nightStep(1);
  }
  /** One hour boundary. Extracted as a method so resumeTimers() can
   *  re-enter the chain after a host migration. */
  nightStep(h: number) {
    const s = this.state;
    if (s.phase !== 'night') return;
    // The previous hour just ended: defaults for anything a player forgot —
    // a lone waker who never peeked gets a random peek, and if the thief
    // never picked between witnesses (5p), the choice is made for them.
    autoInspectIdle(s);
    autoResolveFollowerChoice(s);
    if (h > 6) {
      if (recruitCount(s) > 0) this.startRecruit();
      else this.startDay();
      return;
    }
    s.currentHour = h; s.hourEndsAt = Date.now() + HOUR_MS;
    recordHour(s);
    s.players.forEach(p => { p.hasActedThisHour = false; });
    // The Cheese Mouse ALWAYS takes the cheese when their hour comes —
    // stealing is automatic, never a button the player can forget.
    const thief = thiefOf(s);
    if (thief && canSteal(s, thief)) doSteal(s, thief);
    this.broadcast(); this.later(HOUR_MS, () => this.nightStep(h + 1));
  }
  /** Re-arm the phase timers of a RESTORED state (host migration): every
   *  phase deadline lives in the state itself, so the successor engine
   *  simply re-schedules whatever the dead host had pending. */
  resumeTimers() {
    const s = this.state;
    const remain = (ts?: number | null) => Math.max(0, (ts ?? 0) - Date.now());
    if (s.phase === 'roleReveal') {
      this.later(30000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
    } else if (s.phase === 'night') {
      this.later(remain(s.hourEndsAt), () => this.nightStep(s.currentHour + 1));
    } else if (s.phase === 'recruit') {
      this.later(remain(s.recruitEndsAt), () => {
        if (this.state.phase !== 'recruit') return;
        autoResolveFollowerChoice(this.state);
        this.startDay();
      });
    } else if (s.phase === 'day') {
      this.later(remain(s.discussionEndsAt), () => { if (this.state.phase === 'day') this.startVoting(); });
    } else if (s.phase === 'voting') {
      this.later(remain(s.voteEndsAt), () => { if (this.state.phase === 'voting') this.finishVoting(); });
    }
  }
  /** Stop a superseded engine (its room migrated to a successor host). */
  dispose() { this.clear(); }
  startRecruit() {
    const s = this.state;
    s.phase = 'recruit'; s.recruitEndsAt = Date.now() + RECRUIT_MS; this.broadcast();
    this.later(RECRUIT_MS, () => {
      if (s.phase !== 'recruit') return;
      autoResolveFollowerChoice(s); // thief idled: random recruits
      this.startDay();
    });
  }
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
  finishVoting() { this.clear(); applyDefaultVotes(this.state); resolveVotes(this.state); this.broadcast(); }
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
        // Advance when all but one connected player is ready: one AFK
        // player must not hold the whole table (A19).
        const pool = s.players.filter(p => p.connected);
        if (pool.filter(p => s.revealReady.includes(p.id)).length >= Math.max(1, pool.length - 1)) { this.clear(); this.startNight(); }
        else this.broadcast();
        break;
      }
      case 'readyVote': {
        if (s.phase !== 'day') break;
        if (!s.dayReady.includes(player.id)) s.dayReady.push(player.id);
        const pool = s.players.filter(p => p.connected);
        if (pool.filter(p => s.dayReady.includes(p.id)).length >= Math.max(1, pool.length - 1)) this.startVoting();
        else this.broadcast();
        break;
      }
      case 'steal': doSteal(s, player); this.broadcast(); break;
      case 'chooseFollower':
        if (msg.targetId && chooseFollower(s, player, msg.targetId)) {
          if (s.phase === 'recruit' && followers(s).length >= recruitCount(s)) { this.clear(); this.startDay(); }
          else this.broadcast();
        }
        break;
      case 'inspect': if (msg.targetId) doInspect(s, player, msg.targetId); this.broadcast(); break;
      case 'chat': {
        // Chat is open almost everywhere — lobby, NIGHT (players asked to
        // chat while "sleeping" so the wait isn't dead time), recruit, day
        // and results. Only the secret ballot (voting) stays locked.
        if (s.phase === 'voting' || s.phase === 'roleReveal') return;
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
          if (s.players.every(p => !p.connected || p.hasVoted)) this.finishVoting();
        }
        break;
      case 'kick': {
        // Host-only, lobby-only: remove a player before the round starts.
        // (Mid-game removal belongs to the vote — a host must not be able to
        // rig a round.) The kicked client gets a KICKED signal and may rejoin.
        if (!player.isHost || s.phase !== 'lobby' || !msg.targetId || msg.targetId === player.id) break;
        const target = s.players.find(p => p.id === msg.targetId);
        if (!target || target.isHost) break;
        s.players = s.players.filter(p => p.id !== target.id);
        this.hooks.sendError?.(target.id, 'KICKED');
        this.broadcast();
        break;
      }
      case 'setDiscussion': {
        // Room option (Cycle 6): host-only, lobby-only, fixed choices.
        if (!player.isHost || s.phase !== 'lobby') break;
        if (![60000, 120000, 180000].includes(msg.ms)) break;
        s.discussionMs = msg.ms;
        this.broadcast();
        break;
      }
      case 'playAgain':
        if (player.isHost && s.phase === 'results') {
          s.round++; s.phase = 'lobby';
          s.players.forEach(p => { p.role = undefined; p.dice = undefined; p.isFollower = false; p.vote = null; p.hasVoted = false; p.inspectedDice = null; p.peeks = []; });
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
    if (s.phase === 'voting' && s.players.filter(x => x.connected).every(x => x.hasVoted) && s.players.some(x => x.connected)) this.finishVoting();
    else this.broadcast();
  }
  canAcceptJoin(playerId: string): 'ok' | 'started' | 'full' {
    if (this.state.players.some(p => p.id === playerId)) return 'ok';
    if (this.state.phase !== 'lobby') return 'started';
    if (this.state.players.length >= MAX_PLAYERS) return 'full';
    return 'ok';
  }
}
