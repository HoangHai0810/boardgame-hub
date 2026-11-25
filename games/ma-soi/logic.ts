// Ma Sói (Werewolf) — rules engine. One source of truth for the game's
// rules, used by the browser host (client/src/games/ma-soi/hostEngine.ts).
// The dedicated Socket.IO server does NOT run this game yet (GAME_NOT_SUPPORTED);
// the public MQTT/PeerJS transports use the browser host engine.
//
// Night order: hunter (only if a hunter died and has a shot pending) ->
// wolves -> seer -> guardian -> witch -> day. Every night step has a
// deadline; a player who forgets their action gets the safe default
// (no kill / no peek / no protect / no potion / no shot) — never a random
// irreversible action, except the vote, which defaults to a random target
// like every other game on this platform.

export type Role = 'wolf' | 'villager' | 'seer' | 'guardian' | 'witch' | 'hunter';
export type Phase = 'lobby' | 'roleReveal' | 'night' | 'day' | 'voting' | 'results';
export type NightStep = 'hunter' | 'wolves' | 'seer' | 'guardian' | 'witch' | null;

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;
export const NIGHT_STEP_MS = 30000;
export const DISCUSSION_MS = 120000;
export const VOTE_MS = 60000;

export interface ChatMsg { fromId: string; fromName: string; text: string; ts: number }
export interface Death { id: string; name: string; role: Role; cause: 'wolves' | 'witch' | 'vote' | 'hunter' }
export interface Peek { targetId: string; isWolf: boolean }

export interface Player {
  id: string; name: string; isHost: boolean; connected: boolean;
  role?: Role; alive: boolean;
  hasVoted: boolean; vote: string | null;
  wins: number;
  // Night actions (reset each night; private — never in publicState).
  wolfPick?: string | null; wolfPickTs?: number;
  seerPeeks: Peek[];
  witchSaveLeft: boolean; witchKillLeft: boolean; witchActedNight: number;
  guardianLastTarget?: string | null;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  round: number;
  night: number; // increments every night; the witch's one-potion guard keys on this
  players: Player[];
  discussionMs: number;
  nightStep: NightStep;
  nightEndsAt: number | null;
  discussionEndsAt: number | null;
  voteEndsAt: number | null;
  revealReady: string[];
  dayReady: string[];
  chat: ChatMsg[];
  // This night's working data (private parts are stripped from publicState).
  wolfTarget?: string | null;
  guardianTarget?: string | null;
  witchKillTarget?: string | null;
  witchSaved?: boolean;
  pendingHunterShot?: string | null; // id of a dead hunter who may still shoot
  nightDeaths: Death[];
  lastVoteOut: Death | null;
  voteTie: boolean;
  winner: 'wolves' | 'villagers' | null;
  /** Wolves-only night chat (v35 mockup: "Chat riêng của sói"). Kept in
   *  the state so it survives host migration; only wolves ever receive it
   *  (see privateState). Cleared each night. */
  wolfChat: ChatMsg[];
  /** Wolves who locked their pick with "Chốt lựa chọn" this night — a
   *  locked pick cannot be changed afterwards. */
  wolfConfirmed: string[];
}

export function createGame(code: string): GameState {
  return {
    roomCode: code, phase: 'lobby', round: 1, night: 0, players: [],
    discussionMs: DISCUSSION_MS, nightStep: null,
    nightEndsAt: null, discussionEndsAt: null, voteEndsAt: null,
    revealReady: [], dayReady: [], chat: [],
    nightDeaths: [], lastVoteOut: null, voteTie: false, winner: null,
    wolfChat: [], wolfConfirmed: [],
  };
}

/** Role distribution for a player count — shown in the lobby so the table
 *  knows exactly what it is signing up for. */
export function roleTable(n: number): { role: Role; count: number }[] {
  const wolves = n >= 9 ? 3 : 2;
  const table: { role: Role; count: number }[] = [
    { role: 'wolf', count: wolves },
    { role: 'seer', count: 1 },
    { role: 'guardian', count: 1 },
  ];
  if (n >= 8) table.push({ role: 'witch', count: 1 });
  if (n >= 10) table.push({ role: 'hunter', count: 1 });
  const special = table.reduce((a, t) => a + t.count, 0);
  table.push({ role: 'villager', count: n - special });
  return table;
}

export function assignRoles(s: GameState, rng: () => number = Math.random): void {
  const roles: Role[] = [];
  for (const t of roleTable(s.players.length)) for (let i = 0; i < t.count; i++) roles.push(t.role);
  for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[roles[i], roles[j]] = [roles[j], roles[i]]; }
  s.players.forEach((p, i) => {
    p.role = roles[i]; p.alive = true; p.hasVoted = false; p.vote = null;
    p.wolfPick = null; p.seerPeeks = []; p.witchSaveLeft = true; p.witchKillLeft = true;
    p.witchActedNight = 0; p.guardianLastTarget = null;
  });
  s.nightDeaths = []; s.lastVoteOut = null; s.voteTie = false; s.winner = null;
  s.pendingHunterShot = null; s.wolfTarget = null; s.guardianTarget = null;
  s.witchKillTarget = null; s.witchSaved = false;
  s.wolfChat = []; s.wolfConfirmed = [];
}

export const alive = (s: GameState) => s.players.filter(p => p.alive);
export const wolvesAlive = (s: GameState) => s.players.filter(p => p.alive && p.role === 'wolf');
export const villagersAlive = (s: GameState) => s.players.filter(p => p.alive && p.role !== 'wolf');
const byId = (s: GameState, id?: string | null) => s.players.find(p => p.id === id);

/** Win check — call after every death resolution. Wolves win on parity,
 *  villagers win when no wolf is left alive. */
export function checkWin(s: GameState): 'wolves' | 'villagers' | null {
  if (wolvesAlive(s).length === 0) return 'villagers';
  if (wolvesAlive(s).length >= villagersAlive(s).length) return 'wolves';
  return null;
}

function kill(s: GameState, p: Player, cause: Death['cause']): Death {
  p.alive = false;
  const d: Death = { id: p.id, name: p.name, role: p.role!, cause };
  if (p.role === 'hunter') s.pendingHunterShot = p.id;
  return d;
}

/* ---------- night actions (all validated; each returns whether it landed) ---------- */

export function wolfPick(s: GameState, wolf: Player, targetId: string): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'wolves') return false;
  if (!wolf.alive || wolf.role !== 'wolf') return false;
  if (s.wolfConfirmed.includes(wolf.id)) return false; // locked with "Chốt lựa chọn"
  const t = byId(s, targetId);
  if (!t || !t.alive || t.role === 'wolf') return false; // wolves never eat their own
  wolf.wolfPick = targetId; wolf.wolfPickTs = Date.now();
  return true;
}

/** Wolves-only night chat: only living wolves, only during the night.
 *  Villagers never receive these messages (privateState gates on role). */
export function wolfChatMsg(s: GameState, wolf: Player, text: string): boolean {
  if (s.phase !== 'night') return false;
  if (!wolf.alive || wolf.role !== 'wolf') return false;
  const clean = text.replace(/[<>]/g, '').trim().slice(0, 300);
  if (!clean) return false;
  s.wolfChat.push({ fromId: wolf.id, fromName: wolf.name, text: clean, ts: Date.now() });
  return true;
}

/** Lock a wolf's pick ("Chốt lựa chọn"): a locked pick cannot be changed
 *  afterwards. Requires a pick first — confirming nothing is meaningless. */
export function wolfConfirm(s: GameState, wolf: Player): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'wolves') return false;
  if (!wolf.alive || wolf.role !== 'wolf') return false;
  if (!wolf.wolfPick) return false;
  if (!s.wolfConfirmed.includes(wolf.id)) s.wolfConfirmed.push(wolf.id);
  return true;
}

/** The wolves' victim: majority of their picks; a tie falls to the
 *  earliest pick (deterministic, shown to the wolves as the outcome). */
export function resolveWolfTarget(s: GameState): string | null {
  const picks = s.players.filter(p => p.alive && p.role === 'wolf' && p.wolfPick);
  if (!picks.length) return null;
  const count = new Map<string, { n: number; ts: number }>();
  for (const p of picks) {
    const e = count.get(p.wolfPick!) ?? { n: 0, ts: p.wolfPickTs ?? 0 };
    e.n++; e.ts = Math.min(e.ts || p.wolfPickTs!, p.wolfPickTs!);
    count.set(p.wolfPick!, e);
  }
  let best: string | null = null; let bestN = 0; let bestTs = Infinity;
  for (const [id, e] of count) if (e.n > bestN || (e.n === bestN && e.ts < bestTs)) { best = id; bestN = e.n; bestTs = e.ts; }
  return best;
}

export function seerPeek(s: GameState, seer: Player, targetId: string): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'seer') return false;
  if (!seer.alive || seer.role !== 'seer') return false;
  const t = byId(s, targetId);
  if (!t || !t.alive || t.id === seer.id) return false;
  if (seer.seerPeeks.some(x => x.targetId === targetId)) return false;
  seer.seerPeeks.push({ targetId, isWolf: t.role === 'wolf' });
  return true;
}

export function guardianProtect(s: GameState, g: Player, targetId: string): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'guardian') return false;
  if (!g.alive || g.role !== 'guardian') return false;
  const t = byId(s, targetId);
  if (!t || !t.alive) return false;
  if (g.guardianLastTarget === targetId) return false; // never the same two nights running
  s.guardianTarget = targetId; g.guardianLastTarget = targetId;
  return true;
}

export function witchSave(s: GameState, w: Player): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'witch') return false;
  if (!w.alive || w.role !== 'witch' || !w.witchSaveLeft) return false;
  if (w.witchActedNight === s.night) return false; // one potion per night
  if (!s.wolfTarget) return false; // nobody to save tonight
  w.witchSaveLeft = false; w.witchActedNight = s.night; s.witchSaved = true;
  return true;
}

export function witchKill(s: GameState, w: Player, targetId: string): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'witch') return false;
  if (!w.alive || w.role !== 'witch' || !w.witchKillLeft) return false;
  if (w.witchActedNight === s.night) return false;
  const t = byId(s, targetId);
  if (!t || !t.alive || t.id === w.id) return false;
  w.witchKillLeft = false; w.witchActedNight = s.night; s.witchKillTarget = targetId;
  return true;
}

export function hunterShoot(s: GameState, h: Player, targetId: string): boolean {
  if (s.phase !== 'night' || s.nightStep !== 'hunter') return false;
  if (s.pendingHunterShot !== h.id || h.alive) return false;
  const t = byId(s, targetId);
  if (!t || !t.alive || t.id === h.id) return false;
  s.pendingHunterShot = null;
  s.nightDeaths.push(kill(s, t, 'hunter'));
  return true;
}

/** Resolve the night: apply the wolves' victim (guardian/witch saves),
 *  then the witch's kill. Returns the deaths for the dawn announcement. */
export function resolveNight(s: GameState): Death[] {
  const deaths: Death[] = [];
  const victim = s.wolfTarget ? byId(s, s.wolfTarget) : null;
  if (victim && victim.alive) {
    const saved = s.witchSaved || s.guardianTarget === victim.id;
    if (!saved) deaths.push(kill(s, victim, 'wolves'));
  }
  const wk = s.witchKillTarget ? byId(s, s.witchKillTarget) : null;
  if (wk && wk.alive) deaths.push(kill(s, wk, 'witch'));
  s.nightDeaths = deaths;
  return deaths;
}

/* ---------- voting ---------- */

export function castVote(s: GameState, voter: Player, targetId: string): boolean {
  if (s.phase !== 'voting') return false;
  if (!voter.alive || voter.hasVoted) return false;
  const t = byId(s, targetId);
  if (!t || !t.alive || t.id === voter.id) return false;
  voter.vote = targetId; voter.hasVoted = true;
  return true;
}

export function applyDefaultVotes(s: GameState, rng: () => number = Math.random): void {
  const targets = alive(s);
  for (const p of s.players) {
    if (!p.alive || p.hasVoted) continue;
    const opts = targets.filter(t => t.id !== p.id);
    if (opts.length) { p.vote = opts[Math.floor(rng() * opts.length)].id; p.hasVoted = true; }
  }
}

export function resolveVotes(s: GameState): Death | null {
  const count = new Map<string, number>();
  for (const p of s.players) if (p.alive && p.vote) count.set(p.vote, (count.get(p.vote) ?? 0) + 1);
  let top = 0; let topId: string | null = null; let tied = false;
  for (const [id, n] of count) {
    if (n > top) { top = n; topId = id; tied = false; }
    else if (n === top) tied = true;
  }
  s.voteTie = tied || topId === null;
  if (s.voteTie || !topId) { s.lastVoteOut = null; return null; }
  const out = byId(s, topId)!;
  const d = kill(s, out, 'vote');
  s.lastVoteOut = d;
  return d;
}

/* ---------- state views ---------- */

export function publicState(s: GameState) {
  return {
    roomCode: s.roomCode, phase: s.phase, round: s.round, night: s.night,
    discussionMs: s.discussionMs,
    nightStep: s.nightStep, nightEndsAt: s.nightEndsAt,
    discussionEndsAt: s.discussionEndsAt, voteEndsAt: s.voteEndsAt,
    revealReady: s.revealReady, dayReady: s.dayReady,
    chat: s.chat,
    nightDeaths: s.nightDeaths, lastVoteOut: s.lastVoteOut, voteTie: s.voteTie,
    pendingHunterShot: s.pendingHunterShot,
    winner: s.winner,
    players: s.players.map(p => ({
      id: p.id, name: p.name, isHost: p.isHost, connected: p.connected,
      alive: p.alive, hasVoted: p.hasVoted, wins: p.wins,
      // A dead player's role is public knowledge — the table learns it
      // the moment the body is found (or the vote lands). At results,
      // EVERYONE's role is revealed (like Cheese Thief's inResults spread).
      role: p.alive && s.phase !== 'results' ? undefined : p.role,
    })),
  };
}

export function privateState(s: GameState, me: Player) {
  const wolves = me.role === 'wolf'
    ? s.players.filter(p => p.role === 'wolf').map(p => ({ id: p.id, name: p.name, alive: p.alive }))
    : [];
  return {
    myRole: me.role,
    myVote: me.vote,
    wolfTeam: wolves,
    seerPeeks: me.seerPeeks,
    witchSaveLeft: me.witchSaveLeft,
    witchKillLeft: me.witchKillLeft,
    guardianLastTarget: me.guardianLastTarget,
    wolfPick: me.wolfPick ?? null,
    // The witch sees tonight's victim (or that nobody was attacked).
    nightVictim: me.role === 'witch' ? (s.wolfTarget ?? null) : null,
    canShoot: s.pendingHunterShot === me.id && !me.alive,
    // Live wolf consensus, for the wolves' own screen only.
    wolfPicks: me.role === 'wolf'
      ? s.players.filter(p => p.role === 'wolf' && p.alive && p.wolfPick).map(p => ({ id: p.id, targetId: p.wolfPick! }))
      : [],
    // Wolves-only night chat + whether I locked my pick. Both are empty
    // / false for everyone who is not a wolf.
    wolfChat: me.role === 'wolf' ? s.wolfChat : [],
    wolfConfirmed: me.role === 'wolf' ? s.wolfConfirmed.includes(me.id) : false,
  };
}
