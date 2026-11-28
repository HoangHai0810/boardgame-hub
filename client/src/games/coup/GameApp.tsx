import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview, RetryDefaultButton } from '../../platform/ui';
import { MouseAvatar } from '../../platform/avatars';
import { PlayerAvatar } from '../../platform/GameCard';
import { legalActions, MIN_PLAYERS, MAX_PLAYERS, BLOCK_CHARS, NEEDS_TARGET, MUST_COUP_AT } from '../../../../games/coup/logic';
import type { Card, CharKind, ActionKind, FeedEntry } from '../../../../games/coup/logic';
import { COUP_ART } from '../../platform/art';

const SESSION_KEY = 'ct_guest_session:coup';
const COUP_REACTIONS = ['👑', '🗡️', '🪙', '🤔', '👍', '💥', '🛡️', '🎉'];

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

/* ---------- Coup character cards (CSS art, same chunky style as the platform).
 *  Character names stay in English — they are the original game's names. ---------- */
const CARD_COLORS: Record<CharKind, string> = {
  duke: '#7C3AED', assassin: '#1F2937', captain: '#2563EB', ambassador: '#0E7490', contessa: '#BE185D',
};
const CARD_NAMES: Record<CharKind, string> = {
  duke: 'Duke', assassin: 'Assassin', captain: 'Captain', ambassador: 'Ambassador', contessa: 'Contessa',
};
const CARD_EFFECTS = (d: any): Record<CharKind, string> => ({
  duke: d.effDuke, assassin: d.effAssassin, captain: d.effCaptain, ambassador: d.effAmbassador, contessa: d.effContessa,
});
const ACTION_NAMES = (d: any): Record<ActionKind, string> => ({
  income: d.actIncome, 'foreign-aid': d.actForeignAid, coup: d.actCoup, tax: d.actTax,
  assassinate: d.actAssassinate, steal: d.actSteal, exchange: d.actExchange,
});
const ACTION_HINTS = (d: any): Record<ActionKind, string> => ({
  income: d.actIncomeHint, 'foreign-aid': d.actForeignAidHint, coup: d.actCoupHint, tax: d.actTaxHint,
  assassinate: d.actAssassinateHint, steal: d.actStealHint, exchange: d.actExchangeHint,
});
function CoupCardFace({ card, d, size = 'md' }: { card: Card; d: any; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[92px] h-[134px]' : size === 'sm' ? 'w-[46px] h-[66px]' : 'w-[76px] h-[112px]';
  const nm = size === 'sm' ? 'hidden' : size === 'lg' ? 'text-[11px]' : 'text-[9px]';
  const eff = CARD_EFFECTS(d)[card.kind];
  return (
    <span className={`relative inline-flex flex-none flex-col rounded-xl border-[3px] border-[#2B2016] overflow-hidden ${box}`} style={{ background: CARD_COLORS[card.kind] }}>
      <img src={COUP_ART[card.kind]} alt="" className="relative w-full flex-1 min-h-0 object-cover" draggable={false} />
      {size !== 'sm' && (
        <span className="relative px-1 pt-1 pb-1.5">
          <span className={`block disp font-extrabold ${nm} leading-none text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.35)] uppercase text-center truncate`}>{CARD_NAMES[card.kind]}</span>
          <span className="block mx-0.5 mt-1 rounded-md bg-white/95 px-1 py-0.5 text-[8px] leading-[1.15] font-bold text-[#2B2016] text-center line-clamp-2">{eff}</span>
        </span>
      )}
    </span>
  );
}
function CoupCardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'w-[92px] h-[134px]' : size === 'sm' ? 'w-[46px] h-[66px]' : 'w-[76px] h-[112px]';
  return (
    <span className={`relative inline-flex flex-none items-center justify-center rounded-xl border-[3px] border-[#2B2016] ${box}`} style={{ background: '#3B2F1E' }}>
      <span className="absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-[46%] bg-white/90 rounded-[50%] rotate-[-24deg]" />
      <span className="relative disp font-extrabold text-2xl">👑</span>
    </span>
  );
}
/** A tiny chip for a face-up revealed card. */
function RevealedChips({ pile }: { pile: Card[] }) {
  if (!pile.length) return <span className="font-bold text-xs text-[#F3C6D8]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {pile.map((c, i) => (
        <span key={c.id + '-' + i} className="inline-flex items-center justify-center px-1.5 h-[18px] rounded-md border border-[#2B2016] text-[10px] font-extrabold text-white" style={{ background: CARD_COLORS[c.kind] }} title={CARD_NAMES[c.kind]}>{CARD_NAMES[c.kind]}</span>
      ))}
    </span>
  );
}

function HelpModal({ d, onClose }: { d: any; onClose: () => void }) {
  const chars: CharKind[] = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${CARD} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">👑 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ol>
        <div className="disp font-extrabold text-lg mt-5">{d.cardsRefTitle}</div>
        <p className="font-bold text-sm text-[#8A7B63]">{d.cardsRefSub}</p>
        <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.cardsRefHint}</p>
        <div className="flex flex-col gap-1.5 mt-3">
          {chars.map(k => (
            <div key={k} className="flex items-center gap-3 rounded-2xl border-2 border-[#E5DCC0] bg-white px-2.5 py-2">
              <CoupCardFace card={{ id: k, kind: k }} d={d} size="sm" />
              <span className="flex-1 min-w-0 text-left">
                <span className="block font-extrabold text-sm">{CARD_NAMES[k]} <span className="text-[#8A7B63]">×3</span></span>
                <span className="block font-bold text-xs text-[#5C4B33] leading-snug">{CARD_EFFECTS(d)[k]}</span>
              </span>
              <span className="flex-none w-7 h-7 rounded-full text-white font-extrabold flex items-center justify-center" style={{ background: CARD_COLORS[k] }}>👑</span>
            </div>
          ))}
        </div>
        <div className="disp font-extrabold text-lg mt-5">{d.actIncome} · {d.actForeignAid} · {d.actCoup}</div>
        <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.actIncomeHint} · {d.actForeignAidHint} · {d.actCoupHint}</p>
        <button className={`${BTN} btn-amber w-full mt-4`} onClick={onClose}>OK 👍</button>
      </div>
    </div>
  );
}

const ACTIONS: { kind: ActionKind; needsTarget: boolean }[] = [
  { kind: 'income', needsTarget: false },
  { kind: 'foreign-aid', needsTarget: false },
  { kind: 'tax', needsTarget: false },
  { kind: 'assassinate', needsTarget: true },
  { kind: 'steal', needsTarget: true },
  { kind: 'exchange', needsTarget: false },
  { kind: 'coup', needsTarget: true },
];

export default function CoupApp() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  const [name, setName] = useState(() => sessionStorage.getItem('ct_name') || '');
  const [roomCodeInput, setRoomCodeInput] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const [forceCreate, setForceCreate] = useState(false);
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
  const [myRecord, setMyRecord] = useState<{ w: number; l: number }>({ w: 0, l: 0 });
  const [shareCopied, setShareCopied] = useState(false);
  // Target picker for Coup / Assassinate / Steal.
  const [actionPick, setActionPick] = useState<ActionKind | null>(null);
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  // Lose-influence picker (mine only).
  const [losePick, setLosePick] = useState<string | null>(null);
  // Exchange keep picker (mine only).
  const [keepPick, setKeepPick] = useState<string[]>([]);
  // Elimination verdict (v50 pattern): staged — face-up hand + one-line cause, then spectate.
  const [elimOpen, setElimOpen] = useState(false);
  const [elimInfo, setElimInfo] = useState<{ cause: string; cards: Card[] } | null>(null);
  const [elimFlashId, setElimFlashId] = useState<string | null>(null);
  const prevElimRef = useRef<boolean | null>(null);
  const myHandRef = useRef<Card[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
  useEffect(() => { setActionPick(null); setPickTarget(null); setLosePick(null); setKeepPick([]); setElimOpen(false); }, [pub?.phase]);
  useEffect(() => { setActionPick(null); setPickTarget(null); }, [pub?.pending?.stage]);
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
      }, 'coup');
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
      const won = pub.winner === joined.playerId;
      setMyRecord(r => ({ w: r.w + (won ? 1 : 0), l: r.l + (won ? 0 : 1) }));
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
      }, 'coup', getNet().getBrokerUrl?.());
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

  /* ---------- derived game state ---------- */
  const myTurn = pub?.phase === 'playing' && pub.turn === joined?.playerId && !!me && !me.eliminated;
  const myHand = priv?.myHand ?? [];
  const pending = pub?.pending ?? null;
  const pendingAction = pending && (pending.stage === 'respond' || pending.stage === 'blockWindow' || pending.stage === 'blockRespond') ? pending.action : null;
  const myActionPending = myTurn && !pending;
  const legal = new Set(myTurn && me ? legalActions({ phase: 'playing' } as any, { ...me } as any) : []);
  const mustCoup = !!me && me.coins >= MUST_COUP_AT;
  // Am I being asked to respond to someone else's action?
  const respondStage = pending && (pending.stage === 'respond' || pending.stage === 'blockWindow') ? pending.stage : null;
  const iRespond = !!pending && (pending.stage === 'respond' || pending.stage === 'blockWindow')
    && !!pendingAction && pendingAction.actorId !== joined?.playerId
    && !pending.passed.includes(joined!.playerId) && !!me && !me.eliminated;
  const iAmTarget = !!pendingAction && pendingAction.targetId === joined?.playerId;
  const blockChars = pendingAction ? (BLOCK_CHARS[pendingAction.kind] ?? []) : [];
  const canBlockNow = !!pendingAction && (pendingAction.kind === 'foreign-aid' ? true : iAmTarget);
  const canChallengeNow = !!pendingAction && !!pendingAction.char;
  const iChallengeBlock = !!pending && pending.stage === 'blockRespond' && pending.blockerId !== joined?.playerId
    && !pending.passed.includes(joined!.playerId) && !!me && !me.eliminated;
  const myLose = pending?.stage === 'chooseLose' && pending.playerId === joined?.playerId;
  const myExchange = pending?.stage === 'exchange' && pending.actorId === joined?.playerId;
  const keepCount = pending?.stage === 'exchange' ? pending.keepCount : 0;

  const doDeclare = (kind: ActionKind, targetId?: string) => {
    getNet().nightAction('declareAction', undefined, { kind, ...(targetId ? { targetId } : {}) });
    setActionPick(null); setPickTarget(null);
  };
  const doRespond = (move: 'pass' | 'challenge' | 'block', blockChar?: CharKind) => {
    if (respondStage === 'blockWindow') getNet().nightAction('respondBlockWindow', undefined, { move, ...(blockChar ? { blockChar } : {}) });
    else getNet().nightAction('respond', undefined, { move, ...(blockChar ? { blockChar } : {}) });
  };
  const doRespondBlock = (move: 'pass' | 'challenge') => {
    getNet().nightAction('respondBlock', undefined, { move });
  };

  /* ---------- shared bits ---------- */
  const tone = phase === 'results' ? 'navy' : 'cream';
  const connected = pub?.players.filter(p => p.connected).length ?? 0;
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';
  const others = pub?.players.filter(p => p.id !== joined?.playerId) ?? [];
  const turnPlayer = pub?.players.find(p => p.id === pub?.turn);
  const pendingActor = pendingAction ? pub?.players.find(p => p.id === pendingAction.actorId) : null;
  const pendingBlocker = pending?.stage === 'blockRespond' ? pub?.players.find(p => p.id === pending.blockerId) : null;

  const feedText = (e: FeedEntry | null | undefined): string | null => {
    if (!e) return null;
    const by = playerName(e.by);
    const tgt = e.targetId ? playerName(e.targetId) : '';
    const charName = (e.char ?? e.card) ? CARD_NAMES[(e.char ?? e.card)!] : '';
    const actionName = e.action ? ACTION_NAMES(d)[e.action] : '';
    switch (e.kind) {
      case 'action': return d.fedAction(by, actionName, tgt || undefined);
      case 'challenge-win': return d.fedChallengeWin(by, tgt, charName);
      case 'challenge-fail': return d.fedChallengeFail(by, tgt, charName);
      case 'block': return d.fedBlock(by, tgt, charName);
      case 'block-challenge-win': return d.fedBlockChallengeWin(by, tgt, charName);
      case 'block-challenge-fail': return d.fedBlockChallengeFail(by, tgt, charName);
      case 'lose': return d.fedLose(by, charName);
      case 'eliminated': return d.fedEliminated(by);
      case 'exchange': return d.fedExchange(by);
      case 'win': return d.fedWin(by);
      default: return null;
    }
  };

  // Elimination verdict (v50): remember the hand I held while alive —
  // the engine reveals it face-up the moment I am out, so the private
  // hand is empty by the time the public state arrives.
  useEffect(() => { if (me && !me.eliminated && myHand.length) myHandRef.current = myHand; }, [myHand, me?.eliminated]);
  useEffect(() => {
    if (phase !== 'playing' || !me) return;
    const was = prevElimRef.current;
    prevElimRef.current = me.eliminated;
    if (!me.eliminated) { setElimOpen(false); return; }
    if (was === false && me.eliminated === true) {
      setElimInfo({ cause: feedText(pub?.feed?.[0]) ?? '', cards: myHandRef.current });
      setElimOpen(true);
      sfx('pop', muted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.eliminated, phase]);
  // Brief red ring pulse on ANY seat that just got eliminated.
  const prevElimMap = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (phase !== 'playing' || !pub) return;
    const prev = prevElimMap.current;
    const next: Record<string, boolean> = {};
    for (const p of pub.players) {
      next[p.id] = p.eliminated;
      if (prev[p.id] === false && p.eliminated === true) setElimFlashId(p.id);
    }
    prevElimMap.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub?.players, phase]);
  useEffect(() => {
    if (!elimFlashId) return;
    const t = setTimeout(() => setElimFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [elimFlashId]);

  const standings = pub && phase === 'results'
    ? [pub.winner!, ...[...pub.eliminationOrder].reverse()].filter(Boolean)
    : [];
  const shareText = () => {
    const lines = [`👑 ${d.title} — ${playerName(pub?.winner)} ${d.winner}`];
    if (myRecord.w + myRecord.l > 0) lines.push('📊 ' + d.recordLine(myRecord.w, myRecord.l, 0));
    return lines.join('\n');
  };
  const doShare = async () => {
    try { await navigator.clipboard.writeText(shareText()); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); } catch { /* ignore */ }
  };

  const chatAside = pub && phase === 'playing' && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="bg-[#3B2F1E] border-[3px] border-[#2B2016] rounded-[24px] p-4 hard mb-4">
        <div className="disp font-extrabold text-lg mb-2 text-[#FFF3CF]">📜 {d.feedTitle}</div>
        <div className="space-y-1.5">
          {(pub.feed ?? []).map((e, i) => (
            <div key={i} className="flex items-start gap-2 font-bold text-sm leading-snug text-[#F3E3C6]">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-[#FFB020] flex-none" />
              <span>{feedText(e)}</span>
            </div>
          ))}
          {(pub.feed ?? []).length === 0 && <p className="font-bold text-sm text-[#F3E3C6]">…</p>}
        </div>
      </div>
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.chatTitle}</div>
        <ChatPanel chat={pub.chat} myId={joined?.playerId ?? ''} d={d} height="flex" onChat={onChat} reactions={COUP_REACTIONS} />
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, COUP_REACTIONS)}</span>
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
            <span className="rotate-[-18deg] translate-y-2"><CoupCardFace card={{ id: 'fan-duke', kind: 'duke' }} d={d} size="md" /></span>
            <span className="rotate-[-9deg] translate-y-1"><CoupCardFace card={{ id: 'fan-assassin', kind: 'assassin' }} d={d} size="md" /></span>
            <span className="z-10 -translate-y-1"><CoupCardFace card={{ id: 'fan-captain', kind: 'captain' }} d={d} size="md" /></span>
            <span className="rotate-[9deg] translate-y-1"><CoupCardFace card={{ id: 'fan-ambassador', kind: 'ambassador' }} d={d} size="md" /></span>
            <span className="rotate-[18deg] translate-y-2"><CoupCardFace card={{ id: 'fan-contessa', kind: 'contessa' }} d={d} size="md" /></span>
          </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] px-4 pt-4 pb-6 mt-5">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            {!joinMode && (<button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>👑 {d.create}</button>)}
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
              <button className="font-bold text-sm text-[#8A7B63] underline" onClick={() => setShowHelp(true)}>{d.viewCards}</button>
            </p>
          </div>
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-3">
        <TopBar logo={<span className="text-2xl">👑</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        {phase !== 'lobby' && (<button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>)}
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {migrating && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">🔄 {d.statusMigrating}</div>}
        {error && <><div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div><RetryDefaultButton d={d} /></>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs push font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-xl sm:text-2xl leading-none">👑 {d.title} · {d.lobby}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-1 hidden sm:block">{d.waiting}</p>
              </div>
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
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=coup&room=${pub!.roomCode}`); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}>{linkCopied ? `✅ ${d.copied}` : `🔗 ${d.copyLink}`}</button>
            </div>
            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4 mt-2">
              <div className="card-cream p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">{connected}/{MAX_PLAYERS} · {d.needAtLeast(MIN_PLAYERS)}</span>
                </div>
                <div className="flex flex-col gap-1.5 my-1.5">
                  {pub!.players.map(p => (
                    <div key={p.id} className={`flex items-center gap-2.5 rounded-2xl px-3 py-1 hard-xs ${p.id === joined.playerId ? 'bg-[#2B2016] ring-2 ring-amber-400' : 'bg-[#23233F]'} text-[#FFF3CF]`}>
                      <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state="awake" />} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-extrabold truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}</span>
                        {!p.connected && <span className="text-red-400 text-xs font-bold">{d.offline}</span>}
                      </span>
                      {p.isHost && <span className="flex-none text-xs font-extrabold bg-[#FFB020] text-[#2B2016] rounded-full px-2 py-1">👑 {d.host}</span>}
                      {joined.isHost && p.id !== joined.playerId && (
                        <span role="button" title={d.kick}
                          onClick={() => { getNet().kick(p.id); }}
                          className="flex-none text-xs bg-red-500/20 text-red-300 font-bold rounded-full px-2 py-1 cursor-pointer hover:bg-red-500/30">✖ {d.kick}</span>)}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, 6 - pub!.players.length) }).map((_, i) => (
                    <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] p-2 text-center text-[#8A7B63] font-bold text-xs hidden lg:flex items-center justify-center min-h-[40px]">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
                  ))}
                </div>
                {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
                <button className={`${BTN} bg-[#FFFBef] text-[#D63A2F] w-full mt-2 hidden lg:block`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>🚪 {d.leave}</button>
              </div>
              <div className="card-cream p-3 mt-2 lg:mt-0">
                <h3 className="disp font-extrabold text-xl">{d.settingsTitle}</h3>
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
                    <p className="font-bold text-sm text-[#5C4B33]">{d.cardsRefSub} · {d.actCoupHint}</p>
                  </div>
                )}
                {!joined.isHost && (
                  <p className="font-bold text-sm text-[#5C4B33] mt-2">🕐 {d.secondsUnit(pub!.config.turnSeconds)} · {d.cardsRefSub}</p>
                )}
                {joined.isHost ? (
                  <>
                    <button className={`${BTN} btn-amber w-full mt-3`} disabled={connected < MIN_PLAYERS}
                      onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                    {connected < MIN_PLAYERS && <p className="text-center font-bold text-red-600 text-sm mt-2">{d.need2}</p>}
                  </>
                ) : (
                  <p className="text-center font-bold text-[#8A7B63] mt-3">{d.waiting}</p>
                )}
              </div>
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'playing' && pub && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div className="min-w-0">
              {/* spectating banner — labelled, with a way out (v50) */}
              {me && me.eliminated && !elimOpen && (
                <div className="flex items-center gap-2 bg-[#2B2016] text-[#FFF3CF] rounded-2xl px-3 py-1.5 mb-2 font-bold text-sm">
                  <span className="flex-1">👀 {d.spectating}</span>
                  <button className="font-extrabold text-[#FFB020] underline" onClick={() => { location.href = location.pathname; }}>{d.leaveTable}</button>
                </div>
              )}
              {/* opponents */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {others.map(p => (
                  <div key={p.id} className={`flex-none rounded-2xl px-2 py-1 hard-xs min-w-[150px] border-2 border-[#2B2016] bg-[#3B2F1E] ${pub.turn === p.id ? 'ring-4 ring-amber-400' : ''} ${p.eliminated ? 'opacity-60' : ''} ${elimFlashId === p.id ? 'anim-elim-flash' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="relative flex-none">
                        <PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state={p.eliminated ? 'dead' : 'awake'} />} />
                        {speakingIds.has(p.id) && <span className="absolute -bottom-1 -left-1 bg-green-500 text-white text-[10px] rounded-full px-1 shadow">🎙️</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-extrabold text-sm truncate text-[#FFF3CF] max-w-[96px]">{p.name}{!p.connected ? ` (${d.offline})` : ''}</span>
                        <span className="block font-bold text-xs text-[#F3E3C6]">🪙 {p.coins} · 🃏 {p.handCount}</span>
                      </span>
                    </div>
                    {p.eliminated && <div className="font-extrabold text-[11px] text-[#F3C6D8] mt-1">{d.out}</div>}
                    <div className="mt-1"><RevealedChips pile={p.revealed} /></div>
                  </div>
                ))}
              </div>

              {/* table — glows amber on my turn (turn signal, no text needed) */}
              <div className={`mt-2 rounded-[28px] border-[3px] border-[#2B2016] hard p-2 ${myTurn ? 'anim-turn-glow' : ''}`} style={{ background: '#3B2F1E' }}>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <span className="disp font-extrabold text-[#FFF3CF] text-lg">
                    {myTurn ? d.yourTurn : d.turnOf(turnPlayer?.name ?? '')}
                  </span>
                  <TimerPill endsAt={pub.turnEndsAt} dark />
                  <span className="hidden sm:inline font-bold text-[#F3E3C6] text-xs">{d.turnTimeout}</span>
                </div>
                <div className="flex items-start justify-center gap-4 sm:gap-8 mt-1.5">
                  <div className="text-center">
                    <CoupCardBack size="sm" />
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1">{d.courtDeck} · {pub.courtCount}</span>
                  </div>
                  <div className="text-center">
                    <span className="inline-flex w-[46px] h-[66px] items-center justify-center rounded-xl border-[3px] border-[#F3E3C6]/60 flex-col">
                      <span className="text-xl">🪙</span>
                      <span className="font-extrabold text-[#FFF3CF] text-xs">{me?.coins ?? 0}</span>
                    </span>
                    <span className="block font-extrabold text-[#FFF3CF] text-sm mt-1">{d.coins}</span>
                  </div>
                </div>
                {pending && pending.stage === 'respond' && pendingAction && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">⚖️ {d.respondWaiting(playerName(pendingAction.actorId), ACTION_NAMES(d)[pendingAction.kind])}</p>
                )}
                {pending && pending.stage === 'blockWindow' && pendingAction && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">🛡️ {d.respondWaiting(playerName(pendingAction.actorId), ACTION_NAMES(d)[pendingAction.kind])}</p>
                )}
                {pending && pending.stage === 'blockRespond' && pendingBlocker && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">🛡️ {d.blockWaiting(playerName(pendingBlocker.id), CARD_NAMES[pending.blockChar])}</p>
                )}
                {pending && (pending.stage === 'chooseLose' || pending.stage === 'exchange') && (
                  <p className="text-center font-bold text-[#FFF3CF] text-sm mt-3">⏳ {d.waitingResponse}</p>
                )}
              </div>

              {/* last event banner — phone only; on laptop the Diễn biến feed shows it */}
              {feedText(pub.feed?.[0]) && (
                <div className="mt-2 bg-[#FFFBef] border-2 border-[#E5DCC0] rounded-2xl px-3 py-1.5 font-bold text-[13px] text-[#5C4B33] lg:hidden">📜 {feedText(pub.feed[0])}</div>
              )}

              {/* response bar — my turn to answer someone else's action/block */}
              {(iRespond || iChallengeBlock) && (
                <div className="mt-2 rounded-[20px] border-[3px] border-[#2B2016] bg-[#FFFBef] hard p-3" data-testid="respond-bar">
                  <div className="disp font-extrabold text-base">⚖️ {d.respondTitle}</div>
                  {pendingAction && (
                    <p className="font-bold text-sm text-[#5C4B33] mt-0.5">
                      {playerName(pendingAction.actorId)} · {ACTION_NAMES(d)[pendingAction.kind]}
                      {pendingAction.targetId ? ` → ${playerName(pendingAction.targetId)}` : ''}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {iRespond && canChallengeNow && (
                      <button data-testid="respond-challenge" className={`${BTN} btn-dark flex-1 min-w-[120px]`} onClick={() => doRespond('challenge')}>🗡️ {d.challenge}</button>
                    )}
                    {iRespond && canBlockNow && blockChars.map(c => (
                      <button key={c} data-testid="respond-block" data-block-char={c} className={`${BTN} flex-1 min-w-[120px] text-white`} style={{ background: CARD_COLORS[c] }} onClick={() => doRespond('block', c)}>🛡️ {d.block} · {CARD_NAMES[c]}</button>
                    ))}
                    {iChallengeBlock && (
                      <button data-testid="respond-block-challenge" className={`${BTN} btn-dark flex-1 min-w-[120px]`} onClick={() => doRespondBlock('challenge')}>🗡️ {d.challengeBlock}</button>
                    )}
                    <button data-testid="respond-pass" className={`${BTN} bg-white border-2 border-[#E5DCC0] text-[#5C4B33] flex-1 min-w-[120px]`} onClick={() => { if (iChallengeBlock) doRespondBlock('pass'); else doRespond('pass'); }}>{d.pass}</button>
                  </div>
                  <p className="font-bold text-xs text-[#8A7B63] mt-1.5">{iChallengeBlock ? d.challengeBlockHint : canChallengeNow ? d.challengeHint : canBlockNow ? d.blockHint : d.passHint}</p>
                </div>
              )}

              {/* my hand */}
              <div className="mt-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="disp font-extrabold text-lg">{d.myHand} · {myHand.length} {d.cards}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">🪙 {me?.coins ?? 0}</span>
                </div>
                {mustCoup && myTurn && <p className="font-bold text-sm text-[#D63A2F] mt-1">⚠ {d.mustCoup}</p>}
                <div className="flex gap-2 overflow-x-auto pb-2 pt-2 -mx-1 px-1">
                  {myHand.map((c, hi) => (
                    <span key={c.id} data-testid="hand-card" data-card-id={c.id} className="flex-none anim-card-fall" style={{ animationDelay: `${hi * 45}ms` }}>
                      <CoupCardFace card={c} d={d} size="md" />
                    </span>
                  ))}
                  {myHand.length === 0 && <p className="font-bold text-[#8A7B63] py-6">…</p>}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-bold text-sm text-[#5C4B33] flex-none">{d.myDiscards}:</span>
                  <span className="overflow-x-auto"><RevealedChips pile={me?.revealed ?? []} /></span>
                </div>
              </div>

              {/* action bar — my turn, no open pending */}
              {myActionPending && (
                <div className="mt-2">
                  <p className="font-bold text-[#8A7B63] text-sm">{d.playHint}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                    {ACTIONS.map(a => {
                      const ok = legal.has(a.kind);
                      const label = ACTION_NAMES(d)[a.kind];
                      const hint = ACTION_HINTS(d)[a.kind];
                      return (
                        <button key={a.kind} data-testid="action-btn" data-action-kind={a.kind} disabled={!ok}
                          onClick={() => { if (a.needsTarget) { setActionPick(a.kind); setPickTarget(null); } else doDeclare(a.kind); }}
                          className={`rounded-2xl border-[3px] border-[#2B2016] px-2 py-2 font-extrabold text-sm push text-left ${ok ? 'bg-[#FFFBef] text-[#2B2016]' : 'bg-[#E5DCC0] text-[#8A7B63] opacity-60'} ${a.kind === 'coup' ? 'bg-[#D63A2F] !text-white' : ''}`}>
                          <span className="block disp text-[15px] leading-none">{label}</span>
                          <span className="block font-bold text-[10px] leading-snug mt-0.5 opacity-80">{hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  {mustCoup && <p className="font-bold text-xs text-[#D63A2F] mt-1.5">{d.mustCoupHint}</p>}
                </div>
              )}
              {chatPreviewBar}
            </div>
            {chatAside}
          </div>
        )}

        {phase === 'results' && pub && (
          <div className="max-w-md lg:max-w-lg mx-auto text-center">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.results.toUpperCase()}</p>
            <h2 className="disp font-extrabold text-4xl mt-2">👑 {playerName(pub.winner)} {d.winner}</h2>
            <p className="text-[#B9BCE0] font-bold mt-1">{d.winnerSub}</p>
            <div className="card-cream !rounded-[28px] p-4 mt-4 text-left text-[#2B2016]">
              <div className="disp font-extrabold text-lg">{d.standings}</div>
              <div className="mt-2 space-y-1.5">
                {standings.map((pid, i) => {
                  const p = pub.players.find(x => x.id === pid);
                  if (!p) return null;
                  return (
                    <div key={pid} className="flex items-center gap-2 font-bold">
                      <span className="flex-none w-7 text-center disp font-extrabold">{i + 1}</span>
                      <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={36} fallback={<MouseAvatar seed={p.id} size={36} state="awake" />} /></span>
                      <span className="flex-1 truncate">{p.name}{p.id === joined.playerId ? ` (${d.you})` : ''}{p.id === pub.winner ? ' 👑' : ''}</span>
                      <span className="text-sm">{p.revealed.length} {d.cards} · 🪙 {p.coins}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 bg-[#DFF5E3] rounded-2xl px-3 py-2 font-bold text-sm text-[#2B2016]">
                📊 {d.recordTitle}: {d.recordLine(myRecord.w, myRecord.l, 0)}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className={`${BTN} btn-amber flex-1`} onClick={doShare}>📋 {shareCopied ? d.copied : d.shareResults}</button>
            </div>
            {joined.isHost ? (
              <div className="flex gap-2 mt-2">
                <button className={`${BTN} btn-green flex-1`} onClick={() => getNet().startGame()}>▶ {d.playAgain}</button>
                <button className={`${BTN} bg-[#FFFBef] text-[#2B2016] flex-1`} onClick={() => getNet().nightAction('playAgain')}>{d.backLobby}</button>
              </div>
            ) : (
              <p className="text-center font-bold text-[#B9BCE0] mt-4">{d.waiting}</p>
            )}
          </div>
        )}

        {/* target picker modal (Coup / Assassinate / Steal) */}
        {myActionPending && actionPick && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setActionPick(null)}>
            <div className={`${CARD} max-w-sm w-full text-center max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
              <div className="disp font-extrabold text-lg">🎯 {d.chooseTarget}</div>
              <p className="font-bold text-[13px] leading-snug text-[#5C4B33] mt-1">
                {ACTION_NAMES(d)[actionPick]} — {ACTION_HINTS(d)[actionPick]}
              </p>
              <div className="flex flex-col gap-1.5 mt-2 text-left">
                {pub!.players.filter(p => p.id !== joined.playerId && !p.eliminated).map(p => (
                  <button key={p.id} data-testid="pick-target" data-player-id={p.id}
                    onClick={() => setPickTarget(p.id)}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-2xl font-extrabold text-sm push text-left ${pickTarget === p.id ? 'bg-[#FFB020] text-[#2B2016] ring-4 ring-[#FFB020]/50' : 'bg-white text-[#2B2016]'}`}>
                    <PlayerAvatar avatarId={p.avatar} size={32} fallback={<MouseAvatar seed={p.id} size={32} state="awake" />} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-xs font-bold text-[#8A7B63]">🪙 {p.coins} · 🃏 {p.handCount}</span>
                    </span>
                    {pickTarget === p.id && <span className="text-lg">✅</span>}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button data-testid="pick-confirm" className={`${BTN} btn-amber flex-1`} disabled={!pickTarget} onClick={() => { if (pickTarget) doDeclare(actionPick, pickTarget); }}>{d.confirmTarget}</button>
                <button className="px-3 py-2 rounded-2xl font-bold text-sm bg-white border-2 border-[#E5DCC0] text-[#8A7B63] push" onClick={() => setActionPick(null)}>{d.cancelPick}</button>
              </div>
            </div>
          </div>
        )}
        {/* lose-influence modal (my choice) */}
        {myLose && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className={`${CARD} max-w-sm w-full text-center max-h-[85vh] overflow-auto`}>
              <div className="disp font-extrabold text-xl">💥 {d.loseTitle}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.loseHint}</p>
              <div className="flex justify-center gap-2 mt-3 flex-wrap">
                {myHand.map(c => (
                  <button key={c.id} data-testid="lose-pick" data-card-id={c.id}
                    onClick={() => setLosePick(c.id)}
                    className={`rounded-xl push transition ${losePick === c.id ? 'ring-4 ring-[#FFB020] -translate-y-1' : ''}`}>
                    <CoupCardFace card={c} d={d} size="md" />
                  </button>
                ))}
              </div>
              <button data-testid="lose-confirm" className={`${BTN} btn-amber w-full mt-4`} disabled={!losePick}
                onClick={() => { if (!losePick) return; getNet().nightAction('chooseLose', undefined, { cardId: losePick }); setLosePick(null); }}>{d.loseReveal}</button>
            </div>
          </div>
        )}
        {/* exchange modal (my choice) */}
        {myExchange && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className={`${CARD} max-w-sm w-full text-center max-h-[85vh] overflow-auto`}>
              <div className="disp font-extrabold text-xl">🔄 {d.exchangeTitle}</div>
              <p className="font-bold text-sm text-[#5C4B33] mt-1">{d.exchangeHint}</p>
              <p className="font-extrabold text-sm text-[#2B2016] mt-1">{d.keepCount(keepCount)}</p>
              <div className="flex justify-center gap-2 mt-3 flex-wrap">
                {myHand.map(c => {
                  const sel = keepPick.includes(c.id);
                  return (
                    <button key={c.id} data-testid="exchange-pick" data-card-id={c.id}
                      onClick={() => setKeepPick(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                      className={`rounded-xl push transition ${sel ? 'ring-4 ring-[#0E9F6E] -translate-y-1' : ''}`}>
                      <CoupCardFace card={c} d={d} size="md" />
                    </button>
                  );
                })}
              </div>
              <button data-testid="exchange-confirm" className={`${BTN} btn-amber w-full mt-4`} disabled={keepPick.length !== keepCount}
                onClick={() => { getNet().nightAction('chooseExchange', undefined, { keepCardIds: keepPick }); setKeepPick([]); }}>{d.exchangeKeep}</button>
            </div>
          </div>
        )}
        {/* Elimination verdict (v50): staged — face-up hand + one-line cause + spectate */}
        {phase === 'playing' && elimOpen && elimInfo && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setElimOpen(false)}>
            <div data-testid="elim-overlay" className="card-cream max-w-sm w-full text-center p-5 anim-pop" onClick={e => e.stopPropagation()}>
              <div className="text-5xl">💥</div>
              <div className="disp font-extrabold text-3xl mt-2 text-[#D63A2F]">{d.elimTitle}</div>
              {elimInfo.cause && <p className="font-bold text-sm text-[#5C4B33] mt-2">{elimInfo.cause}</p>}
              {elimInfo.cards.length > 0 && (
                <div className="flex justify-center gap-2 mt-3">
                  {elimInfo.cards.map(c => <span key={c.id} className="anim-card-flip"><CoupCardFace card={c} d={d} size="md" /></span>)}
                </div>
              )}
              <p className="font-bold text-xs text-[#8A7B63] mt-2">{d.elimHandNote}</p>
              <div className="flex gap-2 mt-4">
                <button data-testid="elim-spectate" className={`${BTN} btn-amber flex-1`} onClick={() => setElimOpen(false)}>{d.spectate}</button>
                <button className="px-3 py-2 rounded-2xl font-bold text-sm bg-white border-2 border-[#E5DCC0] text-[#8A7B63] push" onClick={() => { location.href = location.pathname; }}>{d.leaveTable}</button>
              </div>
            </div>
          </div>
        )}
        {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub?.chat ?? []} myId={joined.playerId} d={d} onChat={onChat} reactions={COUP_REACTIONS} />
      </div>
    </div>
  );
}
