import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview } from '../../platform/ui';
import { CatAvatar } from '../../platform/avatars';
import { MIN_PLAYERS, MAX_PLAYERS, NOPE_MS } from '../../../../games/meo-no/logic';
import type { Card, Kind, FeedEvent } from '../../../../games/meo-no/logic';

const SESSION_KEY = 'ct_guest_session:meo-no';
const MEO_REACTIONS = ['💣', '😱', '🙏', '🤔', '👍', '🐱', '🔥', '😹'];

const AVATAR_BG = ['bg-rose-100', 'bg-sky-100', 'bg-lime-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-pink-100', 'bg-indigo-100'];
const avatarBg = (id: string) => AVATAR_BG[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];
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

/* ---------- Mèo Nổ cards (CSS art per Hoàng's design: colored top with
 *  icon, cream bottom with the card name) ---------- */
const CARD_COLORS: Record<Kind, string> = {
  defuse: '#0E9F6E', nope: '#7C4DBD', skip: '#2E7CD6', shuffle: '#6B7280',
  peek: '#0891B2', attack: '#D63A2F', favor: '#B45309', cat: '#C2703D', exploding: '#2B2016',
};
const CAT_TINT: Record<string, string> = { tabby: '#F8CD9E', siamese: '#F5EED3', calico: '#F7BDD6', black: '#6B7280', white: '#FFF3CF' };
function CardIcon({ kind, variant, size = 30 }: { kind: Kind; variant?: string; size?: number }) {
  const ink = '#FFFBef';
  const sw = 5;
  if (kind === 'defuse') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><path d="M50 8 L86 22 V52 Q86 76 50 92 Q14 76 14 52 V22 Z" fill="none" stroke={ink} strokeWidth={sw + 2} strokeLinejoin="round" /><path d="M34 50 L46 62 L68 36" fill="none" stroke={ink} strokeWidth={sw + 2} strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === 'nope') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r="36" fill="none" stroke={ink} strokeWidth={sw + 2} /><path d="M24 24 L76 76" stroke={ink} strokeWidth={sw + 2} strokeLinecap="round" /></svg>
  );
  if (kind === 'skip') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><path d="M28 22 L62 50 L28 78 Z" fill={ink} strokeLinejoin="round" /><rect x="66" y="22" width="10" height="56" rx="4" fill={ink} /></svg>
  );
  if (kind === 'shuffle') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><g fill="none" stroke={ink} strokeWidth={sw + 1} strokeLinecap="round" strokeLinejoin="round"><path d="M14 30 H52 Q66 30 72 44" /><path d="M14 70 H52 Q66 70 72 56" /><path d="M64 36 L76 44 L64 52" /><path d="M64 48 L76 56 L64 64" /><path d="M22 30 Q40 50 22 70" opacity="0.7" /></g></svg>
  );
  if (kind === 'peek') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><path d="M8 50 Q50 8 92 50 Q50 92 8 50 Z" fill="none" stroke={ink} strokeWidth={sw + 1} strokeLinejoin="round" /><circle cx="50" cy="50" r="18" fill={ink} /><circle cx="50" cy="50" r="7" fill={CARD_COLORS.peek} /></svg>
  );
  if (kind === 'attack') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><path d="M56 6 L18 56 H42 L38 94 L78 40 H52 Z" fill={ink} strokeLinejoin="round" /></svg>
  );
  if (kind === 'favor') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><rect x="18" y="38" width="64" height="48" rx="6" fill="none" stroke={ink} strokeWidth={sw + 1} /><path d="M18 52 H82 M50 38 V86" stroke={ink} strokeWidth={sw + 1} /><path d="M50 38 Q30 12 20 26 Q16 40 50 38 Q70 12 80 26 Q84 40 50 38" fill="none" stroke={ink} strokeWidth={sw} strokeLinecap="round" /></svg>
  );
  if (kind === 'exploding') return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden><circle cx="48" cy="58" r="32" fill={ink} /><path d="M66 34 Q78 18 88 14" fill="none" stroke={ink} strokeWidth={sw} strokeLinecap="round" /><circle cx="89" cy="13" r="6" fill="#FFB020" stroke={ink} strokeWidth="3" /><path d="M36 52 l10 10 M46 52 l-10 10" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" /><path d="M38 74 q10 6 20 0" stroke="#2B2016" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>
  );
  // cat — a small face tinted by variant
  const tint = CAT_TINT[variant ?? 'tabby'] ?? '#F8CD9E';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d="M24 42 L16 12 L46 24 Z" fill={tint} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
      <path d="M76 42 L84 12 L54 24 Z" fill={tint} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="50" cy="56" r="33" fill={tint} stroke="#2B2016" strokeWidth="3" />
      <circle cx="38" cy="52" r="4.5" fill="#2B2016" /><circle cx="62" cy="52" r="4.5" fill="#2B2016" />
      <path d="M45 66 h10 l-5 6 Z" fill="#F2728C" stroke="#2B2016" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function cardLabel(d: any, card: Card): string {
  return card.kind === 'defuse' ? d.cardDefuse : card.kind === 'nope' ? d.cardNope
    : card.kind === 'skip' ? d.cardSkip : card.kind === 'shuffle' ? d.cardShuffle
    : card.kind === 'peek' ? d.cardPeek : card.kind === 'attack' ? d.cardAttack
    : card.kind === 'favor' ? d.cardFavor : card.kind === 'cat' ? d.cardCat : d.cardEK;
}
function MeoCardFace({ card, d, size = 'md' }: { card: Card; d: any; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[86px] h-[122px]' : size === 'sm' ? 'w-[56px] h-[80px]' : 'w-[68px] h-[96px]';
  const icon = size === 'sm' ? 26 : size === 'lg' ? 40 : 32;
  const lab = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-sm' : 'text-xs';
  const bg = CARD_COLORS[card.kind];
  return (
    <span className={`relative inline-flex flex-none flex-col overflow-hidden rounded-xl border-[3px] border-[#2B2016] ${box}`}>
      <span className="flex-1 flex items-center justify-center" style={{ background: bg }}>
        <CardIcon kind={card.kind} variant={card.variant} size={icon} />
      </span>
      <span className={`flex-none bg-[#FFFBef] text-center disp font-extrabold text-[#2B2016] leading-tight py-1 px-0.5 ${lab}`}>{cardLabel(d, card)}</span>
    </span>
  );
}
/** The draw pile: a dark card-back with a bomb (design MN3). */
function DeckBack({ count, shake }: { count: number; shake: boolean }) {
  return (
    <span className={`relative inline-flex flex-none items-center justify-center w-[86px] h-[122px] rounded-xl border-[3px] border-[#2B2016] ${shake ? 'anim-pile-shake' : ''}`} style={{ background: '#2B2016' }}>
      <span className="absolute inset-x-[10px] top-1/2 -translate-y-1/2 h-[42%] bg-[#3D3D63] rounded-[50%] rotate-[-24deg] opacity-60" />
      <span className="relative"><CardIcon kind="exploding" size={44} /></span>
      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#FFB020] text-[#2B2016] disp font-extrabold text-sm rounded-full px-2.5 py-0.5 border-2 border-[#2B2016]">{count}</span>
    </span>
  );
}
/** Landing art (design MN1): the cat peeking out beside a lit bomb. */
function CatBomb({ size = 150 }: { size?: number }) {
  return (
    <span className="inline-flex items-end gap-1">
      <CatAvatar seed="landing-cat" size={size} />
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 100 100" aria-hidden className="anim-bob">
        <circle cx="48" cy="58" r="34" fill="#2B2016" stroke="#3D3D63" strokeWidth="3" />
        <circle cx="38" cy="50" r="7" fill="#3D3D63" opacity="0.7" />
        <path d="M66 34 Q78 16 90 12" fill="none" stroke="#FFF3CF" strokeWidth="4" strokeLinecap="round" />
        <circle cx="91" cy="11" r="7" fill="#FFB020" stroke="#2B2016" strokeWidth="2.5" />
        <path d="M36 52 l10 10 M46 52 l-10 10" stroke="#FFFBef" strokeWidth="4" strokeLinecap="round" />
        <path d="M38 74 q10 6 20 0" stroke="#FFFBef" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">💣 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

/** The event feed (laptop "Diễn biến", design MN10): structured events
 *  rendered in the viewer's language, "bạn" when it involves me. */
function FeedList({ feed, d, myId, players }: { feed: FeedEvent[]; d: any; myId?: string; players: { id: string; name: string }[] }) {
  const name = (id?: string) => (id === myId ? d.you : players.find(p => p.id === id)?.name ?? '');
  const dot: Record<string, string> = {
    'play-attack': '#D63A2F', attack: '#D63A2F', draw: '#B9BCE0', exploded: '#2B2016',
    defuse: '#0E9F6E', win: '#0E9F6E', nope: '#7C4DBD', 'nope-block': '#7C4DBD',
    'drew-ek': '#D63A2F', start: '#FFB020', reinsert: '#0891B2',
  };
  const text = (e: FeedEvent): string => {
    const a = name(e.actorId);
    const tg = name(e.targetId);
    switch (e.kind) {
      case 'start': return d.feedStart;
      case 'draw': return d.feedDraw(a);
      case 'drew-ek': return `${a} 💣`;
      case 'defuse': return d.feedDefuse(a);
      case 'reinsert': return `${a} · ${d.feedReinsert}`;
      case 'exploded': return d.feedExploded(a);
      case 'win': return d.feedWin(a);
      case 'nope': return d.feedNope(a);
      case 'nope-block': return d.nopeBlocked(a);
      case 'shuffle': return d.feedShuffle(a);
      case 'peek': return d.feedPeek(a);
      case 'skip': case 'skip-debt': return d.feedSkip(a);
      case 'attack': return d.feedAttack(a) + (tg ? ` → ${tg}` : '');
      case 'favor': return d.feedFavor(a, tg);
      case 'favor-give': return `${a} → ${tg} 🎁`;
      case 'favor-empty': return `${a} · ${tg} (${d.cardsLeft(0)})`;
      default:
        if (e.kind.startsWith('play-')) {
          const k = e.kind.slice(5);
          const label = k === 'skip' ? d.cardSkip : k === 'shuffle' ? d.cardShuffle : k === 'peek' ? d.cardPeek : k === 'attack' ? d.cardAttack : d.cardFavor;
          return tg ? d.feedPlayOn(a, label, tg) : d.feedPlay(a, label);
        }
        return e.kind;
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

export default function MeoNoApp() {
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
  const [myRecord, setMyRecord] = useState<{ w: number; l: number }>({ w: 0, l: 0 });
  const [shareCopied, setShareCopied] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [favorPick, setFavorPick] = useState<Card | null>(null);
  const [favorGiveId, setFavorGiveId] = useState<string | null>(null);
  const [showPeek, setShowPeek] = useState(false);
  const [showEliminated, setShowEliminated] = useState(false);
  const [dismissedNope, setDismissedNope] = useState('');
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
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
  const now = useNow();
  const me = pub?.players.find(p => p.id === joined?.playerId);
  const myHand = priv?.myHand ?? [];
  const myTurn = phase === 'playing' && pub?.turn === joined?.playerId && !!me?.alive;

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
          if (m === 'STATUS_CREATING') setStatus(d.statusCreating);
          else if (m.startsWith('STATUS_CONNECTING:')) setStatus(d.statusConnecting(m.slice('STATUS_CONNECTING:'.length)));
          else setStatus(m);
        },
        onPromoted: () => { setJoined(j => (j ? { ...j, isHost: true } : j)); },
      }, 'meo-no');
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
      setMyRecord(r => ({ w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1) }));
    }
    if (pub.phase === 'results') sfx(pub.winner === joined.playerId ? 'win' : 'lose', muted);
    prevPub.current = { phase: pub.phase, round: pub.round };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub]);

  // A soft chime when my turn starts; a death sting when I explode.
  const prevTurn = useRef<string | null>(null);
  useEffect(() => {
    if (pub?.phase === 'playing' && pub.turn === joined?.playerId && prevTurn.current !== joined?.playerId) sfx('pop', muted);
    prevTurn.current = pub?.turn ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.turn, pub?.phase]);
  const prevAlive = useRef(true);
  useEffect(() => {
    if (!pub || !joined) return;
    const alive = pub.players.find(p => p.id === joined.playerId)?.alive;
    if (alive === false && prevAlive.current) { sfx('death', muted); setShowEliminated(true); }
    if (alive !== undefined) prevAlive.current = alive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.players]);

  // Open the peek overlay when fresh peek cards arrive.
  const prevPeek = useRef<string | null>(null);
  useEffect(() => {
    const key = priv?.peekCards ? priv.peekCards.map(c => c.id).join(',') : null;
    if (key && key !== prevPeek.current) setShowPeek(true);
    prevPeek.current = key;
  }, [priv?.peekCards]);

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
      }, 'meo-no');
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
  const busy = !!(pub?.pendingAction || pub?.pendingExplode || pub?.pendingReinsert || pub?.pendingFavor);
  const canDraw = myTurn && !busy;
  const isActionKind = (k: Kind) => k === 'skip' || k === 'shuffle' || k === 'peek' || k === 'attack' || k === 'favor';
  const canPlay = (c: Card) => myTurn && !busy && isActionKind(c.kind);
  const selectedCard = myHand.find(c => c.id === selectedCardId) ?? null;
  const doPlaySelected = () => {
    if (!selectedCard || !canPlay(selectedCard)) return;
    if (selectedCard.kind === 'favor') { setFavorPick(selectedCard); return; }
    setSelectedCardId(null);
    getNet().nightAction('playCard', undefined, { cardId: selectedCard.id });
  };
  const doPlayFavor = (targetId: string) => {
    if (!favorPick) return;
    getNet().nightAction('playCard', undefined, { cardId: favorPick.id, targetId });
    setFavorPick(null); setSelectedCardId(null);
  };
  const doDraw = () => getNet().nightAction('drawCard');
  const doNope = () => getNet().nightAction('playNope');
  const doDefuse = () => getNet().nightAction('defuse');
  const doReinsert = (pos: number) => getNet().nightAction('reinsert', undefined, { pos });
  const doGiveFavor = () => {
    if (!favorGiveId) return;
    getNet().nightAction('giveFavorCard', undefined, { cardId: favorGiveId });
    setFavorGiveId(null);
  };

  /* ---------- shared bits ---------- */
  const tone = phase === 'results' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';
  const others = pub?.players.filter(p => p.id !== joined?.playerId) ?? [];
  const turnPlayer = pub?.players.find(p => p.id === pub?.turn);
  const risk = pub && pub.deckCount > 0 ? Math.round((pub.ekInDeck / pub.deckCount) * 100) : 0;
  const pendingNope = pub?.pendingAction ?? null;
  const nopeKey = pendingNope ? `${pendingNope.actorId}:${pendingNope.kind}:${pendingNope.endsAt}` : '';
  const iHoldNope = myHand.some(c => c.kind === 'nope');
  const iCanNope = !!pendingNope && iHoldNope && me?.alive
    && (pendingNope.nopes === 0 ? pendingNope.actorId !== joined?.playerId : pendingNope.lastNoper !== joined?.playerId)
    && dismissedNope !== nopeKey;
  const showNopeSheet = !!pendingNope && iCanNope;
  const nopeSecs = pendingNope ? secsLeft(pendingNope.endsAt, now) : null;
  const favorTarget = pub?.pendingFavor ? pub.players.find(p => p.id === pub.pendingFavor!.targetId) : null;
  const favorFrom = pub?.pendingFavor ? pub.players.find(p => p.id === pub.pendingFavor!.fromId) : null;
  const lastDrewEk = pub?.feed.length ? [...pub.feed].reverse().find(e => e.kind === 'drew-ek') : null;
  const pileShake = !!lastDrewEk && Date.now() - lastDrewEk.ts < 1200;

  const shareText = () => {
    const lines = [`💣 ${d.title} — ${playerName(pub?.winner)} ${d.winner}`];
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordTitle + ': ' + d.recordLine(myRecord.w, myRecord.l));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const feedAside = pub && phase === 'playing' && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="bg-[#23233F] border-[3px] border-[#2B2016] rounded-[24px] p-4 flex flex-col flex-1 min-h-0 hard">
        <div className="disp font-extrabold text-lg mb-2 text-[#FFF3CF]">📜 {d.feedTitle}</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {myTurn && (pub.debt ?? 0) > 0 && (
            <div className="flex items-start gap-2 font-bold text-sm leading-snug text-[#FFB020] mb-1.5">
              <span className="mt-1.5 w-2.5 h-2.5 rounded-full flex-none bg-[#FFB020]" />
              <span>{d.feedYourTurnDebt(pub.debt)}</span>
            </div>
          )}
          <FeedList feed={pub.feed} d={d} myId={joined?.playerId} players={pub.players} />
        </div>
      </div>
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0 mt-4">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined?.playerId ?? ''} d={d} height="flex" onChat={onChat} reactions={MEO_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, MEO_REACTIONS)}</span>
      {unreadChat > 0 && <span className="flex-none bg-[#D63A2F] text-white text-xs font-extrabold rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center">{unreadChat}</span>}
    </button>
  );

  /* ---------- landing (design MN1) ---------- */
  if (!joined) {
    return (
      <div className="min-h-dvh bg-[#14142B] text-[#2B2016]">
        <div className="max-w-md lg:max-w-lg mx-auto">
          <div className="flex items-center gap-2 px-3 pt-3">
            <button className="disp font-extrabold text-[#FFF3CF] text-sm bg-[#23233F] border-2 border-[#3D3D63] rounded-full px-3 py-1.5" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
            <span className="flex-1" />
            <button title={muted ? '🔇' : '🔊'} className="w-10 h-10 rounded-full bg-[#23233F] border-2 border-[#3D3D63] text-lg flex items-center justify-center" onClick={toggleMuted}>{muted ? '🔇' : '🔊'}</button>
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
            <CatBomb size={132} />
          </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] px-4 pt-4 pb-6 mt-5">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            <button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>💣 {d.create}</button>
            <div className="flex items-center gap-3 mt-4 mb-3">
              <span className="flex-1 border-t-2 border-[#E5DCC0]" />
              <span className="disp font-extrabold text-xs text-[#8A7B63] tracking-wide">{d.orJoinFriend}</span>
              <span className="flex-1 border-t-2 border-[#E5DCC0]" />
            </div>
            <div className="flex gap-2">
              <input className="inp flex-1 min-w-0 px-4 py-3 font-bold uppercase" placeholder={d.codePh}
                value={roomCodeInput} maxLength={5} onChange={e => setRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' && roomCodeInput.trim() && name.trim()) getNet().joinRoom(roomCodeInput.trim(), name.trim()); }} />
              <button className={`${BTN} btn-dark`} disabled={!name.trim() || !roomCodeInput.trim() || !!status}
                onClick={() => { setError(''); getNet().joinRoom(roomCodeInput.trim(), name.trim()); }}>🚪 {d.join}</button>
            </div>
            {status && <p className="text-center font-bold mt-3">{status} <button className="text-red-500 font-extrabold ml-1" onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } try { getNet().leave(); } catch { /* ignore */ } location.href = location.pathname; }}>{d.cancelConnect}</button></p>}
            {error && <p className="text-center font-bold text-red-600 mt-3">{error}</p>}
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

  const rankings = pub ? [...pub.players].sort((a, b) => {
    if (a.id === pub.winner) return -1;
    if (b.id === pub.winner) return 1;
    return (b.explodedTurn ?? 0) - (a.explodedTurn ?? 0);
  }) : [];

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-4">
        <TopBar logo={<span className="text-2xl">💣</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        <button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {error && <div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-2xl leading-none">💣 {d.title} · {d.lobby}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-1">{d.waiting}</p>
              </div>
              <span className="flex-1" />
              <span className="hidden sm:block font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS}</span>
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
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=meo-no&room=${pub!.roomCode}`); } catch { /* ignore */ } }}>🔗 {d.copyLink}</button>
            </div>

            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4 mt-4">
              <div className="card-cream p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS} · {d.needAtLeast(MIN_PLAYERS)}</span>
                </div>
                <div className="grid grid-cols-4 lg:grid-cols-5 gap-2 my-3">
                  {pub!.players.map(p => (
                    <div key={p.id} className={`rounded-2xl p-2 text-center hard-xs ${p.id === joined.playerId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                      <span className="mx-auto block w-fit"><CatAvatar seed={p.id} size={48} /></span>
                      <span className="block font-bold truncate text-sm mt-0.5 text-[#2B2016]">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                      {p.isHost && <span className="text-amber-600 text-xs font-extrabold whitespace-nowrap">👑 {d.host}</span>}
                      {!p.connected && <span className="text-red-500 text-xs font-bold"> • {d.offline}</span>}
                      {joined.isHost && p.id !== joined.playerId && (
                        <span role="button" title={d.kick}
                          onClick={() => getNet().kick(p.id)}
                          className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 mt-1 cursor-pointer hover:bg-red-200">✖ {d.kick}</span>)}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, MAX_PLAYERS - pub!.players.length) }).map((_, i) => (
                    <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] p-2 text-center text-[#8A7B63] font-bold text-xs hidden lg:flex items-center justify-center min-h-[86px]">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
                  ))}
                </div>
                {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
                <button className={`${BTN} bg-[#FFFBef] text-[#D63A2F] w-full mt-3`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>🚪 {d.leave}</button>
              </div>

              {/* Rule toggles (design MN2/MN9) — host only */}
              <div className="card-cream p-4 mt-4 lg:mt-0">
                <h3 className="disp font-extrabold text-xl">{d.rulesTitle}</h3>
                <div className="mt-3 space-y-3">
                  {([
                    ['nopeEnabled', d.ruleNope, d.ruleNopeSub],
                    ['showCounts', d.ruleCounts, d.ruleCountsSub],
                    ['timerEnabled', d.ruleTimer, d.ruleTimerSub],
                  ] as const).map(([key, label, sub]) => (
                    <div key={key} className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold leading-tight">{label}</div>
                        <div className="font-bold text-sm text-[#8A7B63] leading-snug">{sub}</div>
                      </div>
                      <button
                        data-testid={`toggle-${key}`}
                        disabled={!joined.isHost}
                        aria-pressed={pub!.config[key]}
                        onClick={() => getNet().nightAction('setConfig', undefined, { config: { [key]: !pub!.config[key] } })}
                        className={`flex-none w-12 h-7 rounded-full border-2 border-[#2B2016] relative transition-colors disabled:opacity-70 ${pub!.config[key] ? 'bg-[#0E9F6E]' : 'bg-[#C9BFA5]'}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white border-2 border-[#2B2016] transition-all ${pub!.config[key] ? 'left-6' : 'left-0.5'}`} />
                      </button>
                    </div>
                  ))}
                </div>
                {joined.isHost ? (
                  <>
                    <button className={`${BTN} btn-amber w-full mt-4`} disabled={connected < MIN_PLAYERS}
                      onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                    {connected < MIN_PLAYERS && <p className="text-center font-bold text-red-600 text-sm mt-2">{d.need2}</p>}
                    {connected >= MIN_PLAYERS && <p className="text-center font-bold text-[#8A7B63] text-sm mt-2">{d.stillNeed(MAX_PLAYERS - connected)}</p>}
                  </>
                ) : (
                  <p className="text-center font-bold text-[#8A7B63] mt-4">{d.waiting}</p>
                )}
              </div>
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'playing' && pub && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div className="min-w-0">
              {/* header: turn + attack debt + timer */}
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="disp font-extrabold text-2xl leading-none">
                  {myTurn ? d.yourTurn : d.turnOf(turnPlayer?.name ?? '')}
                </h2>
                {pub.debt > 0 && myTurn && <span className="font-extrabold text-[#D63A2F] text-sm">{d.attackedNote(pub.debt)}</span>}
                {pub.config.timerEnabled && <TimerPill secs={secsLeft(pub.turnEndsAt, now)} dark />}
                {!me?.alive && <span className="font-extrabold text-[#D63A2F] text-sm">💥 {d.exploded} — {d.keepWatching}</span>}
              </div>

              {/* opponents (design MN3) */}
              <div className="flex gap-2 overflow-x-auto pb-1 mt-2">
                {others.map(p => (
                  <div key={p.id} data-testid="opponent" data-player-id={p.id} className={`flex-none flex items-center gap-2 rounded-2xl px-2.5 py-1.5 hard-xs ${pub.turn === p.id ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${!p.alive ? 'opacity-60' : ''}`}>
                    <span className="relative flex-none">
                      <CatAvatar seed={p.id} size={40} state={p.alive ? 'awake' : 'dead'} />
                      {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                    </span>
                    <span className="min-w-0">
                      <span className={`block font-extrabold text-sm truncate text-[#2B2016] max-w-[84px] ${!p.alive ? 'line-through' : ''}`}>{p.name}{!p.connected ? ` (${d.offline})` : ''}</span>
                      <span className="block font-bold text-xs text-[#8A7B63]">🃏 {p.handCount === null ? '?' : p.handCount} {d.cards}{!p.alive ? ` · 💥` : ''}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Nope window banner (when I cannot / do not nope) */}
              {pendingNope && !showNopeSheet && (
                <div className="mt-2 bg-[#EDE9FE] border-2 border-[#7C4DBD] rounded-2xl px-3 py-2 flex items-center gap-2">
                  <span className="font-bold text-sm flex-1 text-[#4C1D95]">{d.nopePlayedBy(playerName(pendingNope.actorId))} — {d.nopeSecondsLeft(nopeSecs ?? 0)}</span>
                  <span className="w-full max-w-[120px] h-2 bg-white rounded-full overflow-hidden border border-[#7C4DBD]"><span className="block h-full bg-[#7C4DBD]" style={{ width: `${Math.max(0, Math.min(100, ((nopeSecs ?? 0) / (NOPE_MS / 1000)) * 100))}%` }} /></span>
                </div>
              )}
              {/* Favor waiting banner */}
              {pub.pendingFavor && favorFrom?.id !== joined.playerId && favorTarget?.id !== joined.playerId && (
                <div className="mt-2 bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 font-bold text-sm text-[#5C4B33]">
                  {d.favorWait(favorTarget?.name ?? '')}
                </div>
              )}
              {pub.pendingFavor && favorFrom?.id === joined.playerId && (
                <div className="mt-2 bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 font-bold text-sm text-[#5C4B33]">
                  {d.favorWait(favorTarget?.name ?? '')}
                </div>
              )}

              {/* table: draw pile + last played + danger meter */}
              <div className="mt-2 rounded-[28px] border-[3px] border-[#2B2016] hard p-4" style={{ background: '#14142B' }}>
                <div className="flex items-start justify-center gap-4 sm:gap-8">
                  <button data-testid="draw-pile" disabled={!canDraw} onClick={doDraw} className="text-center disabled:opacity-60">
                    <DeckBack count={pub.deckCount} shake={pileShake} />
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1.5">{d.drawPile}</span>
                    <span className="block font-bold text-[#B9BCE0] text-xs mt-0.5">{canDraw ? d.drawCardBtn : ''}</span>
                  </button>
                  <div className="text-center">
                    {pub.topCard ? (
                      <span key={pub.topCard.id} className="inline-block anim-card-fall"><MeoCardFace card={pub.topCard} d={d} size="lg" /></span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-[86px] h-[122px] rounded-xl border-[3px] border-dashed border-[#3D3D63] text-[#B9BCE0] font-extrabold">?</span>
                    )}
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1.5">{d.lastPlayed}</span>
                  </div>
                </div>
                {/* danger meter (design MN3) */}
                <div className="mt-3 bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 font-bold text-[13px]">
                    <span className="text-[#EDEDF7] whitespace-nowrap">{d.pileLeft(pub.deckCount, pub.ekInDeck)}</span>
                    <span className="text-[#F87171] font-extrabold whitespace-nowrap">{d.risk(risk)}</span>
                  </div>
                  <div className="h-2.5 bg-[#14142B] rounded-full overflow-hidden mt-1.5 border border-[#3D3D63]">
                    <span className="block h-full bg-[#D63A2F] transition-all" style={{ width: `${risk}%` }} />
                  </div>
                </div>
              </div>

              {/* my hand */}
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="disp font-extrabold text-lg">{d.yourHand} · {myHand.length} {d.cards}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">{myTurn ? d.yourTurn : ''}</span>
                </div>
                <div className="flex pb-2 pt-2 -mx-1 px-1 overflow-x-auto">
                  {myHand.map((c, hi) => {
                    const playable = canPlay(c);
                    const selected = c.id === selectedCardId;
                    return (
                      <span key={c.id} className="flex-none anim-card-fall -ml-1 first:ml-0" style={{ animationDelay: `${hi * 45}ms` }}>
                      <button data-testid="hand-card" data-card-id={c.id} data-kind={c.kind} disabled={!playable && !selected} onClick={() => setSelectedCardId(selected ? null : c.id)}
                        className={`flex-none rounded-xl transition ${playable ? 'hover:-translate-y-2 cursor-pointer' : 'opacity-45 cursor-default'} ${selected ? 'ring-4 ring-[#FFB020] -translate-y-2 z-10' : ''}`}>
                        <MeoCardFace card={c} d={d} size="md" />
                      </button>
                      </span>
                    );
                  })}
                  {myHand.length === 0 && <p className="font-bold text-[#8A7B63] py-6">…</p>}
                </div>
                <div className="flex gap-2 mt-1">
                  <button data-testid="play-selected-btn" className={`${BTN} btn-amber flex-1`} disabled={!selectedCard || !canPlay(selectedCard)} onClick={doPlaySelected}>{d.playSelected}</button>
                  <button data-testid="draw-btn" className={`${BTN} btn-dark flex-1`} disabled={!canDraw} onClick={doDraw}>
                    <span className="lg:hidden">{d.drawCardBtn}</span>
                    <span className="hidden lg:inline">{d.drawCardBtnWide}</span>
                  </button>
                </div>
              </div>
              {chatPreviewBar}
            </div>
            {feedAside}
          </div>
        )}

        {phase === 'results' && pub && (
          <div className="relative">
            <Confetti />
            <div className="relative max-w-md lg:max-w-2xl mx-auto text-center">
              <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.roundOver}</p>
              <div className="flex justify-center mt-1"><CatAvatar seed={pub.winner ?? 'w'} size={56} /></div>
              <h2 className="disp font-extrabold text-3xl mt-1">{playerName(pub.winner)} {d.winner}</h2>
              <p className="text-[#B9BCE0] font-bold mt-0.5">{playerName(pub.winner)} {d.winnerSub}</p>
              <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-4 lg:text-left">
                <div className="mt-2 space-y-1.5 text-left">
                  {rankings.map((p, i) => (
                    <div key={p.id} className={`flex items-center gap-3 rounded-2xl px-3 py-1.5 hard-sm ${i === 0 ? 'bg-[#FFD97A]' : 'bg-[#FFFBef]'} text-[#2B2016]`}>
                      <span className="disp font-extrabold text-xl w-6 text-center flex-none">{i + 1}</span>
                      <CatAvatar seed={p.id} size={36} state={p.alive ? 'awake' : 'dead'} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-extrabold truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                        <span className="block font-bold text-sm text-[#5C4B33]">{p.id === pub.winner ? (p.handCount === null ? (lang === 'vi' ? 'Sống sót' : 'Survived') : d.survived(p.handCount)) : d.explodedAt(p.explodedTurn ?? 0)}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="card-cream !rounded-[28px] p-3 mt-2 text-left text-[#2B2016]">
                  <div className="disp font-extrabold text-lg">{d.standings}</div>
                  <div className="mt-1.5 space-y-1">
                    {[...pub.players].sort((a, b) => b.wins - a.wins).map(p => (
                      <div key={p.id} className="flex items-center gap-2 font-bold">
                        <span className="flex-1 truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                        <span>🏆 {p.wins}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 bg-[#DFF5E3] rounded-2xl px-3 py-1.5 font-bold text-sm text-[#2B2016]">
                    📊 {d.recordTitle}: {d.recordLine(myRecord.w, myRecord.l)}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button className={`${BTN} btn-amber flex-1 !py-2.5`} onClick={doShare}>📋 {shareCopied ? d.copied : d.shareResults}</button>
                  </div>
                  {joined.isHost ? (
                    <div className="flex gap-2 mt-2">
                      <button className={`${BTN} btn-green flex-1 !py-2.5`} onClick={() => getNet().startGame()}>▶ {d.playAgain}</button>
                      <button className={`${BTN} bg-[#FFFBef] text-[#2B2016] flex-1 !py-2.5`} onClick={() => getNet().playAgain()}>{d.backLobby}</button>
                    </div>
                  ) : (
                    <p className="text-center font-bold text-[#B9BCE0] mt-4">{d.waiting}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nope sheet (design MN4) */}
        {showNopeSheet && pendingNope && (
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3" style={{ background: 'linear-gradient(to top, rgba(20,20,43,0.92), transparent)' }}>
            <div className="w-full max-w-md bg-[#23233F] border-[3px] border-[#2B2016] rounded-[24px] p-4 hard anim-slide-up text-[#FFF3CF]">
              <div className="text-center">
                <p className="disp text-[#FFB020] font-extrabold tracking-[0.18em] text-[11px]">{d.nopePlayedBy(playerName(pendingNope.actorId)).toUpperCase()}</p>
                <p className="font-bold text-sm text-[#B9BCE0] mt-1">
                  {pendingNope.kind === 'favor' ? d.favorGiveTitle(playerName(pendingNope.actorId)) : cardLabel(d, { id: '', kind: pendingNope.kind } as Card)}
                </p>
              </div>
              <div className="flex items-baseline justify-between mt-3">
                <span className="disp font-extrabold text-lg">{d.nopeTitle}</span>
                <span className="font-extrabold text-[#FFB020]">{d.nopeSecondsLeft(nopeSecs ?? 0)}</span>
              </div>
              <div className="h-2 bg-[#14142B] rounded-full overflow-hidden mt-1 border border-[#3D3D63]">
                <span className="block h-full bg-[#FFB020] transition-all" style={{ width: `${Math.max(0, Math.min(100, ((nopeSecs ?? 0) / (NOPE_MS / 1000)) * 100))}%` }} />
              </div>
              <p className="font-bold text-sm text-[#B9BCE0] mt-2">{d.nopeYouHave(myHand.filter(c => c.kind === 'nope').length)}</p>
              <button data-testid="nope-btn" className={`${BTN} w-full mt-3 !bg-[#7C4DBD] !text-white`} onClick={doNope}>⊘ {d.nopeBtn}</button>
              <button data-testid="nope-pass-btn" className={`${BTN} w-full mt-2 bg-[#FFFBef] !text-[#2B2016]`} onClick={() => setDismissedNope(nopeKey)}>{d.nopePass}</button>
            </div>
          </div>
        )}

        {/* Favor target picker */}
        {favorPick && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setFavorPick(null)}>
            <div className={`${CARD} max-w-xs w-full text-center`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-xl">{d.favorPickTarget}</div>
              <div className="flex justify-center mt-3"><MeoCardFace card={favorPick} d={d} size="lg" /></div>
              <div className="space-y-2 mt-4">
                {others.filter(p => p.alive).map(p => (
                  <button key={p.id} data-testid="favor-target" data-player-id={p.id} className={`${BTN} btn-amber w-full !py-2.5`} onClick={() => doPlayFavor(p.id)}>
                    <span className="inline-flex items-center gap-2"><CatAvatar seed={p.id} size={28} /> {p.name} · {p.handCount ?? '?'} {d.cards}</span>
                  </button>
                ))}
              </div>
              <button className="font-bold text-sm text-[#8A7B63] underline mt-3" onClick={() => setFavorPick(null)}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
            </div>
          </div>
        )}

        {/* Favor give: I must hand over a card (design MN4 target side) */}
        {pub?.pendingFavor && favorTarget?.id === joined.playerId && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className={`${CARD} max-w-lg w-full text-center max-h-[88vh] overflow-auto`}>
              <div className="disp font-extrabold text-xl">{d.favorGiveTitle(favorFrom?.name ?? '')}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.favorGiveSub}</p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {myHand.map(c => (
                  <button key={c.id} data-testid="favor-give-card" data-card-id={c.id} onClick={() => setFavorGiveId(c.id)}
                    className={`rounded-xl transition ${favorGiveId === c.id ? 'ring-4 ring-[#FFB020] -translate-y-1' : 'hover:-translate-y-1'}`}>
                    <MeoCardFace card={c} d={d} size="md" />
                  </button>
                ))}
              </div>
              <button data-testid="favor-give-btn" className={`${BTN} btn-amber w-full mt-4`} disabled={!favorGiveId} onClick={doGiveFavor}>{d.favorGiveBtn}</button>
            </div>
          </div>
        )}

        {/* Exploding kitten (design MN5) — I drew it and hold a Defuse */}
        {pub?.pendingExplode?.playerId === joined.playerId && priv?.hasDefuse && !pub.pendingReinsert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 50% 30%, #7A1F18, #14142B 75%)' }}>
            <div className="w-full max-w-md text-center text-[#FFF3CF]">
              <p className="disp text-[#F87171] font-extrabold tracking-[0.22em] text-xs">{lang === 'vi' ? 'BẠN VỪA BỐC ĐƯỢC' : 'YOU JUST DREW'}</p>
              <h2 className="disp font-extrabold text-4xl mt-1 anim-ek-shake">{d.youDrewEK}</h2>
              <div className="flex justify-center mt-4"><span className="anim-card-fall inline-block"><MeoCardFace card={{ id: 'ek-show', kind: 'exploding' }} d={d} size="lg" /></span></div>
              <p className="font-bold mt-4 leading-snug">{d.ekNoDefuse}</p>
              <p className="font-bold text-sm text-[#B9BCE0] mt-1">{d.ekDefuseHint}</p>
              <button data-testid="defuse-btn" className={`${BTN} btn-green w-full mt-4 !text-xl`} onClick={doDefuse}>🛡️ {d.defuseBtn}</button>
            </div>
          </div>
        )}

        {/* Reinsert (design MN6) */}
        {pub?.pendingReinsert === joined.playerId && priv?.reinsertOptions && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#14142B]/95">
            <div className="w-full max-w-md text-[#FFF3CF]">
              <div className="bg-[#0E9F6E] rounded-2xl px-4 py-3 hard-sm">
                <div className="disp font-extrabold text-lg">✓ {d.defusedOk}</div>
                <div className="font-bold text-sm">{d.defusedSub}</div>
              </div>
              <h2 className="disp font-extrabold text-3xl mt-4">{d.reinsertTitle}</h2>
              <p className="font-bold text-sm text-[#B9BCE0] mt-1">{d.reinsertSub}</p>
              <div className="space-y-2 mt-4">
                {priv.reinsertOptions.map(o => (
                  <button key={o.pos} data-testid="reinsert-option" data-pos={o.pos} onClick={() => doReinsert(o.pos)}
                    className="w-full flex items-center gap-3 bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2.5 text-left push hover:border-[#FFB020]">
                    <span className="flex-none w-9 h-9 rounded-xl bg-[#7C4DBD] text-white disp font-extrabold flex items-center justify-center border-2 border-[#2B2016]">{o.pos}</span>
                    <span className="min-w-0">
                      <span className="block font-extrabold leading-tight">{o.label === 'Trên cùng' ? d.reinsertTop : o.label === 'Lá thứ 2' ? d.reinsert2 : o.label === 'Lá thứ 3' ? d.reinsert3 : o.label === 'Giữa chồng' ? d.reinsertMid : d.reinsertBottom}</span>
                      <span className="block font-bold text-xs text-[#B9BCE0]">{o.label === 'Trên cùng' ? d.reinsertTopSub : o.label === 'Lá thứ 2' ? d.reinsert2Sub : o.label === 'Giữa chồng' ? d.reinsertMidSub : o.label === 'Dưới đáy' ? d.reinsertBottomSub : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-center font-bold text-sm text-[#B9BCE0] mt-4">{d.reinsertFoot(pub.deckCount)}</p>
            </div>
          </div>
        )}

        {/* Peek (design MN7) */}
        {showPeek && priv?.peekCards && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#14142B]/95">
            <div className="w-full max-w-md text-center text-[#FFF3CF]">
              <p className="disp text-[#67E8F9] font-extrabold tracking-[0.22em] text-xs">{lang === 'vi' ? 'CHỈ MÌNH BẠN THẤY' : 'ONLY YOU CAN SEE THIS'}</p>
              <h2 className="disp font-extrabold text-3xl mt-1">{d.peekTitle}</h2>
              <p className="font-bold text-sm text-[#B9BCE0] mt-1">{d.peekSub}</p>
              <div className="flex justify-center gap-2 mt-5">
                {priv.peekCards.map((c, i) => (
                  <div key={c.id + '-' + i} className="anim-card-flip" style={{ animationDelay: `${i * 0.15}s` }}>
                    <MeoCardFace card={c} d={d} size="lg" />
                    <div className="mt-2">
                      <span className={`disp font-extrabold text-xs rounded-full px-2 py-0.5 ${c.kind === 'exploding' ? 'bg-[#D63A2F] text-white' : 'bg-[#23233F] text-[#B9BCE0] border border-[#3D3D63]'}`}>{d.peekCardN(i + 1)}{c.kind === 'exploding' ? ` · ${d.peekDanger}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
              {priv.peekCards.findIndex(c => c.kind === 'exploding') >= 0 && (
                <div className="mt-4 bg-[#2B1214] border-2 border-[#D63A2F] rounded-2xl px-3 py-2 font-bold text-sm text-left">
                  💣 {d.peekHint(priv.peekCards.findIndex(c => c.kind === 'exploding') + 1)}
                </div>
              )}
              <button data-testid="peek-close-btn" className={`${BTN} btn-amber w-full mt-5`} onClick={() => setShowPeek(false)}>{d.peekClose}</button>
            </div>
          </div>
        )}

        {/* Elimination scene (design MN5, no-defuse side) */}
        {showEliminated && me && !me.alive && phase === 'playing' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 50% 30%, #7A1F18, #14142B 75%)' }}>
            <div className="w-full max-w-md text-center text-[#FFF3CF]">
              <h2 className="disp font-extrabold text-4xl anim-ek-shake">{d.eliminatedTitle}</h2>
              <div className="flex justify-center mt-4"><CatAvatar seed={joined.playerId} size={96} state="dead" /></div>
              <p className="font-bold mt-4 leading-snug">{d.eliminatedSub}</p>
              <button className={`${BTN} btn-amber w-full mt-5`} onClick={() => setShowEliminated(false)}>{d.keepWatching}</button>
            </div>
          </div>
        )}

        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub?.chat ?? []} myId={joined.playerId} d={d} onChat={onChat} reactions={MEO_REACTIONS} />
      </div>
    </div>
  );
}
