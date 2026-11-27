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
  canInspect, followerCandidates, addBot, removeBot,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, RECRUIT_MS, DISCUSSION_MS, VOTE_MS,
} from '../../../../games/cheese-thief/logic';
import { botInspectTarget, botFollowerPick, botVote } from '../../../../games/cheese-thief/bots';

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
  /** Bot actions already scheduled (one key per decision). driveBots()
   *  re-runs after every broadcast, so without this a bot would collect
   *  a new timer on every state change. Keys are scoped to the phase /
   *  hour / round, so a fresh decision always gets a fresh key. */
  private botPending = new Set<string>();
  private botPhaseKey = '';
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
   *  transition is simply re-scheduled. */
  private driveBots() {
    const s = this.state;
    const phaseKey = `${s.phase}:${s.currentHour}:${s.round}`;
    if (phaseKey !== this.botPhaseKey) { this.botPhaseKey = phaseKey; this.botPending.clear(); }
    const bots = s.players.filter(p => p.isBot && p.connected);
    if (!bots.length) return;
    if (s.phase === 'roleReveal') {
      for (const b of bots) {
        if (s.revealReady.includes(b.id)) continue;
        this.scheduleBot(`reveal:${s.round}:${b.id}`, this.botDelay(1000, 1500), () => {
          if (this.state.phase !== 'roleReveal' || this.state.revealReady.includes(b.id)) return;
          this.state.revealReady.push(b.id);
          const pool = this.state.players.filter(p => p.connected);
          if (pool.filter(p => this.state.revealReady.includes(p.id)).length >= Math.max(1, pool.length - 1)) { this.clear(); this.startNight(); }
          else this.broadcast();
        });
      }
      return;
    }
    if (s.phase === 'night') {
      // 5p: a witness saw the theft and the thief bot must pick one as a
      // follower before the hour ends (otherwise the engine picks at random).
      const thiefBot = bots.find(p => p.role === 'thief');
      if (thiefBot && s.pendingFollowerChoice?.length) {
        this.scheduleBot(`follower:${s.round}:${s.currentHour}:${thiefBot.id}`, this.botDelay(1000, 1500), () => this.botChooseFollower(thiefBot));
      }
      for (const b of bots) {
        if (!canInspect(s, b)) continue;
        // Capture the hour NOW: s.currentHour at fire time may already be
        // the next hour, which would defeat botInspect's stale-timer guard.
        const hour = s.currentHour;
        this.scheduleBot(`inspect:${s.round}:${hour}:${b.id}`, this.botDelay(1000, 1500), () => this.botInspect(b, hour));
      }
      return;
    }
    if (s.phase === 'recruit') {
      const thiefBot = bots.find(p => p.role === 'thief');
      // The key carries the follower count, so the second recruit (7–8p)
      // gets a fresh schedule after the first one lands.
      if (thiefBot && followerCandidates(s, thiefBot)?.length) {
        this.scheduleBot(`recruit:${s.round}:${thiefBot.id}:${followers(s).length}`, this.botDelay(1000, 1500), () => this.botChooseFollower(thiefBot));
      }
      return;
    }
    if (s.phase === 'day') {
      // Bots let the humans talk first: they only ready after 20–40s.
      for (const b of bots) {
        if (s.dayReady.includes(b.id)) continue;
        this.scheduleBot(`day:${s.round}:${b.id}`, this.botDelay(20000, 20000), () => {
          if (this.state.phase !== 'day' || this.state.dayReady.includes(b.id)) return;
          this.state.dayReady.push(b.id);
          const pool = this.state.players.filter(p => p.connected);
          if (pool.filter(p => this.state.dayReady.includes(p.id)).length >= Math.max(1, pool.length - 1)) this.startVoting();
          else this.broadcast();
        });
      }
      return;
    }
    if (s.phase === 'voting') {
      for (const b of bots) {
        if (b.hasVoted) continue;
        this.scheduleBot(`vote:${s.round}:${b.id}`, this.botDelay(1000, 1500), () => this.botVoteCast(b));
      }
    }
  }

  /** One bot's night peek, run through the same validated logic a
   *  human's tap goes through. The hour is captured at schedule time so
   *  a stale timer can never peek in the wrong hour. */
  private botInspect(b: Player, hour: number) {
    const s = this.state;
    if (s.phase !== 'night' || s.currentHour !== hour) return;
    const target = botInspectTarget(s, b);
    if (target && doInspect(s, b, target)) this.broadcast();
  }
  /** One bot thief's follower pick (5p witness choice or post-night
   *  recruit), run through the same validated logic as a human's tap. */
  private botChooseFollower(b: Player) {
    const s = this.state;
    const target = botFollowerPick(s, b);
    if (!target) return;
    if (chooseFollower(s, b, target)) {
      if (s.phase === 'recruit' && followers(s).length >= recruitCount(s)) { this.clear(); this.startDay(); }
      else this.broadcast();
    }
  }
  private botVoteCast(b: Player) {
    const s = this.state;
    if (s.phase !== 'voting' || b.hasVoted) return;
    const target = botVote(s, b);
    if (target && castVote(s, b, target)) {
      this.broadcast();
      if (s.players.every(p => !p.connected || p.hasVoted)) this.finishVoting();
    }
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
    // Re-run the bot driver: the old engine's bot timers died with it.
    this.broadcast();
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
      // Lobby setup (host only): bots fill the table when humans are short.
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
