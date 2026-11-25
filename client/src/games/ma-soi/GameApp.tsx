import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview } from '../../platform/ui';
import { roleTable, MIN_PLAYERS } from '../../../../games/ma-soi/logic';
import type { Role } from '../../../../games/ma-soi/logic';

const SESSION_KEY = 'ct_guest_session:ma-soi';
const WOLF_REACTIONS = ['👀', '🐺', '😱', '🤔', '👍', '👎', '😂', '❓'];

const AVATAR_BG = ['bg-rose-100', 'bg-sky-100', 'bg-lime-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-pink-100', 'bg-indigo-100'];
const avatarBg = (id: string) => AVATAR_BG[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];
const FACE_COLORS: [string, string][] = [
  ['#F8CD9E', '#EDA45F'], ['#ACCDF6', '#7FA8E6'], ['#DEC4F4', '#BB94E4'], ['#B4E0C2', '#85C79B'],
  ['#F6AC8D', '#E67F57'], ['#F8E08C', '#E9C04C'], ['#F7BDD6', '#EA93B8'], ['#C9CED8', '#9AA3B2'],
];
const faceFor = (id: string) => FACE_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % FACE_COLORS.length];

/** Flat SVG face in the platform's style. Wolf = pointed ears + grey fur +
 *  fangs; dead = X eyes; asleep = closed eyes. */
export function WolfAvatar({ seed, size = 48, state = 'villager', halo }: { seed: string; size?: number; state?: 'villager' | 'wolf' | 'dead' | 'asleep'; halo?: string }) {
  const [skin, shade] = state === 'wolf' ? ['#8A8F9C', '#6B7080'] : faceFor(seed);
  const dead = state === 'dead';
  const asleep = state === 'asleep';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      {halo && <circle cx="50" cy="50" r="47" fill={halo} />}
      {state === 'wolf' ? (
        <>
          <path d="M22 34 L14 8 L40 22 Z" fill={shade} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
          <path d="M78 34 L86 8 L60 22 Z" fill={shade} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="24" cy="30" r="11" fill={skin} stroke="#2B2016" strokeWidth="3" />
          <circle cx="76" cy="30" r="11" fill={skin} stroke="#2B2016" strokeWidth="3" />
        </>
      )}
      <circle cx="50" cy="54" r="34" fill={skin} stroke="#2B2016" strokeWidth="3.5" />
      <ellipse cx="50" cy="72" rx="13" ry="9" fill={shade} opacity="0.55" />
      <circle cx="50" cy="68" r="4.5" fill="#2B2016" />
      {dead ? (
        <>
          <path d="M32 44 L44 56 M44 44 L32 56" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" />
          <path d="M56 44 L68 56 M68 44 L56 56" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" />
          <path d="M40 82 Q50 76 60 82" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : asleep ? (
        <>
          <path d="M32 50 Q38 54 44 50" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M56 50 Q62 54 68 50" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M42 82 Q50 86 58 82" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="38" cy="50" r={state === 'wolf' ? 4.5 : 4} fill={state === 'wolf' ? '#D63A2F' : '#2B2016'} />
          <circle cx="62" cy="50" r={state === 'wolf' ? 4.5 : 4} fill={state === 'wolf' ? '#D63A2F' : '#2B2016'} />
          {state === 'wolf' ? (
            <path d="M40 78 L46 88 L52 78 L58 88 L64 78" stroke="#FFF3CF" strokeWidth="3" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <path d="M42 80 Q50 87 58 80" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          )}
        </>
      )}
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

const ROLE_EMOJI: Record<Role, string> = { wolf: '🐺', villager: '🧑', seer: '🔮', guardian: '🛡️', witch: '🧪', hunter: '🏹' };
const roleLabel = (d: any, role?: Role | null) => role ? d[role] : '';
const roleColor = (role?: Role | null) =>
  role === 'wolf' ? 'text-[#D63A2F]'
  : role === 'witch' ? 'text-[#7C4DBD]'
  : role === 'seer' ? 'text-[#2E7CD6]'
  : role === 'guardian' ? 'text-[#0E7C6B]'
  : role === 'hunter' ? 'text-[#B45309]'
  : 'text-[#5C4B33]';

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🐺 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

export default function MaSoiApp() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  const [name, setName] = useState(() => sessionStorage.getItem('ct_name') || '');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [pub, setPub] = useState<Pub | null>(null);
  const [priv, setPriv] = useState<Priv | null>(null);
  const [joined, setJoined] = useState<{ code: string; playerId: string; isHost: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [connLost, setConnLost] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('ct_muted') === '1');
  const [showHelp, setShowHelp] = useState(false);
  const [chatSheet, setChatSheet] = useState(false);
  const [myRecord, setMyRecord] = useState<{ w: number; l: number; roles: Record<string, { w: number; g: number }> }>({ w: 0, l: 0, roles: {} });
  const [shareCopied, setShareCopied] = useState(false);
  const recordedRounds = useRef<Set<string>>(new Set());
  const netRef = useRef<Net | null>(null);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const autoVoiceRef = useRef('');
  const voiceOptOutRef = useRef(false);
  // Pending intents (v29 pattern): a tap that the host never confirmed is
  // re-fired when the connection recovers, so a vote never silently dies.
  const pendingRef = useRef<Record<string, { kind: string; targetId?: string }>>({});
  const phase = pub?.phase ?? 'lobby';
  const now = useNow();
  const me = pub?.players.find(p => p.id === joined?.playerId);

  const toggleMuted = () => setMuted(m => { localStorage.setItem('ct_muted', m ? '0' : '1'); return !m; });
  useEffect(() => { if (!muted) ensureCtx(); }, [muted]);

  const getNet = () => {
    if (!netRef.current) {
      netRef.current = createNet({
        onState: (s) => { setPub(s); setStatus(''); setConnLost(false); },
        onPrivate: (p) => setPriv(p),
        onJoined: (c, pid, isHost) => {
          setJoined({ code: c, playerId: pid, isHost });
          if (!isHost) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: c, name: sessionStorage.getItem('ct_name') || '' }));
          else sessionStorage.removeItem(SESSION_KEY);
        },
        onError: (m) => {
          setStatus('');
          if (m === 'HOST_GONE') { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
          if (m === 'KICKED') { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
          const map: Record<string, string> = {
            ROOM_FULL: d.errRoomFull, GAME_STARTED: d.errGameStarted, ROOM_NOT_FOUND: d.errRoomNotFound,
            HOST_GONE: d.errHostGone, KICKED: d.kickedMsg, HOST_DISCONNECTED: d.errHostDisconnected,
            PEER_BLOCKED: d.errPeerBlocked, SERVER_UNREACHABLE: d.errServerUnreachable,
            GAME_NOT_SUPPORTED: d.errGameNotSupported,
          };
          if (m.startsWith('CONN_ERROR:')) setError(d.errConnError(m.slice('CONN_ERROR:'.length)));
          else if (m === 'NET_LOST') setConnLost(true);
          else if (m === 'NET_OK') setConnLost(false);
          else setError(map[m] || d.errFailed);
          if (m === 'HOST_GONE' || m === 'KICKED') { setJoined(null); setPub(null); setPriv(null); }
        },
        onStatus: (m) => {
          if (!m) { setStatus(''); return; }
          if (m === 'STATUS_CREATING') setStatus(d.statusCreating);
          else if (m.startsWith('STATUS_CONNECTING:')) setStatus(d.statusConnecting(m.slice('STATUS_CONNECTING:'.length)));
          else setStatus(m);
        },
        onPromoted: () => { setJoined(j => (j ? { ...j, isHost: true } : j)); },
      }, 'ma-soi');
    }
    return netRef.current;
  };

  // Auto-rejoin after a refresh: a stored GUEST session goes straight back
  // into its room. The key is per-game, so a Cheese Thief session never
  // auto-joins a Ma Sói room (and vice versa).
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (autoJoinTried.current) return;
    autoJoinTried.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s?.code) return;
      const urlRoom = new URLSearchParams(location.search).get('room');
      if (urlRoom && urlRoom.toUpperCase() !== String(s.code).toUpperCase()) return;
      getNet().joinRoom(String(s.code), String(s.name || ''));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Record the round in my personal session record (once per round).
  const prevPub = useRef<{ phase?: string; round?: number } | null>(null);
  useEffect(() => {
    if (!pub || !priv?.myRole || !joined) return;
    const key = pub.roomCode + ':' + pub.round;
    if (prevPub.current?.phase === 'voting' && pub.phase === 'results' && !recordedRounds.current.has(key)) {
      recordedRounds.current.add(key);
      const won = pub.winner === 'wolves' ? priv.myRole === 'wolf' : priv.myRole !== 'wolf';
      setMyRecord(r => {
        const roles = { ...r.roles };
        const e = roles[priv.myRole!] ?? { w: 0, g: 0 };
        roles[priv.myRole!] = { w: e.w + (won ? 1 : 0), g: e.g + 1 };
        return { w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1), roles };
      });
    }
    if (pub.phase === 'night' && prevPub.current?.phase !== 'night') sfx('night', muted);
    if (pub.phase === 'day' && prevPub.current?.phase !== 'day') sfx('morning', muted);
    if (pub.phase === 'results') sfx(pub.winner === 'wolves' ? (priv.myRole === 'wolf' ? 'win' : 'lose') : (priv.myRole === 'wolf' ? 'lose' : 'win'), muted);
    prevPub.current = { phase: pub.phase, round: pub.round };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub, priv?.myRole]);

  // Pending intents: re-fire unconfirmed ones when the connection recovers.
  useEffect(() => { setChatSheet(false); pendingRef.current = {}; }, [phase]);
  useEffect(() => {
    if (connLost || !joined) return;
    const pend = pendingRef.current;
    if (pend.vote && phase === 'voting' && !(pub as any)?.players?.find((p: any) => p.id === joined.playerId)?.hasVoted) getNet().vote(pend.vote.targetId!);
    if (pend.readyVote && phase === 'day' && !(pub as any).dayReady?.includes(joined.playerId)) getNet().readyVote();
    if (pend.ready && phase === 'roleReveal' && !(pub as any).revealReady?.includes(joined.playerId)) getNet().ready();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connLost]);

  // Host F5 guard: the room lives in the host's tab.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (joined?.isHost && pub && phase !== 'lobby' && phase !== 'results') { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [joined?.isHost, pub, phase]);

  /* ---------- voice (same rules as Cheese Thief: speaker auto-on when
   *  entering a room, mic stays off until the player taps it) ---------- */
  const startSpeaker = async (auto = false) => {
    if (!joined || voiceRef.current) return;
    setVoiceSpeaker('busy');
    try {
      voiceRef.current = await joinVoice(joined.code, joined.playerId, {
        onSpeaking: (ids) => setSpeakingIds(prev => (prev.size === ids.size && [...ids].every(x => prev.has(x)) ? prev : ids)),
        onPeers: () => { /* presence is implicit in the speaking badges */ },
      }, 'ma-soi');
      setVoiceSpeaker('on');
    } catch {
      setVoiceSpeaker('off');
      if (!auto) setError(d.errNetUnreachable);
    }
  };
  const toggleSpeaker = async () => {
    if (voiceSpeaker === 'on' && voiceRef.current) {
      voiceOptOutRef.current = true;
      try { voiceRef.current.leave(); } catch { /* noop */ }
      voiceRef.current = null; setVoiceSpeaker('off'); setVoiceMic('off'); return;
    }
    if (voiceSpeaker === 'off') { voiceOptOutRef.current = false; await startSpeaker(false); }
  };
  const toggleMic = async () => {
    const vh = voiceRef.current;
    if (!vh) return;
    if (voiceMic === 'on' || voiceMic === 'busy') {
      try { vh.setMuted(!voiceMuted); } catch { /* noop */ }
      setVoiceMuted(m => !m); return;
    }
    setVoiceMic('busy');
    try { await vh.enableMic(); setVoiceMic('on'); setVoiceMuted(false); }
    catch { setVoiceMic('off'); setError(d.errVoiceMic); }
  };
  const leaveVoice = () => {
    try { voiceRef.current?.leave(); } catch { /* noop */ }
    voiceRef.current = null; setVoiceSpeaker('off'); setVoiceMic('off');
  };
  useEffect(() => {
    if (!joined) { autoVoiceRef.current = ''; voiceOptOutRef.current = false; return; }
    const key = joined.code + ':' + joined.playerId;
    if (autoVoiceRef.current === key || voiceOptOutRef.current) return;
    autoVoiceRef.current = key;
    void startSpeaker(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  useEffect(() => { if (!joined) leaveVoice(); }, [joined]);

  const doNight = (kind: string, targetId?: string) => {
    pendingRef.current.night = { kind, targetId };
    getNet().nightAction(kind as any, targetId);
  };
  const doVote = (targetId: string) => {
    pendingRef.current.vote = { kind: 'vote', targetId };
    getNet().vote(targetId);
  };

  const voice = joined ? {
    speaker: voiceSpeaker, mic: voiceMic, muted: voiceMuted,
    onSpeaker: toggleSpeaker, onMic: toggleMic,
  } : undefined;
  const lastChat = pub?.chat?.length ? pub.chat[pub.chat.length - 1] : null;
  const onChat = (text: string) => getNet().chat(text);

  /* ---------- shared bits ---------- */
  const tone = phase === 'night' || phase === 'roleReveal' || phase === 'results' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const avatarState = (p: any): 'villager' | 'wolf' | 'dead' | 'asleep' => {
    if (!p.alive) return 'dead';
    if (phase === 'night') return 'asleep';
    if (phase === 'results') return p.role === 'wolf' ? 'wolf' : 'villager';
    if (p.id === joined?.playerId && priv?.myRole === 'wolf') return 'wolf';
    return 'villager';
  };
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';

  function PlayerGrid({ pickable, onPick, compact = false }: { pickable?: (p: any) => boolean; onPick?: (id: string) => void; compact?: boolean }) {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${compact ? 'gap-2 my-2' : 'gap-3 my-3'}`}>
        {(pub?.players ?? []).map(p => {
          const canPick = onPick && pickable ? pickable(p) : false;
          const dead = !p.alive;
          return (
            <button key={p.id} disabled={onPick ? !canPick : true}
              onClick={() => onPick?.(p.id)}
              className={`relative rounded-2xl text-[#2B2016] ${compact ? 'p-2' : 'p-2.5'} text-center shadow ${dead ? 'bg-gray-100 opacity-80' : p.id === joined?.playerId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${onPick ? 'hover:scale-105 transition cursor-pointer' : 'cursor-default'} disabled:opacity-60 disabled:hover:scale-100`}>
              {speakingIds.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
              <div className="mx-auto w-fit"><WolfAvatar seed={p.id} size={compact ? 44 : 56} state={avatarState(p)} /></div>
              <div className={`font-bold truncate ${compact ? 'text-sm' : ''} ${dead ? 'line-through text-gray-500' : ''}`}>{p.name} {p.id === joined?.playerId && <span className="text-amber-600">({d.you})</span>}</div>
              <div className="text-xs">{p.isHost && <span className="bg-purple-500 text-white rounded-full px-2 py-0.5">👑 {d.host}</span>} {!p.connected && <span className="text-red-500">• {d.offline}</span>}</div>
              {(p.wins ?? 0) > 0 && <div className="text-xs mt-1 font-extrabold text-amber-600">🏆 ×{p.wins}</div>}
              {phase === 'lobby' && joined?.isHost && p.id !== joined.playerId && (
                <div className="mt-1">
                  <span role="button" title={d.kick}
                    onClick={(e) => { e.stopPropagation(); getNet().kick(p.id); }}
                    className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 cursor-pointer hover:bg-red-200">✖ {d.kick}</span>
                </div>)}
              {dead && p.role && phase !== 'results' && <div className={`text-sm mt-1 font-extrabold ${roleColor(p.role)}`}>{ROLE_EMOJI[p.role]} {roleLabel(d, p.role)}</div>}
              {phase === 'voting' && p.alive && <div className="text-xs mt-1">{p.hasVoted ? '✅ voted' : '🤔 …'}</div>}
              {phase === 'results' && p.role && <div className={`text-sm mt-1 font-extrabold ${roleColor(p.role)}`}>{ROLE_EMOJI[p.role]} {roleLabel(d, p.role)}</div>}
            </button>
          );
        })}
      </div>
    );
  }

  const shareText = () => {
    const lines = [`🐺 ${d.title} — ${pub?.winner === 'wolves' ? d.wolvesWin : d.villagersWin}`];
    if (priv?.myRole) lines.push(`${d.yourRole}: ${ROLE_EMOJI[priv.myRole]} ${roleLabel(d, priv.myRole)}`);
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordLine(myRecord.w, myRecord.l));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const nightStepTitle = pub?.nightStep ? d[('step' + pub.nightStep[0].toUpperCase() + pub.nightStep.slice(1)) as keyof typeof d] as string : '';
  const amDead = joined && me && !me.alive;
  const amWolf = priv?.myRole === 'wolf' && me?.alive;
  const amSeer = priv?.myRole === 'seer' && me?.alive;
  const amGuardian = priv?.myRole === 'guardian' && me?.alive;
  const amWitch = priv?.myRole === 'witch' && me?.alive;
  const amHunter = !!priv?.canShoot;

  /* ---------- landing ---------- */
  if (!joined) {
    return (
      <div className="min-h-dvh bg-[#14142B] text-[#2B2016] transition-colors duration-1000">
        <div className="max-w-3xl mx-auto px-3 py-4">
          <TopBar logo={<span className="text-2xl">🐺</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} />
          <button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
          <div className="relative bg-[#171731] px-5 pt-6 pb-6 text-center overflow-hidden rounded-[28px] hard">
            <div className="stars" style={{ position: 'absolute' }} />
            <p className="disp relative text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px] sm:text-xs">{d.kicker}</p>
            <h1 className="disp relative text-[#FFF3CF] font-extrabold text-5xl leading-none mt-2">🐺 {d.title}</h1>
            <p className="relative text-[#B9BCE0] font-bold mt-3 max-w-md mx-auto leading-snug">{d.subtitle}</p>
          </div>
          <div className={`${CARD} mt-4`}>
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: Hoàng"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            <button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>🌙 {d.create}</button>
            <div className="flex gap-2 mt-3">
              <input className="inp flex-1 min-w-0 px-4 py-3 font-bold uppercase" placeholder={d.codePh}
                value={roomCodeInput} maxLength={5} onChange={e => setRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' && roomCodeInput.trim() && name.trim()) getNet().joinRoom(roomCodeInput.trim(), name.trim()); }} />
              <button className={`${BTN} btn-dark`} disabled={!name.trim() || !roomCodeInput.trim() || !!status}
                onClick={() => { setError(''); getNet().joinRoom(roomCodeInput.trim(), name.trim()); }}>🚪 {d.join}</button>
            </div>
            {status && <p className="text-center font-bold mt-3">{status} <button className="text-red-500 font-extrabold ml-1" onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } try { getNet().leave(); } catch { /* ignore */ } location.href = location.pathname; }}>{d.cancelConnect}</button></p>}
            {error && <p className="text-center font-bold text-red-600 mt-3">{error}</p>}
            {!status && !error && <p className="text-center text-[#8A7B63] font-bold text-sm mt-3">6–12 {d.players} · {d.discussionTime} 2:00</p>}
          </div>
          <p className="text-center text-[#B9BCE0] font-bold text-sm mt-4">🎙️ {d.voiceListen} · {d.voiceMicOn}</p>
          {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        </div>
      </div>
    );
  }

  const secretBar = priv?.myRole && phase !== 'lobby' && (
    <div className="bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2 mb-2 flex items-center gap-2 flex-wrap">
      <span className="disp font-extrabold text-[#FFF3CF]">{ROLE_EMOJI[priv.myRole]} {d.yourRole}: <span className={priv.myRole === 'wolf' ? 'text-[#FF8A80]' : 'text-[#FFB020]'}>{roleLabel(d, priv.myRole)}</span></span>
      {priv.myRole === 'wolf' && priv.wolfTeam.length > 1 && (
        <span className="text-[#B9BCE0] font-bold text-sm">{d.wolfTeammates}: {priv.wolfTeam.filter(w => w.id !== joined.playerId).map(w => w.name).join(', ')}</span>
      )}
      {priv.myRole === 'witch' && (
        <span className="text-[#B9BCE0] font-bold text-sm">🧪 {priv.witchSaveLeft ? '💚' : '—'} {priv.witchKillLeft ? '☠️' : '—'}</span>
      )}
      {priv.myRole === 'seer' && priv.seerPeeks.length > 0 && (
        <span className="text-[#B9BCE0] font-bold text-sm">🔮 {priv.seerPeeks.length} {lang === 'vi' ? 'đã soi' : 'peeked'}</span>
      )}
      {amDead && <span className="text-red-300 font-bold text-sm">💀 {lang === 'vi' ? 'Bạn đã chết — đang theo dõi' : 'You are dead — watching'}</span>}
    </div>
  );

  const chatAside = pub && (phase === 'lobby' || phase === 'day' || phase === 'results') && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined.playerId} d={d} height="flex" onChat={onChat} reactions={WOLF_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (phase === 'lobby' || phase === 'day' || phase === 'results') && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2" onClick={() => setChatSheet(true)}>
      <span className="font-bold text-sm text-[#5C4B33]">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm">{chatPreview(d, lastChat.text, WOLF_REACTIONS)}</span>
    </button>
  );

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-4">
        <TopBar logo={<span className="text-2xl">🐺</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        <button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
        {secretBar}
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {error && <div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div>}

        {phase === 'lobby' && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div>
              <div className={`${CARD}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="disp font-extrabold text-2xl">🐺 {d.lobby} · <span className="text-[#FFB020]">{pub!.roomCode}</span></h2>
                  <button className="disp font-extrabold text-sm bg-white hard-xs rounded-full px-3 py-1.5" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=ma-soi&room=${pub!.roomCode}`); } catch { /* ignore */ } }}>{d.copyLink}</button>
                </div>
                <PlayerGrid />
                <div className="mt-2">
                  <div className="disp font-extrabold text-sm">{d.rolesPreview} ({connected} {d.players}):</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {roleTable(connected).map(t => (
                      <span key={t.role} className="inline-flex items-center gap-1 bg-white hard-xs rounded-full px-2.5 py-1 text-xs font-extrabold">{ROLE_EMOJI[t.role]} {roleLabel(d, t.role)} ×{t.count}</span>
                    ))}
                  </div>
                </div>
                {joined.isHost ? (
                  <>
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      <span className="font-extrabold text-sm">{d.discussionTime}:</span>
                      {[60000, 120000, 180000].map(ms => (
                        <button key={ms} onClick={() => getNet().setDiscussion(ms)}
                          className={`disp px-3 py-1.5 rounded-full font-extrabold text-sm push ${pub!.discussionMs === ms ? 'bg-[#FFB020] text-[#2B2016] hard-xs' : 'bg-white hard-xs'}`}>
                          {ms / 60000}:00
                        </button>
                      ))}
                    </div>
                    <button className={`${BTN} btn-green w-full mt-3`} disabled={connected < MIN_PLAYERS}
                      onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                    {connected < MIN_PLAYERS && <p className="text-center font-bold text-red-600 text-sm mt-2">{d.need6}</p>}
                  </>
                ) : (
                  <p className="text-center font-bold text-[#8A7B63] mt-4">{d.waiting}</p>
                )}
                <button className="disp font-extrabold text-sm text-red-500 mt-3" onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>{d.leave}</button>
              </div>
            </div>
            {chatAside}
          </div>
        )}

        {phase === 'roleReveal' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-5 text-center">
              <div className="text-7xl mb-2">{ROLE_EMOJI[priv?.myRole ?? 'villager']}</div>
              <div className="disp font-extrabold text-3xl text-[#FFF3CF]">{roleLabel(d, priv?.myRole)}</div>
              <p className="text-[#B9BCE0] font-bold leading-snug mt-3">{priv?.myRole ? d[priv.myRole + 'Desc' as keyof typeof d] as string : ''}</p>
              {priv?.myRole === 'wolf' && priv.wolfTeam.length > 1 && (
                <p className="text-[#FFB020] font-bold mt-3">{d.wolfTeammates}: {priv.wolfTeam.filter(w => w.id !== joined.playerId).map(w => w.name).join(', ')}</p>
              )}
              <button className={`${BTN} btn-amber w-full mt-5`} onClick={() => { pendingRef.current.ready = { kind: 'ready' }; getNet().ready(); }}>
                {d.imReady}
              </button>
              <p className="text-[#B9BCE0] font-bold text-sm mt-2">{d.readyOf(pub!.revealReady.length, connected)}</p>
              {joined.isHost && <button className="disp font-extrabold text-sm text-[#FFB020] mt-1" onClick={() => getNet().beginNight()}>{d.forceNight}</button>}
            </div>
          </div>
        )}

        {phase === 'night' && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h2 className="disp font-extrabold text-2xl text-[#FFF3CF]">🌙 {d.night} {pub!.round > 1 ? `#${pub!.night}` : ''} · {nightStepTitle}</h2>
              <TimerPill secs={secsLeft(pub!.nightEndsAt, now)} dark />
            </div>
            {pub!.lastVoteOut && (
              <div className="bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2 mb-2 font-bold text-[#FFF3CF] text-sm">
                {d.voteOutNote(pub!.lastVoteOut.name, roleLabel(d, pub!.lastVoteOut.role))}
              </div>
            )}
            {pub!.voteTie && (
              <div className="bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2 mb-2 font-bold text-[#FFF3CF] text-sm">{d.voteTieNote}</div>
            )}

            {amDead ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-5 text-center">
                <div className="text-6xl mb-2">💀</div>
                <p className="text-[#B9BCE0] font-bold">{lang === 'vi' ? 'Bạn đã chết — đang theo dõi ván đấu.' : 'You are dead — watching the game.'}</p>
                <PlayerGrid compact />
              </div>
            ) : pub!.nightStep === 'wolves' && amWolf ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                <p className="font-extrabold text-[#FFF3CF] text-lg">{d.wolfPrompt}</p>
                {priv!.wolfTeam.filter(w => w.id !== joined.playerId && w.alive).length > 0 && (
                  <p className="text-[#B9BCE0] font-bold text-sm mt-1">{d.wolfTeammates}: {priv!.wolfTeam.filter(w => w.id !== joined.playerId && w.alive).map(w => {
                    const pick = priv!.wolfPicks.find(x => x.id === w.id);
                    return pick ? `${w.name} → ${playerName(pick.targetId)}` : `${w.name} (${d.looking})`;
                  }).join(' · ')}</p>
                )}
                <PlayerGrid
                  pickable={p => p.alive && p.id !== joined.playerId && !priv!.wolfTeam.some(w => w.id === p.id)}
                  onPick={id => doNight('wolfPick', id)}
                />
                <div className="text-center font-bold text-[#FFF3CF] text-sm mb-2">
                  {priv!.wolfPick ? d.wolfPickMade(playerName(priv!.wolfPick)) : d.wolfWaiting}
                </div>
                <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63]" onClick={() => doNight('wolfPass')}>{d.passNoKill}</button>
              </div>
            ) : pub!.nightStep === 'seer' && amSeer ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                <p className="font-extrabold text-[#FFF3CF] text-lg">{d.seerPrompt}</p>
                <PlayerGrid
                  pickable={p => p.alive && p.id !== joined.playerId && !priv!.seerPeeks.some(x => x.targetId === p.id)}
                  onPick={id => doNight('seerPeek', id)}
                />
                {priv!.seerPeeks.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {priv!.seerPeeks.map(pk => (
                      <div key={pk.targetId} className="font-bold text-sm text-[#FFF3CF] bg-[#23233F] rounded-xl px-3 py-2">
                        {d.seerResult(playerName(pk.targetId), pk.isWolf)}
                      </div>
                    ))}
                  </div>
                )}
                <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63] mt-3" onClick={() => doNight('seerPass')}>{lang === 'vi' ? 'Bỏ qua đêm nay' : 'Skip tonight'}</button>
              </div>
            ) : pub!.nightStep === 'guardian' && amGuardian ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                <p className="font-extrabold text-[#FFF3CF] text-lg">{d.guardPrompt}</p>
                {priv!.guardianLastTarget && <p className="text-[#FFB020] font-bold text-sm mt-1">{d.guardLast(playerName(priv!.guardianLastTarget))}</p>}
                <PlayerGrid
                  pickable={p => p.alive && p.id !== priv!.guardianLastTarget}
                  onPick={id => doNight('guardProtect', id)}
                />
                <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63]" onClick={() => doNight('guardPass')}>{lang === 'vi' ? 'Không bảo vệ ai' : 'Protect no one'}</button>
              </div>
            ) : pub!.nightStep === 'witch' && amWitch ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                <p className="font-extrabold text-[#FFF3CF] text-lg">{d.witchPrompt} <span className="text-[#FFB020]">{priv!.nightVictim ? playerName(priv!.nightVictim) : d.witchVictimNone}</span></p>
                {priv!.witchSaveLeft && priv!.nightVictim && (
                  <button className={`${BTN} btn-green w-full mt-3`} onClick={() => doNight('witchSave')}>{d.witchSaveBtn}</button>
                )}
                {priv!.witchKillLeft && (
                  <>
                    <p className="font-extrabold text-[#FFF3CF] mt-4 mb-1">{d.witchKillBtn}</p>
                    <PlayerGrid
                      pickable={p => p.alive && p.id !== joined.playerId}
                      onPick={id => doNight('witchKill', id)}
                    />
                  </>
                )}
                {!priv!.witchSaveLeft && !priv!.witchKillLeft && (
                  <p className="text-[#B9BCE0] font-bold mt-3">{d.witchNoPotions}</p>
                )}
                <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63] mt-3" onClick={() => doNight('witchPass')}>{d.witchPass}</button>
              </div>
            ) : pub!.nightStep === 'hunter' && amHunter ? (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                <p className="font-extrabold text-[#FFF3CF] text-lg">{d.hunterPrompt}</p>
                <PlayerGrid
                  pickable={p => p.alive}
                  onPick={id => doNight('hunterShoot', id)}
                />
                <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63]" onClick={() => doNight('hunterPass')}>{d.hunterPass}</button>
              </div>
            ) : (
              <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-6 text-center">
                <div className="text-7xl mb-3">🌙</div>
                <p className="text-[#FFF3CF] font-extrabold text-xl">{d.sleeping}</p>
                <p className="text-[#B9BCE0] font-bold mt-2">{d.nightWaiting}</p>
                <p className="text-[#B9BCE0] font-bold text-sm mt-1">{d.nightActing}</p>
              </div>
            )}
          </div>
        )}

        {phase === 'day' && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div>
              <div className={`${CARD}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="disp font-extrabold text-2xl">🌅 {d.day} {pub!.round > 1 ? `#${pub!.night}` : ''}</h2>
                  <TimerPill secs={secsLeft(pub!.discussionEndsAt, now)} />
                </div>
                {pub!.nightDeaths.length > 0 ? (
                  <div className="mt-3">
                    <p className="font-extrabold">{d.diedLastNight}</p>
                    <div className="space-y-2 mt-2">
                      {pub!.nightDeaths.map(x => (
                        <div key={x.id} className="flex items-center gap-2 bg-white hard-sm rounded-2xl px-3 py-2">
                          <WolfAvatar seed={x.id} size={40} state="dead" />
                          <div className="font-bold">
                            {x.name} — <span className={roleColor(x.role)}>{ROLE_EMOJI[x.role]} {roleLabel(d, x.role)}</span>
                            <span className="text-[#8A7B63] text-sm"> · {d.diedBy(x.cause)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="font-extrabold mt-3 text-[#0E9F6E]">{d.peacefulNight}</p>
                )}
                <p className="font-extrabold text-lg mt-4">{d.discuss}</p>
                <PlayerGrid compact />
                <button className={`${BTN} btn-amber w-full mt-2`} onClick={() => { pendingRef.current.readyVote = { kind: 'readyVote' }; getNet().readyVote(); }}>
                  {d.readyVoteBtn}
                </button>
                <p className="text-center font-bold text-[#8A7B63] text-sm mt-2">{d.readyVoteOf(pub!.dayReady.length, pub!.players.filter(p => p.connected && p.alive).length)}</p>
                {joined.isHost && (
                  <button className="disp w-full text-center font-extrabold text-sm text-[#D63A2F] mt-1" onClick={() => getNet().toVoting()}>{d.toVote}</button>
                )}
              </div>
              {chatPreviewBar}
            </div>
            {chatAside}
          </div>
        )}

        {phase === 'voting' && (
          <div className="max-w-3xl mx-auto">
            <div className={`${CARD}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="disp font-extrabold text-2xl">🗳️ {d.voting}</h2>
                <TimerPill secs={secsLeft(pub!.voteEndsAt, now)} />
              </div>
              <p className="font-bold text-[#8A7B63] mt-1">{d.voteHint}</p>
              <PlayerGrid
                pickable={p => p.alive && p.id !== joined.playerId}
                onPick={id => doVote(id)}
              />
              {me?.hasVoted && priv?.myVote && <p className="text-center font-extrabold text-[#0E9F6E]">{d.votedFor(playerName(priv.myVote))}</p>}
            </div>
          </div>
        )}

        {phase === 'results' && (
          <div className="max-w-3xl mx-auto flex flex-col min-h-0">
            <div className="flex-1 min-h-0 flex flex-col">
              <p className="disp text-center font-extrabold tracking-[0.22em] text-[#FFB020] text-xs mt-1">{d.results.toUpperCase()}</p>
              <h2 className="disp font-extrabold text-3xl text-center text-[#FFF3CF] leading-snug">
                {pub!.winner === 'wolves' ? d.wolvesWin : d.villagersWin}
              </h2>
              <PlayerGrid compact />
              {myRecord.w + myRecord.l > 0 && (
                <div className="text-center"><span className="font-extrabold text-[13px] text-[#B9BCE0]">{d.recordTitle}: </span><span className="font-bold text-teal-300 text-[13px]">{d.recordLine(myRecord.w, myRecord.l)}</span></div>
              )}
              <div className="flex gap-2 mt-3">
                <button className="disp flex-1 px-3 py-2.5 rounded-2xl font-extrabold hard push bg-[#FFFBef] text-[#2B2016] whitespace-nowrap" onClick={doShare}>
                  {shareCopied ? '✓ ' + d.copied : '📣 ' + d.shareResults}
                </button>
                {joined.isHost ? (
                  <button className="disp flex-1 px-3 py-2.5 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] whitespace-nowrap" onClick={() => getNet().playAgain()}>🔄 {d.playAgain}</button>
                ) : (
                  <p className="flex-1 text-center font-bold text-[#B9BCE0] self-center text-[13px] leading-tight">{d.waiting}</p>
                )}
              </div>
              {chatPreviewBar}
            </div>
          </div>
        )}
      </div>
      {chatSheet && pub && <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub.chat} myId={joined.playerId} d={d} onChat={onChat} reactions={WOLF_REACTIONS} />}
      {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
