// Authoritative host engine — the SAME rules as the Socket.IO server, run by
// the host player's browser in the peer/bus transports. All validation happens
// here; clients only send intents. Private snapshots leave the engine only
// through sendPriv(playerId, ...) — each transport must deliver them ONLY to
// that player (PeerJS: their data channel. MQTT: their ECDH-encrypted topic).
import {
  GameState, Player, createGame, assignRolesAndDice, publicState, privateState,
  doSteal, doInspect, castVote, resolveVotes,
  MIN_PLAYERS, MAX_PLAYERS, HOUR_MS, DISCUSSION_MS, VOTE_MS,
} from '../../shared/logic';

export type Pub = ReturnType<typeof publicState>;
export type Priv = ReturnType<typeof privateState>;

export interface EngineHooks {
  sendPub(pub: Pub): void;
  sendPriv(playerId: string, priv: Priv): void;
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
  addPlayer(id: string, name: string, isHost: boolean): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) { p.connected = true; return p; }
    p = { id, name: cleanName(name), isHost, connected: true, hasActedThisHour: false, hasVoted: false, vote: null, inspectedDice: null };
    this.state.players.push(p); return p;
  }
  startRound() {
    this.clear(); assignRolesAndDice(this.state); this.state.phase = 'roleReveal'; this.broadcast();
    this.later(45000, () => { if (this.state.phase === 'roleReveal') this.startNight(); });
  }
  startNight() {
    const s = this.state; s.phase = 'night';
    const step = (h: number) => {
      if (s.phase !== 'night') return;
      if (h > 6) {
        s.phase = 'day'; s.dayReady = []; s.discussionEndsAt = Date.now() + DISCUSSION_MS; this.broadcast();
        this.later(DISCUSSION_MS, () => { if (s.phase === 'day') this.startVoting(); });
        return;
      }
      s.currentHour = h; s.hourEndsAt = Date.now() + HOUR_MS;
      s.players.forEach(p => { p.hasActedThisHour = false; });
      this.broadcast(); this.later(HOUR_MS, () => step(h + 1));
    };
    step(1);
  }
  startVoting() {
    this.clear(); const s = this.state;
    s.phase = 'voting'; s.voteEndsAt = Date.now() + VOTE_MS; this.broadcast();
    this.later(VOTE_MS, () => { if (s.phase === 'voting') this.finishVoting(); });
  }
  finishVoting() { this.clear(); resolveVotes(this.state); this.broadcast(); }
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
        if (s.players.filter(p => p.connected).every(p => s.dayReady.includes(p.id))) this.startVoting();
        else this.broadcast();
        break;
      }
      case 'steal': doSteal(s, player); this.broadcast(); break;
      case 'inspect': if (msg.targetId) doInspect(s, player, msg.targetId); this.broadcast(); break;
      case 'chat': {
        if (s.phase !== 'day') return;
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
      case 'playAgain':
        if (player.isHost && s.phase === 'results') {
          s.round++; s.phase = 'lobby';
          s.players.forEach(p => { p.role = undefined; p.dice = undefined; p.vote = null; p.hasVoted = false; p.inspectedDice = null; });
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
