import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview, RetryDefaultButton } from '../../platform/ui';
import { MouseAvatar } from '../../platform/avatars';
import { PlayerAvatar } from '../../platform/GameCard';
import { legalPlays, MIN_PLAYERS, MAX_PLAYERS, GUESSABLE, CARD_VALUE, tokensFor } from '../../../../games/love-letter/logic';
import type { Card, CardKind } from '../../../../games/love-letter/logic';

const SESSION_KEY = 'ct_guest_session:love-letter';
const LL_REACTIONS = ['💌', '😱', '🙏', '🤔', '👍', '👸', '👑', '🎉'];

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

/* ---------- Love Letter cards (CSS art, same chunky style as the platform).
 *  Card names stay in English — they are the original game's names. ---------- */
const CARD_COLORS: Record<CardKind, string> = {
  spy: '#78716C', guard: '#6B7280', priest: '#2E7CD6', baron: '#E07B39', handmaid: '#0E9F6E',
  prince: '#5B5BD6', chancellor: '#0E7490', king: '#C99327', countess: '#C0397A', princess: '#D63A6B',
};
const CARD_NAMES: Record<CardKind, string> = {
  spy: 'Spy', guard: 'Guard', priest: 'Priest', baron: 'Baron', handmaid: 'Handmaid',
  prince: 'Prince', chancellor: 'Chancellor', king: 'King', countess: 'Countess', princess: 'Princess',
};
const CARD_EFFECTS = (d: any): Record<CardKind, string> => ({
  spy: d.effSpy, guard: d.effGuard, priest: d.effPriest, baron: d.effBaron, handmaid: d.effHandmaid,
  prince: d.effPrince, chancellor: d.effChancellor, king: d.effKing, countess: d.effCountess, princess: d.effPrincess,
});
function LLCardFace({ card, d, size = 'md' }: { card: Card; d: any; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[92px] h-[134px]' : size === 'sm' ? 'w-[46px] h-[66px]' : 'w-[76px] h-[112px]';
  const val = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-4xl' : 'text-3xl';
  const nm = size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-base' : 'text-[13px]';
  const eff = CARD_EFFECTS(d)[card.kind];
  return (
    <span className={`relative inline-flex flex-none flex-col items-center rounded-xl border-[3px] border-[#2B2016] overflow-hidden ${box}`} style={{ background: CARD_COLORS[card.kind] }}>
      <span className="absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-[46%] bg-white/90 rounded-[50%] rotate-[-24deg]" />
      <span className={`relative disp font-extrabold ${val} leading-none mt-1.5 text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]`}>{card.value}</span>
      <span className={`relative disp font-extrabold ${nm} leading-tight text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.35)] px-1 text-center`}>{CARD_NAMES[card.kind]}</span>
      {size !== 'sm' && (
        <span className="relative mt-auto mb-1.5 mx-1.5 rounded-lg bg-white/95 px-1.5 py-1 text-[9px] leading-[1.15] font-bold text-[#2B2016] text-center">{eff}</span>
      )}
    </span>
  );
}
function LLCardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[92px] h-[134px]' : size === 'sm' ? 'w-[46px] h-[66px]' : 'w-[76px] h-[112px]';
  return (
    <span className={`relative inline-flex flex-none items-center justify-center rounded-xl border-[3px] border-[#2B2016] ${box}`} style={{ background: '#D63A6B' }}>
      <span className="absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-[46%] bg-white/90 rounded-[50%] rotate-[-24deg]" />
      <span className="relative disp font-extrabold text-2xl">💌</span>
    </span>
  );
}
/** A tiny value chip for a face-up discard pile. */
function DiscardChips({ pile }: { pile: Card[] }) {
  if (!pile.length) return <span className="font-bold text-xs text-[#8A7B63]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {pile.map((c, i) => (
        <span key={c.id + '-' + i} className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-md border border-[#2B2016] text-[10px] font-extrabold text-white" style={{ background: CARD_COLORS[c.kind] }} title={CARD_NAMES[c.kind]}>{c.value}</span>
      ))}
    </span>
  );
}

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">💌 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <div className="grid grid-cols-5 gap-1.5 mt-4">
          {(Object.keys(CARD_NAMES) as CardKind[]).map(k => (
            <LLCardFace key={k} card={{ id: k, kind: k, value: CARD_VALUE[k] }} d={d} size="sm" />
          ))}
        </div>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

export default function LoveLetterApp() {
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
  const [myRecord, setMyRecord] = useState<{ w: number; l: number; tokens: number }>({ w: 0, l: 0, tokens: 0 });
  const [shareCopied, setShareCopied] = useState(false);
  // Target/guess picker for the open card effect (mine only).
  const [pickOpen, setPickOpen] = useState(false);
  // Chancellor keep-one picker (mine only).
  const [chancellorOpen, setChancellorOpen] = useState(false);
  const [keepPick, setKeepPick] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  const [pickGuess, setPickGuess] = useState<CardKind | null>(null);
  // Priest peek modal: shown once per new peek.
  const [peekOpen, setPeekOpen] = useState(false);
  const peekKeyRef = useRef('');
  // Optimistic UI: the played card fades out at once (6s fallback).
  const [optPlayed, setOptPlayed] = useState<string | null>(null);
  useEffect(() => { if (!optPlayed) return; const t = setTimeout(() => setOptPlayed(null), 6000); return () => clearTimeout(t); }, [optPlayed]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
  useEffect(() => { setOptPlayed(null); setPickOpen(false); setPickTarget(null); setPickGuess(null); setChancellorOpen(false); setKeepPick(null); }, [pub?.phase]);
  useEffect(() => {
    if (optPlayed && priv && !priv.myHand.some(c => c.id === optPlayed)) setOptPlayed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub, priv]);
  const recordedSession = useRef(false);
  const netRef = useRef<Net | null>(null);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const autoVoiceRef = useRef('');
  const voiceOptOutRef = useRef(false);
  const phase = pub?.phase ?? 'lobby';
  const toggleGuard = useRef(0);

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
      }, 'love-letter');
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
    if (pub.phase === 'results' && prevPub.current?.phase !== 'results' && !recordedSession.current) {
      recordedSession.current = true;
      const won = pub.sessionWinner === joined.playerId;
      const myTokens = pub.players.find(p => p.id === joined.playerId)?.tokens ?? 0;
      setMyRecord(r => ({ w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1), tokens: myTokens }));
      sfx(won ? 'win' : 'lose', muted);
    }
    if (pub.phase === 'lobby') recordedSession.current = false;
    prevPub.current = { phase: pub.phase };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub]);

  // A soft chime when my turn starts.
  const prevTurn = useRef<string | null>(null);
  useEffect(() => {
    if (pub?.phase === 'playing' && pub.turn === joined?.playerId && prevTurn.current !== joined?.playerId) sfx('pop', muted);
    prevTurn.current = pub?.turn ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.turn, pub?.phase]);

  // Auto-open the target picker when an effect of mine opens; show the
  // Priest peek modal once per new peek.
  const myPending = pub?.phase === 'playing' && pub.pendingAction?.actorId === joined?.playerId ? pub.pendingAction : null;
  useEffect(() => { if (myPending && myPending.type !== 'chancellor') setPickOpen(true); }, [myPending?.type, myPending?.actorId]);
  useEffect(() => { if (myPending?.type === 'chancellor') setChancellorOpen(true); }, [myPending?.type, myPending?.actorId]);
  useEffect(() => {
    const seen = priv?.mySeen;
    if (!seen) return;
    const key = seen.targetId + ':' + seen.card.id;
    if (peekKeyRef.current !== key) { peekKeyRef.current = key; setPeekOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priv?.mySeen]);
  useEffect(() => { if (phase !== 'playing') setPeekOpen(false); }, [phase]);

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
      }, 'love-letter', getNet().getBrokerUrl?.());
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
  const myHand = priv?.myHand ?? [];
  // The engine enforces the Countess rule; the UI mirrors it so the
  // forced card is obvious before the tap.
  const playableIds = new Set(legalPlays({} as any, { hand: myHand } as any).map(c => c.id));
  const forcedCountess = myTurn && myHand.some(c => c.kind === 'countess') && myHand.some(c => c.kind === 'king' || c.kind === 'prince');
  const canPlay = (c: Card) => myTurn && !myPending && playableIds.has(c.id) && optPlayed !== c.id;
  const doPlay = (card: Card) => {
    setOptPlayed(card.id);
    getNet().nightAction('playCard', undefined, { cardId: card.id });
  };
  const validTargets = (pub?.players ?? []).filter(p => {
    if (!p.inRound || p.protected) return false;
    if (p.id === joined?.playerId) return myPending?.type === 'prince';
    return true;
  });
  const doChooseTarget = () => {
    if (!pickTarget) return;
    if (myPending?.type === 'guard' && !pickGuess) return;
    getNet().nightAction('chooseTarget', undefined, { targetId: pickTarget, ...(pickGuess ? { guess: pickGuess } : {}) });
    setPickOpen(false); setPickTarget(null); setPickGuess(null);
  };

  /* ---------- shared bits ---------- */
  const tone = phase === 'results' || phase === 'roundEnd' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';
  const others = pub?.players.filter(p => p.id !== joined?.playerId) ?? [];
  const turnPlayer = pub?.players.find(p => p.id === pub?.turn);
  const pendingActor = pub?.players.find(p => p.id === pub?.pendingAction?.actorId);
  const mySeen = priv?.mySeen ?? null;

  const lastPlayText = (): string | null => {
    const lp = pub?.lastPlay;
    if (!lp) return null;
    const by = playerName(lp.by);
    const cardName = CARD_NAMES[lp.card];
    const tgt = lp.targetId ? playerName(lp.targetId) : '';
    const guessName = lp.guess ? CARD_NAMES[lp.guess] : '';
    switch (lp.outcome) {
      case 'hit': return `${d.playedCard(by, cardName)} — ${d.guardHit(tgt, guessName)}`;
      case 'miss': return `${d.playedCard(by, cardName)} — ${d.guardMiss(tgt, guessName)}`;
      case 'peek': return `${d.playedCard(by, cardName)} — ${d.priestPeek(tgt)}`;
      case 'win': return `${d.playedCard(by, cardName)} — ${d.baronWin(tgt)}`;
      case 'lose': return `${d.playedCard(by, cardName)} — ${d.baronLose(tgt)}`;
      case 'tie': return `${d.playedCard(by, cardName)} — ${d.baronTie(tgt)}`;
      case 'trade': return `${d.playedCard(by, cardName)} — ${d.kingTrade(tgt)}`;
      case 'redraw': return `${d.playedCard(by, cardName)} — ${d.princeRedraw(tgt)}`;
      case 'chancellor': return `${d.playedCard(by, cardName)} — ${d.chancellorPlayed}`;
      case 'princess': return `${d.playedCard(by, cardName)} — ${d.princePrincess(tgt)}`;
      case 'no-target': return `${d.playedCard(by, cardName)} — ${d.noTarget}`;
      default: return d.playedNoEffect(by, cardName);
    }
  };

  const shareText = () => {
    const lines = [`💌 ${d.title} — ${playerName(pub?.sessionWinner)} ${d.winner}`];
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordLine(myRecord.w, myRecord.l, myRecord.tokens));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const chatAside = pub && phase === 'playing' && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined?.playerId ?? ''} d={d} height="flex" onChat={onChat} reactions={LL_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, LL_REACTIONS)}</span>
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
            <span className="rotate-[-18deg] translate-y-2"><LLCardFace card={{ id: 'fan-spy', kind: 'spy', value: 0 }} d={d} size="md" /></span>
            <span className="rotate-[-9deg] translate-y-1"><LLCardFace card={{ id: 'fan-guard', kind: 'guard', value: 1 }} d={d} size="md" /></span>
            <span className="z-10 -translate-y-1"><LLCardFace card={{ id: 'fan-princess', kind: 'princess', value: 9 }} d={d} size="md" /></span>
            <span className="rotate-[9deg] translate-y-1"><LLCardFace card={{ id: 'fan-chancellor', kind: 'chancellor', value: 6 }} d={d} size="md" /></span>
            <span className="rotate-[18deg] translate-y-2"><LLCardFace card={{ id: 'fan-king', kind: 'king', value: 7 }} d={d} size="md" /></span>
          </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] px-4 pt-4 pb-6 mt-5">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            {!joinMode && (<button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>💌 {d.create}</button>)}
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
        <TopBar logo={<span className="text-2xl">💌</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        {phase !== 'lobby' && (<button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>)}
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {migrating && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">🔄 {d.statusMigrating}</div>}
        {error && <><div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div><RetryDefaultButton d={d} /></>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs push font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-xl sm:text-2xl leading-none">💌 {d.title} · {d.lobby}</h2>
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
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=love-letter&room=${pub!.roomCode}`); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}>{linkCopied ? `✅ ${d.copied}` : `🔗 ${d.copyLink}`}</button>
            </div>
            <div className="mt-4 card-cream p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                <span className="font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS} · {d.needAtLeast(MIN_PLAYERS)}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 my-3">
                {pub!.players.map(p => (
                  <div key={p.id} className={`rounded-2xl p-2 text-center hard-xs ${p.id === joined.playerId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                    <span className="mx-auto block w-fit"><PlayerAvatar avatarId={p.avatar} size={48} fallback={<MouseAvatar seed={p.id} size={48} state="awake" />} /></span>
                    <span className="block font-bold truncate text-sm mt-0.5 text-[#2B2016]">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                    {p.isBot && <span className="text-xs font-extrabold bg-[#23233F] text-[#FFB020] rounded-full px-2 py-0.5 mt-0.5 inline-block">🤖 {d.botTag}</span>}
                    {p.isHost && <span className="block text-amber-600 text-xs font-extrabold leading-tight">👑 {d.host}</span>}
                    {!p.connected && <span className="text-red-500 text-xs font-bold"> • {d.offline}</span>}
                    {joined.isHost && p.id !== joined.playerId && (
                      <span role="button" title={p.isBot ? d.removeBot : d.kick}
                        onClick={() => { if (p.isBot) getNet().nightAction('removeBot', p.id); else getNet().kick(p.id); }}
                        className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 mt-1 cursor-pointer hover:bg-red-200">✖ {p.isBot ? d.removeBot : d.kick}</span>)}
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 6 - pub!.players.length) }).map((_, i) => (
                  <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] p-2 text-center text-[#8A7B63] font-bold text-xs hidden lg:flex items-center justify-center min-h-[86px]">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
                ))}
              </div>
              {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
              {joined.isHost && (
                <div className="mt-2 space-y-3">
                  <div>
                    <div className="disp font-extrabold text-sm mb-1">{d.turnTime}</div>
                    <div className="flex gap-1.5">
                      {[30, 60, 90].map(v => (
                        <button key={v} data-testid="pill-turnSeconds" data-val={String(v)}
                          onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('setConfig', undefined, { config: { turnSeconds: v } }); }}
                          className={`flex-1 px-1 py-2 min-h-[44px] rounded-full border-2 font-extrabold text-sm push ${pub!.config.turnSeconds === v ? 'bg-[#FFB020] border-[#2B2016] text-[#2B2016]' : 'bg-white border-[#C9BFA5] text-[#5C4B33]'}`}>{d.secondsUnit(v)}</button>
                      ))}
                    </div>
                  </div>
                  <button data-testid="toggle-quickMode" aria-pressed={pub!.config.quickMode}
                    onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('setConfig', undefined, { config: { quickMode: !pub!.config.quickMode } }); }}
                    className="w-full flex items-center gap-2 text-left">
                    <span className={`w-12 h-7 rounded-full border-2 border-[#2B2016] relative transition-colors block flex-none ${pub!.config.quickMode ? 'bg-[#0E9F6E]' : 'bg-[#C9BFA5]'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white border-2 border-[#2B2016] transition-all ${pub!.config.quickMode ? 'left-6' : 'left-0.5'}`} />
                    </span>
                    <span>
                      <span className="disp font-extrabold text-sm block">⚡ {d.quickMode}</span>
                      <span className="font-bold text-xs text-[#8A7B63] block">{d.quickModeHint}</span>
                    </span>
                  </button>
                  <p className="font-bold text-sm text-[#5C4B33]">{d.tokensToWin(tokensFor(connected, pub!.config.quickMode))}</p>
                </div>
              )}
              {!joined.isHost && (
                <p className="font-bold text-sm text-[#5C4B33] mt-2">🕐 {d.secondsUnit(pub!.config.turnSeconds)} · {pub!.config.quickMode ? `⚡ ${d.quickMode} — ` : ''}{d.tokensToWin(tokensFor(connected, pub!.config.quickMode))}</p>
              )}
              {joined.isHost && pub!.players.length < MAX_PLAYERS && (
                <div className="mt-2">
                  <button className={`${BTN} btn-dark w-full`} onClick={() => { const n = Date.now(); if (n - toggleGuard.current < 500) return; toggleGuard.current = n; getNet().nightAction('addBot'); }}>🤖 {d.addBot}</button>
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
              {/* opponents */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {others.map(p => (
                  <div key={p.id} className={`flex-none rounded-2xl px-2.5 py-1.5 hard-xs min-w-[132px] ${pub.turn === p.id ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <span className="relative flex-none">
                        <PlayerAvatar avatarId={p.avatar} size={40} fallback={<MouseAvatar seed={p.id} size={40} state={p.inRound ? 'awake' : 'dead'} />} />
                        {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-extrabold text-sm truncate text-[#2B2016] max-w-[84px]">{p.name}{p.isBot ? ' 🤖' : ''}{!p.connected ? ` (${d.offline})` : ''}</span>
                        <span className="block font-bold text-xs text-[#8A7B63]">🃏 {p.handCount} · ❤ {p.tokens}{p.protected ? ' · 🛡️' : ''}{!p.inRound ? ` · ${d.out}` : ''}</span>
                      </span>
                    </div>
                    <div className="mt-1"><DiscardChips pile={p.discardPile} /></div>
                  </div>
                ))}
              </div>

              {/* table */}
              <div className="mt-2 rounded-[28px] border-[3px] border-[#2B2016] hard p-4" style={{ background: '#7C2D4E' }}>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="disp font-extrabold text-[#FFF3CF] text-lg">
                    {myTurn ? d.yourTurn : d.turnOf(turnPlayer?.name ?? '')}
                  </span>
                  <TimerPill endsAt={pub.turnEndsAt} dark />
                </div>
                <p className="text-center font-bold text-[#F3C6D8] text-xs mt-1">{d.turnTimeout}</p>
                <div className="flex items-start justify-center gap-4 sm:gap-8 mt-3">
                  <button data-testid="draw-pile" className="text-center" onClick={() => { /* draw is automatic at turn start */ }}>
                    <LLCardBack size="lg" />
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1.5">{d.drawPile} · {pub.deckCount}</span>
                  </button>
                  <div className="text-center">
                    {pub.setAsidePresent ? <LLCardBack size="lg" /> : <span className="inline-flex w-[92px] h-[134px] items-center justify-center rounded-xl border-[3px] border-dashed border-[#F3C6D8]/60 text-[#F3C6D8] font-bold text-xs text-center px-2">—</span>}
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1.5">{d.setAside}</span>
                    <span className="block font-bold text-[#F3C6D8] text-xs mt-0.5">{pub.setAsidePresent ? '' : '✓'}</span>
                  </div>
                </div>
                {pub.faceUpRemoved.length > 0 && (
                  <div className="mt-3 text-center">
                    <span className="font-bold text-[#F3C6D8] text-xs">{d.removedFaceUp}: </span>
                    <span className="inline-flex gap-1 align-middle">
                      {pub.faceUpRemoved.map(c => <LLCardFace key={c.id} card={c} d={d} size="sm" />)}
                    </span>
                  </div>
                )}
                {pub.pendingAction && pub.pendingAction.actorId !== joined.playerId && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">🎯 {d.turnOf(pendingActor?.name ?? '')}</p>
                )}
                {myPending && myPending.type === 'chancellor' && !chancellorOpen && (
                  <button data-testid="reopen-chancellor" className="mt-3 w-full disp px-5 py-3 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-lg animate-pulse" onClick={() => setChancellorOpen(true)}>🎩 {d.chancellorTitle}</button>
                )}
                {myPending && myPending.type !== 'chancellor' && !pickOpen && (
                  <button data-testid="reopen-pick" className="mt-3 w-full disp px-5 py-3 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-lg animate-pulse" onClick={() => setPickOpen(true)}>🎯 {d.chooseTarget}</button>
                )}
              </div>

              {/* last play banner */}
              {lastPlayText() && (
                <div className="mt-2 bg-[#FFFBef] border-2 border-[#E5DCC0] rounded-2xl px-3 py-2 font-bold text-sm text-[#5C4B33]">📜 {lastPlayText()}</div>
              )}
              {/* my peek memory (private) */}
              {mySeen && (
                <div className="mt-2 bg-[#EAF3FF] border-2 border-[#2E7CD6] rounded-2xl px-3 py-2 font-bold text-sm text-[#1D4E8A]">
                  👀 {d.peekChip(playerName(mySeen.targetId))}: {CARD_NAMES[mySeen.card.kind]} ({mySeen.card.value})
                </div>
              )}

              {/* my hand */}
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="disp font-extrabold text-lg">{d.myHand} · {myHand.length} {d.cards}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">❤ {me?.tokens ?? 0} / {pub.tokensToWin}</span>
                </div>
                {forcedCountess && <p className="font-bold text-sm text-[#C0397A] mt-1">⚠ {d.forcedCountess}</p>}
                <div className="flex gap-2 overflow-x-auto pb-2 pt-2 -mx-1 px-1">
                  {myHand.map((c, hi) => {
                    const playable = canPlay(c);
                    return (
                      <span key={c.id} className="flex-none anim-card-fall" style={{ animationDelay: `${hi * 45}ms` }}>
                      <button data-testid="hand-card" data-card-id={c.id} disabled={!playable} onClick={() => doPlay(c)}
                        className={`flex-none rounded-xl transition ${playable ? 'hover:-translate-y-2 cursor-pointer' : 'opacity-40 cursor-default'} ${optPlayed === c.id ? 'opacity-30 scale-90 pointer-events-none' : ''}`}>
                        <LLCardFace card={c} d={d} size="md" />
                      </button>
                      </span>
                    );
                  })}
                  {myHand.length === 0 && <p className="font-bold text-[#8A7B63] py-6">…</p>}
                </div>
                <p className="font-bold text-[#8A7B63] text-sm">{d.playHint}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-bold text-sm text-[#5C4B33] flex-none">{d.myDiscards}:</span>
                  <span className="overflow-x-auto"><DiscardChips pile={me?.discardPile ?? []} /></span>
                </div>
              </div>
              {chatPreviewBar}
            </div>
            {chatAside}
          </div>
        )}

        {phase === 'roundEnd' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto text-center">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.roundEndTitle.toUpperCase()} · {lang === 'vi' ? `Vòng ${pub.round}` : `Round ${pub.round}`}</p>
            <h2 className="disp font-extrabold text-3xl mt-2">
              {pub.roundWinners.length === 1 ? d.roundWinner(playerName(pub.roundWinners[0])) : d.roundWinners(pub.roundWinners.map(playerName).join(', '))}
            </h2>
            <p className="text-[#B9BCE0] font-bold mt-1">
              {pub.roundResult?.reason === 'last-standing' ? d.reasonLast
                : pub.roundResult?.reason === 'showdown' ? d.reasonShowdown
                : d.reasonTie}
              {' '}{pub.roundWinners.map(id => `${playerName(id)} ${d.tokensEarned(1)}`).join(', ')}
            </p>
            {pub.roundResult?.spyFavorId && (
              <p className="text-[#FFB020] font-bold mt-1">🕵️ {d.spyFavor(playerName(pub.roundResult.spyFavorId))}</p>
            )}
            {pub.roundResult?.hands && (
              <div className="card-cream !rounded-[28px] p-4 mt-4 text-left text-[#2B2016]">
                <div className="disp font-extrabold text-lg">{d.revealedHands}</div>
                <div className="flex gap-3 mt-2 flex-wrap justify-center">
                  {Object.entries(pub.roundResult.hands).map(([pid, card]) => (
                    <div key={pid} className="text-center">
                      <LLCardFace card={card} d={d} size="md" />
                      <div className="font-bold text-sm mt-1">{playerName(pid)}{pub.roundWinners.includes(pid) ? ' 👑' : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card-cream !rounded-[28px] p-4 mt-4 text-left text-[#2B2016]">
              <div className="disp font-extrabold text-lg">{d.standings}</div>
              <div className="mt-2 space-y-1.5">
                {[...pub.players].sort((a, b) => b.tokens - a.tokens || b.roundWins - a.roundWins).map(p => (
                  <div key={p.id} className="flex items-center gap-2 font-bold">
                    <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state="awake" />} /></span>
                    <span className="flex-1 truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                    <span className="text-sm">❤ {p.tokens} / {pub.tokensToWin} · 🏆 {p.roundWins}</span>
                  </div>
                ))}
              </div>
              <p className="font-bold text-sm text-[#8A7B63] mt-2">{d.winnerGoesFirst(playerName(pub.roundWinners[0]))}</p>
            </div>
            {joined.isHost ? (
              <button data-testid="next-round" className={`${BTN} btn-amber w-full mt-4`} onClick={() => getNet().nightAction('nextRound')}>▶ {d.nextRound}</button>
            ) : (
              <p className="text-center font-bold text-[#B9BCE0] mt-4">{d.waiting}</p>
            )}
          </div>
        )}

        {phase === 'results' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto text-center">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.results.toUpperCase()}</p>
            <h2 className="disp font-extrabold text-4xl mt-2">{playerName(pub.sessionWinner)} {d.winner}</h2>
            <p className="text-[#B9BCE0] font-bold mt-1">{d.winnerSub(pub.tokensToWin)}</p>
            <div className="card-cream !rounded-[28px] p-4 mt-4 text-left text-[#2B2016]">
              <div className="disp font-extrabold text-lg">{d.standings}</div>
              <div className="mt-2 space-y-1.5">
                {[...pub.players].sort((a, b) => b.tokens - a.tokens || b.roundWins - a.roundWins).map(p => (
                  <div key={p.id} className="flex items-center gap-2 font-bold">
                    <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state="awake" />} /></span>
                    <span className="flex-1 truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}{p.id === pub.sessionWinner ? ' 👑' : ''}</span>
                    <span className="text-sm">❤ {p.tokens} · 🏆 {p.roundWins} {d.wins}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-[#DFF5E3] rounded-2xl px-3 py-2 font-bold text-sm text-[#2B2016]">
                📊 {d.recordTitle}: {d.recordLine(myRecord.w, myRecord.l, myRecord.tokens)}
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

        {/* target + guess picker modal (my open effect) */}
        {myPending && myPending.type !== 'chancellor' && pickOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPickOpen(false)}>
            <div className={`${CARD} max-w-sm w-full text-center max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-xl">🎯 {d.chooseTarget}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">
                {myPending.type === 'guard' ? `${CARD_NAMES.guard} — ${d.effGuard}`
                  : myPending.type === 'priest' ? `${CARD_NAMES.priest} — ${d.effPriest}`
                  : myPending.type === 'baron' ? `${CARD_NAMES.baron} — ${d.effBaron}`
                  : myPending.type === 'king' ? `${CARD_NAMES.king} — ${d.effKing}`
                  : `${CARD_NAMES.prince} — ${d.effPrince}`}
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {validTargets.map(p => (
                  <button key={p.id} data-testid="pick-target" data-player-id={p.id}
                    onClick={() => setPickTarget(p.id)}
                    className={`disp px-4 py-2.5 rounded-2xl font-extrabold hard push text-sm ${pickTarget === p.id ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-white text-[#2B2016]'}`}>
                    {p.name}{p.id === joined.playerId ? ` (${d.you})` : ''} · 🃏 {p.handCount}
                  </button>
                ))}
              </div>
              {myPending.type === 'guard' && (
                <>
                  <div className="disp font-extrabold text-lg mt-4">{d.chooseGuess}</div>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {GUESSABLE.map(k => (
                      <button key={k} data-testid="pick-guess" data-card-kind={k}
                        onClick={() => setPickGuess(k)}
                        className={`rounded-xl border-[3px] py-2 font-extrabold text-sm push ${pickGuess === k ? 'border-[#FFB020] bg-[#FFB020] text-[#2B2016]' : 'border-[#2B2016] text-white'}`}
                        style={{ background: pickGuess === k ? undefined : CARD_COLORS[k] }}>
                        {k === 'spy' ? '🕵️' : k === 'priest' ? '⛪' : k === 'baron' ? '⚖️' : k === 'handmaid' ? '🌸' : k === 'prince' ? '🤴' : k === 'chancellor' ? '🎩' : k === 'king' ? '👑' : k === 'countess' ? '👸' : '💌'} {CARD_VALUE[k]} · {CARD_NAMES[k]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button data-testid="pick-confirm" className={`${BTN} btn-amber w-full mt-4`} disabled={!pickTarget || (myPending.type === 'guard' && !pickGuess)} onClick={doChooseTarget}>{d.confirmTarget}</button>
              <button className="font-bold text-sm text-[#8A7B63] underline mt-3" onClick={() => setPickOpen(false)}>{d.cancelPick}</button>
            </div>
          </div>
        )}
        {/* Chancellor keep-one modal (my open effect) */}
        {myPending && myPending.type === 'chancellor' && chancellorOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setChancellorOpen(false)}>
            <div className={`${CARD} max-w-sm w-full text-center max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-xl">🎩 {d.chancellorTitle}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.chancellorHint}</p>
              <div className="flex justify-center gap-2 mt-3 flex-wrap">
                {myHand.map(c => (
                  <button key={c.id} data-testid="chancellor-keep-pick" data-card-id={c.id}
                    onClick={() => setKeepPick(c.id)}
                    className={`rounded-xl push transition ${keepPick === c.id ? 'ring-4 ring-[#FFB020] -translate-y-1' : ''}`}>
                    <LLCardFace card={c} d={d} size="md" />
                  </button>
                ))}
              </div>
              <button data-testid="chancellor-keep" className={`${BTN} btn-amber w-full mt-4`} disabled={!keepPick}
                onClick={() => { if (!keepPick) return; getNet().nightAction('resolveChancellor', undefined, { keepCardId: keepPick }); setChancellorOpen(false); setKeepPick(null); }}>{d.chancellorKeep}</button>
              <button className="font-bold text-sm text-[#8A7B63] underline mt-3" onClick={() => setChancellorOpen(false)}>{d.cancelPick}</button>
            </div>
          </div>
        )}
        {/* Priest peek modal (private) */}
        {peekOpen && mySeen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPeekOpen(false)}>
            <div className={`${CARD} max-w-xs w-full text-center`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-xl">👀 {d.peekTitle}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.peekText(playerName(mySeen.targetId))}</p>
              <div className="flex justify-center mt-3"><LLCardFace card={mySeen.card} d={d} size="lg" /></div>
              <p className="font-bold text-xs text-[#8A7B63] mt-2">{d.peekNote}</p>
              <button className={`${BTN} btn-amber w-full mt-3`} onClick={() => setPeekOpen(false)}>OK 👍</button>
            </div>
          </div>
        )}
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub?.chat ?? []} myId={joined.playerId} d={d} onChat={onChat} reactions={LL_REACTIONS} />
      </div>
    </div>
  );
}
