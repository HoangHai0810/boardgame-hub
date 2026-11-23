import { useEffect, useMemo, useRef, useState } from 'react';
import { createNet, Net, Pub, Priv } from './net';
import { t, Lang } from './i18n';
import { HOUR_MS } from '../../shared/logic';
import { sfx, ensureCtx } from './sound';
import { joinVoice, VoiceHandle } from './voice';

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

function useNow(step = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), step); return () => clearInterval(i); }, [step]);
  return now;
}
const secsLeft = (endsAt: number | null, now: number) => endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;

const BTN = 'px-5 py-3 rounded-2xl font-bold shadow-lg transition active:scale-95 disabled:opacity-40 disabled:active:scale-100';
const CARD = 'bg-white/95 rounded-3xl shadow-2xl p-4 sm:p-5';

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🧀 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} bg-amber-400 w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

function TopBar({ d, lang, muted, onToggleMuted, onHelp, onToggleLang, voice }: { d: any; lang: Lang; muted: boolean; onToggleMuted: () => void; onHelp: () => void; onToggleLang: () => void; voice?: { state: 'off' | 'busy' | 'on'; muted: boolean; onToggle: () => void; onLeave: () => void } }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="font-extrabold text-white drop-shadow text-lg">🧀 {d.title}</div>
      <div className="flex gap-2">
        {voice && (voice.state === 'off'
          ? <button title={d.voiceJoin} className="bg-white/20 text-white rounded-full px-3 py-1" onClick={voice.onToggle}>🎤</button>
          : voice.state === 'busy'
            ? <button title={d.voiceJoin} className="bg-amber-400 text-white rounded-full px-3 py-1 anim-pulse-soft">🎤</button>
            : <>
              <button title={voice.muted ? d.voiceUnmute : d.voiceMute} className={`${voice.muted ? 'bg-red-500' : 'bg-green-500'} text-white rounded-full px-3 py-1`} onClick={voice.onToggle}>{voice.muted ? '🔇' : '🎤'}</button>
              <button title={d.voiceLeave} className="bg-white/20 text-white rounded-full px-3 py-1" onClick={voice.onLeave}>✕</button>
            </>)}
        <button aria-label="sound" className="bg-white/20 text-white rounded-full px-3 py-1" onClick={onToggleMuted}>{muted ? '🔇' : '🔊'}</button>
        <button className="bg-white/20 text-white rounded-full px-3 py-1 font-bold" onClick={onHelp}>❓ {d.help}</button>
        <button className="bg-white/20 text-white rounded-full px-3 py-1 font-bold" onClick={onToggleLang}>{lang === 'en' ? '🇻🇳 VI' : '🇬🇧 EN'}</button>
      </div>
    </div>
  );
}

// Quick reactions + preset phrases: one-tap chat. Phrases travel as QC
// tokens and render localized in the VIEWER's language.
const REACTIONS = ['👀', '🧀', '😱', '🤔', '👍', '👎', '😂', '❓'];
const QC_KEYS = ['qc1', 'qc2', 'qc3', 'qc4'] as const;

function renderChatText(d: any, text: string) {
  if ((REACTIONS as string[]).includes(text)) return <span className="text-4xl leading-tight">{text}</span>;
  const qc = /^QC([1-4])$/.exec(text);
  if (qc) return <span>{d['qc' + qc[1]]}</span>;
  return <span>{text}</span>;
}

// Module-level ON PURPOSE: this panel owns the draft text and the scroll
// box. When it lived inside App, every state broadcast remounted it — the
// draft vanished mid-typing, focus was lost, old messages re-animated and
// scrollIntoView dragged the whole page up and down. Auto-scroll now only
// moves THIS box, and only while the reader is already near the bottom
// (or the newest message is their own).
function ChatPanel({ chat, myId, d, height = 'h-48', onChat }: { chat: any[]; myId?: string; d: any; height?: string; onChat: (text: string) => void }) {
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const send = () => { if (text.trim()) { onChat(text); setText(''); } };
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const lastMine = chat.length > 0 && chat[chat.length - 1].fromId === myId;
    if (stickRef.current || lastMine) el.scrollTop = el.scrollHeight;
  }, [chat.length, myId]);
  return (
    <div className={`text-left ${height === 'flex' ? 'flex flex-col flex-1 min-h-0' : ''}`}>
      <div ref={boxRef}
        onScroll={e => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className={`bg-gradient-to-b from-amber-50 to-orange-50 rounded-2xl p-3 ${height === 'flex' ? 'flex-1 min-h-0' : height} overflow-y-auto space-y-2`}>
        {chat.length === 0 && <p className="text-center text-gray-400 font-bold py-4">{d.chatEmpty}</p>}
        {chat.map((m: any, i: number) => {
          const mine = m.fromId === myId;
          return (
            <div key={`${m.ts}-${m.fromId}-${i}`} className={`flex ${mine ? 'justify-end' : 'justify-start'} anim-slide-up`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 shadow ${mine ? 'bg-amber-400 rounded-br-md' : 'bg-white rounded-bl-md'}`}>
                <div className="text-xs font-extrabold opacity-70">{mouseFor(m.fromId)} {m.fromName}
                  <span className="font-normal ml-2">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                <div className="leading-snug">{renderChatText(d, m.text)}</div>
              </div>
            </div>);
        })}
      </div>
      <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1" aria-label="quick reactions">
        {REACTIONS.map(e => (
          <button key={e} className="text-2xl bg-white rounded-full w-10 h-10 shrink-0 shadow active:scale-90 transition"
            onClick={() => onChat(e)}>{e}</button>
        ))}
        {QC_KEYS.map((k, i) => (
          <button key={k} className="text-xs font-bold bg-indigo-100 text-indigo-800 rounded-full px-3 h-10 shrink-0 shadow active:scale-95 transition whitespace-nowrap"
            onClick={() => onChat('QC' + (i + 1))}>{d[k]}</button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input className="flex-1 border-2 border-amber-300 rounded-2xl px-4 py-2.5" placeholder={d.chatPh} maxLength={300}
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <button className={`${BTN} bg-amber-400 !py-2`} onClick={send}>{d.send}</button>
      </div>
    </div>
  );
}

// Module-level for the same reason as ChatPanel: a click landing while App
// re-rendered used to hit a freshly remounted chip and die — voting felt
// like it needed 2–3 clicks. Stable identity = one click, one vote.
function PlayerChips({ players, myId, phase, d, roleLabel, onPick, pickable, onKick, markThiefId, markFollowerIds, iAmFollower, peeks, speakingIds }: {
  players: any[]; myId?: string; phase?: string; d: any;
  roleLabel: (role?: string | null, isFollower?: boolean) => string;
  onPick?: (id: string) => void; pickable?: (p: any) => boolean; onKick?: (id: string) => void;
  markThiefId?: string | null; markFollowerIds?: string[]; iAmFollower?: boolean; peeks?: { targetId: string; dice: number }[];
  speakingIds?: Set<string>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
      {players.map(p => (
        <button key={p.id} disabled={onPick ? (pickable ? !pickable(p) : false) : !onKick}
          onClick={() => onPick?.(p.id)}
          className={`relative rounded-2xl p-2.5 text-center shadow ${p.id === markThiefId ? 'bg-red-100 ring-4 ring-red-400' : markFollowerIds?.includes(p.id) ? 'bg-emerald-50 ring-4 ring-emerald-400' : p.id === myId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${onPick ? 'hover:scale-105 transition cursor-pointer' : 'cursor-default'} disabled:opacity-50 disabled:hover:scale-100`}>
          {p.id === markThiefId && <span className="absolute -top-2 -left-2 text-2xl anim-pop" title={d.thief}>😈</span>}
          {(markFollowerIds?.includes(p.id) || (p.id === myId && iAmFollower)) && <span className="absolute -top-2 -left-2 text-2xl anim-pop">🤝</span>}
          {peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2 -right-2 bg-sky-500 text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow">🎲{peeks!.find(x => x.targetId === p.id)!.dice}</span>}
          {speakingIds?.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
          <div className={`text-3xl anim-bob w-12 h-12 mx-auto rounded-full flex items-center justify-center ${avatarBg(p.id)} shadow-inner`}>{mouseFor(p.id)}</div>
          <div className="font-bold truncate">{p.name} {p.id === myId && <span className="text-amber-600">({d.you})</span>}</div>
          <div className="text-xs">{p.isHost && <span className="bg-purple-500 text-white rounded-full px-2 py-0.5">👑 {d.host}</span>} {!p.connected && <span className="text-red-500">• {d.offline}</span>}</div>
          {(p.wins ?? 0) > 0 && <div className="text-xs mt-1 font-extrabold text-amber-600">🏆 ×{p.wins}</div>}
          {onKick && p.id !== myId && (
            <div className="mt-1">
              <span role="button" title={d.kick}
                onClick={(e) => { e.stopPropagation(); onKick(p.id); }}
                className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 cursor-pointer hover:bg-red-200">✖ {d.kick}</span>
            </div>)}
          {(phase === 'results') && <div className="text-sm mt-1 flex items-center justify-center gap-2">{roleLabel(p.role, p.isFollower)}<DiceFace value={p.dice ?? 1} size={26} /></div>}
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
function ChatSheet({ open, onClose, chat, myId, d, onChat }: { open: boolean; onClose: () => void; chat: any[]; myId?: string; d: any; onChat: (t: string) => void }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl mx-auto h-[62%] bg-gradient-to-b from-amber-50 to-orange-50 rounded-t-3xl p-3 flex flex-col anim-slide-up shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <span className="font-extrabold text-lg">💬 {d.chatTitle ?? 'Chat'}</span>
          <button className="bg-white rounded-full w-9 h-9 shadow font-extrabold" onClick={onClose}>✕</button>
        </div>
        <ChatPanel chat={chat} myId={myId} d={d} height="flex" onChat={onChat} />
      </div>
    </div>
  );
}

// The cheese flies from the table to the thief's avatar the moment the
// steal happens — everyone awake at that hour sees it.
function FlyCheese({ x0, y0, dx, dy, onDone }: { x0: number; y0: number; dx: number; dy: number; onDone: () => void }) {
  const [moved, setMoved] = useState(false);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMoved(true)));
    const t = setTimeout(() => doneRef.current(), 1250);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, []);
  return (
    <div className="pointer-events-none absolute z-40 text-4xl" style={{
      left: x0, top: y0,
      transform: moved ? `translate(${dx}px, ${dy}px) scale(0.55) rotate(24deg)` : 'translate(0px, 0px) scale(1)',
      transition: 'transform 0.95s cubic-bezier(0.3, 0.7, 0.4, 1)',
      filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))',
    }}>🧀</div>
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
            if (!isHost) sessionStorage.setItem('ct_guest_session', JSON.stringify({ code: c, name: sessionStorage.getItem('ct_name') || '' }));
            else sessionStorage.removeItem('ct_guest_session');
          } catch { /* ignore */ }
          // Keep any transport overrides (?broker= / ?server= / ?net=) in the
          // URL — the net layer re-reads them on reconnect/rejoin.
          const u = new URL(location.href); u.searchParams.set('room', c);
          history.replaceState(null, '', u.pathname + u.search);
        },
        onError: (m) => {
          if (m === 'HOST_GONE') { try { sessionStorage.removeItem('ct_guest_session'); } catch { /* ignore */ } }
          if (m === 'KICKED') {
            try { sessionStorage.removeItem('ct_guest_session'); } catch { /* ignore */ }
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
      });
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
      const raw = sessionStorage.getItem('ct_guest_session');
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
  const flyKeyRef = useRef('');
  const [chatSheet, setChatSheet] = useState(false);
  const [connLost, setConnLost] = useState(false);
  // Voice chat (v26): off -> busy (mic prompt + mesh join) -> on; the mic
  // button then toggles mute, ✕ leaves the mesh. Speaking ids drive the
  // 🎙️ badges on player cards.
  const [voiceState, setVoiceState] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const voiceRef = useRef<VoiceHandle | null>(null);
  const leaveVoice = () => {
    try { voiceRef.current?.leave(); } catch { /* noop */ }
    voiceRef.current = null;
    setVoiceState('off'); setVoiceMuted(false); setSpeakingIds(new Set());
  };
  const toggleVoice = async () => {
    if (voiceState === 'busy') return;
    if (voiceState === 'on') {
      const m = !voiceMuted;
      setVoiceMuted(m);
      voiceRef.current?.setMuted(m);
      return;
    }
    if (!joined) return;
    setVoiceState('busy');
    try {
      voiceRef.current = await joinVoice(joined.code, joined.playerId, {
        onSpeaking: (ids) => setSpeakingIds(prev => (prev.size === ids.size && [...ids].every(x => prev.has(x)) ? prev : ids)),
        onPeers: () => { /* presence is implicit in the speaking badges */ },
      });
      setVoiceMuted(false);
      setVoiceState('on');
    } catch {
      setVoiceState('off');
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
  useEffect(() => { setChatSheet(false); setOptVote(null); setOptReadyVote(false); setOptReady(false); setOptPeek(false); }, [phase]);
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
    setFly({ key, x0: f.left - b.left + f.width / 2 - 18, y0: f.top - b.top + f.height / 2 - 18, dx: (t.left + t.width / 2) - (f.left + f.width / 2), dy: (t.top + t.height / 2) - (f.top + f.height / 2) });
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
      return <span key={role} className="bg-white rounded-full px-3 py-1 font-bold shadow">{emoji} {label} {r.w}/{r.g}</span>;
    };
    return (
      <div className="max-w-md mx-auto bg-teal-50 rounded-2xl p-3 mt-3">
        <div className="font-extrabold text-center">{d.recordTitle}</div>
        <div className="text-center font-bold text-teal-700">{d.recordLine(myRecord.w, myRecord.l)}</div>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
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
      <div className="max-w-sm mx-auto bg-amber-50 rounded-2xl p-3 mt-3 text-left">
        <div className="font-extrabold text-center mb-1">{d.standings}</div>
        {scored.map(p => (
          <div key={p.id} className="flex justify-between font-bold">
            <span>{mouseFor(p.id)} {p.name} {((p as any).wins === top) && '👑'}</span>
            <span>🏆 ×{(p as any).wins}</span>
          </div>))}
      </div>
    );
  };

  /* ---------- LANDING ---------- */
  if (!joined) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-300 via-orange-200 to-yellow-100 p-4">
        <div className="max-w-xl mx-auto pt-6">
          <TopBar d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} />
          <div className={`${card} text-center anim-pop overflow-hidden`}>
            <div className="relative -mx-5 -mt-5 sm:-mx-7 sm:-mt-7 mb-4 py-6 bg-gradient-to-b from-indigo-950 via-purple-900 to-indigo-800">
              <div className="stars" style={{ position: 'absolute' }} />
              <div className="text-8xl anim-floaty inline-block drop-shadow-[0_10px_16px_rgba(0,0,0,0.45)]">🧀</div>
              <div className="flex justify-center gap-3 text-4xl mt-1">
                <span className="anim-bob">🐭</span><span className="anim-bob" style={{ animationDelay: '.3s' }}>🐹</span>
                <span className="anim-bob" style={{ animationDelay: '.6s' }}>😈</span>
                <span className="anim-bob" style={{ animationDelay: '.9s' }}>🐭</span>
              </div>
              <div className="wood-table mx-10 h-3 mt-2 opacity-90" />
            </div>
            <h1 className="text-4xl font-extrabold bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 bg-clip-text text-transparent">{d.title}</h1>
            <p className="text-gray-600 mt-1">{d.subtitle}</p>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              <span className="bg-amber-100 text-amber-800 font-bold rounded-full px-3 py-1 text-sm">👥 4–8 players</span>
              <span className="bg-sky-100 text-sky-800 font-bold rounded-full px-3 py-1 text-sm">⏱️ 5–15 min</span>
              <span className="bg-green-100 text-green-800 font-bold rounded-full px-3 py-1 text-sm">📱 No install</span>
              <span className="bg-purple-100 text-purple-800 font-bold rounded-full px-3 py-1 text-sm">🌐 EN / VI</span>
            </div>
            <input className="w-full border-2 border-amber-300 rounded-2xl px-4 py-3 mt-3 text-lg" placeholder={d.name}
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            <button className={`${btn} bg-amber-400 hover:bg-amber-500 w-full mt-3 text-xl`}
              disabled={!name.trim()} onClick={() => { setError(''); getNet().createRoom(name); }}>{d.create} 🏠</button>
            <div className="flex gap-2 mt-3">
              <input className="flex-1 border-2 border-amber-300 rounded-2xl px-4 py-3 uppercase text-lg" placeholder={d.codePh}
                value={code} maxLength={5} onChange={e => setCode(e.target.value.toUpperCase())} />
              <button className={`${btn} bg-sky-400 hover:bg-sky-500 text-white`} disabled={!name.trim() || code.trim().length < 4}
                onClick={() => { setError(''); getNet().joinRoom(code, name); }}>{d.join}</button>
            </div>
            <button className="mt-4 underline font-bold text-amber-700" onClick={() => setShowHelp(true)}>📖 {d.how} (1 min)</button>
            {status && <p className="mt-3 text-sky-700 font-bold">{localizeMsg(status)}</p>}
            {error && <p className="mt-3 text-red-600 font-bold">{localizeMsg(error)}</p>}
          </div>
          <p className="text-center text-amber-800/70 mt-4 text-sm">4–8 players · ~5–15 min · free, no install 🎉</p>
        </div>
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
      </div>
    );
  }

  if (!pub) return <div className="min-h-screen bg-indigo-950 text-white flex items-center justify-center text-2xl">⏳ {status ? localizeMsg(status) : d.connecting}</div>;

  const bg = phase === 'night' || phase === 'roleReveal' || phase === 'recruit'
    ? 'bg-gradient-to-b from-indigo-950 via-purple-950 to-slate-900'
    : 'bg-gradient-to-b from-amber-300 via-orange-200 to-yellow-100';
  const nameOf = (id?: string | null) => pub?.players.find(p => p.id === id)?.name || '?';
  const roleLabel = (role?: string | null, isFollower?: boolean) =>
    (role === 'thief' ? '😈 ' + d.thief : role === 'fallmouse' ? '💀 ' + d.fall : '🐭 ' + d.sleepy) + (isFollower ? ' 🤝' : '');

  return (
    <div className={`h-dvh ${bg} p-3 sm:p-4 transition-colors duration-1000 flex flex-col overflow-hidden relative`}>
      <div className="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <TopBar d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })}  voice={{ state: voiceState, muted: voiceMuted, onToggle: toggleVoice, onLeave: leaveVoice }}/>
        {connLost && joined && <div className="bg-red-500 text-white text-center font-bold text-sm rounded-full px-4 py-1 mb-2 anim-pulse-soft shadow">📡 {d.connLost}</div>}
        {error && <div className="bg-red-100 border border-red-400 text-red-700 rounded-2xl px-4 py-2 mb-3 font-bold">{localizeMsg(error)}
          <button className="float-right" onClick={() => setError('')}>✕</button></div>}

        {/* Persistent secret info — your role & dice stay visible all game */}
        {priv?.role && (phase === 'night' || phase === 'recruit' || phase === 'day' || phase === 'voting') && (
          <div className="bg-black/70 text-white rounded-2xl px-4 py-1.5 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-bold backdrop-blur">
            <span>🤫 {d.yourInfo}:</span>
            <span>{roleLabel(priv.role, priv.isFollower)}</span>
            <span className="inline-flex items-center gap-1.5"><DiceFace value={priv.dice ?? 1} size={22} /><span>🎲 {priv.dice ?? '?'} · ⏰ {priv.dice ? d.wakeAt(priv.dice) : ''}</span></span>
            {phase === 'night' && <span>{priv.awake ? '👀 ' + d.youAwake : '💤 ' + d.sleeping}</span>}
            {priv.knownThiefId && <span className="text-red-300">{d.knowsThief(nameOf(priv.knownThiefId))}</span>}
            {priv.witnessedThiefId && <span className="text-red-300">{d.sawThief(nameOf(priv.witnessedThiefId))}</span>}
            {priv.role === 'thief' && priv.knownFollowerIds.length > 0 && <span className="text-emerald-300">{d.yourFollowers(priv.knownFollowerIds.map(nameOf).join(', '))}</span>}
            {priv.isFollower && priv.knownFollowerIds.length > 0 && <span className="text-emerald-300">{d.knowsFollower(priv.knownFollowerIds.map(nameOf).join(', '))}</span>}
          </div>
        )}

        {/* ---------- LOBBY ---------- */}
        {phase === 'lobby' && (
          <div className={`${card} anim-pop flex flex-col flex-1 min-h-0`}>
            <h2 className="text-2xl font-extrabold">🏠 {d.lobby} · {d.round} {pub.round}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-3xl font-extrabold tracking-widest bg-amber-100 rounded-2xl px-4 py-1">{pub.roomCode}</span>
              <button className={`${btn} bg-sky-400 text-white !py-2`} onClick={() => {
                navigator.clipboard?.writeText(location.origin + location.pathname + '?room=' + pub.roomCode);
                setCopied(true); setTimeout(() => setCopied(false), 1500);
              }}>{copied ? '✅ ' + d.copied : '🔗 ' + d.copyLink}</button>
              <span className="font-bold">{d.players}: {pub.players.length}/8</span>
            </div>
            <PlayerChips players={pub.players} myId={joined.playerId} phase={phase} d={d} roleLabel={roleLabel} onKick={isHost ? (id) => getNet().kick(id) : undefined} speakingIds={speakingIds} />
            <div className="flex items-center justify-center gap-2 mt-1 flex-wrap">
              <span className="font-bold text-gray-500">💬 {d.discussionTime}:</span>
              {isHost
                ? [60000, 120000, 180000].map(ms => (
                  <button key={ms} onClick={() => getNet().setDiscussion(ms)}
                    className={`rounded-full px-3 py-1 font-extrabold ${((pub as any).discussionMs ?? 120000) === ms ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500'}`}>
                    {ms / 60000}:00
                  </button>))
                : <span className="font-extrabold">{((pub as any).discussionMs ?? 120000) / 60000}:00</span>}
            </div>
            <Standings />
            <MyRecord />
            {isHost ? (
              <>
                <button className={`${btn} bg-green-500 hover:bg-green-600 text-white w-full text-xl`}
                  disabled={pub.players.filter(p => p.connected).length < 4}
                  onClick={() => getNet().startGame()}>▶️ {d.start}</button>
                {pub.players.length < 4 && <p className="text-center text-red-500 font-bold mt-2">{d.need4}</p>}
              </>
            ) : <p className="text-center font-bold text-gray-500">{d.waiting}</p>}
            <div className="mt-3 flex flex-col flex-1 min-h-0"><ChatPanel chat={pub.chat} myId={joined.playerId} d={d} height="flex" onChat={t => getNet().chat(t)} /></div>
            <button className="mt-4 underline text-gray-500" onClick={() => { try { sessionStorage.removeItem('ct_guest_session'); } catch { /* ignore */ } getNet().leave(); location.href = location.pathname; }}>{d.leave}</button>
          </div>
        )}

        {/* ---------- ROLE REVEAL ---------- */}
        {phase === 'roleReveal' && priv && (
          <div className={`${card} text-center anim-pop my-auto w-full`}>
            <h2 className="text-xl font-bold text-gray-500">{d.yourRole} 🤫</h2>
            <div className="text-8xl my-3">{priv.role === 'thief' ? '😈' : priv.role === 'fallmouse' ? '💀' : '🐭'}</div>
            <div className={`text-3xl font-extrabold ${priv.role === 'thief' ? 'text-red-500' : priv.role === 'fallmouse' ? 'text-violet-600' : 'text-sky-600'}`}>
              {priv.role === 'thief' ? d.thief : priv.role === 'fallmouse' ? d.fall : d.sleepy}</div>
            <p className="mt-2 text-gray-600">{priv.role === 'thief' ? d.thiefDesc : priv.role === 'fallmouse' ? d.fallDesc : d.sleepyDesc}</p>
            <div className={`mt-4 inline-block rounded-3xl px-8 py-4 ${priv.role === 'thief' ? 'bg-red-50 ring-2 ring-red-200' : priv.role === 'fallmouse' ? 'bg-violet-50 ring-2 ring-violet-300' : 'bg-indigo-50 ring-2 ring-indigo-200'}`}>
              <div className="text-sm font-bold text-gray-500 mb-2">{d.yourDice}</div>
              <div className="flex justify-center"><DiceFace value={priv.dice ?? 1} size={104} /></div>
              <div className="text-2xl font-extrabold mt-2">{priv.dice}</div>
            </div>
            <div>
              {pub.revealReady?.includes(joined.playerId) || optReady
                ? <p className="mt-5 font-extrabold text-green-600">✅ {d.readyOf(pub.revealReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
                : <button className={`${btn} bg-green-500 hover:bg-green-600 text-white mt-5 text-lg`} onClick={() => { setOptReady(true); getNet().ready(); }}>{d.imReady}</button>}
              <p className="mt-2 font-bold text-gray-400">{d.readyOf(pub.revealReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
              {isHost && <button className="mt-2 underline text-indigo-500 font-bold" onClick={() => getNet().beginNight()}>🌙 {d.forceNight}</button>}
            </div>
          </div>
        )}

        {/* ---------- NIGHT ---------- */}
        {phase === 'night' && priv && (
          <div ref={nightBoxRef} className="text-center relative flex-1 min-h-0 flex flex-col">
            <div className="stars" /><div className="stars2" />
            {fly && <FlyCheese key={fly.key} x0={fly.x0} y0={fly.y0} dx={fly.dx} dy={fly.dy} onDone={() => setFly(null)} />}
            <h2 className="text-2xl font-extrabold text-indigo-200">🌙 {d.night} — {d.hour} {pub.currentHour}/6
              <span className="ml-3 text-lg bg-white/10 rounded-full px-3 py-0.5">⏱ {secsLeft(pub.hourEndsAt, now)}s</span></h2>
            <div className="flex justify-center gap-1 my-2">
              {[1, 2, 3, 4, 5, 6].map(h => <div key={h} className={`w-8 h-8 rounded-full flex items-center justify-center font-extrabold ${h === pub.currentHour ? 'bg-amber-400 text-black scale-110' : h < pub.currentHour ? 'bg-indigo-700 text-white' : 'bg-white/10 text-indigo-200'}`}>{h}</div>)}
            </div>
            {/* Thin progress bar for the current 12s hour */}
            <div className="max-w-md mx-auto h-2 bg-white/15 rounded-full overflow-hidden relative z-10" aria-label="hour progress">
              <div className="h-full bg-amber-400 rounded-full transition-[width] duration-300" style={{ width: `${pub.hourEndsAt ? Math.max(0, Math.min(100, ((pub.hourEndsAt - now) / HOUR_MS) * 100)) : 0}%` }} />
            </div>
            {/* Table indicator must reflect what THIS player can actually see:
                wakers see the real table (cheese present or gone); sleepers
                have their eyes closed and must NOT be told the cheese is
                "on the table" when it may already be stolen. */}
            <div className="wood-table w-full max-w-sm mx-auto px-4 pt-3 pb-2 my-2 relative z-10">
              <div id="table-cheese" className="text-5xl leading-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.4)]">
                {priv.awake
                  ? (priv.cheesePresentWhenAwake === false ? '🍽️' : <span className="anim-wiggle inline-block">🧀</span>)
                  : <span className="opacity-40">🧀</span>}
              </div>
              <div className="text-base font-bold text-amber-100 drop-shadow mt-1">
                {priv.awake
                  ? (priv.cheesePresentWhenAwake === false
                      ? <span className="text-red-300">💨 {d.tableGone}</span>
                      : <span className="text-amber-100">✨ {d.onTheTable}</span>)
                  : <span className="opacity-70">💤 {d.eyesClosed}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2">
              {pub.players.map(p => {
                const isMe = p.id === joined.playerId;
                const awakeNow = isMe ? !!priv.awake : priv.fellowWakers.includes(p.id);
                return (
                <div key={p.id} id={`pcard-${p.id}`} className={`rounded-2xl p-2 relative z-10 ${isMe && priv.awake ? 'bg-amber-300 text-black ring-4 ring-amber-100 awake-glow' : awakeNow ? 'bg-sky-300 text-black ring-4 ring-sky-100 awake-glow' : 'bg-white/10 text-indigo-100'}`}>
                  <div className={`text-3xl relative inline-block w-11 h-11 rounded-full ${avatarBg(p.id)} items-center justify-center inline-flex`}>{mouseFor(p.id)}
                    {awakeNow
                      ? <span className="absolute -top-2 -right-3 text-lg">👀</span>
                      : <span className="zzz absolute -top-2 -right-3 text-lg text-sky-300 font-bold">z</span>}
                  </div>
                  <div className="font-bold truncate text-sm">{p.name}</div>
                  {priv.stealById === p.id && <span className="absolute -top-2 -left-2 text-2xl anim-pop">🧀</span>}
                  {(priv.knownThiefId === p.id || priv.witnessedThiefId === p.id) && <span className="absolute -bottom-2 -right-2 text-2xl anim-pop">😈</span>}
                  {priv.peeks?.some(x => x.targetId === p.id) && <span className="absolute -top-2 -right-2 bg-sky-500 text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow z-20">🎲{priv.peeks.find(x => x.targetId === p.id)!.dice}</span>}
                  {speakingIds.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow z-20 anim-pulse-soft">🎙️</span>}
                </div>);
              })}
            </div>
            <button className="absolute bottom-2 right-2 z-40 bg-white/15 hover:bg-white/25 text-white rounded-full px-4 py-2 font-extrabold backdrop-blur shadow-lg"
              onClick={() => setChatSheet(true)}>💬 Chat{!chatSheet && (pub.chat.length > chatSeen) && <span className="ml-1 inline-block w-2.5 h-2.5 bg-red-400 rounded-full align-middle" />}</button>
            {priv.awake ? (
              <div className={`${card} anim-pop max-w-xl mx-auto w-full mt-auto`}>
                <div className="text-xl font-extrabold">👀 {d.youAwake}</div>
                {priv.cheesePresentWhenAwake === false && <p className="font-bold text-red-500 mt-1">{d.cheeseGoneWake}</p>}
                {priv.cheesePresentWhenAwake === true && <p className="text-gray-500 mt-1">{d.cheeseHere}</p>}
                {priv.fellowWakers.length > 0 && <p className="mt-1 font-bold text-purple-600">👀👀 {d.fellow} ({priv.fellowWakers.map(id => pub.players.find(p => p.id === id)?.name).join(', ')})</p>}
                {priv.role === 'thief' && priv.hasActedThisHour && <p className="mt-3 font-bold text-green-600">{d.stolenOk}</p>}
                {priv.followerCandidates && (
                  <div className="mt-3">
                    <div className="font-bold mb-2 text-purple-700">{d.chooseWitnessTitle}</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {priv.followerCandidates.map(id => (
                        <button key={id} className={`${btn} bg-purple-500 text-white !py-2`} onClick={() => getNet().nightAction('chooseFollower', id)}>🤝 {mouseFor(id)} {nameOf(id)}</button>))}
                    </div>
                  </div>)}
                {priv.isFollower && (
                  <p className="mt-3 bg-emerald-50 ring-2 ring-emerald-300 rounded-2xl px-4 py-2 font-extrabold text-emerald-700">🤝 {d.becameFollower}</p>)}
                {!priv.isFollower && priv.role !== 'thief' && priv.knownFollowerIds.length > 0 && (
                  <p className="mt-3 font-bold text-purple-600">{d.witnessKnows(priv.knownFollowerIds.map(nameOf).join(', '))}</p>)}
                {priv.canInspect && !optPeek && (
                  <div className="mt-3">
                    <div className="font-bold mb-2">{d.inspectTitle}</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {pub.players.filter(p => p.id !== joined.playerId).map(p => (
                        <button key={p.id} className={`${btn} bg-sky-400 text-white !py-2`} onClick={() => { setOptPeek(true); getNet().nightAction('inspect', p.id); }}>{mouseFor(p.id)} {p.name}</button>))}
                    </div>
                  </div>)}
                {priv.canInspect && optPeek && !priv.inspected && (
                  <p className="mt-3 font-extrabold text-sky-700 text-lg">{d.looking}</p>)}
                {priv.inspected && <p className="mt-3 font-extrabold text-sky-700 text-lg">🔎 {d.inspected(pub.players.find(p => p.id === priv.inspected!.targetId)?.name || '?', priv.inspected.dice)}</p>}
              </div>
            ) : (
              <p className="text-indigo-200 font-bold text-lg mt-auto pb-2">{d.sleeping}</p>
            )}
          </div>
        )}

        {/* ---------- RECRUIT (after hour 6, 6–8 players) ---------- */}
        {phase === 'recruit' && priv && (
          <div className="text-center relative my-auto w-full">
            <div className="stars" /><div className="stars2" />
            <h2 className="text-3xl font-extrabold text-indigo-200 relative z-10">🌙✨ {d.night} — 🤝
              <span className="ml-3 text-xl bg-white/10 rounded-full px-3 py-1">⏱ {secsLeft(pub.recruitEndsAt, now)}s</span></h2>
            {priv.role === 'thief' && priv.followerCandidates ? (
              <div className={`${card} anim-pop max-w-xl mx-auto mt-4 relative z-10`}>
                <div className="text-2xl font-extrabold">😈 {d.recruitTitle}</div>
                <p className="font-bold text-gray-500 mt-1">{d.recruitHint(priv.followersNeeded, priv.followersChosen)}</p>
                <div className="flex flex-wrap gap-2 justify-center mt-3">
                  {priv.followerCandidates.map(id => (
                    <button key={id} className={`${btn} bg-purple-500 hover:bg-purple-600 text-white`} onClick={() => getNet().nightAction('chooseFollower', id)}>🤝 {mouseFor(id)} {nameOf(id)}</button>))}
                </div>
              </div>
            ) : priv.isFollower ? (
              <div className={`${card} anim-pop max-w-xl mx-auto mt-4 relative z-10`}>
                <p className="font-extrabold text-emerald-600 text-xl">{d.becameFollower}</p>
                {priv.knownThiefId
                  ? <p className="font-bold text-red-500 mt-1">{d.knowsThief(nameOf(priv.knownThiefId))}</p>
                  : <p className="font-bold text-gray-500 mt-1">{d.followerBlind}</p>}
                {priv.knownFollowerIds.length > 0 && <p className="font-bold text-emerald-600 mt-1">{d.knowsFollower(priv.knownFollowerIds.map(nameOf).join(', '))}</p>}
              </div>
            ) : (
              <p className="text-indigo-200 font-bold text-xl mt-6 relative z-10">{d.recruitWaiting}</p>
            )}
            <button className="relative z-10 mt-4 bg-white/15 hover:bg-white/25 text-white rounded-full px-4 py-2 font-extrabold backdrop-blur shadow-lg"
              onClick={() => setChatSheet(true)}>💬 Chat{!chatSheet && (pub.chat.length > chatSeen) && <span className="ml-1 inline-block w-2.5 h-2.5 bg-red-400 rounded-full align-middle" />}</button>
          </div>
        )}

        {/* ---------- DAY ---------- */}
        {phase === 'day' && (
          <div className={`${card} anim-pop flex flex-col flex-1 min-h-0`}>
            <h2 className="text-2xl font-extrabold text-center">{d.day}</h2>
            <p className="text-center font-bold text-gray-600">{d.discuss} <span className="bg-amber-100 rounded-full px-3 py-0.5">⏱ {secsLeft(pub.discussionEndsAt, now)}s</span></p>
            {priv?.isFollower && (
              <p className="bg-emerald-50 ring-2 ring-emerald-300 rounded-2xl px-4 py-2 mt-3 text-center font-extrabold text-emerald-700 anim-pop">🤝 {d.becameFollower}</p>)}
            {priv?.witnessedThiefId && (
              <p className="text-center font-extrabold text-red-500 mt-3">{d.sawThief(nameOf(priv.witnessedThiefId))}</p>)}
            <PlayerChips players={pub.players} myId={joined.playerId} phase={phase} d={d} roleLabel={roleLabel} markThiefId={priv?.knownThiefId || priv?.witnessedThiefId || null} markFollowerIds={priv?.knownFollowerIds} iAmFollower={priv?.isFollower} peeks={priv?.peeks} speakingIds={speakingIds} />
            <ChatPanel chat={pub.chat} myId={joined.playerId} d={d} height="flex" onChat={t => getNet().chat(t)} />
            <div className="mt-3 text-center">
              {pub.dayReady?.includes(joined.playerId) || optReadyVote
                ? <p className="font-extrabold text-green-600">{d.readyVoteDone}</p>
                : <button className={`${btn} bg-green-500 hover:bg-green-600 text-white`} onClick={() => { setOptReadyVote(true); getNet().readyVote(); }}>{d.readyVoteBtn}</button>}
              <p className="font-bold text-gray-500 mt-1">{d.readyVoteOf(pub.dayReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
            </div>
            {isHost && <button className={`${btn} bg-purple-500 text-white w-full mt-3`} onClick={() => getNet().toVoting()}>🗳️ {d.toVote}</button>}
          </div>
        )}

        {/* ---------- VOTING ---------- */}
        {phase === 'voting' && (
          <div className={`${card} anim-pop text-center flex flex-col flex-1 min-h-0`}>
            <h2 className="text-3xl font-extrabold">🗳️ {d.voting} <span className="text-xl bg-amber-100 rounded-full px-3 py-1">⏱ {secsLeft(pub.voteEndsAt, now)}s</span></h2>
            <p className="text-gray-500 font-bold">{d.voteHint}</p>
            <p className="font-bold mt-1">{pub.players.filter(p => p.hasVoted).length}/{pub.players.length} voted</p>
            {priv?.myVote || optVote
              ? <p className="mt-4 font-extrabold text-green-600 text-lg">{d.votedFor(pub.players.find(p => p.id === (priv?.myVote || optVote))?.name || '?')}</p>
              : <PlayerChips players={pub.players} myId={joined.playerId} phase={phase} d={d} roleLabel={roleLabel} markThiefId={priv?.knownThiefId || priv?.witnessedThiefId || null} markFollowerIds={priv?.knownFollowerIds} iAmFollower={priv?.isFollower} peeks={priv?.peeks} speakingIds={speakingIds} onPick={(id) => { setOptVote(id); getNet().vote(id); }} pickable={(p) => p.id !== joined.playerId} />}
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {phase === 'results' && (
          <div className={`${card} anim-pop text-center flex-1 min-h-0 overflow-y-auto`}>
            <Confetti />
            <div className="text-7xl anim-bob inline-block">{pub.winner === 'sleepyheads' ? '🎉' : pub.winner === 'fallmouse' ? '💀' : '😈'}</div>
            <h2 className="text-3xl font-extrabold">{pub.winner === 'sleepyheads' ? d.sleepyWin : pub.winner === 'fallmouse' ? d.fallWin : d.thiefWin}</h2>
            <p className="font-bold text-lg mt-1">{d.thiefWas(pub.players.find(p => p.id === pub.thiefId)?.name || '?')} {mouseFor(pub.thiefId || '')}</p>
            {pub.players.some(p => (p as any).role === 'fallmouse') && (
              <p className="font-bold text-lg text-violet-600">{d.fallWas(pub.players.find(p => (p as any).role === 'fallmouse')?.name || '?')} {mouseFor(pub.players.find(p => (p as any).role === 'fallmouse')?.id || '')}</p>)}
            <PlayerChips players={pub.players} myId={joined.playerId} phase={phase} d={d} roleLabel={roleLabel} speakingIds={speakingIds} />
            <div className="text-left max-w-sm mx-auto bg-amber-50 rounded-2xl p-3">
              {pub.voteCounts?.map(v => (
                <div key={v.id} className="flex justify-between font-bold">
                  <span>{mouseFor(v.id)} {pub.players.find(p => p.id === v.id)?.name}</span><span>{v.count} {d.votes}</span>
                </div>))}
            </div>
            <Standings />
            <MyRecord />
            <button className={`${btn} bg-sky-500 hover:bg-sky-600 text-white mt-3`} onClick={shareResult}>
              {shared ? '✅ ' + d.shareCopied : '📋 ' + d.shareResults}
            </button>
            {(pub as any).recap?.length > 0 && (
              <div className="text-left max-w-md mx-auto bg-indigo-50 rounded-2xl p-3 mt-3">
                <div className="font-extrabold text-center mb-1">{d.recapTitle}</div>
                {[1, 2, 3, 4, 5, 6].map(h => {
                  const evs = (pub as any).recap.filter((e: any) => e.hour === h && !e.afterNight);
                  if (!evs.length) return null;
                  const wake = evs.find((e: any) => e.kind === 'wake');
                  return (
                    <div key={h} className="mt-1">
                      <span className="font-extrabold">🕐 {d.recapHour(h)}: </span>
                      {wake && wake.ids.length
                        ? <span>{d.recapWake(wake.ids.map(nameOf).join(', '))}</span>
                        : <span className="text-gray-500">{d.recapNone}</span>}
                      {evs.filter((e: any) => e.kind !== 'wake').map((e: any, i: number) => (
                        <div key={i} className="ml-4">
                          {e.kind === 'steal' && d.recapSteal(nameOf(e.ids[0]))}
                          {e.kind === 'witness' && d.recapWitness(e.ids.map(nameOf).join(', '))}
                          {e.kind === 'inspect' && d.recapInspect(nameOf(e.ids[0]), nameOf(e.targetId), e.seen)}
                          {e.kind === 'recruit' && d.recapRecruit(nameOf(e.ids[0]))}
                        </div>))}
                    </div>);
                })}
                {(pub as any).recap.some((e: any) => e.afterNight) && (
                  <div className="mt-1">
                    <span className="font-extrabold">🌅 {d.recapAfter}: </span>
                    {(pub as any).recap.filter((e: any) => e.afterNight).map((e: any, i: number) => (
                      <div key={i} className="ml-4">{d.recapRecruit(nameOf(e.ids[0]))}</div>))}
                  </div>)}
              </div>)}
            <div className="mt-3"><ChatPanel chat={pub.chat} myId={joined.playerId} d={d} onChat={t => getNet().chat(t)} height="h-40" /></div>
            {isHost
              ? <button className={`${btn} bg-green-500 text-white w-full mt-4 text-xl`} onClick={() => getNet().playAgain()}>🔁 {d.playAgain} ({d.backLobby})</button>
              : <p className="mt-4 font-bold text-gray-500">{d.waiting}</p>}
          </div>
        )}
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub.chat} myId={joined.playerId} d={d} onChat={t => getNet().chat(t)} />
      </div>
      {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
