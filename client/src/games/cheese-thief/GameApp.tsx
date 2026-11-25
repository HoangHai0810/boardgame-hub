import { useEffect, useMemo, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { TopBar, ChatPanel, ChatSheet, chatPreview } from '../../platform/ui';
import { t, Lang } from './i18n';
import { HOUR_MS } from '../../../../games/cheese-thief/logic';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';

const MICE = ['🐭', '🐹', '🐰', '🦊', '🐱', '🐶', '🐷', '🐨'];
const mouseFor = (id: string) => MICE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % MICE.length];
const AVATAR_BG = ['bg-rose-100', 'bg-sky-100', 'bg-lime-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-pink-100', 'bg-indigo-100'];
const avatarBg = (id: string) => AVATAR_BG[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];

const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
export function DiceFace({ value, size = 96 }: { value: number; size?: number }) {
  const pips = PIPS[value] || [];
  return (
    <div className="dice-face" style={{ width: size, height: size }} aria-label={`dice ${value}`}>
      {pips.map(cell => {
        const row = Math.ceil(cell / 3), col = ((cell - 1) % 3) + 1;
        return <div key={cell} className="dice-pip" style={{ left: `${(col - 1) * 28 + 12}%`, top: `${(row - 1) * 28 + 12}%` }} />;
      })}
    </div>
  );
}

const CONFETTI = ['🧀', '🎉', '🐭', '⭐', '🧀', '🎊', '✨', '🧀'];
export function Confetti() {
  return <>{CONFETTI.map((e, i) => (
    <span key={i} className="confetti-piece" style={{
      left: `${6 + i * 12}%`, fontSize: 22 + (i % 3) * 8,
      animationDuration: `${2.6 + (i % 4) * 0.7}s`, animationDelay: `${i * 0.22}s`,
    }}>{e}</span>))}</>;
}

// ---- v30 design system components (SVG mice in the mockup's flat style;
// per-player pastel colors hashed from the player id) ----
const MOUSE_COLORS: [string, string][] = [
  ['#C9CED8', '#9AA3B2'], ['#F8CD9E', '#EDA45F'], ['#ACCDF6', '#7FA8E6'], ['#DEC4F4', '#BB94E4'],
  ['#B4E0C2', '#85C79B'], ['#F6AC8D', '#E67F57'], ['#F8E08C', '#E9C04C'], ['#F7BDD6', '#EA93B8'],
];
const hashId = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
export function MouseAvatar({ seed, size = 48, state = 'awake', halo }: { seed: string; size?: number; state?: 'awake' | 'asleep' | 'thief' | 'dead'; halo?: string }) {
  const [face, ear] = MOUSE_COLORS[hashId(seed) % MOUSE_COLORS.length];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="inline-block flex-none" aria-hidden>
      {halo && <circle cx="50" cy="50" r="48" fill={halo} stroke="#2B2016" strokeWidth="2.5" />}
      <circle cx="27" cy="27" r="17" fill={ear} stroke="#2B2016" strokeWidth="3" />
      <circle cx="73" cy="27" r="17" fill={ear} stroke="#2B2016" strokeWidth="3" />
      <circle cx="27" cy="27" r="8.5" fill="#F6A8BC" />
      <circle cx="73" cy="27" r="8.5" fill="#F6A8BC" />
      <circle cx="50" cy="57" r="35" fill={face} stroke="#2B2016" strokeWidth="3" />
      <g stroke="#2B2016" strokeWidth="1.6" opacity="0.35" strokeLinecap="round"><path d="M8 62 l14 3 M10 72 l13 -1" /><path d="M92 62 l-14 3 M90 72 l-13 -1" /></g>
      {state === 'thief' ? (<>
        <rect x="13" y="43" width="74" height="21" rx="10.5" fill="#26221F" />
        <circle cx="37" cy="53.5" r="6.4" fill="#FFFBef" /><circle cx="63" cy="53.5" r="6.4" fill="#FFFBef" />
        <circle cx="37" cy="53.5" r="3.2" fill="#2B2016" /><circle cx="63" cy="53.5" r="3.2" fill="#2B2016" />
      </>) : state === 'asleep' ? (
        <g stroke="#2B2016" strokeWidth="3" fill="none" strokeLinecap="round"><path d="M30 54 q7 6 14 0" /><path d="M56 54 q7 6 14 0" /></g>
      ) : state === 'dead' ? (
        <g stroke="#2B2016" strokeWidth="3.4" strokeLinecap="round"><path d="M31 48 l12 12 M43 48 l-12 12" /><path d="M57 48 l12 12 M69 48 l-12 12" /></g>
      ) : (
        <g fill="#2B2016"><circle cx="37" cy="53" r="4.6" /><circle cx="63" cy="53" r="4.6" /></g>
      )}
      <ellipse cx="50" cy="68" rx="5.4" ry="4.2" fill="#F2728C" stroke="#2B2016" strokeWidth="1.6" />
      <path d="M50 72 q0 5 -7 6 M50 72 q0 5 7 6" stroke="#2B2016" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function CheeseWedge({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.76)} viewBox="0 0 100 76" className="inline-block" aria-hidden>
      <path d="M8 68 L92 68 L92 14 Z" fill="#FFC93C" stroke="#2B2016" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M92 14 L92 68 L83 68 L83 23 Z" fill="#F0A92E" />
      <path d="M15 63 L86 22 L86 31 L27 63 Z" fill="#FFDE59" opacity="0.75" />
      <g fill="#E39A0B" stroke="#C77F06" strokeWidth="1">
        <circle cx="66" cy="50" r="6.5" /><circle cx="44" cy="58" r="4.4" /><circle cx="78" cy="35" r="4" /><circle cx="56" cy="43" r="3.1" />
      </g>
      <path d="M8 68 L92 68 L92 14 Z" fill="none" stroke="#2B2016" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

function TimerPill({ secs, dark = false }: { secs: number | null; dark?: boolean }) {
  if (secs === null || secs === undefined) return null;
  const label = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
  return <span className={`disp inline-flex items-center gap-1 rounded-full px-3 py-1 font-extrabold text-base ${dark ? 'bg-[#23233F] border-2 border-[#3D3D63] text-[#FFB020]' : 'bg-[#FFFBef] hard-xs text-[#2B2016]'}`}>🕐 {label}</span>;
}

function useNow(step = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), step); return () => clearInterval(i); }, [step]);
  return now;
}
const secsLeft = (endsAt: number | null, now: number) => endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;

const BTN = 'disp px-5 py-3 rounded-2xl font-extrabold hard push disabled:opacity-40';
const CARD = 'card-cream p-4 sm:p-5';

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🧀 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

// Module-level for the same reason as ChatPanel: a click landing while App
// re-rendered used to hit a freshly remounted chip and die — voting felt
// like it needed 2–3 clicks. Stable identity = one click, one vote.
function PlayerChips({ players, myId, phase, d, roleLabel, onPick, pickable, onKick, markThiefId, markFollowerIds, iAmFollower, peeks, speakingIds, compact, winnerSide }: {
  players: any[]; myId?: string; phase?: string; d: any;
  roleLabel: (role?: string | null, isFollower?: boolean) => string;
  onPick?: (id: string) => void; pickable?: (p: any) => boolean; onKick?: (id: string) => void;
  markThiefId?: string | null; markFollowerIds?: string[]; iAmFollower?: boolean; peeks?: { targetId: string; dice: number }[];
  speakingIds?: Set<string>; compact?: boolean;
  /** Results only: which side won — winners get a strong team tint + 🏆,
   *  losers go grey, so the outcome reads at a glance (Hoàng: "giao diện
   *  mờ, không phản ánh kết quả"). */
  winnerSide?: 'thief' | 'village' | 'fallmouse' | null;
}) {
  const sideOf = (p: any) => p.role === 'fallmouse' ? 'fallmouse' : (p.role === 'thief' || p.isFollower) ? 'thief' : 'village';
  const resultCls = (p: any): string | null => {
    if (phase !== 'results' || !winnerSide) return null;
    if (sideOf(p) !== winnerSide) return 'bg-gray-100 ring-2 ring-gray-300 opacity-75';
    return winnerSide === 'thief' ? 'bg-red-100 ring-4 ring-red-500'
      : winnerSide === 'fallmouse' ? 'bg-violet-200 ring-4 ring-violet-500'
      : 'bg-emerald-100 ring-4 ring-emerald-500';
  };
  const roleColor = (p: any) => sideOf(p) === 'thief' ? 'text-red-600' : sideOf(p) === 'fallmouse' ? 'text-violet-700' : (winnerSide === 'village' && phase === 'results' ? 'text-emerald-700' : 'text-gray-700');
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${compact ? 'gap-2 my-2' : 'gap-3 my-3'}`}>
      {players.map(p => (
        <button key={p.id} disabled={onPick ? (pickable ? !pickable(p) : false) : !onKick}
          onClick={() => onPick?.(p.id)}
          className={`relative rounded-2xl ${compact ? 'p-2' : 'p-2.5'} text-center shadow ${resultCls(p) ?? (p.id === markThiefId ? 'bg-red-100 ring-4 ring-red-400' : markFollowerIds?.includes(p.id) ? 'bg-emerald-50 ring-4 ring-emerald-400' : p.id === myId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white')} ${onPick ? 'hover:scale-105 transition cursor-pointer' : 'cursor-default'} disabled:opacity-50 disabled:hover:scale-100`}>
          {phase === 'results' && winnerSide && sideOf(p) === winnerSide && <span className="absolute -top-2 -right-2 text-2xl anim-pop">🏆</span>}
          {p.id === markThiefId && <span className="absolute -top-2 -left-2 text-2xl anim-pop" title={d.thief}>😈</span>}
          {(markFollowerIds?.includes(p.id) || (p.id === myId && iAmFollower)) && <span className="absolute -top-2 -left-2 text-2xl anim-pop">🤝</span>}
          {peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2 -right-2 bg-sky-500 text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow">🎲{peeks!.find(x => x.targetId === p.id)!.dice}</span>}
          {speakingIds?.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
          <div className={`${compact ? 'text-2xl w-9 h-9' : 'text-3xl w-12 h-12'} anim-bob mx-auto rounded-full flex items-center justify-center ${avatarBg(p.id)} shadow-inner`}>{mouseFor(p.id)}</div>
          <div className={`font-bold truncate ${compact ? 'text-sm' : ''}`}>{p.name} {p.id === myId && <span className="text-amber-600">({d.you})</span>}</div>
          <div className="text-xs">{p.isHost && <span className="bg-purple-500 text-white rounded-full px-2 py-0.5">👑 {d.host}</span>} {!p.connected && <span className="text-red-500">• {d.offline}</span>}</div>
          {(p.wins ?? 0) > 0 && <div className="text-xs mt-1 font-extrabold text-amber-600">🏆 ×{p.wins}</div>}
          {onKick && p.id !== myId && (
            <div className="mt-1">
              <span role="button" title={d.kick}
                onClick={(e) => { e.stopPropagation(); onKick(p.id); }}
                className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 cursor-pointer hover:bg-red-200">✖ {d.kick}</span>
            </div>)}
          {(phase === 'results') && <div className="text-sm mt-1 font-extrabold flex items-center justify-center gap-2"><span className={roleColor(p)}>{roleLabel(p.role, p.isFollower)}</span><DiceFace value={p.dice ?? 1} size={26} /></div>}
          {phase === 'voting' && <div className="text-xs mt-1">{p.hasVoted ? '✅ voted' : '🤔 …'}</div>}
        </button>
      ))}
    </div>
  );
}

// Slide-up chat sheet used at night / during recruitment: chat is open
// while "sleeping" (players asked for it — the wait shouldn't be dead
// time), but the night scene itself must stay one-screen, so the chat
// lives in an overlay instead of pushing the layout down.
// The cheese flies from the table to the thief's avatar the moment the
// steal happens — everyone awake at that hour sees it.
function FlyCheese({ x0, y0, dx, dy, onDone }: { x0: number; y0: number; dx: number; dy: number; onDone: () => void }) {
  const [moved, setMoved] = useState(false);
  const [burst, setBurst] = useState(false);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMoved(true)));
    const t1 = setTimeout(() => setBurst(true), 880);
    const t2 = setTimeout(() => doneRef.current(), 1520);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <>
      {[2, 1, 0].map(i => (
        <div key={i} className="pointer-events-none absolute z-40" style={{
          left: x0, top: y0,
          transform: moved ? `translate(${dx}px, ${dy}px) scale(${0.62 + (2 - i) * 0.14})` : 'translate(0px, 0px) scale(1)',
          transition: `transform 0.9s cubic-bezier(0.3, 0.6, 0.4, 1) ${i * 75}ms`,
          opacity: 1 - i * 0.3,
          filter: i === 0 ? 'drop-shadow(0 0 16px rgba(255,176,32,0.95)) drop-shadow(0 8px 10px rgba(0,0,0,0.4))' : undefined,
        }}>
          <div className={i === 0 ? 'anim-fly-arc' : ''}><CheeseWedge size={76} /></div>
        </div>
      ))}
      {burst && (
        <div className="pointer-events-none absolute z-40" style={{ left: x0 + dx, top: y0 + dy }}>
          <span className="fly-ring" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <span key={i} className="fly-dot" style={{ '--a': `${i * 45}deg` } as any} />)}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  // Transport errors/statuses arrive as language-neutral codes (Cycle 7) and
  // are translated at render time, so switching language re-renders them.
  const localizeMsg = (m: string): string => {
    if (m === 'KICKED') return d.kickedMsg;
    if (m.startsWith('CONN_ERROR:')) return d.errConnError(m.slice('CONN_ERROR:'.length));
    if (m.startsWith('STATUS_CONNECTING:')) return d.statusConnecting(m.slice('STATUS_CONNECTING:'.length));
    const map: Record<string, string> = {
      HOST_GONE: d.errHostGone, ROOM_FULL: d.errRoomFull, GAME_STARTED: d.errGameStarted,
      ROOM_NOT_FOUND: d.errRoomNotFound, HOST_UNREACHABLE: d.errHostUnreachable,
      NET_UNREACHABLE: d.errNetUnreachable, SERVER_UNREACHABLE: d.errServerUnreachable,
      HOST_DISCONNECTED: d.errHostDisconnected, PEER_BLOCKED: d.errPeerBlocked, VOICE_MIC: d.errVoiceMic,
      NEED_MORE_PLAYERS: d.errNeedMore, FAILED: d.errFailed, STATUS_CREATING: d.statusCreating,
    };
    return map[m] ?? m;
  };
  const [name, setName] = useState(() => sessionStorage.getItem('ct_name') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const [joined, setJoined] = useState<{ code: string; playerId: string; isHost: boolean } | null>(null);
  const [pub, setPub] = useState<Pub | null>(null);
  const [priv, setPriv] = useState<Priv | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('ct_muted') === '1');
  const toggleMuted = () => setMuted(m => { localStorage.setItem('ct_muted', m ? '0' : '1'); return !m; });
  const netRef = useRef<Net | null>(null);
  // Personal session record (Cycle 8): my wins/losses, split by dealt role.
  const [myRecord, setMyRecord] = useState<{ w: number; l: number; roles: Record<string, { w: number; g: number }> }>({ w: 0, l: 0, roles: {} });
  const recordedRounds = useRef<Set<string>>(new Set());
  const now = useNow();

  const getNet = () => {
    if (!netRef.current) {
      netRef.current = createNet({
        onState: (s) => { setPub(s); setStatus(''); setConnLost(false); },
        onPrivate: (p) => setPriv(p),
        onJoined: (c, pid, isHost) => {
          setJoined({ code: c, playerId: pid, isHost });
          // Guests: remember the session so an F5 drops straight back into
          // the room. Hosts can't resume (their room lives in their tab),
          // so a host session is never stored.
          try {
            if (!isHost) sessionStorage.setItem('ct_guest_session:cheese-thief', JSON.stringify({ code: c, name: sessionStorage.getItem('ct_name') || '' }));
            else sessionStorage.removeItem('ct_guest_session:cheese-thief');
          } catch { /* ignore */ }
          // Keep any transport overrides (?broker= / ?server= / ?net=) in the
          // URL — the net layer re-reads them on reconnect/rejoin.
          const u = new URL(location.href); u.searchParams.set('room', c);
          history.replaceState(null, '', u.pathname + u.search);
        },
        onError: (m) => {
          if (m === 'HOST_GONE') { try { sessionStorage.removeItem('ct_guest_session:cheese-thief'); } catch { /* ignore */ } }
          if (m === 'KICKED') {
            try { sessionStorage.removeItem('ct_guest_session:cheese-thief'); } catch { /* ignore */ }
            // Host removed us from the lobby: leave cleanly, land on the
            // home screen with a (localized at render) notice.
            try { netRef.current?.leave(); } catch { /* noop */ }
            setJoined(null); setPub(null); setPriv(null);
            const u = new URL(location.href); u.searchParams.delete('room');
            history.replaceState(null, '', u.pathname + u.search);
          }
          setError(m); setStatus('');
        },
        onStatus: (m) => {
          setStatus(m);
          if (m === 'NET_LOST') setConnLost(true);
          else if (m === 'NET_OK') setConnLost(false);
        },
        onPromoted: () => {
          // Host migration: I am the successor host now — host controls
          // (and the F5 guard) key off joined.isHost.
          setJoined(j => (j ? { ...j, isHost: true } : j));
        },
      }, 'cheese-thief');
    }
    return netRef.current;
  };


  // Auto-rejoin after a refresh: a stored GUEST session goes straight
  // back into its room instead of landing on the home screen. An invite
  // link for a DIFFERENT room wins over the stored session.
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (autoJoinTried.current) return;
    autoJoinTried.current = true;
    try {
      const raw = sessionStorage.getItem('ct_guest_session:cheese-thief');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s?.code) return;
      const urlRoom = new URLSearchParams(location.search).get('room');
      if (urlRoom && urlRoom.toUpperCase() !== String(s.code).toUpperCase()) return;
      getNet().joinRoom(String(s.code), String(s.name || ''));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sound (Cycle 2): unlock the AudioContext on the first user gesture —
  // browsers refuse audio before any interaction with the page.
  useEffect(() => {
    const unlock = () => ensureCtx();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Event cues: watch state transitions and play the matching sound.
  const sfxPrev = useRef<{ phase?: string; hour?: number; acted?: boolean; myVote?: string | null; chatLen?: number; init: boolean }>({ init: false });
  useEffect(() => {
    const prev = sfxPrev.current;
    if (!pub) return;
    if (!prev.init) { // first observed state: record, never play
      sfxPrev.current = { phase: pub.phase, hour: pub.currentHour, acted: priv?.hasActedThisHour, myVote: priv?.myVote, chatLen: pub.chat.length, init: true };
      return;
    }
    if (pub.phase === 'night' && (prev.phase !== 'night' || prev.hour !== pub.currentHour)) {
      sfx('hour', muted);
      if (priv?.awake) sfx('wake', muted);
    }
    if (priv?.hasActedThisHour && !prev.acted && priv.role === 'thief') sfx('steal', muted);
    if (pub.phase === 'day' && prev.phase !== 'day') sfx('morning', muted);
    if (pub.phase === 'voting' && priv?.myVote && !prev.myVote) sfx('vote', muted);
    if (pub.phase === 'results' && prev.phase !== 'results') {
      const w = pub.winner;
      const iWon = w === 'fallmouse' ? priv?.role === 'fallmouse'
        : w === 'thief' ? (priv?.role === 'thief' || !!priv?.isFollower)
        : w === 'sleepyheads' ? (!!priv && priv.role !== 'thief' && !priv.isFollower) : false;
      sfx(iWon ? 'win' : 'lose', muted);
      // Record the round in my personal session record (once per round).
      const key = pub.roomCode + ':' + pub.round;
      if (priv?.role && !recordedRounds.current.has(key)) {
        recordedRounds.current.add(key);
        const role = priv.role;
        setMyRecord(r => {
          const roles = { ...r.roles };
          const cur = roles[role] ?? { w: 0, g: 0 };
          roles[role] = { w: cur.w + (iWon ? 1 : 0), g: cur.g + 1 };
          return { w: r.w + (iWon ? 1 : 0), l: r.l + (iWon ? 0 : 1), roles };
        });
      }
    }
    if (pub.chat.length > (prev.chatLen ?? 0) && pub.phase !== 'voting' && pub.phase !== 'roleReveal') {
      const last = pub.chat[pub.chat.length - 1];
      if (last && last.fromId !== joined?.playerId) sfx('pop', muted);
    }
    sfxPrev.current = { phase: pub.phase, hour: pub.currentHour, acted: priv?.hasActedThisHour, myVote: priv?.myVote, chatLen: pub.chat.length, init: true };
  }, [pub, priv, muted, joined]);
  const me = useMemo(() => pub?.players.find(p => p.id === joined?.playerId), [pub, joined]);
  const isHost = joined?.isHost || me?.isHost;
  const phase = pub?.phase;

  // Fly-to-avatar steal effect: measured against the live DOM (table cheese
  // -> the thief's night card), replayed at most once per steal.
  const nightBoxRef = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<{ key: string; x0: number; y0: number; dx: number; dy: number } | null>(null);
  const [flyHit, setFlyHit] = useState<string | null>(null);
  const flyKeyRef = useRef('');
  const [chatSheet, setChatSheet] = useState(false);
  const [connLost, setConnLost] = useState(false);
  // Voice chat (v26): off -> busy (mic prompt + mesh join) -> on; the mic
  // button then toggles mute, ✕ leaves the mesh. Speaking ids drive the
  // 🎙️ badges on player cards.
  // Voice (v29): speaker and mic are separate switches — 🎧 joins the
  // mesh listen-only (hear everyone, no mic needed); 🎤 starts sending.
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const voiceRef = useRef<VoiceHandle | null>(null);
  const leaveVoice = () => {
    try { voiceRef.current?.leave(); } catch { /* noop */ }
    voiceRef.current = null;
    setVoiceSpeaker('off'); setVoiceMic('off'); setVoiceMuted(false); setSpeakingIds(new Set());
  };
  const voiceOptOutRef = useRef(false);
  const startSpeaker = async (auto = false) => {
    if (!joined || voiceRef.current) return;
    setVoiceSpeaker('busy');
    try {
      voiceRef.current = await joinVoice(joined.code, joined.playerId, {
        onSpeaking: (ids) => setSpeakingIds(prev => (prev.size === ids.size && [...ids].every(x => prev.has(x)) ? prev : ids)),
        onPeers: () => { /* presence is implicit in the speaking badges */ },
      }, 'cheese-thief');
      setVoiceSpeaker('on');
    } catch {
      setVoiceSpeaker('off');
      if (!auto) setError('NET_UNREACHABLE');
    }
  };
  const toggleSpeaker = async () => {
    if (voiceSpeaker === 'busy') return;
    if (voiceSpeaker === 'on') { voiceOptOutRef.current = true; leaveVoice(); return; }
    voiceOptOutRef.current = false;
    await startSpeaker(false);
  };
  // Speaker AUTO-joins when a room opens (v32, Hoàng's rule: loa tự mở,
  // mic tự đóng — the mic only ever starts from its own button). A manual
  // 🎧-off opts out for the rest of this room session.
  const autoVoiceRef = useRef('');
  useEffect(() => {
    if (!joined) { autoVoiceRef.current = ''; voiceOptOutRef.current = false; return; }
    const key = joined.code + ':' + joined.playerId;
    if (autoVoiceRef.current === key || voiceOptOutRef.current) return;
    autoVoiceRef.current = key;
    void startSpeaker(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  const toggleMic = async () => {
    const vh = voiceRef.current;
    if (!vh || voiceMic === 'busy') return;
    if (voiceMic === 'on') {
      const m = !voiceMuted;
      setVoiceMuted(m);
      vh.setMuted(m);
      return;
    }
    setVoiceMic('busy');
    try {
      await vh.enableMic();
      setVoiceMuted(false);
      setVoiceMic('on');
    } catch {
      setVoiceMic('off');
      setError('VOICE_MIC');
    }
  };
  // Leaving the room (or being kicked / host gone) tears the mesh down.
  useEffect(() => { if (!joined) leaveVoice(); }, [joined]);

  // Host safety net: in the public build the host's tab IS the server, so
  // an accidental F5 ends the room for everyone. Make the browser ask
  // first. (The structural fix is the dedicated-server mode — see report.)
  useEffect(() => {
    if (!joined?.isHost) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [joined?.isHost]);
  // Optimistic feedback: a tapped action shows its result IMMEDIATELY and
  // locks, instead of looking dead while the intent travels (the #1 live
  // complaint on a flaky connection). Authoritative state replaces it when
  // it lands; a timeout restores the control if it never does.
  const [optVote, setOptVote] = useState<string | null>(null);
  const [optReadyVote, setOptReadyVote] = useState(false);
  const [optReady, setOptReady] = useState(false);
  const [optPeek, setOptPeek] = useState(false);
  useEffect(() => { if (!optVote) return; const t = setTimeout(() => setOptVote(null), 6000); return () => clearTimeout(t); }, [optVote]);
  useEffect(() => { if (!optReadyVote) return; const t = setTimeout(() => setOptReadyVote(false), 6000); return () => clearTimeout(t); }, [optReadyVote]);
  useEffect(() => { if (!optReady) return; const t = setTimeout(() => setOptReady(false), 6000); return () => clearTimeout(t); }, [optReady]);
  const [chatSeen, setChatSeen] = useState(0);
  useEffect(() => { setChatSheet(false); setOptVote(null); setOptReadyVote(false); setOptReady(false); setOptPeek(false); pendingRef.current = {}; }, [phase]);
  // Intents tapped but not yet confirmed by the host. A publish lost in a
  // connection flap used to vanish silently (Hoàng: "Vote rồi mà ở step
  // nào cũng 4/6") — on reconnect the unconfirmed ones are re-sent.
  const pendingRef = useRef<{ vote?: string; readyVote?: boolean; ready?: boolean }>({});
  const prevConnLostRef = useRef(false);
  useEffect(() => {
    if (prevConnLostRef.current && !connLost && joined && pub) {
      const pd = pendingRef.current;
      if (phase === 'voting' && pd.vote && !priv?.myVote) getNet().vote(pd.vote);
      if (phase === 'day' && pd.readyVote && !(pub as any).dayReady?.includes(joined.playerId)) getNet().readyVote();
      if (phase === 'roleReveal' && pd.ready && !(pub as any).revealReady?.includes(joined.playerId)) getNet().ready();
    }
    prevConnLostRef.current = connLost;
  }, [connLost]);
  useEffect(() => { if (priv?.myVote) pendingRef.current.vote = undefined; }, [priv?.myVote]);
  useEffect(() => { if (joined && (pub as any)?.dayReady?.includes(joined.playerId)) pendingRef.current.readyVote = false; }, [(pub as any)?.dayReady?.join(',')]);
  useEffect(() => { if (joined && (pub as any)?.revealReady?.includes(joined.playerId)) pendingRef.current.ready = false; }, [(pub as any)?.revealReady?.join(',')]);
  useEffect(() => { setOptPeek(false); }, [pub?.currentHour]);
  useEffect(() => { if (chatSheet) setChatSeen(pub?.chat?.length ?? 0); }, [chatSheet, pub?.chat?.length]);
  useEffect(() => {
    const target = priv?.stealById;
    if (phase !== 'night' || !target || !pub || !joined) return;
    const key = `${pub.round}-${pub.currentHour}-${target}`;
    if (flyKeyRef.current === key) return;
    const box = nightBoxRef.current;
    const from = document.getElementById('table-cheese');
    const to = document.getElementById('pcard-' + target);
    if (!box || !from || !to) return;
    flyKeyRef.current = key;
    const b = box.getBoundingClientRect(), f = from.getBoundingClientRect(), t = to.getBoundingClientRect();
    setFly({ key, x0: f.left - b.left + f.width / 2 - 38, y0: f.top - b.top + f.height / 2 - 29, dx: (t.left + t.width / 2) - (f.left + f.width / 2), dy: (t.top + t.height / 2) - (f.top + f.height / 2) });
    setFlyHit(target);
    window.setTimeout(() => setFlyHit(cur => (cur === target ? null : cur)), 2100);
  }, [priv?.stealById, pub?.currentHour, pub?.round, phase]);

  const btn = 'px-5 py-3 rounded-2xl font-bold shadow-lg transition active:scale-95 disabled:opacity-40 disabled:active:scale-100';
  const card = 'bg-white/95 rounded-3xl shadow-2xl p-4 sm:p-5';

  // Shareable results summary (Cycle 9): copy a compact localized text of
  // the round to the clipboard, Wordle-style, for the group's chat app.
  const shareResult = () => {
    if (!pub) return;
    const winnerText = pub.winner === 'sleepyheads' ? d.sleepyWin : pub.winner === 'fallmouse' ? d.fallWin : d.thiefWin;
    const lines = [d.shareHeader(pub.roomCode, pub.round), winnerText, d.thiefWas(nameOf(pub.thiefId))];
    const fall = pub.players.find(p => (p as any).role === 'fallmouse');
    if (fall) lines.push(d.fallWas(fall.name));
    const scored = pub.players.filter(p => ((p as any).wins ?? 0) > 0)
      .sort((a, b) => ((b as any).wins ?? 0) - ((a as any).wins ?? 0));
    if (scored.length) lines.push('🏆 ' + scored.map(p => `${p.name} ×${(p as any).wins}`).join(' · '));
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordLine(myRecord.w, myRecord.l));
    lines.push(location.origin + location.pathname);
    navigator.clipboard?.writeText(lines.join('\n'));
    setShared(true); setTimeout(() => setShared(false), 1500);
  };

  // Personal session record (Cycle 8): my own W/L split by dealt role.
  const MyRecord = () => {
    if (myRecord.w + myRecord.l === 0) return null;
    const roleChip = (role: string, emoji: string, label: string) => {
      const r = myRecord.roles[role];
      if (!r) return null;
      return <span key={role} className="bg-white hard-xs rounded-full px-2 py-0.5 text-[12px] font-bold">{emoji} {label} {r.w}/{r.g}</span>;
    };
    return (
      <div className="bg-[#DFF5E3] hard-sm rounded-3xl p-2.5">
        <div className="text-center"><span className="font-extrabold text-[13px]">{d.recordTitle}: </span><span className="font-bold text-teal-700 text-[13px]">{d.recordLine(myRecord.w, myRecord.l)}</span></div>
        <div className="flex flex-wrap justify-center gap-1.5 mt-1">
          {roleChip('sleepyhead', '🐭', d.sleepy)}
          {roleChip('thief', '😈', d.thief)}
          {roleChip('fallmouse', '💀', d.fall)}
        </div>
      </div>);
  };

  // Session scoreboard (Cycle 1): rounds won in this room, leader gets 👑.
  const Standings = () => {
    const scored = pub!.players.filter(p => ((p as any).wins ?? 0) > 0)
      .sort((a, b) => ((b as any).wins ?? 0) - ((a as any).wins ?? 0));
    if (!scored.length) return null;
    const top = (scored[0] as any).wins ?? 0;
    return (
      <div className="bg-[#FFFBef] hard-sm rounded-3xl p-2.5 text-left">
        <div className="font-extrabold text-center text-[13px] mb-1">{d.standings}</div>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {scored.map(p => (
            <span key={p.id} className="bg-white hard-xs rounded-full px-2 py-0.5 text-[12px] font-bold">{mouseFor(p.id)} {p.name} {((p as any).wins === top) && '👑'} 🏆×{(p as any).wins}</span>))}
        </div>
      </div>
    );
  };

  /* ---------- LANDING ---------- */
  if (!joined) {
    return (
      <div className="min-h-dvh bg-[#14142B] p-3 sm:p-4">
        <div className="max-w-xl mx-auto pt-2">
          <TopBar logo={<CheeseWedge size={30} />} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} />
          <button className="font-bold text-[#B9BCE0] hover:text-[#FFF3CF] text-sm mt-2 mb-1 px-1" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
          <div className="card-cream anim-pop overflow-hidden !rounded-[28px]">
            <div className="relative bg-[#171731] px-5 pt-6 text-center overflow-hidden">
              <div className="stars" style={{ position: 'absolute' }} />
              <p className="disp relative text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px] sm:text-xs">{d.kicker}</p>
              <h1 className="disp relative text-[#FFF3CF] font-extrabold text-5xl leading-[1.05] mt-1.5">
                <svg width="34" height="34" viewBox="0 0 24 24" className="inline-block -mt-3 mr-1"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z" fill="#FFD94D" /></svg>
                {d.title}
              </h1>
              <p className="relative text-[#B9BCE0] font-bold mt-2">{d.subtitle}</p>
              <div className="relative h-[104px] mt-1">
                <div className="absolute inset-x-0 bottom-3 flex items-end justify-center gap-1 sm:gap-2">
                  {['lan', 'hai', 'mit', 'bo', 'soc'].map((k, i) => (
                    <span key={k} className="anim-bob inline-block" style={{ animationDelay: `${i * 0.3}s` }}><MouseAvatar seed={'landing-' + k} size={i === 2 ? 58 : 52} /></span>
                  ))}
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 anim-wiggle"><CheeseWedge size={96} /></div>
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-[#A06A35] to-[#7C4A21] border-t-[3px] border-[#2B2016]" />
              </div>
            </div>
            <div className="bg-[#FFF3CF] px-5 py-5 text-left">
              <label className="text-[11px] font-black tracking-[0.18em] text-[#8A7B63]">{d.nameLabel}</label>
              <input className="inp w-full px-4 py-3 mt-1.5 text-lg font-bold" placeholder={d.name}
                value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
              <button className={`${BTN} btn-amber w-full mt-3.5 text-xl`}
                disabled={!name.trim() || !!status} onClick={() => { setError(''); getNet().createRoom(name); }}>🏠 {d.create}</button>
              <div className="flex items-center gap-3 mt-5">
                <span className="flex-1 h-[2px] bg-[#E3D3AC]" />
                <span className="text-[11px] font-black tracking-[0.14em] text-[#8A7B63]">{d.orJoin}</span>
                <span className="flex-1 h-[2px] bg-[#E3D3AC]" />
              </div>
              <div className="flex gap-2 mt-3">
                <input className="inp flex-1 min-w-0 px-3 py-3 uppercase text-lg font-extrabold tracking-[0.25em] text-center" placeholder={d.codePh}
                  value={code} maxLength={5} onChange={e => setCode(e.target.value.toUpperCase())} />
                <button className={`${BTN} btn-dark`} disabled={!name.trim() || code.trim().length < 4 || !!status}
                  onClick={() => { setError(''); getNet().joinRoom(code, name); }}>{d.join}</button>
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-5 text-sm font-extrabold text-[#6B5B43]">
                <span>👥 {d.playersRange}</span><span>🕐 {d.minsRange}</span><span>⚡ {d.noInstall}</span>
              </div>
              <button className="block mx-auto mt-3 underline font-extrabold text-[#2B2016]" onClick={() => setShowHelp(true)}>{d.how}</button>
              {status && <p className="mt-3 text-center text-sky-700 font-bold">{localizeMsg(status)}</p>}
              {(status === 'STATUS_CREATING' || status.startsWith('STATUS_CONNECTING:')) && (
                <button className="block mx-auto mt-2.5 bg-white hard-xs push rounded-full px-5 py-2 font-extrabold text-[#D63A2F]"
                  onClick={() => { getNet().cancelConnect(); setStatus(''); }}>{d.cancelConnect}</button>
              )}
              {error && <p className="mt-3 text-center text-red-600 font-bold">{localizeMsg(error)}</p>}
            </div>
          </div>
        </div>
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
      </div>
    );
  }

  if (!pub) return (
    <div className="min-h-screen bg-[#14142B] text-white flex flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="text-2xl font-bold">⏳ {status ? localizeMsg(status) : d.connecting}</div>
      <button className="bg-white hard-xs push rounded-full px-5 py-2 font-extrabold text-[#D63A2F]"
        onClick={() => { try { sessionStorage.removeItem('ct_guest_session:cheese-thief'); } catch { /* ignore */ } try { getNet().leave(); } catch { /* ignore */ } location.href = location.pathname; }}>{d.cancelConnect}</button>
    </div>
  );

  const bg = phase === 'night' || phase === 'roleReveal' || phase === 'recruit' || phase === 'results'
    ? 'bg-[#14142B]'
    : 'bg-[#FFF3CF]';
  const tone = bg === 'bg-[#14142B]' ? 'navy' as const : 'cream' as const;
  const nameOf = (id?: string | null) => pub?.players.find(p => p.id === id)?.name || '?';
  const lastChat = pub && pub.chat.length ? pub.chat[pub.chat.length - 1] : null;
  const roleLabel = (role?: string | null, isFollower?: boolean) =>
    (role === 'thief' ? '😈 ' + d.thief : role === 'fallmouse' ? '💀 ' + d.fall : '🐭 ' + d.sleepy) + (isFollower ? ' 🤝' : '');

  return (
    <div className={`h-dvh ${bg} p-3 sm:p-4 transition-colors duration-1000 flex flex-col overflow-hidden relative`}>
      <div className="max-w-3xl lg:max-w-6xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex flex-col lg:flex-row lg:gap-5 flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-h-0">
        <TopBar logo={<CheeseWedge size={30} />} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })}  tone={tone} voice={{ speaker: voiceSpeaker, mic: voiceMic, muted: voiceMuted, onSpeaker: toggleSpeaker, onMic: toggleMic }}/>
        {connLost && joined && <div className="bg-red-500 text-white text-center font-bold text-sm rounded-full px-4 py-1 mb-2 anim-pulse-soft shadow">📡 {d.connLost}</div>}
        {error && <div className="bg-red-100 border border-red-400 text-red-700 rounded-2xl px-4 py-2 mb-3 font-bold">{localizeMsg(error)}
          <button className="float-right" onClick={() => setError('')}>✕</button></div>}

        {/* Persistent secret info — your role & dice stay visible all game */}
        {priv?.role && (phase === 'night' || phase === 'recruit' || phase === 'day' || phase === 'voting') && (
          <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-2xl px-3.5 py-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-bold text-[#EDEDF7] relative z-10">
            <span className="disp bg-[#FFB020] text-[#2B2016] text-[11px] font-black rounded-md px-1.5 py-0.5 tracking-wider">{d.secretTag}</span>
            <span>{priv.role === 'thief' ? d.thief : priv.role === 'fallmouse' ? d.fall : d.sleepy}{priv.isFollower ? ' 🤝' : ''}</span>
            <span className="inline-flex items-center gap-1.5"><DiceFace value={priv.dice ?? 1} size={22} /><span>{d.peekPill(priv.dice ?? 0)} · {d.wakeShort(priv.dice ?? 0)}</span></span>
            {phase === 'night' && <span>{priv.awake ? '👀 ' + d.youAwake : '💤 ' + d.sleeping}</span>}
            {priv.peeks && priv.peeks.length > 0 && <span className="text-[#9CC3F5]">{d.peekedShort}: {priv.peeks.map(x => `${nameOf(x.targetId)} · 🎲${x.dice}`).join(', ')}</span>}
            {priv.knownThiefId && <span className="text-red-300">{d.knowsThief(nameOf(priv.knownThiefId))}</span>}
            {priv.witnessedThiefId && <span className="text-red-300">{d.sawThief(nameOf(priv.witnessedThiefId))}</span>}
            {priv.role === 'thief' && priv.knownFollowerIds.length > 0 && <span className="text-emerald-300">{d.yourFollowers(priv.knownFollowerIds.map(nameOf).join(', '))}</span>}
            {priv.isFollower && priv.knownFollowerIds.length > 0 && <span className="text-emerald-300">{d.knowsFollower(priv.knownFollowerIds.map(nameOf).join(', '))}</span>}
          </div>
        )}

        {/* ---------- LOBBY ---------- */}
        {phase === 'lobby' && (
          <div className="anim-pop flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2.5 mb-3">
              <button className="bg-[#FFFBef] hard-xs push rounded-xl w-10 h-10 text-lg font-black text-[#2B2016] flex-none" title={d.leave}
                onClick={() => { try { sessionStorage.removeItem('ct_guest_session:cheese-thief'); } catch { /* ignore */ } getNet().leave(); location.href = location.pathname; }}>←</button>
              <div className="min-w-0">
                <h2 className="disp text-[26px] font-extrabold text-[#2B2016] leading-none">{d.lobby}</h2>
                <p className="text-[13px] font-bold text-[#8A7B63] mt-0.5">{d.lobbySub(pub.round)}</p>
              </div>
            </div>
            <div className="bg-[#1D1D38] rounded-3xl hard p-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="disp text-[#FFB020] text-[11px] font-black tracking-[0.2em]">{d.roomCodeLabel}</div>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {pub.roomCode.split('').map((ch, i) => (
                    <span key={i} className="disp bg-[#FFF3CF] text-[#2B2016] font-extrabold text-xl w-9 h-10 rounded-lg flex items-center justify-center border-2 border-[#2B2016]">{ch}</span>
                  ))}
                </div>
              </div>
              <button className={`${BTN} btn-amber !px-3.5 !py-2.5 text-sm flex-none`} onClick={() => {
                navigator.clipboard?.writeText(location.origin + location.pathname + '?room=' + pub.roomCode);
                setCopied(true); setTimeout(() => setCopied(false), 1500);
              }}>{copied ? '✅ ' + d.copied : '🔗 ' + d.copyLink}</button>
            </div>
            <div className="flex items-baseline justify-between mt-4 mb-2">
              <h3 className="disp text-lg font-extrabold text-[#2B2016]">{d.players}</h3>
              <span className="text-[13px] font-bold text-[#8A7B63]">{d.playersCount(pub.players.length, 8)}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {pub.players.map(p => (
                <div key={p.id} className={`relative flex items-center gap-2.5 rounded-2xl px-3 py-2 hard-sm ${p.id === joined.playerId ? 'bg-[#FFE9B8]' : 'bg-[#FFFBef]'}`}>
                  <MouseAvatar seed={p.id} size={42} halo="#FFF3CF" state={p.connected ? 'awake' : 'asleep'} />
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold truncate text-[15px] text-[#2B2016] leading-tight">{p.name} {p.isHost && '👑'}</div>
                    <div className="text-xs font-bold text-[#8A7B63] truncate">
                      {p.id === joined.playerId && p.isHost ? d.youHost : p.id === joined.playerId ? d.you : (p.wins ?? 0) > 0 ? d.winsSub(p.wins) : !p.connected ? d.offline : ''}
                    </div>
                  </div>
                  {speakingIds.has(p.id) && <span className="absolute -bottom-2 left-2 bg-[#0E9F6E] text-white text-[11px] rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
                  {isHost && p.id !== joined.playerId && (
                    <button title={d.kick} className="absolute -top-2 -right-2 bg-[#D63A2F] text-white text-[11px] font-black rounded-full w-6 h-6 border-2 border-[#2B2016] leading-none"
                      onClick={() => getNet().kick(p.id)}>✕</button>)}
                </div>
              ))}
              {Array.from({ length: Math.max(0, 8 - pub.players.length) }).map((_, i) => (
                <div key={'slot' + i} className="rounded-2xl border-[2.5px] border-dashed border-[#D8C69A] flex items-center justify-center py-[15px] text-[#B3A284] font-bold text-sm">{d.waitingSlot}</div>
              ))}
            </div>
            {isHost && pub.players.length > 1 && <p className="text-xs font-bold text-[#8A7B63] italic mt-2">{d.kickHint}</p>}
            <div className="flex items-center gap-3 mt-3.5">
              <span className="disp font-extrabold text-[#2B2016]">{d.discussionTime}</span>
              <div className="flex bg-[#FFFBef] hard-xs rounded-2xl overflow-hidden ml-auto">
                {[60000, 120000, 180000].map(ms => {
                  const sel = ((pub as any).discussionMs ?? 120000) === ms;
                  return isHost
                    ? <button key={ms} onClick={() => getNet().setDiscussion(ms)} className={`disp px-3.5 py-1.5 font-extrabold ${sel ? 'bg-[#33241A] text-[#FFF3CF]' : 'text-[#8A7B63]'}`}>{ms / 60000}:00</button>
                    : <span key={ms} className={`disp px-3.5 py-1.5 font-extrabold ${sel ? 'bg-[#33241A] text-[#FFF3CF]' : 'text-[#B3A284]'}`}>{ms / 60000}:00</span>;
                })}
              </div>
            </div>
            <div className="mt-auto pt-3">
              <button className="w-full lg:hidden bg-[#FFFBef] hard-sm push rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-left" onClick={() => setChatSheet(true)}>
                <span className="text-lg">💬</span>
                <span className="flex-1 min-w-0 truncate font-bold text-[#6B5B43] text-sm">
                  {lastChat ? <><span className="font-extrabold text-[#2B2016]">{lastChat.fromName}:</span> {chatPreview(d, lastChat.text)}</> : d.chatEmpty}
                </span>
                {pub.chat.length > chatSeen && <span className="bg-[#D63A2F] text-white text-xs font-black rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center border-2 border-[#2B2016]">{pub.chat.length - chatSeen}</span>}
              </button>
              {isHost ? (
                <>
                  <button className={`${BTN} btn-amber w-full text-xl mt-2.5 !py-3.5`}
                    disabled={pub.players.filter(p => p.connected).length < 4}
                    onClick={() => getNet().startGame()}>▶ {d.start}</button>
                  {pub.players.length < 4 && <p className="text-center text-[#D63A2F] font-bold mt-2 text-sm">{d.need4}</p>}
                </>
              ) : <p className="text-center font-bold text-[#8A7B63] mt-3">{d.waiting}</p>}
            </div>
          </div>
        )}

        {/* ---------- ROLE REVEAL ---------- */}
        {phase === 'roleReveal' && priv && (
          <div className="anim-pop flex flex-col flex-1 min-h-0 w-full">
            <p className="disp text-center text-[#FFB020] font-extrabold tracking-[0.22em] text-xs uppercase">{d.yourRole}</p>
            <p className="text-center text-[#B9BCE0] font-bold mt-1">{d.revealSub}</p>
            <div className="card-cream max-w-md sm:max-w-2xl w-full mx-auto mt-4 px-5 py-6 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="flex-1 text-center">
              <MouseAvatar seed={joined.playerId} size={118} halo="#FFF3CF" state={priv.role === 'thief' ? 'thief' : priv.role === 'fallmouse' ? 'dead' : 'awake'} />
              <div className="mt-3">
                <span className={`disp inline-block text-white font-extrabold text-xl rounded-2xl px-5 py-1.5 border-[2.5px] border-[#2B2016] shadow-[0_3px_0_#2B2016] ${priv.role === 'thief' ? 'bg-[#D63A2F]' : priv.role === 'fallmouse' ? 'bg-[#7C4DBD]' : 'bg-[#2E7CD6]'}`}>
                  {(priv.role === 'thief' ? d.thief : priv.role === 'fallmouse' ? d.fall : d.sleepy).toUpperCase()}
                </span>
              </div>
              <p className="mt-3 font-bold text-[#5C4B33] leading-snug">{priv.role === 'thief' ? d.thiefDesc : priv.role === 'fallmouse' ? d.fallDesc : d.sleepyDesc}</p>
              </div>
              <div className="border-t-2 sm:border-2 border-dashed border-[#D8C69A] mt-4 sm:mt-0 pt-4 sm:py-5 sm:px-5 sm:rounded-3xl sm:bg-[#FFFBEF] flex items-center justify-center gap-4 sm:w-[280px] flex-none">
                <DiceFace value={priv.dice ?? 1} size={76} />
                <div className="text-left">
                  <div className="text-[11px] font-black tracking-[0.16em] text-[#8A7B63] uppercase">{d.yourDice}</div>
                  <div className="disp text-5xl font-extrabold text-[#2B2016] leading-none mt-0.5">{priv.dice}</div>
                  <div className="font-bold text-[#5C4B33] text-sm mt-1">{d.wakeLine(priv.dice ?? 0)}</div>
                </div>
              </div>
              </div>
            </div>
            <div className="mt-auto pt-4 max-w-md w-full mx-auto">
              {pub.revealReady?.includes(joined.playerId) || optReady
                ? <p className="disp text-center font-extrabold text-[#35D99A] text-lg">{d.imReady}</p>
                : <button className={`${BTN} btn-amber w-full text-xl !py-3.5`} onClick={() => { setOptReady(true); pendingRef.current.ready = true; getNet().ready(); }}>{d.imReady}</button>}
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {pub.players.filter(p => p.connected).map(p => (
                  <span key={p.id} className={`w-3 h-3 rounded-full border-2 ${pub.revealReady?.includes(p.id) ? 'bg-[#FFB020] border-[#FFB020]' : 'bg-transparent border-[#3D3D63]'}`} />
                ))}
                <span className="ml-2 font-bold text-[#B9BCE0] text-sm">{d.readyOf(pub.revealReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</span>
              </div>
              {isHost && <button className="block mx-auto mt-2.5 underline font-bold text-[#B9BCE0]" onClick={() => getNet().beginNight()}>{d.forceNight}</button>}
            </div>
          </div>
        )}

        {/* ---------- NIGHT ---------- */}
        {phase === 'night' && priv && (
          <div ref={nightBoxRef} className="relative flex-1 min-h-0 flex flex-col">
            <div className="stars" /><div className="stars2" />
            {fly && <FlyCheese key={fly.key} x0={fly.x0} y0={fly.y0} dx={fly.dx} dy={fly.dy} onDone={() => setFly(null)} />}
            <div className="flex items-start gap-2 relative z-10">
              <div className="flex-1 min-w-0">
                <h2 className="disp text-[26px] font-extrabold text-[#FFF3CF] leading-none">🌙 {d.night}</h2>
                <p className="text-[#B9BCE0] font-bold text-sm mt-1">{d.hourOf(pub.currentHour ?? 1)}</p>
              </div>
              <TimerPill dark secs={secsLeft(pub.hourEndsAt, now)} />
              <button className="relative lg:hidden bg-[#23233F] border-2 border-[#3D3D63] text-white rounded-xl w-10 h-10 text-lg flex-none" title={d.chatTitle ?? 'Chat'}
                onClick={() => setChatSheet(true)}>💬{pub.chat.length > chatSeen && <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-[#D63A2F] rounded-full border-2 border-[#14142B]" />}</button>
            </div>
            <div className="flex items-center justify-between px-1 mt-3 relative z-10 max-w-md w-full mx-auto">
              {[1, 2, 3, 4, 5, 6].map(h => (
                <span key={h} className={`disp w-9 h-9 rounded-full flex items-center justify-center font-extrabold ${h === pub.currentHour ? 'bg-[#FFB020] text-[#2B2016] border-2 border-[#2B2016] scale-110' : h < (pub.currentHour ?? 1) ? 'bg-[#3D3D63] text-[#B9BCE0]' : 'bg-[#23233F] text-[#7C83B8]'}`}>{h}</span>
              ))}
            </div>
            <div className="max-w-md w-full mx-auto h-2 bg-[#23233F] rounded-full overflow-hidden mt-2 relative z-10" aria-label="hour progress">
              <div className="h-full bg-[#FFB020] rounded-full transition-[width] duration-300" style={{ width: `${pub.hourEndsAt ? Math.max(0, Math.min(100, ((pub.hourEndsAt - now) / HOUR_MS) * 100)) : 0}%` }} />
            </div>
            {/* Table indicator must reflect what THIS player can actually see:
                wakers see the real table (cheese present or gone); sleepers
                have their eyes closed and must NOT be told the cheese is
                "on the table" when it may already be stolen. */}
            <div className="relative z-10 mt-3 rounded-3xl border-[2.5px] border-[#2B2016] shadow-[0_4px_0_#2B2016] bg-gradient-to-b from-[#A06A35] to-[#7C4A21] px-4 py-3 flex items-center gap-3.5 max-w-md w-full mx-auto">
              <div id="table-cheese" className="flex-none leading-none">
                {priv.awake
                  ? (priv.cheesePresentWhenAwake === false ? <span className="text-5xl">🍽️</span> : <span className="anim-wiggle inline-block"><CheeseWedge size={74} /></span>)
                  : <span className="opacity-40 inline-block"><CheeseWedge size={74} /></span>}
              </div>
              <div className="min-w-0">
                <div className="disp font-extrabold text-[#FFF3CF] text-lg leading-tight">
                  {priv.awake ? (priv.cheesePresentWhenAwake === false ? d.tableGoneT : d.tableStill) : d.eyesClosedT}
                </div>
                <div className="text-[#F3D9AE] font-bold text-sm leading-snug">
                  {priv.awake ? (priv.cheesePresentWhenAwake === false ? d.tableGoneSub : d.tableStillSub) : d.eyesClosedSub}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 relative z-10 max-w-md w-full mx-auto">
              {pub.players.map(p => {
                const isMe = p.id === joined.playerId;
                const awakeNow = isMe ? !!priv.awake : priv.fellowWakers.includes(p.id);
                const knownThief = priv.knownThiefId === p.id || priv.witnessedThiefId === p.id;
                return (
                <div key={p.id} id={`pcard-${p.id}`} className={`rounded-3xl border-2 p-2 text-center relative transition-all duration-300 ${isMe && priv.awake ? 'bg-[#FFB020] border-[#2B2016] shadow-[0_3px_0_#2B2016] text-[#2B2016]' : awakeNow ? 'bg-[#2E7CD6] border-[#9CC3F5] text-white' : 'bg-[#1D1D38] border-[#3D3D63] text-[#B9BCE0]'} ${flyHit === p.id ? 'ring-4 ring-[#FFB020] scale-[1.07] z-10' : ''}`}>
                  <MouseAvatar seed={p.id} size={50} state={awakeNow ? (knownThief ? 'thief' : 'awake') : 'asleep'} />
                  {!awakeNow && <span className="absolute top-1.5 right-2.5 text-[#7C83B8] font-black text-sm">z</span>}
                  <div className="font-extrabold truncate text-[13px] leading-tight">{p.name}{isMe ? ` (${d.you})` : ''}</div>
                  {priv.stealById === p.id && <span className="absolute -top-2 -left-2 text-2xl anim-pop">🧀</span>}
                  {priv.peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2 -right-2 bg-[#2E7CD6] text-white text-[11px] font-extrabold rounded-full px-2 py-0.5 border-2 border-[#2B2016] z-20">{d.peekPill(priv.peeks.find(x => x.targetId === p.id)!.dice)}</span>}
                  {speakingIds.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-[#0E9F6E] text-white text-[11px] rounded-full px-1.5 py-0.5 shadow z-20 anim-pulse-soft">🎙️</span>}
                  {(priv.knownFollowerIds.includes(p.id) || (isMe && priv.isFollower)) && <span className="absolute -bottom-2 -right-2 text-lg anim-pop">🤝</span>}
                </div>);
              })}
            </div>
            {priv.awake ? (
              <div className="card-cream anim-pop max-w-md w-full mx-auto mt-auto relative z-10 px-4 py-3.5 text-center">
                <div className="disp text-lg font-extrabold text-[#2B2016]">👁 {d.youAwake}</div>
                {priv.cheesePresentWhenAwake === false && <p className="font-bold text-[#D63A2F] mt-1">{d.cheeseGoneWake}</p>}
                {priv.cheesePresentWhenAwake === true && <p className="font-bold text-[#8A7B63] mt-1">{d.cheeseHere}</p>}
                {priv.fellowWakers.length > 0 && <p className="mt-1 font-bold text-[#7C4DBD]">👀👀 {d.fellow} ({priv.fellowWakers.map(id => pub.players.find(p => p.id === id)?.name).join(', ')})</p>}
                {priv.role === 'thief' && priv.hasActedThisHour && <p className="mt-3 font-extrabold text-[#0B8A5E]">{d.stolenOk}</p>}
                {priv.followerCandidates && (
                  <div className="mt-3">
                    <div className="font-extrabold mb-2 text-[#7C4DBD]">{d.chooseWitnessTitle}</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {priv.followerCandidates.map(id => (
                        <button key={id} className={`${BTN} !bg-[#7C4DBD] text-white !px-3.5 !py-1.5 text-sm inline-flex items-center gap-1.5`} onClick={() => getNet().nightAction('chooseFollower', id)}><MouseAvatar seed={id} size={22} /> {nameOf(id)}</button>))}
                    </div>
                  </div>)}
                {priv.isFollower && (
                  <p className="mt-3 bg-[#DFF5E3] border-2 border-[#0E9F6E] rounded-2xl px-4 py-2 font-extrabold text-[#0B6B4A]">🤝 {d.becameFollower}</p>)}
                {!priv.isFollower && priv.role !== 'thief' && priv.knownFollowerIds.length > 0 && (
                  <p className="mt-3 font-bold text-[#7C4DBD]">{d.witnessKnows(priv.knownFollowerIds.map(nameOf).join(', '))}</p>)}
                {priv.canInspect && !optPeek && (
                  <div className="mt-3">
                    <div className="font-bold mb-2 text-[#5C4B33]">{d.inspectTitle}</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {pub.players.filter(p => p.id !== joined.playerId).map(p => (
                        <button key={p.id} className={`${BTN} btn-blue !px-3.5 !py-1.5 text-sm inline-flex items-center gap-1.5`} onClick={() => { setOptPeek(true); getNet().nightAction('inspect', p.id); }}><MouseAvatar seed={p.id} size={22} /> {p.name}</button>))}
                    </div>
                  </div>)}
                {priv.canInspect && optPeek && !priv.inspected && (
                  <p className="mt-3 font-extrabold text-[#2E7CD6] text-lg">{d.looking}</p>)}
                {priv.inspected && <p className="mt-3 font-extrabold text-[#2E7CD6] text-lg">🔎 {d.inspected(pub.players.find(p => p.id === priv.inspected!.targetId)?.name || '?', priv.inspected.dice)}</p>}
              </div>
            ) : (
              <p className="text-[#B9BCE0] font-bold text-lg text-center mt-auto pb-2 relative z-10">{d.sleeping}</p>
            )}
          </div>
        )}

        {/* ---------- RECRUIT (after hour 6, 6–8 players) ---------- */}
        {phase === 'recruit' && priv && (
          <div className="relative flex-1 min-h-0 flex flex-col w-full">
            <div className="stars" /><div className="stars2" />
            <div className="flex items-start gap-2 relative z-10 max-w-xl w-full mx-auto">
              <div className="flex-1 min-w-0">
                <h2 className="disp text-[26px] font-extrabold text-[#FFF3CF] leading-tight">{priv.role === 'thief' ? d.recruitTitle : '🌙 ' + d.night}</h2>
                {priv.role === 'thief' && <p className="text-[#B9BCE0] font-bold text-sm mt-0.5">{d.hourOf(6)} · {d.revealSub}</p>}
              </div>
              <TimerPill dark secs={secsLeft(pub.recruitEndsAt, now)} />
            </div>
            {priv.role === 'thief' && priv.followerCandidates ? (
              <div className="card-cream anim-pop max-w-xl w-full mx-auto mt-4 relative z-10 px-4 py-4">
                <div className="flex items-center gap-3">
                  <MouseAvatar seed={joined.playerId} size={52} state="thief" halo="#FFF3CF" />
                  <div className="min-w-0">
                    <div className="disp font-extrabold text-lg text-[#2B2016] leading-tight">{d.recruitTitle}</div>
                    <div className="text-sm font-bold text-[#8A7B63]">{d.recruitHint(priv.followersNeeded, priv.followersChosen)}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {priv.followerCandidates.map(id => (
                    <div key={id} className="flex items-center gap-2.5 bg-white rounded-2xl hard-sm px-3 py-2">
                      <MouseAvatar seed={id} size={40} halo="#FFF3CF" />
                      <span className="flex-1 font-extrabold text-[#2B2016] truncate">{nameOf(id)}</span>
                      <button className={`${BTN} btn-green !px-4 !py-1.5 text-sm flex-none`} onClick={() => getNet().nightAction('chooseFollower', id)}>+ {d.inviteBtn}</button>
                    </div>))}
                </div>
              </div>
            ) : priv.isFollower ? (
              <div className="card-cream anim-pop max-w-xl w-full mx-auto mt-4 relative z-10 px-4 py-4 text-center">
                <p className="font-extrabold text-[#0B8A5E] text-xl">🤝 {d.becameFollower}</p>
                {priv.knownThiefId
                  ? <p className="font-bold text-[#D63A2F] mt-1">{d.knowsThief(nameOf(priv.knownThiefId))}</p>
                  : <p className="font-bold text-[#8A7B63] mt-1">{d.followerBlind}</p>}
                {priv.knownFollowerIds.length > 0 && <p className="font-bold text-[#0B8A5E] mt-1">{d.knowsFollower(priv.knownFollowerIds.map(nameOf).join(', '))}</p>}
              </div>
            ) : (
              <p className="text-[#B9BCE0] font-bold text-xl text-center mt-8 relative z-10">{d.recruitWaiting}</p>
            )}
            <div className="mt-auto relative z-10 flex items-end justify-between gap-3 pt-3 max-w-xl w-full mx-auto">
              <p className="text-[#7C83B8] text-[13px] font-bold leading-snug">{priv.role === 'thief' ? d.recruitNote : ''}</p>
              <button className="relative lg:hidden bg-[#23233F] border-2 border-[#3D3D63] text-white rounded-2xl px-4 py-2.5 font-extrabold flex-none" onClick={() => setChatSheet(true)}>💬 Chat{pub.chat.length > chatSeen && <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-[#D63A2F] rounded-full border-2 border-[#14142B]" />}</button>
            </div>
          </div>
        )}

        {/* ---------- DAY ---------- */}
        {phase === 'day' && (
          <div className="anim-pop flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2.5">
              <span className="w-11 h-11 rounded-full bg-[#FFB020] border-[2.5px] border-[#2B2016] flex items-center justify-center text-[22px] flex-none">☀️</span>
              <div className="flex-1 min-w-0">
                <h2 className="disp text-[26px] font-extrabold text-[#2B2016] leading-none">{d.dayTitle}</h2>
                <p className="font-extrabold text-[#D63A2F] text-sm mt-0.5">{d.daySub}</p>
              </div>
              <TimerPill secs={secsLeft(pub.discussionEndsAt, now)} />
            </div>
            {priv?.isFollower && (
              <p className="bg-[#DFF5E3] border-2 border-[#0E9F6E] rounded-2xl px-4 py-2 mt-3 text-center font-extrabold text-[#0B6B4A] anim-pop">🤝 {d.becameFollower}</p>)}
            {priv?.witnessedThiefId && (
              <p className="text-center font-extrabold text-[#D63A2F] mt-3">{d.sawThief(nameOf(priv.witnessedThiefId))}</p>)}
            <div className="flex lg:hidden gap-1.5 mt-3 pb-1">
              {pub.players.map(p => (
                <div key={p.id} className={`relative flex-1 min-w-0 rounded-2xl border-2 px-1 py-1.5 text-center ${p.id === joined.playerId ? 'bg-[#FFE9B8] border-[#2B2016] shadow-[0_2px_0_#2B2016]' : 'bg-[#FFFBef] border-[#E3D3AC]'}`}>
                  <MouseAvatar seed={p.id} size={36} state={(priv?.knownThiefId === p.id || priv?.witnessedThiefId === p.id) ? 'thief' : 'awake'} />
                  <div className="text-[11px] font-extrabold truncate text-[#2B2016]">{p.name}</div>
                  {priv?.peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2 -right-1.5 bg-[#2E7CD6] text-white text-[11px] font-black rounded-full w-5 h-5 flex items-center justify-center border-2 border-[#2B2016] z-10">{priv.peeks.find(x => x.targetId === p.id)!.dice}</span>}
                  {speakingIds.has(p.id) && <span className="absolute -bottom-2 left-0 bg-[#0E9F6E] text-white text-[10px] rounded-full px-1 py-0.5 anim-pulse-soft z-10">🎙️</span>}
                  {(priv?.knownFollowerIds.includes(p.id) || (p.id === joined.playerId && priv?.isFollower)) && <span className="absolute -bottom-2 right-0 text-sm z-10">🤝</span>}
                </div>))}
            </div>
            <div className="hidden lg:grid grid-cols-3 gap-2.5 mt-3">
              {pub.players.map(p => (
                <div key={p.id} className={`relative rounded-2xl border-2 px-3 py-3 text-center ${p.id === joined.playerId ? 'bg-[#FFE9B8] border-[#2B2016] shadow-[0_3px_0_#2B2016]' : 'bg-[#FFFBef] border-[#E3D3AC]'}`}>
                  <MouseAvatar seed={p.id} size={56} state={(priv?.knownThiefId === p.id || priv?.witnessedThiefId === p.id) ? 'thief' : 'awake'} />
                  <div className="disp font-extrabold text-lg text-[#2B2016] mt-1 leading-tight">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</div>
                  {priv?.peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2.5 right-2 bg-[#2E7CD6] text-white text-xs font-extrabold rounded-full px-2.5 py-0.5 border-2 border-[#2B2016] whitespace-nowrap z-10">{d.peekPill(priv.peeks.find(x => x.targetId === p.id)!.dice)}</span>}
                  {speakingIds.has(p.id) && <span className="absolute top-2 left-2 bg-[#0E9F6E] text-white text-[11px] rounded-full px-1.5 py-0.5 anim-pulse-soft">🎙️</span>}
                  {(priv?.knownFollowerIds.includes(p.id) || (p.id === joined.playerId && priv?.isFollower)) && <span className="absolute top-2 right-2 text-lg">🤝</span>}
                </div>))}
            </div>
            <div className="flex-1 min-h-0 flex flex-col lg:hidden"><ChatPanel chat={pub.chat} myId={joined.playerId} d={d} height="flex" onChat={t => getNet().chat(t)} /></div>
            <div className="mt-3 lg:mt-auto text-center">
              {pub.dayReady?.includes(joined.playerId) || optReadyVote
                ? <p className="disp font-extrabold text-[#0B8A5E] text-lg">✅ {d.readyVoteDone}</p>
                : <button className={`${BTN} btn-dark w-full text-lg !py-3`} onClick={() => { setOptReadyVote(true); pendingRef.current.readyVote = true; getNet().readyVote(); }}>{d.readyVoteBtn}</button>}
              <p className="font-bold text-[#8A7B63] mt-1.5 text-sm">{d.readyVoteOf(pub.dayReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
            </div>
            {isHost && <button className={`${BTN} btn-amber w-full mt-2`} onClick={() => getNet().toVoting()}>🗳️ {d.toVote}</button>}
          </div>
        )}

        {/* ---------- VOTING ---------- */}
        {phase === 'voting' && (
          <div className="anim-pop flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2.5">
              <span className="w-11 h-11 rounded-full bg-[#FFB020] border-[2.5px] border-[#2B2016] flex items-center justify-center text-[22px] flex-none">🗳️</span>
              <div className="flex-1 min-w-0">
                <h2 className="disp text-[26px] font-extrabold text-[#2B2016] leading-none">{d.voting}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-0.5">{d.votedCount(pub.players.filter(p => p.hasVoted).length, pub.players.length)}</p>
              </div>
              <TimerPill secs={secsLeft(pub.voteEndsAt, now)} />
            </div>
            <div className="bg-[#FFFBef] hard-sm rounded-2xl px-4 py-2.5 mt-3 font-bold text-[#5C4B33]">
              {d.voteInstrA}<span className="text-[#D63A2F] font-extrabold">{d.thief}</span>{d.voteInstrB}
            </div>
            {priv?.myVote || optVote
              ? <p className="mt-5 disp font-extrabold text-[#0B8A5E] text-xl text-center">{d.votedFor(pub.players.find(p => p.id === (priv?.myVote || optVote))?.name || '?')}</p>
              : (
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                {pub.players.map(p => {
                  const isMe = p.id === joined.playerId;
                  return (
                  <button key={p.id} disabled={isMe}
                    onClick={() => { setOptVote(p.id); pendingRef.current.vote = p.id; getNet().vote(p.id); }}
                    className={`relative rounded-3xl px-3 pt-4 pb-3 text-center ${isMe ? 'bg-[#FFF3CF] border-[2.5px] border-dashed border-[#D8C69A] opacity-80' : 'card-cream push cursor-pointer'}`}>
                    <MouseAvatar seed={p.id} size={62} halo="#FFF3CF" state={(priv?.knownThiefId === p.id || priv?.witnessedThiefId === p.id) ? 'thief' : 'awake'} />
                    <div className="disp font-extrabold text-lg text-[#2B2016] mt-1 leading-tight">{p.name}{isMe ? ` (${d.you})` : ''}</div>
                    <div className={`text-[13px] font-bold ${isMe ? 'text-[#8A7B63]' : p.hasVoted ? 'text-[#2B2016]' : 'italic text-[#8A7B63]'}`}>
                      {isMe ? d.cantVoteSelf : p.hasVoted ? d.votedStatus : d.thinkingStatus}
                    </div>
                    {priv?.peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#2E7CD6] text-white text-xs font-extrabold rounded-full px-2.5 py-0.5 border-2 border-[#2B2016] whitespace-nowrap z-10">{d.peekPill(priv.peeks.find(x => x.targetId === p.id)!.dice)}</span>}
                    {speakingIds.has(p.id) && <span className="absolute top-2 left-2 bg-[#0E9F6E] text-white text-[11px] rounded-full px-1.5 py-0.5 anim-pulse-soft">🎙️</span>}
                    {(priv?.knownFollowerIds.includes(p.id) || (isMe && priv?.isFollower)) && <span className="absolute top-2 right-2 text-lg">🤝</span>}
                  </button>);
                })}
              </div>)}
            <p className="text-[13px] font-bold text-[#8A7B63] mt-auto pt-3 leading-snug">{d.voteRule}</p>
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {phase === 'results' && (
          <div className="anim-pop flex-1 min-h-0 flex flex-col">
            <div className="card-cream overflow-hidden !rounded-[28px] flex-1 min-h-0 flex flex-col">
              <div className="relative bg-[#171731] px-4 pt-3 pb-9 text-center overflow-hidden flex-none">
                <Confetti />
                <p className="disp relative text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.resultsKicker(pub.round)}</p>
                <h2 className="disp relative text-[#FFF3CF] font-extrabold text-[20px] leading-snug sm:text-3xl sm:leading-tight mt-1">{pub.winner === 'sleepyheads' ? d.sleepyWin : pub.winner === 'fallmouse' ? d.fallWin : d.thiefWin}</h2>
                <p className="relative text-[#B9BCE0] font-bold mt-0.5 text-sm">{pub.winner === 'sleepyheads' ? d.winSubVillage : pub.winner === 'fallmouse' ? d.winSubFall : d.winSubThief}</p>
              </div>
              <div className="px-3 -mt-7 relative z-10 flex flex-row gap-2 flex-none">
                <div className="bg-[#FFF3CF] hard rounded-3xl px-3 py-1.5 flex items-center gap-2.5 flex-1 min-w-0">
                  <MouseAvatar seed={pub.thiefId || ''} size={38} state="thief" halo="#FFFBef" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-black tracking-[0.06em] text-[#8A7B63] leading-tight">{d.thiefCardLabel}</div>
                    <div className="disp text-xl font-extrabold text-[#2B2016] leading-none truncate">{pub.players.find(p => p.id === pub.thiefId)?.name || '?'}</div>
                  </div>
                </div>
                {pub.players.some(p => (p as any).role === 'fallmouse') && (
                  <div className="bg-[#EFE6FB] hard rounded-3xl px-3 py-1.5 flex items-center gap-2.5 flex-1 min-w-0">
                    <MouseAvatar seed={pub.players.find(p => (p as any).role === 'fallmouse')?.id || ''} size={38} state="dead" halo="#FFFBef" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-black tracking-[0.06em] text-[#8A7B63] leading-tight">{d.fallCardLabel}</div>
                      <div className="disp text-xl font-extrabold text-[#2B2016] leading-none truncate">{pub.players.find(p => (p as any).role === 'fallmouse')?.name || '?'}</div>
                    </div>
                  </div>)}
              </div>
              <div className="bg-[#FFF3CF] px-3.5 pt-3 pb-3.5 flex-1 min-h-0 flex flex-col">
                <h3 className="disp font-extrabold text-base text-[#2B2016]">{d.rolesTitle}</h3>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5 flex-none">
                  {[...pub.players].sort((a, b) => {
                    const w = (p: any) => p.id === pub.thiefId ? 0 : p.id === joined.playerId ? 1 : 2;
                    return w(a) - w(b);
                  }).map(p => {
                    const role = (p as any).role as string | undefined;
                    const side = role === 'fallmouse' ? 'fallmouse' : (role === 'thief' || p.isFollower) ? 'thief' : 'village';
                    const winnerSide = pub.winner === 'sleepyheads' ? 'village' : pub.winner === 'fallmouse' ? 'fallmouse' : 'thief';
                    const votes = pub.voteCounts?.find(v => v.id === p.id)?.count ?? 0;
                    return (
                    <div key={p.id} className={`relative flex items-center gap-2 rounded-2xl hard-sm px-2.5 py-1 ${role === 'thief' ? 'bg-[#FDE3E0]' : p.id === joined.playerId ? 'bg-[#FFE9B8]' : 'bg-[#FFFBef]'}`}>
                      <span className="absolute -top-2 right-2 bg-[#2B2016] text-white text-[10px] font-black rounded-full px-1.5 py-px">{votes} {d.votes}</span>
                      <MouseAvatar seed={p.id} size={30} halo="#FFFBef" state={role === 'thief' ? 'thief' : role === 'fallmouse' ? 'dead' : 'awake'} />
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-[#2B2016] truncate leading-tight">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`inline-block text-[10px] font-black text-white rounded-full px-1.5 py-px whitespace-nowrap ${role === 'thief' ? 'bg-[#D63A2F]' : role === 'fallmouse' ? 'bg-[#7C4DBD]' : 'bg-[#2E7CD6]'}`}>
                            {role === 'thief' ? d.thief : role === 'fallmouse' ? d.fall : d.sleepy}{p.isFollower ? ' 🤝' : ''}
                          </span>
                          <span className="inline-block bg-[#2B2016] text-white text-[10px] font-black rounded-full px-1.5 py-px whitespace-nowrap">🎲{p.dice ?? 1}</span>
                        </div>
                      </div>
                      {side === winnerSide && <span className="text-base flex-none">🏆</span>}
                    </div>);
                  })}
                </div>
                <div className="results-standings grid grid-cols-2 gap-2 mt-2.5 items-start flex-none">
                  <Standings />
                  <MyRecord />
                </div>
                {(pub as any).recap?.length > 0 && (
                  <div className="results-recap bg-[#1D1D38] rounded-3xl hard p-3.5 mt-2.5 text-left flex-1 min-h-0 overflow-y-auto">
                    <div className="disp font-extrabold text-[#FFF3CF] text-center mb-0.5">{d.recapTitle}</div>
                    <div className="lg:grid lg:grid-cols-2 lg:gap-x-5">
                    {[1, 2, 3, 4, 5, 6].map(h => {
                      const evs = (pub as any).recap.filter((e: any) => e.hour === h && !e.afterNight);
                      if (!evs.length) return null;
                      const wake = evs.find((e: any) => e.kind === 'wake');
                      const steal = evs.some((e: any) => e.kind === 'steal');
                      return (
                        <div key={h} className="flex gap-2.5 mt-1.5">
                          <span className={`disp w-6 h-6 rounded-full flex-none flex items-center justify-center font-extrabold text-[13px] ${steal ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#3D3D63] text-[#B9BCE0]'}`}>{h}</span>
                          <div className="text-[#EDEDF7] font-bold text-[13px] leading-snug pt-0.5">
                            {wake && wake.ids.length
                              ? <span>{d.recapWake(wake.ids.map(nameOf).join(', '))}</span>
                              : <span className="text-[#7C83B8]">{d.recapNone}</span>}
                            {evs.filter((e: any) => e.kind !== 'wake').map((e: any, i: number) => (
                              <span key={i} className="block">
                                {e.kind === 'steal' && d.recapSteal(nameOf(e.ids[0]))}
                                {e.kind === 'witness' && d.recapWitness(e.ids.map(nameOf).join(', '))}
                                {e.kind === 'inspect' && d.recapInspect(nameOf(e.ids[0]), nameOf(e.targetId), e.seen)}
                                {e.kind === 'recruit' && d.recapRecruit(nameOf(e.ids[0]))}
                              </span>))}
                          </div>
                        </div>);
                    })}
                    {(pub as any).recap.some((e: any) => e.afterNight) && (
                      <div className="flex gap-2.5 mt-1.5">
                        <span className="disp w-6 h-6 rounded-full flex-none flex items-center justify-center font-extrabold text-[13px] bg-[#3D3D63] text-[#B9BCE0]">🌅</span>
                        <div className="text-[#EDEDF7] font-bold text-[13px] leading-snug pt-0.5">
                          {(pub as any).recap.filter((e: any) => e.afterNight).map((e: any, i: number) => (
                            <span key={i} className="block">{d.recapRecruit(nameOf(e.ids[0]))}</span>))}
                        </div>
                      </div>)}
                    </div>
                  </div>)}
                <button className="w-full bg-[#FFFBef] hard-sm push rounded-2xl px-3.5 py-2.5 mt-2.5 flex items-center gap-2 text-left flex-none" onClick={() => setChatSheet(true)}>
                  <span className="text-lg">💬</span>
                  <span className="flex-1 min-w-0 truncate font-bold text-[#5C4B33]">
                    {lastChat ? <><span className="font-extrabold text-[#2B2016]">{lastChat.fromName}:</span> {chatPreview(d, lastChat.text)}</> : d.chatEmpty}
                  </span>
                  {pub.chat.length > chatSeen && <span className="bg-[#D63A2F] text-white text-xs font-black rounded-full min-w-6 h-6 px-1 flex items-center justify-center flex-none">{pub.chat.length - chatSeen}</span>}
                </button>
                <div className="flex gap-2 mt-2.5 flex-none">
                  <button className={`${BTN} flex-1 !bg-[#DCEBFB] text-[#2B2016] !py-2.5 !px-3 whitespace-nowrap text-[15px]`} onClick={shareResult}>
                    {shared ? '✅ ' + d.shareCopied : '📋 ' + d.shareResults}
                  </button>
                  {isHost
                    ? <button className={`${BTN} btn-amber flex-1 !py-2.5 !px-3 whitespace-nowrap text-[15px]`} onClick={() => getNet().playAgain()}>🔁 {d.playAgain}</button>
                    : <p className="flex-1 text-center font-bold text-[#8A7B63] self-center text-[13px] leading-tight line-clamp-2">{d.waiting}</p>}
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
        {(phase === 'lobby' || phase === 'day' || phase === 'night' || phase === 'recruit') && joined && (
          <aside className="hidden lg:flex flex-col w-[360px] flex-none min-h-0 bg-[#FFF3CF] hard-sm rounded-3xl overflow-hidden">
            <div className="px-4 pt-3.5 pb-3 border-b-2 border-[#E8D9B0]">
              <div className="disp text-xl font-extrabold text-[#2B2016]">{phase === 'day' ? d.chatPanelDay : d.chatTitle}</div>
              {(phase === 'night' || phase === 'recruit') && <div className="text-xs font-bold text-[#8A7B63]">{d.chatSleepNote}</div>}
              {phase === 'recruit' && priv?.role === 'thief' && <div className="text-[13px] font-bold text-[#8A7B63] mt-1.5 leading-snug">{d.recruitNote}</div>}
            </div>
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <ChatPanel chat={pub.chat} myId={joined.playerId} d={d} onChat={t => getNet().chat(t)} height="flex" />
            </div>
          </aside>
        )}
        </div>
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub.chat} myId={joined.playerId} d={d} onChat={t => getNet().chat(t)} />
      </div>
      {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
