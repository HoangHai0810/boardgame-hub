import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview, RetryDefaultButton } from '../../platform/ui';
import { MouseAvatar } from '../../platform/avatars';
import { PlayerAvatar } from '../../platform/GameCard';
import { SPY_ART, CLOCHE_ART } from '../../platform/art';
import { MIN_PLAYERS, MAX_PLAYERS, LOCATIONS } from '../../../../games/gian-diep/logic';
import type { FeedEvent } from '../../../../games/gian-diep/logic';

const SESSION_KEY = 'ct_guest_session:gian-diep';
const SPY_REACTIONS = ['🕵️', '😏', '🤔', '👍', '😱', '👀', '🔥', '😹'];

const AVATAR_BG = ['bg-rose-100', 'bg-sky-100', 'bg-lime-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-pink-100', 'bg-indigo-100'];
const avatarBg = (id: string) => AVATAR_BG[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];
// The countdown ticks inside the pill (1s) instead of a 250ms clock at
// App level re-rendering the whole screen 4×/second (A3).
function TimerPill({ endsAt, dark = false }: { endsAt: number | null | undefined; dark?: boolean }) {
  const [secs, setSecs] = useState<number | null>(() => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null));
  useEffect(() => {
    if (!endsAt) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (secs === null || secs === undefined) return null;
  const label = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
  return <span className={`disp inline-flex items-center gap-1 rounded-full px-3 py-1 font-extrabold text-base ${dark ? 'bg-[#23233F] border-2 border-[#3D3D63] text-[#FFB020]' : 'bg-[#FFFBef] hard-xs text-[#2B2016]'}`}>🕐 {label}</span>;
}
/** A static pill for a paused clock (the round timer during a vote). */
function PausedPill({ msLeft }: { msLeft: number | null | undefined }) {
  if (msLeft === null || msLeft === undefined) return null;
  const secs = Math.max(0, Math.ceil(msLeft / 1000));
  const label = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
  return <span className="disp inline-flex items-center gap-1 rounded-full px-3 py-1 font-extrabold text-base bg-[#FFFBef] hard-xs text-[#2B2016]">⏸ {label}</span>;
}

const BTN = 'disp px-5 py-3 rounded-2xl font-extrabold hard push disabled:opacity-40';
const CARD = 'card-cream p-4 sm:p-5';

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🕵️ {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

/** The event feed (laptop "Diễn biến"): structured events rendered in
 *  the viewer's language, "bạn" when it involves me. */
function FeedList({ feed, d, myId, players }: { feed: FeedEvent[]; d: any; myId?: string; players: { id: string; name: string }[] }) {
  const name = (id?: string) => (id === myId ? d.you : players.find(p => p.id === id)?.name ?? '');
  const dot: Record<string, string> = {
    start: '#FFB020', ask: '#B9BCE0', accuse: '#D63A2F', 'accuse-fail': '#B9BCE0',
    'accuse-cancel': '#B9BCE0', 'convict-spy': '#0E9F6E', 'convict-innocent': '#D63A2F',
    'guess-right': '#D63A2F', 'guess-wrong': '#0E9F6E', 'timeout-spy': '#D63A2F',
    'final-start': '#FFB020', 'final-pass': '#B9BCE0',
  };
  const text = (e: FeedEvent): string => {
    const a = name(e.actorId);
    const tg = name(e.targetId);
    switch (e.kind) {
      case 'start': return d.feedStart;
      case 'ask': return d.feedAsk(a, tg) + (e.text ? `: “${e.text}”` : '');
      case 'accuse': return d.feedAccuse(a, tg);
      case 'accuse-fail': return d.feedAccuseFail(a, tg);
      case 'accuse-cancel': return d.feedAccuseCancel(a, tg);
      case 'convict-spy': return d.feedConvictSpy(a);
      case 'convict-innocent': return d.feedConvictInnocent(a);
      case 'guess-right': return d.feedGuessRight;
      case 'guess-wrong': return d.feedGuessWrong;
      case 'timeout-spy': return d.feedTimeoutSpy;
      case 'final-start': return d.feedFinalStart;
      case 'final-pass': return d.feedFinalPass(a);
      default: return e.kind;
    }
  };
  return (
    <div className="space-y-1.5">
      {feed.length === 0 && <p className="font-bold text-sm text-[#B9BCE0]">…</p>}
      {[...feed].reverse().map((e, i) => (
        <div key={e.ts + '-' + i} className="flex items-start gap-2 font-bold text-sm leading-snug text-[#EDEDF7]">
          <span className="mt-1.5 w-2.5 h-2.5 rounded-full flex-none" style={{ background: dot[e.kind] ?? '#B9BCE0' }} />
          <span>{text(e)}</span>
        </div>
      ))}
    </div>
  );
}

function Confetti() {
  const colors = ['#FFB020', '#D63A2F', '#0E9F6E', '#2E7CD6', '#7C4DBD', '#FFFBef'];
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    left: (i * 41) % 100, delay: (i % 7) * 0.35, dur: 2.6 + (i % 5) * 0.5,
    color: colors[i % colors.length], rotate: (i * 53) % 360, w: 8 + (i % 3) * 3,
  }));
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden>
      {pieces.map((p, i) => (
        <span key={i} className="absolute top-0" style={{
          left: `${p.left}%`, width: p.w, height: p.w * 0.6, background: p.color,
          animation: `fall ${p.dur}s linear ${p.delay}s infinite`, transform: `rotate(${p.rotate}deg)`,
        }} />
      ))}
    </div>
  );
}

export default function GianDiepApp() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  const [name, setName] = useState(() => sessionStorage.getItem('ct_name') || '');
  const [roomCodeInput, setRoomCodeInput] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const [forceCreate, setForceCreate] = useState(false);
  // Invite-link mode: a room code in the URL (or typed in) makes JOIN the
  // primary action — the amber Create button hides, so nobody creates a
  // new room by habit instead of joining their friend's.
  const joinMode = !forceCreate && roomCodeInput.trim().length >= 4;
  const [pub, setPub] = useState<Pub | null>(null);
  const [priv, setPriv] = useState<Priv | null>(null);
  const [joined, setJoined] = useState<{ code: string; playerId: string; isHost: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [connLost, setConnLost] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('ct_muted') === '1');
  const [showHelp, setShowHelp] = useState(false);
  const [botAdding, setBotAdding] = useState(false);
  const [chatSheet, setChatSheet] = useState(false);
  const [myRecord, setMyRecord] = useState<{ w: number; l: number }>({ w: 0, l: 0 });
  const [shareCopied, setShareCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
  const recordedSessions = useRef<Set<string>>(new Set());
  const netRef = useRef<Net | null>(null);
  const toggleGuard = useRef(0);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const autoVoiceRef = useRef('');
  const voiceOptOutRef = useRef(false);
  const phase = pub?.phase ?? 'lobby';

  const me = pub?.players.find(p => p.id === joined?.playerId);
  const locName = (idx: number | null) => idx === null ? '' : (LOCATIONS[idx]?.name[lang] ?? '');
  const locIcon = (idx: number | null) => idx === null ? '' : (LOCATIONS[idx]?.icon ?? '');
  const roleName = (idx: number | null) => idx === null ? '' : (priv?.locationIdx !== null && priv?.locationIdx !== undefined && LOCATIONS[priv.locationIdx]?.roles[idx]?.[lang]) ?? '';
  const myLoc = priv?.locationIdx ?? null;
  const myRole = priv?.roleIdx ?? null;
  const isSpy = !!priv?.isSpy;

  const toggleMuted = () => setMuted(m => { localStorage.setItem('ct_muted', m ? '0' : '1'); return !m; });
  useEffect(() => { if (!muted) ensureCtx(); }, [muted]);

  const getNet = () => {
    if (!netRef.current) {
      netRef.current = createNet({
        onState: (s) => { setPub(s); setStatus(''); setConnLost(false); setMigrating(false); },
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
            GAME_NOT_SUPPORTED: d.errGameNotSupported, HOST_UNREACHABLE: d.errHostUnreachable,
          };
          if (m.startsWith('CONN_ERROR:')) setError(d.errConnError(m.slice('CONN_ERROR:'.length)));
          else if (m === 'NET_LOST') setConnLost(true);
          else if (m === 'NET_OK') setConnLost(false);
          else setError(map[m] || d.errFailed);
          if (m === 'HOST_GONE' || m === 'KICKED') { setJoined(null); setPub(null); setPriv(null); }
        },
        onStatus: (m) => {
          if (!m) { setStatus(''); return; }
          if (m === 'STATUS_MIGRATING') { setMigrating(true); return; }
          if (m === 'STATUS_CREATING') setStatus(d.statusCreating);
          else if (m.startsWith('STATUS_CONNECTING:')) setStatus(d.statusConnecting(m.slice('STATUS_CONNECTING:'.length)));
          else setStatus(m);
        },
        onPromoted: () => { setJoined(j => (j ? { ...j, isHost: true } : j)); },
      }, 'gian-diep');
    }
    return netRef.current;
  };

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

  // Record the session in my personal record (once per session).
  const prevPub = useRef<{ phase?: string } | null>(null);
  useEffect(() => {
    if (!pub || !joined) return;
    if (prevPub.current?.phase !== 'results' && pub.phase === 'results' && !recordedSessions.current.has(pub.roomCode + ':' + pub.round)) {
      recordedSessions.current.add(pub.roomCode + ':' + pub.round);
      const maxScore = Math.max(...pub.players.map(p => pub.config.pointsOn ? p.score : p.roundWins));
      const won = (pub.config.pointsOn ? (me?.score ?? 0) : (me?.roundWins ?? 0)) === maxScore;
      setMyRecord(r => ({ w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1) }));
      sfx(won ? 'win' : 'lose', muted);
    }
    prevPub.current = { phase: pub.phase };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub]);

  // A soft chime when my turn to ask starts.
  const prevAsker = useRef<string | null>(null);
  useEffect(() => {
    if (pub?.phase === 'questioning' && pub.currentAskerId === joined?.playerId && prevAsker.current !== joined?.playerId) sfx('pop', muted);
    prevAsker.current = pub?.currentAskerId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.currentAskerId, pub?.phase]);

  useEffect(() => { setChatSheet(false); }, [phase]);
  // Re-arm the Add-bot button once the new bot actually arrives (the
  // Ma Sói sample leaves it disabled after the first add).
  useEffect(() => { setBotAdding(false); }, [pub?.players.length]);

  // Host F5 guard: the room lives in the host's tab.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (joined?.isHost && pub && phase !== 'lobby' && phase !== 'results') { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [joined?.isHost, pub, phase]);

  /* ---------- voice (same rules as the other games: speaker auto-on
   *  when entering a room, mic stays off until the player taps it) ---------- */
  const startSpeaker = async (auto = false) => {
    if (!joined || voiceRef.current) return;
    setVoiceSpeaker('busy');
    try {
      voiceRef.current = await joinVoice(joined.code, joined.playerId, {
        onSpeaking: (ids) => setSpeakingIds(prev => (prev.size === ids.size && [...ids].every(x => prev.has(x)) ? prev : ids)),
        onPeers: () => { /* presence is implicit in the speaking badges */ },
      }, 'gian-diep', getNet().getBrokerUrl?.());
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

  const voice = joined ? {
    speaker: voiceSpeaker, mic: voiceMic, muted: voiceMuted,
    onSpeaker: toggleSpeaker, onMic: toggleMic,
  } : undefined;
  const lastChat = pub?.chat?.length ? pub.chat[pub.chat.length - 1] : null;
  const onChat = (text: string) => getNet().chat(text);

  /* ---------- game actions (optimistic where it matters) ---------- */
  const [optReady, setOptReady] = useState(false);
  const [optVote, setOptVote] = useState<boolean | null>(null);
  const [optAsk, setOptAsk] = useState<string | null>(null);
  const [accuseMode, setAccuseMode] = useState(false);
  const [accuseConfirm, setAccuseConfirm] = useState<string | null>(null);
  const [showGuess, setShowGuess] = useState(false);
  const [guessPick, setGuessPick] = useState<number | null>(null);
  // Typed question for my ask turn (optional — no mic needed to ask).
  const [askText, setAskText] = useState('');
  // Location notes: locals tap to cross out eliminated locations; the spy
  // taps to pick the guess. Local-only, reset every round.
  const [crossed, setCrossed] = useState<number[]>([]);
  useEffect(() => { setOptReady(false); setOptVote(null); setOptAsk(null); setAccuseMode(false); setAccuseConfirm(null); setShowGuess(false); setGuessPick(null); setAskText(''); setCrossed([]); }, [phase, pub?.round]);
  useEffect(() => { if (priv?.myVote !== null && priv?.myVote !== undefined) setOptVote(priv.myVote); }, [priv?.myVote]);
  useEffect(() => { if (pub && !pub.accusation && !pub.finalVote) setOptVote(null); }, [pub?.accusation, pub?.finalVote]);

  const doReady = () => { setOptReady(true); getNet().nightAction('ready'); };
  const doAsk = (targetId: string) => {
    setOptAsk(targetId);
    const q = askText.trim();
    getNet().nightAction('askTarget', undefined, { targetId, ...(q ? { question: q } : {}) });
    setAskText('');
  };
  const doAccuse = (targetId: string) => {
    setAccuseConfirm(null); setAccuseMode(false);
    getNet().nightAction('accuse', undefined, { targetId });
  };
  const doVote = (yes: boolean) => {
    setOptVote(yes);
    if (pub?.finalVote) getNet().nightAction('finalVote', undefined, { yes });
    else getNet().nightAction('voteAccuse', undefined, { yes });
  };
  const doGuess = () => {
    if (guessPick === null) return;
    setShowGuess(false);
    getNet().nightAction('spyGuess', undefined, { locationIdx: guessPick });
  };
  const doFinalPick = (targetId: string | null) => {
    setAccuseConfirm(null); setAccuseMode(false);
    getNet().nightAction('finalPick', undefined, { targetId });
  };

  /* ---------- shared bits ---------- */
  const tone = phase === 'results' || phase === 'roleReveal' || phase === 'roundEnd' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';
  const others = pub?.players.filter(p => p.id !== joined?.playerId) ?? [];
  const myAskTurn = phase === 'questioning' && !pub?.finalPhase && !pub?.accusation && !pub?.finalVote && pub?.currentAskerId === joined?.playerId;
  const finalMyTurn = phase === 'questioning' && !!pub?.finalPhase && !pub?.finalVote && pub?.finalOrder[pub.finalIdx] === joined?.playerId;
  const voteOpen = pub?.accusation ?? pub?.finalVote ?? null;
  const myVote = optVote ?? priv?.myVote ?? null;
  const canAccuse = !!priv?.canAccuse;

  const shareText = () => {
    const top = pub ? [...pub.players].sort((a, b) => (pub.config.pointsOn ? b.score - a.score : b.roundWins - a.roundWins))[0] : null;
    const lines = [`🕵️ ${d.title} — ${top?.name ?? ''}: ${pub?.config.pointsOn ? `${top?.score ?? 0} ${d.points}` : `${top?.roundWins ?? 0} ${d.wins}`}`];
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordTitle + ': ' + d.recordLine(myRecord.w, myRecord.l));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const feedAside = pub && (phase === 'questioning' || phase === 'roundEnd') && (
    <aside className="hidden lg:flex flex-col min-h-0">
      {phase === 'questioning' && (
        <div className="bg-[#23233F] border-[3px] border-[#2B2016] rounded-[24px] p-4 hard mb-4">
          <div className="disp font-extrabold text-[11px] tracking-[0.18em] text-[#B9BCE0]">{d.myCard}</div>
          <div className="flex items-center gap-3 mt-2">
            <img src={isSpy ? SPY_ART : CLOCHE_ART} alt="" className="w-[72px] h-[58px] rounded-xl border-2 border-[#3D3D63] object-cover flex-none" />
            <div className="min-w-0">
              {isSpy ? (
                <><div className="disp font-extrabold text-lg text-[#FFB020] leading-tight">{d.revealYouAreSpy}</div>
                <div className="font-bold text-[#B9BCE0] text-xs mt-0.5">{d.guessHint}</div></>
              ) : (
                <><div className="disp font-extrabold text-lg text-[#FFF3CF] leading-tight">{locName(myLoc)}</div>
                {pub.config.rolesOn && myRole !== null && <div className="font-bold text-[#B9BCE0] text-xs mt-0.5">{d.revealYourRole}: {roleName(myRole)}</div>}</>
              )}
            </div>
          </div>
        </div>
      )}
      {phase === 'questioning' && (
        <div className="bg-[#23233F] border-[3px] border-[#2B2016] rounded-[24px] p-4 hard mb-4">
          <div className="disp font-extrabold text-lg mb-2 text-[#FFF3CF]">💬 {d.recentAsks}</div>
          <div className="space-y-1.5">
            {pub.feed.filter(e => e.kind === 'ask').slice(-3).reverse().map((e, i) => (
              <div key={e.ts + '-' + i} className="font-bold text-sm leading-snug text-[#EDEDF7]">
                <span className="text-[#FFB020]">{playerName(e.actorId)}</span>
                {' → '}<span className="text-[#FFB020]">{playerName(e.targetId)}</span>
                {e.text ? <span className="text-[#B9BCE0]">: “{e.text}”</span> : ''}
              </div>
            ))}
            {pub.feed.filter(e => e.kind === 'ask').length === 0 && <p className="font-bold text-sm text-[#B9BCE0]">…</p>}
          </div>
        </div>
      )}
      <div className="bg-[#23233F] border-[3px] border-[#2B2016] rounded-[24px] p-4 flex flex-col flex-1 min-h-0 hard">
        <div className="disp font-extrabold text-lg mb-2 text-[#FFF3CF]">📜 {d.feedTitle}</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FeedList feed={pub.feed} d={d} myId={joined?.playerId} players={pub.players} />
        </div>
      </div>
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0 mt-4">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined?.playerId ?? ''} d={d} height="flex" onChat={onChat} reactions={SPY_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, SPY_REACTIONS)}</span>
      {unreadChat > 0 && <span className="flex-none bg-[#D63A2F] text-white text-xs font-extrabold rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center">{unreadChat}</span>}
    </button>
  );

  /* ---------- landing ---------- */
  if (!joined) {
    return (
      <div className="min-h-dvh bg-[#14142B] text-[#2B2016]">
        <div className="max-w-md lg:max-w-lg mx-auto">
          <div className="flex items-center gap-2 px-3 pt-3">
            <button className="disp font-extrabold text-[#FFF3CF] text-sm bg-[#23233F] border-2 border-[#3D3D63] rounded-full px-3 py-2.5 push" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
            <span className="flex-1" />
            <button title={muted ? '🔕' : '🔊'} className="w-11 h-11 push rounded-full bg-[#23233F] border-2 border-[#3D3D63] text-lg flex items-center justify-center" onClick={toggleMuted}>{muted ? '🔕' : '🔊'}</button>
            <span className="inline-flex rounded-full overflow-hidden border-2 border-[#3D3D63] text-sm font-black">
              <button className={`px-2.5 py-1 ${lang === 'vi' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => { localStorage.setItem('ct_lang', 'vi'); setLang('vi'); }}>VI</button>
              <button className={`px-2.5 py-1 ${lang === 'en' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => { localStorage.setItem('ct_lang', 'en'); setLang('en'); }}>EN</button>
            </span>
          </div>
          <div className="text-center px-4 pt-6">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.kicker}</p>
            <h1 className="disp text-[#FFF3CF] font-extrabold text-5xl leading-none mt-2">{d.title}</h1>
            <p className="text-[#B9BCE0] font-bold mt-2 leading-snug">{d.subtitle}</p>
          </div>
          <div className="flex justify-center mt-5">
            <img src={SPY_ART} alt="" className="w-[200px] rounded-[24px] border-[3px] border-[#2B2016] hard anim-bob" />
          </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] px-4 pt-4 pb-6 mt-5">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            {!joinMode && (<button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>🕵️ {d.create}</button>)}
            {!name.trim() && <p className="text-center font-bold text-[#8A7B63] text-sm mt-2">{d.nameFirst}</p>}
            {!joinMode && (<div className="flex items-center gap-3 mt-4 mb-3">
              <span className="flex-1 border-t-2 border-[#E5DCC0]" />
              <span className="disp font-extrabold text-xs text-[#8A7B63] tracking-wide">{d.orJoinFriend}</span>
              <span className="flex-1 border-t-2 border-[#E5DCC0]" />
            </div>)}
            <div className="flex gap-2">
              <input className="inp flex-1 min-w-0 px-4 py-3 font-bold uppercase" placeholder={d.codePh}
                value={roomCodeInput} maxLength={5} onChange={e => setRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' && roomCodeInput.trim() && name.trim()) getNet().joinRoom(roomCodeInput.trim(), name.trim()); }} />
              <button className={`${BTN} ${joinMode ? 'btn-amber' : 'btn-dark'}`} disabled={!name.trim() || !roomCodeInput.trim() || !!status}
                onClick={() => { setError(''); getNet().joinRoom(roomCodeInput.trim(), name.trim()); }}>🚪 {d.join}</button>
            </div>
            {joinMode && (<p className="text-center mt-3"><button className="font-bold text-sm text-[#8A7B63] underline" onClick={() => setForceCreate(true)}>＋ {d.create}</button></p>)}
            {status && <p className="text-center font-bold mt-3">{status} <button className="text-red-500 font-extrabold ml-1" onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } try { getNet().leave(); } catch { /* ignore */ } location.href = location.pathname; }}>{d.cancelConnect}</button></p>}
            {error && <><p className="text-center font-bold text-red-600 mt-3">{error}</p><RetryDefaultButton d={d} /></>}
            {!status && !error && <p className="text-center text-[#8A7B63] font-bold text-sm mt-4">{d.landingFoot}</p>}
            <p className="text-center mt-3">
              <button className="font-bold text-sm text-[#8A7B63] underline" onClick={() => setShowHelp(true)}>{d.how}</button>
            </p>
          </div>
          {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        </div>
      </div>
    );
  }

  const rankings = pub ? [...pub.players].sort((a, b) => (pub.config.pointsOn ? b.score - a.score : b.roundWins - a.roundWins)) : [];
  const sessionWinner = rankings[0] ?? null;
  const myPointsThisRound = pub?.roundResult?.points[joined?.playerId ?? ''] ?? 0;

  const onPlayerTap = (p: { id: string }) => {
    if (accuseMode || finalMyTurn) { if (p.id !== joined?.playerId) setAccuseConfirm(p.id); return; }
    if (myAskTurn && p.id !== joined?.playerId) doAsk(p.id);
  };

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-3">
        <TopBar logo={<span className="text-2xl">🕵️</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        {phase !== 'lobby' && (<button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>)}
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {migrating && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">🔄 {d.statusMigrating}</div>}
        {error && <><div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div><RetryDefaultButton d={d} /></>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs push font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-xl leading-none">🕵️ {d.title} · {d.lobby}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-0.5 hidden sm:block">{d.waiting}</p>
              </div>
              <span className="flex-1" />
              <span className="hidden sm:block font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS}</span>
            </div>
            <div className="bg-[#14142B] rounded-[20px] px-4 py-2 flex items-center gap-3 hard">
              <div className="min-w-0">
                <div className="disp text-[#FFB020] font-extrabold text-[11px] tracking-[0.18em]">{d.roomCode}</div>
                <div className="flex gap-1.5 mt-1" data-testid="room-code">
                  {pub!.roomCode.split('').map((c, i) => (
                    <span key={i} className="w-7 h-7 sm:w-9 sm:h-10 rounded-lg bg-[#FFFBef] text-[#2B2016] font-extrabold text-lg sm:text-xl flex items-center justify-center">{c}</span>
                  ))}
                </div>
              </div>
              <span className="flex-1" />
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=gian-diep&room=${pub!.roomCode}`); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}>{linkCopied ? `✅ ${d.copied}` : `🔗 ${d.copyLink}`}</button>
            </div>

            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4 mt-2">
              <div className="card-cream p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS} · {d.needAtLeast(MIN_PLAYERS)}</span>
                </div>
                <div className="space-y-1.5 my-1.5">
                  {pub!.players.map(p => (
                    <div key={p.id} className={`flex items-center gap-2.5 rounded-2xl px-3 py-1 border-2 hard-xs ${p.id === joined.playerId ? 'bg-[#FFB020]/15 border-[#FFB020]' : 'bg-[#23233F] border-[#3D3D63]'}`}>
                      <span className="relative flex-none">
                        <PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state={p.connected ? 'awake' : 'asleep'} />} />
                        {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                      </span>
                      <span className="flex-1 min-w-0 font-extrabold truncate text-[#FFF3CF]">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                      {p.isBot && <span className="flex-none text-xs font-extrabold bg-[#FFFBef] text-[#2B2016] rounded-full px-2 py-1">🤖 {d.botTag}</span>}
                      {p.isHost && <span className="flex-none text-xs font-extrabold bg-[#FFB020] text-[#2B2016] rounded-full px-2.5 py-1">👑 {d.host}</span>}
                      {!p.connected && <span className="flex-none text-red-400 text-xs font-bold">{d.offline}</span>}
                      {joined.isHost && p.id !== joined.playerId && (
                        <span role="button" title={p.isBot ? d.removeBot : d.kick}
                          onClick={() => { if (p.isBot) getNet().nightAction('removeBot', p.id); else getNet().kick(p.id); }}
                          className="flex-none text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-1 cursor-pointer hover:bg-red-200">✖ {p.isBot ? d.removeBot : d.kick}</span>)}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, MAX_PLAYERS - pub!.players.length) }).map((_, i) => (
                    <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] px-3 py-1 text-center text-[#8A7B63] font-bold text-xs hidden lg:block">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
                  ))}
                </div>
                {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
                {joined.isHost && pub!.players.length < MAX_PLAYERS && (
                  <div className="mt-2">
                    <button className={`${BTN} btn-dark w-full`} disabled={botAdding} onClick={() => { setBotAdding(true); getNet().nightAction('addBot'); }}>🤖 {d.addBot}</button>
                    <p className="font-bold text-[#8A7B63] text-sm text-center mt-1.5 hidden sm:block">{d.botHint}</p>
                  </div>
                )}
                <button className={`${BTN} bg-[#FFFBef] text-[#D63A2F] w-full mt-2 hidden lg:block`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>🚪 {d.leave}</button>
              </div>

              {/* Game settings — host only */}
              <div className="card-cream p-3 mt-2 lg:mt-0">
                <h3 className="disp font-extrabold text-xl">{d.rulesTitle}{!joined.isHost && <span className="text-sm font-bold text-[#8A7B63]"> ({d.hostOnlyShort})</span>}</h3>
                <div className="mt-2 space-y-2">
                  {/* The two pill groups sit side by side so the lobby
                   * still fits one phone screen (stacked they cost
                   * ~110px more). */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="font-extrabold leading-tight text-sm whitespace-nowrap">{d.ruleMinutes}</div>
                      <div className="flex gap-1.5 mt-1">
                        {[6, 8, 12].map(v => (
                          <button key={v} data-testid="pill-minutes" data-val={v} disabled={!joined.isHost}
                            onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('setConfig', undefined, { config: { roundMinutes: v } }); }}
                            className={`flex-1 px-1 py-2 min-h-[44px] rounded-full border-2 font-extrabold text-sm push ${pub!.config.roundMinutes === v ? 'bg-[#FFB020] border-[#2B2016] text-[#2B2016]' : 'bg-white border-[#C9BFA5] text-[#5C4B33]'}`}>{d.minutesUnit(v)}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="font-extrabold leading-tight text-sm whitespace-nowrap">{d.ruleRounds}</div>
                      <div className="flex gap-1.5 mt-1">
                        {[3, 5, 7].map(v => (
                          <button key={v} data-testid="pill-rounds" data-val={v} disabled={!joined.isHost}
                            onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('setConfig', undefined, { config: { roundsTotal: v } }); }}
                            className={`flex-1 px-1 py-2 min-h-[44px] rounded-full border-2 font-extrabold text-sm push ${pub!.config.roundsTotal === v ? 'bg-[#FFB020] border-[#2B2016] text-[#2B2016]' : 'bg-white border-[#C9BFA5] text-[#5C4B33]'}`}>{d.roundsUnit(v)}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 lg:flex-col">
                    {([
                      ['rolesOn', d.ruleRoles, d.ruleRolesSub],
                      ['pointsOn', d.rulePoints, d.rulePointsSub],
                    ] as const).map(([key, label, sub]) => (
                      <div key={key} className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <div className="font-extrabold leading-tight text-sm">{label}</div>
                          <div className="font-bold text-xs text-[#8A7B63] leading-snug hidden sm:block">{sub}</div>
                        </div>
                        <button
                          data-testid={`toggle-${key}`}
                          disabled={!joined.isHost}
                          aria-pressed={pub!.config[key]}
                          onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('setConfig', undefined, { config: { [key]: !pub!.config[key] } }); }}
                          className="flex-none min-w-[44px] min-h-[44px] px-1 flex items-center justify-center disabled:opacity-70">
                          <span className={`w-12 h-7 rounded-full border-2 border-[#2B2016] relative transition-colors block ${pub!.config[key] ? 'bg-[#0E9F6E]' : 'bg-[#C9BFA5]'}`}>
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white border-2 border-[#2B2016] transition-all ${pub!.config[key] ? 'left-6' : 'left-0.5'}`} />
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                {joined.isHost ? (
                  <>
                    <button className={`${BTN} btn-amber w-full mt-2`} disabled={connected < MIN_PLAYERS}
                      onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                    {connected < MIN_PLAYERS && <p className="text-center font-bold text-red-600 text-xs mt-2">{d.need2}</p>}
                    {connected >= MIN_PLAYERS && <p className="text-center font-bold text-[#8A7B63] text-xs mt-2 hidden sm:block">{d.stillNeed(MAX_PLAYERS - connected)}</p>}
                  </>
                ) : (
                  <p className="text-center font-bold text-[#8A7B63] mt-3">{d.waiting}</p>
                )}
              </div>
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'roleReveal' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto">
            <div className="text-center">
              <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.revealTitle} · {d.roundOf(pub.round, pub.config.roundsTotal)}</p>
              <h2 className="disp font-extrabold text-2xl mt-1">{d.dealerStarts(playerName(pub.dealerId))}</h2>
            </div>
            {isSpy ? (
              <div data-testid="spy-card" className="mt-4 rounded-[28px] border-4 border-white overflow-hidden hard anim-enter" style={{ background: '#0F766E' }}>
                <img src={SPY_ART} alt="" className="w-full h-[190px] object-cover" />
                <div className="p-5 text-center">
                  <p className="disp font-extrabold tracking-[0.22em] text-[11px] text-[#99F6E4]">BẠN LÀ · {d.roundOf(pub.round, pub.config.roundsTotal)}</p>
                  <div className="disp font-extrabold text-3xl text-white mt-1">{lang === 'vi' ? 'Gián điệp' : 'The Spy'}</div>
                  <p className="font-bold text-[#CCFBF1] text-sm leading-snug mt-2">{d.revealSpySub}</p>
                </div>
                <div className="px-4 pb-4">
                  <p className="disp font-extrabold text-[#FFF3CF] mb-2 text-center">{d.revealLocationList}</p>
                  <div className="grid grid-cols-2 gap-2 text-left">
                    {LOCATIONS.map((l, i) => (
                      <div key={i} className="bg-[#134E4A] border-2 border-[#2DD4BF]/40 rounded-2xl px-3 py-2 font-bold text-sm text-[#EDEDF7]">{l.icon} {l.name[lang]}</div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[28px] border-4 border-white overflow-hidden hard anim-enter" style={{ animation: 'cardFlip 0.5s ease', background: '#92400E' }}>
                <img src={CLOCHE_ART} alt="" className="w-full h-[190px] object-cover" />
                <div className="p-5 text-center">
                  <p className="disp font-extrabold tracking-[0.22em] text-[11px] text-[#FDE68A]">{d.revealTitle.toUpperCase()} · {d.roundOf(pub.round, pub.config.roundsTotal)}</p>
                  <div className="disp font-extrabold text-3xl leading-tight text-white mt-1">{locName(myLoc)}</div>
                  {pub.config.rolesOn && myRole !== null && (
                    <div className="mt-3 inline-block bg-white/95 rounded-full px-4 py-1.5 font-extrabold text-sm text-[#2B2016]">{d.revealYourRole}: {roleName(myRole)}</div>
                  )}
                </div>
              </div>
            )}
            <button className={`${BTN} btn-amber w-full mt-4`} data-testid="reveal-ready" disabled={optReady || pub.revealReady.includes(joined?.playerId ?? '')} onClick={doReady}>
              {optReady || pub.revealReady.includes(joined?.playerId ?? '') ? `✅ ${d.voted}` : d.revealReady}
            </button>
            <p className="text-center font-bold text-[#8A7B63] text-sm mt-2">
              {d.revealWaiting(Math.max(0, connected - pub.revealReady.length))} · {d.revealTimeout}
            </p>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'questioning' && pub && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div className="min-w-0">
              {/* secret bar: my location + role, always visible */}
              <div className="bg-[#14142B] rounded-2xl px-3 py-2 mb-2 flex items-center gap-2 hard">
                {isSpy ? (
                  <><span className="text-xl">🕵️</span><span className="font-extrabold text-[#FFB020] text-sm leading-snug">{d.revealYouAreSpy} — {d.guessHint}</span></>
                ) : (
                  <><span className="text-xl">{locIcon(myLoc)}</span><span className="font-extrabold text-[#FFF3CF] text-sm leading-snug">{locName(myLoc)}{pub.config.rolesOn && myRole !== null ? ` · ${roleName(myRole)}` : ''}</span></>
                )}
                <span className="flex-1" />
                <span className="font-bold text-[#B9BCE0] text-xs whitespace-nowrap">{d.roundOf(pub.round, pub.config.roundsTotal)}</span>
              </div>
              {/* header: round clock */}
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="disp font-extrabold text-2xl leading-none">
                  {pub.finalPhase ? d.finalTitle : myAskTurn ? d.askYourTurn : d.askTurn(playerName(pub.currentAskerId))}
                </h2>
                {pub.accusation ? <PausedPill msLeft={pub.roundRemainingMs} /> : pub.roundEndsAt ? <TimerPill endsAt={pub.roundEndsAt} dark /> : null}
                {pub.finalPickEndsAt && <TimerPill endsAt={pub.finalPickEndsAt} dark />}
              </div>
              <p className="font-bold text-[#8A7B63] text-xs mt-1">
                {pub.finalPhase ? d.finalSub : d.roundTimerSub}
                {myAskTurn ? ` · ${d.askAuto}` : ''}
              </p>

              {/* last ask — who asked whom, and the typed question if any */}
              {(() => {
                const lastAsk = [...pub.feed].reverse().find(e => e.kind === 'ask');
                if (!lastAsk) return null;
                const nm = (id?: string | null) => (id === joined?.playerId ? d.you : playerName(id));
                const asker = pub.players.find(p => p.id === lastAsk.actorId);
                const target = pub.players.find(p => p.id === lastAsk.targetId);
                return (
                  <div className="mt-2 bg-[#FFFBef] border-2 border-[#FFB020] rounded-2xl px-3 py-2 flex items-center gap-2 hard-xs">
                    <PlayerAvatar avatarId={asker?.avatar} size={32} fallback={<MouseAvatar seed={lastAsk.actorId} size={32} state="awake" />} />
                    <span className="font-extrabold text-sm">→</span>
                    <PlayerAvatar avatarId={target?.avatar} size={32} fallback={<MouseAvatar seed={lastAsk.targetId ?? ''} size={32} state="awake" />} />
                    <span className="font-bold text-sm text-[#2B2016] leading-snug">{d.feedAsk(nm(lastAsk.actorId), nm(lastAsk.targetId))}{lastAsk.text ? <span className="text-[#5C4B33]">: “{lastAsk.text}”</span> : ''}</span>
                  </div>
                );
              })()}

              {/* typed question (optional): type first, then tap a player */}
              {myAskTurn && (
                <input value={askText} maxLength={140} onChange={e => setAskText(e.target.value)}
                  placeholder={d.askQuestionPh} className="inp w-full px-4 py-2.5 font-bold mt-2" />
              )}

              {/* final-phase rotation */}
              {pub.finalPhase && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pub.finalOrder.map((id, i) => (
                    <span key={id} className={`font-extrabold text-xs rounded-full px-2.5 py-1.5 border-2 ${i === pub.finalIdx ? 'bg-[#FFB020] border-[#2B2016] text-[#2B2016]' : i < pub.finalIdx ? 'bg-[#C9BFA5] border-[#C9BFA5] text-[#5C4B33] line-through' : 'bg-white border-[#C9BFA5] text-[#5C4B33]'}`}>
                      {i + 1}. {playerName(id)}{i === pub.finalIdx ? ' ←' : ''}
                    </span>
                  ))}
                </div>
              )}
              {finalMyTurn && (
                <p className="font-extrabold text-[#D63A2F] text-sm mt-2">{d.finalYourTurn} {d.finalPickHint}</p>
              )}

              {/* player table — tap to ask / accuse */}
              <div className="grid grid-cols-4 gap-2 mt-2">
                {pub.players.map(p => {
                  const isAsker = pub.currentAskerId === p.id && !pub.finalPhase;
                  const tapped = optAsk === p.id;
                  const clickable = (myAskTurn && p.id !== joined?.playerId) || ((accuseMode || finalMyTurn) && p.id !== joined?.playerId);
                  return (
                    <button key={p.id} data-testid="ask-player" data-player-id={p.id} disabled={!clickable}
                      onClick={() => onPlayerTap(p)}
                      className={`rounded-2xl p-1.5 text-center hard-xs ${isAsker ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${tapped ? 'ring-4 ring-[#0E9F6E]' : ''} ${!p.connected ? 'opacity-60' : ''}`}>
                      <span className="mx-auto block w-fit relative">
                        <PlayerAvatar avatarId={p.avatar} size={40} fallback={<MouseAvatar seed={p.id} size={40} state={p.connected ? 'awake' : 'asleep'} />} />
                        {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                      </span>
                      <span className="block font-bold truncate text-sm mt-0.5 text-[#2B2016]">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                      {isAsker && <span className="text-[#D63A2F] text-xs font-extrabold">❓ {lang === 'vi' ? 'đang hỏi' : 'asking'}</span>}
                      {pub.accusedOnce.includes(p.id) && <span className="block text-[#8A7B63] text-[11px] font-bold">⚠️ {lang === 'vi' ? 'đã tố cáo' : 'accused'}</span>}
                      {pub.config.pointsOn && <span className="block font-bold text-xs text-[#8A7B63]">{p.score} {d.points}</span>}
                    </button>
                  );
                })}
              </div>
              {myAskTurn && <p className="font-bold text-[#8A7B63] text-sm mt-2">{d.askHint}</p>}
              {(accuseMode || finalMyTurn) && <p className="font-extrabold text-[#D63A2F] text-sm mt-2">{d.finalPickHint}</p>}

              {/* action row */}
              <div className="flex gap-2 mt-3">
                {!pub.finalPhase && (
                  <button className={`${BTN} btn-amber flex-1`} data-testid="accuse-btn" disabled={!canAccuse || !!pub.accusation || !!pub.finalVote}
                    onClick={() => setAccuseMode(m => !m)}>
                    {canAccuse ? `⚠️ ${d.accuseBtn}` : `⚠️ ${d.accuseBtn} · ${d.accusedOut}`}
                  </button>
                )}
                {finalMyTurn && (
                  <button className={`${BTN} flex-1 bg-[#FFFBef] text-[#2B2016]`} data-testid="final-pass" onClick={() => doFinalPick(null)}>
                    {d.finalPass}
                  </button>
                )}
                {isSpy && (
                  <button className={`${BTN} btn-dark flex-1`} data-testid="guess-btn" disabled={!priv?.canGuess}
                    onClick={() => { if (guessPick !== null) doGuess(); else { setGuessPick(null); setShowGuess(true); } }}>
                    🕵️ {d.guessBtn}
                  </button>
                )}
              </div>
              {accuseMode && (
                <p className="font-bold text-[#8A7B63] text-sm mt-2">{d.accuseHint}</p>
              )}

              {/* location notes grid (design v48): locals cross out,
                  the spy taps to pick the guess. */}
              {!pub.finalPhase && (
                <div className="mt-3">
                  <p className="disp font-extrabold text-xs tracking-wide text-[#8A7B63]">{isSpy ? d.locationsSpyHint : d.locationsTitle}</p>
                  <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                    {LOCATIONS.map((l, i) => {
                      const isCrossed = crossed.includes(i);
                      const isPicked = isSpy && guessPick === i;
                      return (
                        <button key={i} data-testid={isSpy ? 'spy-loc-pick' : 'loc-note'}
                          onClick={() => {
                            if (isSpy) setGuessPick(isPicked ? null : i);
                            else setCrossed(c => isCrossed ? c.filter(x => x !== i) : [...c, i]);
                          }}
                          className={`rounded-xl border-2 px-2 py-2 font-extrabold text-sm push ${isPicked ? 'bg-[#FFB020] border-[#2B2016] text-[#2B2016]' : isCrossed ? 'bg-[#C9BFA5] border-[#C9BFA5] text-[#5C4B33] line-through opacity-60' : 'bg-[#23233F] border-[#3D3D63] text-[#EDEDF7]'}`}>
                          {l.name[lang]}
                        </button>
                      );
                    })}
                  </div>
                  {isSpy && guessPick !== null && <p className="font-bold text-[#8A7B63] text-xs mt-1.5">{d.guessPickFirst}</p>}
                </div>
              )}

              {chatPreviewBar}
            </div>
            {feedAside}
          </div>
        )}

        {phase === 'roundEnd' && pub && pub.roundResult && (
          <div className="lg:grid lg:grid-cols-[340px_1fr] lg:gap-6 lg:items-start max-w-3xl mx-auto">
            <div className="rounded-[28px] border-4 border-white overflow-hidden hard" style={{ background: '#0F766E' }}>
              <img src={SPY_ART} alt="" className="w-full h-[190px] object-cover" />
              <div className="p-5 text-center">
                <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.roundEndTitle} · {d.roundOf(pub.round, pub.config.roundsTotal)}</p>
                <h2 className="disp font-extrabold text-3xl mt-1 text-white">{pub.roundResult.reason === 'spy-caught' ? d.caughtHeadline : pub.roundResult.winner === 'spy' ? d.spyWon : d.localsWon}</h2>
                <p className="font-bold text-[#CCFBF1] mt-1">{d.spyWas(playerName(pub.roundResult.spyId))}. {d.locationWas(locName(pub.roundResult.locationIdx))}.</p>
                {pub.roundResult.reason === 'spy-guess-right' && (
                  <p className="font-extrabold text-[#FFB020] mt-1">🔍 {d.spyGuessedRight}</p>
                )}
              </div>
            </div>
            <div className="mt-4 lg:mt-0">
              <div className="bg-[#23233F] border-[3px] border-[#2B2016] rounded-[20px] p-3 flex items-center gap-3 hard">
                <img src={CLOCHE_ART} alt="" className="w-[64px] h-[52px] rounded-xl border-2 border-[#3D3D63] object-cover flex-none" />
                <div>
                  <div className="disp font-extrabold text-[11px] tracking-[0.18em] text-[#B9BCE0]">{lang === 'vi' ? 'ĐỊA ĐIỂM' : 'LOCATION'}</div>
                  <div className="disp font-extrabold text-xl text-[#FFF3CF]">{locName(pub.roundResult.locationIdx)}</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {pub.players.map(p => {
                  const pts = pub.roundResult!.points[p.id] ?? 0;
                  const isSpyRow = p.id === pub.roundResult!.spyId;
                  const roleIdx = pub.roundResult!.roles?.[p.id];
                  const rrRole = roleIdx !== undefined && roleIdx !== null ? (LOCATIONS[pub.roundResult!.locationIdx]?.roles[roleIdx]?.[lang] ?? '') : '';
                  return (
                    <div key={p.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 border-2 hard-xs ${isSpyRow ? 'bg-[#FFB020]/15 border-[#FFB020]' : 'bg-[#23233F] border-[#3D3D63]'}`}>
                      <PlayerAvatar avatarId={p.avatar} size={40} fallback={<MouseAvatar seed={p.id} size={40} state="awake" />} />
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-[#FFF3CF] truncate">{p.name}{p.id === joined?.playerId ? ` (${d.you})` : ''}</div>
                        <div className="font-bold text-xs text-[#B9BCE0]">{isSpyRow ? d.spyBadge : rrRole}</div>
                      </div>
                      {isSpyRow && <span className="bg-[#D63A2F] text-white text-xs font-extrabold rounded-full px-2.5 py-1 flex-none">{d.spyBadge}</span>}
                      <span className="disp font-extrabold text-[#FFB020] flex-none">{pub.config.pointsOn ? (pts > 0 ? d.pointsEarned(pts) : '—') : `${p.roundWins} ${d.wins}`}</span>
                    </div>
                  );
                })}
              </div>
              <p className="font-bold text-[#B9BCE0] text-sm mt-3 text-center lg:text-left">{d.nextDealer(playerName(pub.dealerId))}</p>
              {joined.isHost ? (
                <button className={`${BTN} btn-amber w-full mt-4`} data-testid="next-round" onClick={() => getNet().nightAction('nextRound')}>
                  {pub.round >= pub.config.roundsTotal ? d.viewResults : `▶ ${d.nextRound}`}
                </button>
              ) : (
                <p className="text-center font-bold text-[#B9BCE0] mt-4">{d.waiting}</p>
              )}
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'results' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto text-center">
            {sessionWinner && sessionWinner.id === joined?.playerId && <Confetti />}
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.results}</p>
            <h2 className="disp font-extrabold text-3xl mt-1">{d.sessionOver}</h2>
            <p className="font-bold text-[#B9BCE0] mt-1">
              {sessionWinner ? (rankings.filter(r => (pub.config.pointsOn ? r.score : r.roundWins) === (pub.config.pointsOn ? sessionWinner.score : sessionWinner.roundWins)).length > 1 ? d.sessionTie : d.sessionSpyWins(sessionWinner.name)) : ''}
            </p>
            <div className="card-cream rounded-[28px] p-5 mt-4 hard text-left">
              <div className="disp font-extrabold text-lg mb-2">{pub.config.pointsOn ? d.totalPoints : d.roundsWon}</div>
              <div className="space-y-1">
                {rankings.map((p, i) => (
                  <div key={p.id} className={`flex items-center justify-between font-bold ${i === 0 ? 'text-lg' : 'text-sm'}`}>
                    <span>{i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i + 1}. `}{p.name}{p.id === joined?.playerId ? ` (${d.you})` : ''}</span>
                    <span>{pub.config.pointsOn ? `${p.score} ${d.points}` : `${p.roundWins} ${d.wins}`}</span>
                  </div>
                ))}
              </div>
              {(myRecord.w + myRecord.l) > 0 && <p className="font-bold text-[#8A7B63] text-sm mt-3">📊 {d.recordTitle}: {d.recordLine(myRecord.w, myRecord.l)}</p>}
            </div>
            <div className="flex gap-2 mt-4">
              <button className={`${BTN} btn-amber flex-1`} data-testid="play-again" disabled={!joined.isHost} onClick={() => getNet().nightAction('playAgain')}>
                🔄 {d.playAgain}
              </button>
              <button className={`${BTN} bg-[#FFFBef] text-[#2B2016] flex-1`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>
                {d.backLobby}
              </button>
            </div>
            <button className="disp font-extrabold text-[#FFB020] text-sm mt-3" onClick={doShare}>{shareCopied ? `✅ ${d.copied}` : `📣 ${d.shareResults}`}</button>
            {chatPreviewBar}
          </div>
        )}
      </div>

      {/* accusation vote sheet (mid-round or timer-end) */}
      {voteOpen && phase === 'questioning' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4" onClick={() => { /* vote must be cast, not dismissed */ }}>
          <div className="card-cream rounded-[28px] p-5 w-full max-w-md hard anim-enter max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="disp font-extrabold text-2xl">{lang === 'vi' ? 'Bỏ phiếu' : 'Vote'}</h3>
                <p className="font-bold text-[#8A7B63] text-sm">{d.accuseTitle(playerName(pub!.accusation?.accuserId), playerName(voteOpen.suspectId))}</p>
              </div>
              <TimerPill endsAt={voteOpen.endsAt} />
            </div>
            {(() => {
              const voters = pub!.players.filter(p => p.connected && p.id !== voteOpen.suspectId);
              const needed = Math.max(0, voters.length - (voteOpen.yes ?? 0));
              return (
                <>
                  <div className="mt-3 bg-[#FFFBef] border-2 border-[#FFB020] rounded-2xl px-3 py-2 font-bold text-sm text-[#5C4B33]">
                    {d.voteUnanimous} {playerName(voteOpen.suspectId)} {d.voteSuspect}, {d.needMoreVotes(needed)}.
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {pub!.players.filter(p => p.id === voteOpen.suspectId).map(p => (
                      <div key={p.id} className="flex items-center gap-2 rounded-2xl px-3 py-2 bg-[#FFB020] border-2 border-[#2B2016]">
                        <PlayerAvatar avatarId={p.avatar} size={32} fallback={<MouseAvatar seed={p.id} size={32} state="awake" />} />
                        <span className="font-extrabold text-sm flex-1">{p.name}</span>
                        <span className="font-bold text-xs">⚠️ {d.voteSuspect}</span>
                      </div>
                    ))}
                    {voters.map(p => {
                      const hasVoted = voteOpen.voted.includes(p.id);
                      const isMe = p.id === joined?.playerId;
                      return (
                        <div key={p.id} className="flex items-center gap-2 rounded-2xl px-3 py-2 bg-white border-2 border-[#E5DCC0]">
                          <PlayerAvatar avatarId={p.avatar} size={32} fallback={<MouseAvatar seed={p.id} size={32} state="awake" />} />
                          <span className="font-extrabold text-sm flex-1">{p.name}{isMe ? ` (${d.you})` : ''}{pub!.accusation?.accuserId === p.id ? ` · ${d.accuserTag}` : ''}</span>
                          {isMe && myVote !== null ? (
                            <span className={`font-extrabold text-xs ${myVote ? 'text-[#0E9F6E]' : 'text-[#D63A2F]'}`}>{myVote ? `✅ ${d.voteYes}` : `❌ ${d.voteNo}`}</span>
                          ) : hasVoted ? (
                            <span className="font-extrabold text-xs text-[#0E9F6E]">✓ {d.hasVoted}</span>
                          ) : (
                            <span className="font-bold text-xs text-[#8A7B63]">… {d.waitingVote}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
            <p className="font-bold text-[#8A7B63] text-xs mt-2">{d.voteTimeout}</p>
            {voteOpen.suspectId === joined?.playerId ? (
              <p className="text-center font-extrabold text-[#D63A2F] mt-4">{lang === 'vi' ? 'Bạn đang bị tố cáo — chờ cả bàn bỏ phiếu.' : 'You are being accused — wait for the vote.'}</p>
            ) : myVote !== null ? (
              <p className="text-center font-extrabold text-[#0E9F6E] mt-4">✅ {d.voted} — {myVote ? d.voteYes : d.voteNo}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button className={`${BTN} btn-amber`} data-testid="vote-yes" onClick={() => doVote(true)}>✅ {d.voteYes}</button>
                <button className={`${BTN} bg-[#FFFBef] text-[#2B2016]`} data-testid="vote-no" onClick={() => doVote(false)}>❌ {d.voteNo}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* accuse confirm bar */}
      {accuseConfirm && phase === 'questioning' && (
        <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
          <div className="card-cream rounded-t-[28px] p-4 max-w-md mx-auto hard pointer-events-auto">
            <p className="text-center font-extrabold text-lg">
              {d.accuseTitle(playerName(joined?.playerId), playerName(accuseConfirm))}
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button className={`${BTN} btn-amber`} data-testid="accuse-confirm" onClick={() => pub!.finalPhase ? doFinalPick(accuseConfirm) : doAccuse(accuseConfirm)}>
                ⚠️ {d.accuseBtn}
              </button>
              <button className={`${BTN} bg-[#FFFBef] text-[#2B2016]`} onClick={() => setAccuseConfirm(null)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      {/* spy guess sheet */}
      {showGuess && phase === 'questioning' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowGuess(false)}>
          <div className="card-cream rounded-[28px] p-5 w-full max-w-md max-h-[85vh] overflow-auto hard anim-enter" onClick={e => e.stopPropagation()}>
            <h3 className="disp font-extrabold text-2xl text-center">{d.guessTitle}</h3>
            <p className="font-bold text-[#8A7B63] text-sm text-center mt-1">{d.guessSub}</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {LOCATIONS.map((l, i) => (
                <button key={i} data-testid="guess-pick" data-loc={i} onClick={() => setGuessPick(i)}
                  className={`rounded-2xl px-3 py-2.5 font-extrabold text-left border-2 push ${guessPick === i ? 'bg-[#FFB020] border-[#2B2016]' : 'bg-white border-[#C9BFA5]'}`}>
                  {l.icon} {l.name[lang]}
                </button>
              ))}
            </div>
            <button className={`${BTN} btn-amber w-full mt-4`} data-testid="guess-confirm" disabled={guessPick === null} onClick={doGuess}>
              🕵️ {d.guessBtn2}
            </button>
          </div>
        </div>
      )}

      {chatSheet && pub && (
        <ChatSheet open={chatSheet} d={d} chat={pub.chat} myId={joined?.playerId ?? ''} onChat={onChat} onClose={() => setChatSheet(false)} reactions={SPY_REACTIONS} />
      )}
      {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
