import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview, RetryDefaultButton } from '../../platform/ui';
import { MouseAvatar } from '../../platform/avatars';
import { NoticeBanner, PlayerAvatar, fanLayout, fanFrameH } from '../../platform/GameCard';
import { isPlayable, MIN_PLAYERS, MAX_PLAYERS, COLORS } from '../../../../games/uno/logic';
import type { Card, Color } from '../../../../games/uno/logic';

const SESSION_KEY = 'ct_guest_session:uno';
const UNO_REACTIONS = ['🎉', '😱', '🙏', '🤔', '👍', '🔴', '🔵', '🟢'];

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

const BTN = 'disp px-5 py-3 rounded-2xl font-extrabold hard push disabled:opacity-40';
const CARD = 'card-cream p-4 sm:p-5';

/* ---------- Uno cards (CSS art, same chunky style as the platform) ---------- */
const CARD_COLORS: Record<string, string> = { red: '#D63A2F', yellow: '#FFB020', green: '#0E9F6E', blue: '#2E7CD6', wild: '#2B2016' };
const COLOR_LABEL: Record<Color, string> = { red: 'Đỏ', yellow: 'Vàng', green: 'Xanh lá', blue: 'Xanh dương' };
function cardSymbol(card: Card): string {
  return card.kind === 'number' ? String(card.value)
    : card.kind === 'skip' ? '⊘' : card.kind === 'reverse' ? '⟳'
    : card.kind === 'draw2' ? '+2' : card.kind === 'wild' ? 'WILD' : '+4';
}
function UnoCardFace({ card, size = 'md' }: { card: Card; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[76px] h-[110px]' : size === 'sm' ? 'w-[52px] h-[76px]' : 'w-[62px] h-[90px]';
  const sym = size === 'sm' ? 'text-base' : size === 'lg' ? (card.color === 'wild' ? 'text-2xl' : 'text-3xl') : (card.color === 'wild' ? 'text-xl' : 'text-2xl');
  const pip = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const bg = CARD_COLORS[card.color];
  const symColor = card.color === 'wild' ? '#2B2016' : bg;
  return (
    <span className={`relative inline-flex flex-none items-center justify-center rounded-xl border-[3px] border-white overflow-hidden ${box}`} style={{ background: bg, boxShadow: '0 3px 0 rgba(43,32,22,0.9), 0 8px 18px rgba(0,0,0,0.35)' }}>
      {card.color === 'wild' ? (
        <span className="absolute inset-[7px] rounded-[10px] overflow-hidden grid grid-cols-2 grid-rows-2 rotate-[-18deg] scale-110">
          <span style={{ background: '#D63A2F' }} /><span style={{ background: '#FFB020' }} />
          <span style={{ background: '#0E9F6E' }} /><span style={{ background: '#2E7CD6' }} />
        </span>
      ) : (
        <span className="absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-[46%] bg-white rounded-[50%] rotate-[-24deg]" />
      )}
      <span className={`relative disp font-extrabold ${sym} ${card.color === 'wild' ? 'text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.45)]' : ''}`} style={card.color === 'wild' ? undefined : { color: symColor }}>
        {cardSymbol(card)}
      </span>
      <span className={`absolute top-1 left-1.5 disp font-extrabold ${pip} text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.35)]`}>{card.kind === 'number' ? card.value : card.kind === 'draw2' ? '+2' : card.kind === 'wild4' ? '+4' : card.kind === 'skip' ? '⊘' : card.kind === 'reverse' ? '⟳' : 'W'}</span>
      <span className={`absolute bottom-1 right-1.5 disp font-extrabold ${pip} text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.35)] rotate-180`}>{card.kind === 'number' ? card.value : card.kind === 'draw2' ? '+2' : card.kind === 'wild4' ? '+4' : card.kind === 'skip' ? '⊘' : card.kind === 'reverse' ? '⟳' : 'W'}</span>
    </span>
  );
}
function UnoCardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[76px] h-[110px]' : size === 'sm' ? 'w-[52px] h-[76px]' : 'w-[62px] h-[90px]';
  return (
    <span className={`relative inline-flex flex-none items-center justify-center rounded-xl border-[3px] border-white ${box}`} style={{ background: '#2B2016', boxShadow: '0 3px 0 rgba(43,32,22,0.9), 0 8px 18px rgba(0,0,0,0.35)' }}>
      <span className="absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-[46%] bg-[#D63A2F] rounded-[50%] rotate-[-24deg]" />
      <span className="relative disp font-extrabold italic text-lg" style={{ color: '#FFB020' }}>UNO</span>
    </span>
  );
}

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🃏 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

export default function UnoApp() {
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
  const [chatSheet, setChatSheet] = useState(false);
  const [myRecord, setMyRecord] = useState<{ w: number; l: number; points: number }>({ w: 0, l: 0, points: 0 });
  const [shareCopied, setShareCopied] = useState(false);
  // A wild card in my hand waiting for a color choice (or the first-card
  // wild: colorPickPending === me, with no card involved).
  const [wildPick, setWildPick] = useState<Card | null>(null);
  // Optimistic UI: the played card fades out at once; the draw pile shows
  // "drawing" until the host state arrives (6s fallback).
  const [optPlayed, setOptPlayed] = useState<string | null>(null);
  const [optDrew, setOptDrew] = useState(false);
  const [hoverCardId, setHoverCardId] = useState<string | null>(null);
  const fanRef = useRef<HTMLDivElement>(null);
  const [fanW, setFanW] = useState(358);
  useEffect(() => {
    const el = fanRef.current; if (!el) return;
    const ro = new ResizeObserver(es => { const w = es[0]?.contentRect.width; if (w) setFanW(w); });
    ro.observe(el); return () => ro.disconnect();
  }, [pub?.phase]);
  useEffect(() => { if (!optPlayed) return; const t = setTimeout(() => setOptPlayed(null), 6000); return () => clearTimeout(t); }, [optPlayed]);
  useEffect(() => { if (!optDrew) return; const t = setTimeout(() => setOptDrew(false), 6000); return () => clearTimeout(t); }, [optDrew]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [ackOneCard, setAckOneCard] = useState('');
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
  useEffect(() => { setOptPlayed(null); setOptDrew(false); }, [pub?.phase]);
  useEffect(() => {
    if (optPlayed && priv && !priv.myHand.some(c => c.id === optPlayed)) setOptPlayed(null);
    if (optDrew && pub?.turnDrawn) setOptDrew(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub, priv]);
  const recordedRounds = useRef<Set<string>>(new Set());
  const netRef = useRef<Net | null>(null);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const autoVoiceRef = useRef('');
  const voiceOptOutRef = useRef(false);
  const phase = pub?.phase ?? 'lobby';

  const me = pub?.players.find(p => p.id === joined?.playerId);

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
      }, 'uno');
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

  // Record the round in my personal session record (once per round).
  const prevPub = useRef<{ phase?: string; round?: number } | null>(null);
  useEffect(() => {
    if (!pub || !joined) return;
    const key = pub.roomCode + ':' + pub.round;
    if (prevPub.current?.phase === 'playing' && pub.phase === 'results' && !recordedRounds.current.has(key)) {
      recordedRounds.current.add(key);
      const won = pub.winner === joined.playerId;
      const myPoints = pub.players.find(p => p.id === joined.playerId)?.points ?? 0;
      setMyRecord(r => ({ w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1), points: myPoints }));
    }
    if (pub.phase === 'results') sfx(pub.winner === joined.playerId ? 'win' : 'lose', muted);
    prevPub.current = { phase: pub.phase, round: pub.round };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub]);

  // A soft chime when my turn starts.
  const prevTurn = useRef<string | null>(null);
  useEffect(() => {
    if (pub?.phase === 'playing' && pub.turn === joined?.playerId && prevTurn.current !== joined?.playerId) sfx('pop', muted);
    prevTurn.current = pub?.turn ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.turn, pub?.phase]);

  useEffect(() => { setChatSheet(false); }, [phase]);

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
      }, 'uno', getNet().getBrokerUrl?.());
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

  /* ---------- turn actions ---------- */
  const myTurn = pub?.phase === 'playing' && pub.turn === joined?.playerId;
  const canDraw = myTurn && !pub.turnDrawn && !pub.pendingDraw4 && !pub.colorPickPending;
  const canPlay = (c: Card) => {
    if (!myTurn || !pub) return false;
    if (pub.pendingDraw4 || pub.colorPickPending) return false;
    if (!isPlayable(c, pub.topCard, pub.currentColor)) return false;
    if (pub.turnDrawn && c.id !== priv?.drawnCardId) return false; // after drawing, only the drawn card
    return true;
  };
  const doPlay = (card: Card, color?: Color) => {
    if (card.color === 'wild' && !color) { setWildPick(card); return; }
    setWildPick(null);
    setOptPlayed(card.id);
    getNet().nightAction('playCard', undefined, { cardId: card.id, ...(color ? { color } : {}) });
  };
  const doDraw = () => { setOptDrew(true); getNet().nightAction('drawCard'); };
  const doPass = () => getNet().nightAction('passTurn');
  const doCallUno = () => getNet().nightAction('callUno');
  const doCatchUno = (targetId: string) => getNet().nightAction('catchUno', targetId);
  const doTakeDraw4 = () => getNet().nightAction('takeDraw4');
  const doChallenge = () => getNet().nightAction('challengeWild4');
  const doPickColor = (color: Color) => {
    setWildPick(null);
    getNet().nightAction('pickColor', undefined, { color });
  };

  /* ---------- shared bits ---------- */
  const tone = phase === 'results' || phase === 'playing' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';
  const others = pub?.players.filter(p => p.id !== joined?.playerId) ?? [];
  const turnPlayer = pub?.players.find(p => p.id === pub?.turn);
  const unoPendingPlayer = pub?.players.find(p => p.id === pub?.unoPending);
  const draw4Player = pub?.players.find(p => p.id === pub?.pendingDraw4?.from);
  const colorLabel = (c: Color) => COLOR_LABEL[c];
  const drawnCard = priv?.myHand.find(c => c.id === priv?.drawnCardId);
  const drawnIsPlayable = drawnCard ? canPlay(drawnCard) : false;
  /** Short label for the fan detail bar, e.g. "7 đỏ", "+2 đỏ", "Cấm xanh". */
  const unoLabel = (c: Card) => {
    if (c.color === 'wild') return c.kind === 'wild4' ? '+4' : (lang === 'vi' ? 'Đổi màu' : 'Wild');
    const col = colorLabel(c.color);
    if (c.kind === 'number') return `${c.value} ${col}`;
    if (c.kind === 'draw2') return `+2 ${col}`;
    if (c.kind === 'skip') return lang === 'vi' ? `Cấm ${col}` : `Skip ${col}`;
    return lang === 'vi' ? `Đảo ${col}` : `Reverse ${col}`;
  };
  const myHand = priv?.myHand ?? [];
  const hoverCard = myHand.find(c => c.id === hoverCardId) ?? null;
  const fan = fanLayout(myHand.length, 76, fanW, null, 4, 1.6, 110);

  const shareText = () => {
    const lines = [`🃏 ${d.title} — ${playerName(pub?.winner)} ${d.winner}`];
    if (pub) lines.push(`+${pub.roundPoints} ${d.points}`);
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordLine(myRecord.w, myRecord.l, myRecord.points));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const chatAside = pub && phase === 'playing' && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined?.playerId ?? ''} d={d} height="flex" onChat={onChat} reactions={UNO_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, UNO_REACTIONS)}</span>
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
          <div className="flex justify-center items-end mt-5 -space-x-3">
            <span className="rotate-[-18deg] translate-y-2"><UnoCardFace card={{ id: 'fan-b2', color: 'blue', kind: 'number', value: 2 }} size="lg" /></span>
            <span className="rotate-[-9deg] translate-y-1"><UnoCardFace card={{ id: 'fan-g7', color: 'green', kind: 'number', value: 7 }} size="lg" /></span>
            <span className="z-10 -translate-y-1"><UnoCardFace card={{ id: 'fan-r9', color: 'red', kind: 'number', value: 9 }} size="lg" /></span>
            <span className="rotate-[9deg] translate-y-1"><UnoCardFace card={{ id: 'fan-y2', color: 'yellow', kind: 'draw2' }} size="lg" /></span>
            <span className="rotate-[18deg] translate-y-2"><UnoCardFace card={{ id: 'fan-b5', color: 'blue', kind: 'number', value: 5 }} size="lg" /></span>
          </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] px-4 pt-4 pb-6 mt-5">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            {!joinMode && (<button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>🃏 {d.create}</button>)}
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

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-4">
        <TopBar logo={<span className="text-2xl">🃏</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        <button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {migrating && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">🔄 {d.statusMigrating}</div>}
        {error && <><div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div><RetryDefaultButton d={d} /></>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs push font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-2xl leading-none">🃏 {d.title} · {d.lobby}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-1">{d.waiting}</p>
              </div>
            </div>
            <div className="bg-[#14142B] rounded-[20px] px-4 py-3 flex items-center gap-3 hard">
              <div className="min-w-0">
                <div className="disp text-[#FFB020] font-extrabold text-[11px] tracking-[0.18em]">{d.roomCode}</div>
                <div className="flex gap-1.5 mt-1" data-testid="room-code">
                  {pub!.roomCode.split('').map((c, i) => (
                    <span key={i} className="w-8 h-9 sm:w-9 sm:h-10 rounded-lg bg-[#FFFBef] text-[#2B2016] font-extrabold text-xl flex items-center justify-center">{c}</span>
                  ))}
                </div>
              </div>
              <span className="flex-1" />
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=uno&room=${pub!.roomCode}`); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}>{linkCopied ? `✅ ${d.copied}` : `🔗 ${d.copyLink}`}</button>
            </div>
            <div className="mt-4 card-cream p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                <span className="font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS} · {d.needAtLeast(MIN_PLAYERS)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 my-3">
                {pub!.players.map(p => (
                  <div key={p.id} className={`rounded-2xl p-2 text-center hard-xs ${p.id === joined.playerId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                    <span className="mx-auto block w-fit"><PlayerAvatar avatarId={p.avatar} size={48} fallback={<MouseAvatar seed={p.id} size={48} state="awake" />} /></span>
                    <span className="block font-bold truncate text-sm mt-0.5 text-[#2B2016]">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                    {(p as any).isBot && <span className="text-xs font-extrabold bg-[#23233F] text-[#FFB020] rounded-full px-2 py-0.5 mt-0.5 inline-block">🤖 {d.botTag}</span>}
                    {p.isHost && <span className="text-amber-600 text-xs font-extrabold whitespace-nowrap">👑 {d.host}</span>}
                    {!p.connected && <span className="text-red-500 text-xs font-bold"> • {d.offline}</span>}
                    {joined.isHost && p.id !== joined.playerId && (
                      <span role="button" title={(p as any).isBot ? d.removeBot : d.kick}
                        onClick={() => { if ((p as any).isBot) getNet().nightAction('removeBot', p.id); else getNet().kick(p.id); }}
                        className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 mt-1 cursor-pointer hover:bg-red-200">✖ {(p as any).isBot ? d.removeBot : d.kick}</span>)}
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 4 - pub!.players.length) }).map((_, i) => (
                  <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] p-2 text-center text-[#8A7B63] font-bold text-xs hidden lg:flex items-center justify-center min-h-[86px]">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
                ))}
              </div>
              {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
              {joined.isHost && pub!.players.length < MAX_PLAYERS && (
                <div className="mt-2">
                  <button className={`${BTN} btn-dark w-full`} onClick={() => getNet().nightAction('addBot')}>🤖 {d.addBot}</button>
                  <p className="font-bold text-[#8A7B63] text-sm text-center mt-1.5">{d.botHint}</p>
                </div>
              )}
              {joined.isHost ? (
                <>
                  <button className={`${BTN} btn-amber w-full mt-4`} disabled={connected < MIN_PLAYERS}
                    onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                  {connected < MIN_PLAYERS && <p className="text-center font-bold text-red-600 text-sm mt-2">{d.need2}</p>}
                </>
              ) : (
                <p className="text-center font-bold text-[#8A7B63] mt-4">{d.waiting}</p>
              )}
              <button className={`${BTN} bg-[#FFFBef] text-[#D63A2F] w-full mt-3`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>🚪 {d.leave}</button>
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'playing' && pub && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div className="min-w-0">
              {/* One-card warning (design Uno3): stays until I tap "Đã hiểu" */}
              {pub.unoPending && pub.unoPending !== joined.playerId && ackOneCard !== `${pub.unoPending}:${pub.round}` && (
                <NoticeBanner
                  text={d.oneCardBanner(unoPendingPlayer?.name ?? '')}
                  ackLabel={d.gotIt} onAck={() => setAckOneCard(`${pub.unoPending}:${pub.round}`)} tone="red" />
              )}
              {/* opponents */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {others.map(p => (
                  <div key={p.id} className={`flex-none flex items-center gap-2 rounded-2xl px-2.5 py-1.5 hard-xs ${pub.turn === p.id ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                    <span className="relative flex-none">
                      <PlayerAvatar avatarId={p.avatar} size={40} fallback={<MouseAvatar seed={p.id} size={40} state="awake" />} />
                      {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-extrabold text-sm truncate text-[#2B2016] max-w-[84px]">{p.name}{!p.connected ? ` (${d.offline})` : ''}{(p as any).isBot ? ' 🤖' : ''}</span>
                      <span className="block font-bold text-xs text-[#8A7B63]">🃏 {p.handCount} {d.cards}{p.handCount === 1 ? ' · UNO!' : ''}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* table */}
              <div className="mt-2 rounded-[28px] border-[3px] border-[#2B2016] hard p-4" style={{ background: '#14142B' }}>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="disp font-extrabold text-[#FFF3CF] text-lg">
                    {myTurn ? d.yourTurn : d.turnOf(turnPlayer?.name ?? '')}
                  </span>
                  <span className="text-[#FFF3CF] font-extrabold text-lg" title={pub.direction === 1 ? 'clockwise' : 'counter-clockwise'}>{pub.direction === 1 ? '⟳' : '⟲'}</span>
                  <TimerPill endsAt={pub.turnEndsAt} dark />
                </div>
                <p className="text-center font-bold text-[#BFE8D2] text-xs mt-1">{d.turnTimer} — {d.turnTimeout}</p>
                <div className="flex items-start justify-center gap-4 sm:gap-8 mt-3">
                  <button data-testid="draw-pile" disabled={!canDraw || optDrew} onClick={doDraw} className="text-center disabled:opacity-60">
                    <UnoCardBack size="lg" />
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1.5">{d.drawPile} · {pub.deckCount}</span>
                    <span className="block font-bold text-[#BFE8D2] text-xs mt-0.5">{optDrew && !pub.turnDrawn ? '…' : canDraw ? d.draw : pub.turnDrawn ? (drawnIsPlayable ? d.drawnPlayable : d.drawnNotPlayable) : ''}</span>
                  </button>
                  <div className="text-center">
                    {pub.topCard ? <UnoCardFace card={pub.topCard} size="lg" /> : <UnoCardBack size="lg" />}
                    <span className="mt-1.5 flex items-center justify-center gap-1.5 font-extrabold text-[#FFF3CF] text-sm">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-white" style={{ background: CARD_COLORS[pub.currentColor] }} />
                      {d.currentColor}: {colorLabel(pub.currentColor)}
                    </span>
                    <span className="block font-bold text-[#BFE8D2] text-xs mt-0.5">{d.discardPile} · {pub.discardCount}</span>
                  </div>
                </div>

                {/* +4 decision (only the challenged player sees the buttons) */}
                {pub.pendingDraw4 && pub.turn === joined.playerId && (
                  <div className="mt-3 bg-[#FFFBef] rounded-2xl p-3 text-center hard-sm">
                    <div className="disp font-extrabold text-lg text-[#D63A2F]">{d.draw4Title(draw4Player?.name ?? '')}</div>
                    <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.draw4Prompt}</p>
                    <div className="flex gap-2 mt-3">
                      <button data-testid="take-4" className={`${BTN} btn-dark flex-1 !py-2.5`} onClick={doTakeDraw4}>{d.take4}</button>
                      <button data-testid="challenge-btn" className={`${BTN} btn-amber flex-1 !py-2.5`} onClick={doChallenge}>{d.challenge}</button>
                    </div>
                  </div>
                )}
                {pub.pendingDraw4 && pub.turn !== joined.playerId && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">{d.draw4Title(draw4Player?.name ?? '')} — {d.turnOf(turnPlayer?.name ?? '')}</p>
                )}
                {/* first-card wild: I pick the starting color */}
                {pub.colorPickPending === joined.playerId && (
                  <div className="mt-3 bg-[#FFFBef] rounded-2xl p-3 text-center hard-sm">
                    <div className="disp font-extrabold">{d.pickColorFirst}</div>
                    <div className="flex justify-center gap-2 mt-2">
                      {COLORS.map(c => (
                        <button key={c} data-testid="color-pick-first" data-color={c} onClick={() => doPickColor(c)} className="w-12 h-12 rounded-2xl border-[3px] border-[#2B2016] push font-extrabold text-white text-lg" style={{ background: CARD_COLORS[c] }} title={colorLabel(c)}>{c === 'red' ? '🔴' : c === 'yellow' ? '🟡' : c === 'green' ? '🟢' : '🔵'}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Detail bar (design v47): hovered card's ability on line 1,
               *  the special-card legend on line 2 — sits above the fan. */}
              <div className="mt-2 bg-[#221D45] border-2 border-[#F5B02E] rounded-2xl px-3 py-2 font-bold leading-snug text-[#FFF3CF]">
                <p className="text-[13px]">{hoverCard ? d.cardAb(hoverCard.kind, unoLabel(hoverCard)) : pub.topCard ? d.topHint(unoLabel(pub.topCard)) : ''}</p>
                <p className="text-xs text-[#B9BCE0] mt-0.5">{d.cardLegend}</p>
              </div>

              {/* UNO row */}
              {pub.unoPending && (
                <div className="mt-2">
                  {pub.unoPending === joined.playerId ? (
                    <button data-testid="uno-btn" className="w-full disp px-5 py-3 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-xl animate-pulse" onClick={doCallUno}>📣 {d.unoBtn}</button>
                  ) : (
                    <div className="bg-[#FBE3E0] border-2 border-[#D63A2F] rounded-2xl px-3 py-2 flex items-center gap-2">
                      <span className="font-bold text-sm flex-1 text-[#7A1F18]">{d.unoPendingNote(unoPendingPlayer?.name ?? '')}</span>
                      <button data-testid="catch-uno-btn" className="disp px-4 py-2 rounded-xl font-extrabold hard push bg-[#D63A2F] text-white text-sm" onClick={() => doCatchUno(pub.unoPending!)}>{d.catchUno}</button>
                    </div>
                  )}
                </div>
              )}
              {priv?.drawnCardId && myTurn && (
                <div className="mt-2 flex gap-2">
                  <div className="flex-1 bg-[#FFFBef] border-2 border-[#FFB020] rounded-2xl px-3 py-2 font-bold text-sm text-[#7A5A00]">{drawnIsPlayable ? `✨ ${d.drawnPlayable}` : d.drawnNotPlayable}</div>
                  <button data-testid="pass-btn" className={`${BTN} btn-dark !py-2`} onClick={doPass}>{d.pass}</button>
                </div>
              )}

              {/* my hand — curved fan (design v47): cards overlap and rotate
               *  around a pivot below the hand; hovering lifts a card and
               *  shows its ability in the detail bar above. Tap still plays
               *  at once (no extra tap). */}
              <div className="mt-2">
                <div ref={fanRef} className="relative" style={{ height: fanFrameH(myHand.length, 110, 1.6) }}>
                  <div className="absolute inset-x-0 flex justify-center" style={{ top: 36 }}>
                    {myHand.map((c, hi) => {
                      const playable = canPlay(c);
                      const isDrawn = c.id === priv?.drawnCardId;
                      const hovered = hoverCardId === c.id && playable;
                      const L = fan[hi];
                      const ty = hovered ? -24 : L.ty;
                      const rot = hovered ? 0 : L.rot;
                      const sc = hovered ? 1.06 : 1;
                      const z = hovered ? 80 : L.z;
                      return (
                        <span key={c.id} className="flex-none" style={{ marginLeft: L.ml, transform: `translateY(${ty}px) rotate(${rot}deg) scale(${sc})`, transformOrigin: '50% 130%', zIndex: z, position: 'relative', transition: 'transform .25s cubic-bezier(.2,.8,.2,1)' }}>
                        <button data-testid="hand-card" data-card-id={c.id} disabled={!playable || optPlayed === c.id}
                          onMouseEnter={() => setHoverCardId(c.id)} onMouseLeave={() => setHoverCardId(null)}
                          onClick={() => doPlay(c)}
                          className={`flex-none rounded-xl ${playable ? 'cursor-pointer' : 'opacity-40 cursor-default'} ${isDrawn ? 'ring-4 ring-[#FFB020]' : ''} ${optPlayed === c.id ? 'opacity-30 scale-90 pointer-events-none' : ''}`}>
                          <UnoCardFace card={c} size="lg" />
                        </button>
                        </span>
                      );
                    })}
                    {myHand.length === 0 && <p className="font-bold text-[#B9BCE0] py-6">…</p>}
                  </div>
                </div>
              </div>
              {chatPreviewBar}
            </div>
            {chatAside}
          </div>
        )}

        {phase === 'results' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto text-center">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.results.toUpperCase()}</p>
            <h2 className="disp font-extrabold text-4xl mt-2">{playerName(pub.winner)} {d.winner}</h2>
            <p className="text-[#B9BCE0] font-bold mt-1">{d.winnerSub(pub.roundPoints)}</p>
            <div className="card-cream !rounded-[28px] p-4 mt-4 text-left text-[#2B2016]">
              <div className="disp font-extrabold text-lg">{d.standings}</div>
              <div className="mt-2 space-y-1.5">
                {[...pub.players].sort((a, b) => b.points - a.points || b.wins - a.wins).map(p => (
                  <div key={p.id} className="flex items-center gap-2 font-bold">
                    <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state="awake" />} /></span>
                    <span className="flex-1 truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}{p.id === pub.winner ? ' 👑' : ''}</span>
                    <span className="text-sm">🏆 {p.wins} · ⭐ {p.points} {d.points}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-[#DFF5E3] rounded-2xl px-3 py-2 font-bold text-sm text-[#2B2016]">
                📊 {d.recordTitle}: {d.recordLine(myRecord.w, myRecord.l, myRecord.points)}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className={`${BTN} btn-amber flex-1`} onClick={doShare}>📋 {shareCopied ? d.copied : d.shareResults}</button>
            </div>
            {joined.isHost ? (
              <div className="flex gap-2 mt-2">
                <button className={`${BTN} btn-green flex-1`} onClick={() => getNet().startGame()}>▶ {d.playAgain}</button>
                <button className={`${BTN} bg-[#FFFBef] text-[#2B2016] flex-1`} onClick={() => getNet().playAgain()}>{d.backLobby}</button>
              </div>
            ) : (
              <p className="text-center font-bold text-[#B9BCE0] mt-4">{d.waiting}</p>
            )}
          </div>
        )}

        {/* color picker modal (wild / wild4 in hand) */}
        {wildPick && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setWildPick(null)}>
            <div className={`${CARD} max-w-xs w-full text-center`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-xl">{d.pickColor}</div>
              <div className="flex justify-center mt-3"><UnoCardFace card={wildPick} size="lg" /></div>
              {wildPick.kind === 'wild4' && <p className="font-bold text-sm text-[#5C4B33] mt-2">{d.wild4Note}</p>}
              <div className="grid grid-cols-2 gap-2 mt-4">
                {COLORS.map(c => (
                  <button key={c} data-testid="color-pick" data-color={c} onClick={() => doPlay(wildPick, c)}
                    className="disp px-4 py-3 rounded-2xl font-extrabold hard push text-white text-lg border-[3px] border-[#2B2016]"
                    style={{ background: CARD_COLORS[c] }}>{colorLabel(c)}</button>
                ))}
              </div>
              <button className="font-bold text-sm text-[#8A7B63] underline mt-3" onClick={() => setWildPick(null)}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
            </div>
          </div>
        )}
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub?.chat ?? []} myId={joined.playerId} d={d} onChat={onChat} reactions={UNO_REACTIONS} />
      </div>
    </div>
  );
}
