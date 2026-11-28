import { useEffect, useRef, useState } from 'react';
import { createNet, Net } from '../../transport/net';
import { Pub, Priv } from './hostEngine';
import { t, Lang } from './i18n';
import { sfx, ensureCtx } from '../../transport/sound';
import { joinVoice, VoiceHandle } from '../../transport/voice';
import { TopBar, ChatPanel, ChatSheet, chatPreview, RetryDefaultButton } from '../../platform/ui';
import { WolfAvatar, MouseAvatar, RoleIcon, ROLE_STRONG, MoonVillage } from '../../platform/avatars';
import { RoleCard, PlayerAvatar } from '../../platform/GameCard';
import { roleTable, effectiveRoleConfig, MIN_PLAYERS, MAX_PLAYERS } from '../../../../games/ma-soi/logic';
import type { RoleConfig } from '../../../../games/ma-soi/logic';
import type { Role } from '../../../../games/ma-soi/logic';

const SESSION_KEY = 'ct_guest_session:ma-soi';
const WOLF_REACTIONS = ['👀', '🐺', '😱', '🤔', '👍', '👎', '😂', '❓'];

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
  const [roleSettingsOpen, setRoleSettingsOpen] = useState(false);
  const [chatSheet, setChatSheet] = useState(false);
  const [myRecord, setMyRecord] = useState<{ w: number; l: number; roles: Record<string, { w: number; g: number }> }>({ w: 0, l: 0, roles: {} });
  const [shareCopied, setShareCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [botAdding, setBotAdding] = useState(false);
  // Optimistic UI (same pattern as Cheese Thief): show the tap result
  // immediately, replace it when the host state arrives (6s fallback).
  const [optVote, setOptVote] = useState<string | null>(null);
  const [optReady, setOptReady] = useState(false);
  const [optReadyVote, setOptReadyVote] = useState(false);
  useEffect(() => { if (!optVote) return; const t = setTimeout(() => setOptVote(null), 6000); return () => clearTimeout(t); }, [optVote]);
  useEffect(() => { if (!optReady) return; const t = setTimeout(() => setOptReady(false), 6000); return () => clearTimeout(t); }, [optReady]);
  useEffect(() => { if (!optReadyVote) return; const t = setTimeout(() => setOptReadyVote(false), 6000); return () => clearTimeout(t); }, [optReadyVote]);
  useEffect(() => {
    if (!joined || !pub) return;
    if (pub.players.find(p => p.id === joined.playerId)?.hasVoted) setOptVote(null);
    if (pub.revealReady?.includes(joined.playerId)) setOptReady(false);
    if (pub.dayReady?.includes(joined.playerId)) setOptReadyVote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub]);
  useEffect(() => { setBotAdding(false); }, [pub?.players.length]);
  // Local pick highlight for the night grid (reset each step); the
  // authoritative pick lives in priv (wolves) / the peek list (seer).
  const [nightPick, setNightPick] = useState<string | null>(null);
  useEffect(() => { setNightPick(null); }, [pub?.nightStep]);
  // Unread chat count for the mobile preview bar: everything since the
  // player last opened the chat sheet or entered a new phase.
  const [seenChat, setSeenChat] = useState(0);
  const unreadChat = Math.max(0, (pub?.chat.length ?? 0) - seenChat);
  useEffect(() => { setSeenChat(pub?.chat.length ?? 0); }, [pub?.phase]);
  const [wolfChatText, setWolfChatText] = useState('');
  const recordedRounds = useRef<Set<string>>(new Set());
  const netRef = useRef<Net | null>(null);
  const voiceRef = useRef<VoiceHandle | null>(null);
  const [voiceSpeaker, setVoiceSpeaker] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMic, setVoiceMic] = useState<'off' | 'busy' | 'on'>('off');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const autoVoiceRef = useRef('');
  const voiceOptOutRef = useRef(false);
  const tapGuard = useRef(0);
  const allowTap = () => { const n = Date.now(); if (n - tapGuard.current < 500) return false; tapGuard.current = n; return true; };
  // Pending intents (v29 pattern): a tap that the host never confirmed is
  // re-fired when the connection recovers, so a vote never silently dies.
  const pendingRef = useRef<Record<string, { kind: string; targetId?: string }>>({});
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
  useEffect(() => { setChatSheet(false); pendingRef.current = {}; setOptVote(null); setOptReady(false); setOptReadyVote(false); }, [phase]);
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
      }, 'ma-soi', getNet().getBrokerUrl?.());
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
    setOptVote(targetId);
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
  const playerName = (id?: string | null) => pub?.players.find(p => p.id === id)?.name ?? '';

  // One grid, five faces (mockup): lobby = small mouse cards + empty
  // slots; pick = night picker (wolves see wolf faces, others mice);
  // day = compact mouse cards; vote = big 2-col cards with a status line;
  // results = horizontal rows (wolf = pink tint, dead = grey + strike).
  function PlayerGrid({ variant = 'day', pickable, onPick, selectedId }: {
    variant?: 'lobby' | 'pick' | 'day' | 'vote' | 'results';
    pickable?: (p: any) => boolean; onPick?: (id: string) => void; selectedId?: string | null;
  }) {
    const players = pub?.players ?? [];
    const cols = variant === 'vote' ? 'grid-cols-2 lg:grid-cols-4'
      : variant === 'results' ? 'grid-cols-2 lg:grid-cols-3'
      : variant === 'lobby' ? 'grid-cols-4'
      : variant === 'pick' ? 'grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-4 lg:grid-cols-5';
    const emptySlots = variant === 'lobby' ? Math.max(0, 12 - players.length) : 0;
    return (
      <div className={`grid ${cols} gap-2 my-3`}>
        {players.map((p, pi) => {
          const canPick = onPick && pickable ? pickable(p) : false;
          const dead = !p.alive;
          const isMe = p.id === joined?.playerId;
          const isWolfCard = (variant === 'pick' || variant === 'results')
            && ((variant === 'results' && p.role === 'wolf')
              || (variant === 'pick' && priv?.wolfTeam.some(w => w.id === p.id)));
          const selected = selectedId === p.id;
          const avSize = variant === 'lobby' ? 40 : 52;
          if (variant === 'results') {
            const bg = p.role === 'wolf' ? 'bg-[#FBE3E0]' : dead ? 'bg-[#E5E5E5]' : 'bg-[#FFFBef]';
            return (
              <div key={p.id} className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 hard-xs ${bg} anim-slide-up`} style={{ animationDelay: `${pi * 60}ms` }}>
                <span className="flex-none"><PlayerAvatar avatarId={p.avatar} size={44} fallback={isWolfCard ? <WolfAvatar seed={p.id} size={44} state="dead" /> : <MouseAvatar seed={p.id} size={44} state={dead ? 'dead' : 'awake'} />} /></span>
                <span className="min-w-0">
                  <span className={`block font-extrabold truncate ${dead ? 'line-through text-[#6B6257]' : 'text-[#2B2016]'}`}>{p.name}{isMe ? ` (${d.you})` : ''}</span>
                  {p.role && <span className={`block text-sm font-extrabold ${roleColor(p.role)}`}>{ROLE_EMOJI[p.role]} {roleLabel(d, p.role)}</span>}
                </span>
              </div>
            );
          }
          if (variant === 'vote') {
            const voted = !dead && p.hasVoted;
            return (
              <button key={p.id} disabled={!canPick}
                onClick={() => onPick?.(p.id)}
                className={`relative rounded-[20px] p-3 text-center hard-sm ${dead ? 'bg-[#EFEFEF] opacity-70' : voted ? 'bg-[#DFF5E3]' : isMe ? 'bg-[#EFE7D3]' : 'bg-white'} ${canPick ? 'hover:scale-[1.03] transition cursor-pointer' : 'cursor-default'}`}>
                {voted && <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#0E9F6E] text-white disp font-extrabold text-sm flex items-center justify-center border-2 border-[#2B2016] anim-badge-pop">✓</span>}
                <span className="mx-auto block w-fit"><PlayerAvatar avatarId={p.avatar} size={56} fallback={isWolfCard ? <WolfAvatar seed={p.id} size={56} state="wolf" /> : <MouseAvatar seed={p.id} size={56} state={dead ? 'dead' : 'awake'} />} /></span>
                <span className={`block font-extrabold text-lg mt-1 ${dead ? 'line-through text-gray-500' : 'text-[#2B2016]'}`}>{p.name}{isMe ? ` (${d.you})` : ''}</span>
                <span className="block text-sm font-bold text-[#8A7B63] mt-0.5">
                  {dead ? '' : p.hasVoted ? d.votedAlready : isMe ? d.cantSelfVote : d.thinking}
                </span>
              </button>
            );
          }
          if (variant === 'lobby') {
            // Lobby cards are plain divs, NOT disabled buttons: the host's
            // kick / remove-bot ✕ lives inside the card, and a disabled
            // <button> swallows clicks on its children (B1: kick was dead).
            return (
              <div key={p.id} className={`relative rounded-2xl text-[#2B2016] p-1.5 text-center hard-xs ${dead ? 'bg-[#D8D8D8]' : isMe ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'}`}>
                {speakingIds.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
                <span className="mx-auto block w-fit">
                  <PlayerAvatar avatarId={p.avatar} size={avSize} fallback={isWolfCard ? <WolfAvatar seed={p.id} size={avSize} state={dead ? 'dead' : 'wolf'} /> : <MouseAvatar seed={p.id} size={avSize} state={dead ? 'dead' : phase === 'night' ? 'asleep' : 'awake'} />} />
                </span>
                <span className={`block font-bold truncate text-sm mt-0.5 ${dead ? 'line-through text-gray-500' : ''}`}>{p.name}{isMe ? ` (${d.you})` : ''}</span>
                {(p as any).isBot && <span className="text-xs font-extrabold bg-[#23233F] text-[#FFB020] rounded-full px-2 py-0.5 mt-0.5 inline-block">🤖 {d.botTag}</span>}
                {p.isHost && <span className="text-amber-600 text-xs font-extrabold">👑 {d.host}</span>}
                {!p.connected && <span className="text-red-500 text-xs font-bold"> • {d.offline}</span>}
                {joined?.isHost && !isMe && (
                  <span role="button" title={(p as any).isBot ? d.removeBot : d.kick}
                    onClick={() => { if ((p as any).isBot) getNet().nightAction('removeBot', p.id); else getNet().kick(p.id); }}
                    className="inline-block text-xs bg-red-100 text-red-600 font-bold rounded-full px-2 py-0.5 mt-1 cursor-pointer hover:bg-red-200">✖ {(p as any).isBot ? d.removeBot : d.kick}</span>)}
              </div>
            );
          }
          return (
            <button key={p.id} disabled={onPick ? !canPick : true}
              onClick={() => { onPick?.(p.id); }}
              className={`relative rounded-2xl text-[#2B2016] p-1.5 text-center hard-xs ${selected ? 'bg-[#FFE3E0] ring-4 ring-[#D63A2F]' : dead ? 'bg-[#D8D8D8]' : isMe ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${onPick ? 'hover:scale-105 transition cursor-pointer' : 'cursor-default'} disabled:opacity-70 disabled:hover:scale-100`}>
              {speakingIds.has(p.id) && <span className="absolute -bottom-2 -left-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow anim-pulse-soft">🎙️</span>}
              <span className="mx-auto block w-fit">
                <PlayerAvatar avatarId={p.avatar} size={avSize} fallback={isWolfCard ? <WolfAvatar seed={p.id} size={avSize} state={dead ? 'dead' : 'wolf'} /> : <MouseAvatar seed={p.id} size={avSize} state={dead ? 'dead' : phase === 'night' ? 'asleep' : 'awake'} />} />
              </span>
              <span className={`block font-bold truncate text-sm mt-0.5 ${dead ? 'line-through text-gray-500' : ''}`}>{p.name}{isMe ? ` (${d.you})` : ''}</span>
              {selected && variant === 'pick' && <span className="block text-xs font-extrabold text-[#D63A2F] mt-0.5">{lang === 'vi' ? 'đã chọn' : 'picked'}</span>}
            </button>
          );
        })}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div key={'empty-' + i} className="rounded-2xl border-2 border-dashed border-[#C9BFA5] p-2 text-center text-[#8A7B63] font-bold text-xs hidden lg:flex items-center justify-center min-h-[86px]">{lang === 'vi' ? 'Đang chờ…' : 'Waiting…'}</div>
        ))}
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

  /* ---------- landing (mockup "Ma Sói 1": moon + village hero, cream form) ---------- */
  if (!joined) {
    return (
      <div className="min-h-dvh bg-[#14142B] text-[#2B2016]">
        <div className="max-w-md lg:max-w-5xl mx-auto">
          <div className="flex items-center gap-2 px-3 pt-3">
            <button className="disp font-extrabold text-[#FFF3CF] text-sm bg-[#23233F] border-2 border-[#3D3D63] rounded-full px-3 py-2.5 push" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>
            <span className="flex-1" />
            <button title={muted ? '🔕' : '🔊'} className="w-11 h-11 push rounded-full bg-[#23233F] border-2 border-[#3D3D63] text-lg flex items-center justify-center" onClick={toggleMuted}>{muted ? '🔕' : '🔊'}</button>
            <span className="inline-flex rounded-full overflow-hidden border-2 border-[#3D3D63] text-sm font-black">
              <button className={`px-2.5 py-1 ${lang === 'vi' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => { localStorage.setItem('ct_lang', 'vi'); setLang('vi'); }}>VI</button>
              <button className={`px-2.5 py-1 ${lang === 'en' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => { localStorage.setItem('ct_lang', 'en'); setLang('en'); }}>EN</button>
            </span>
          </div>
          <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-center lg:px-6">
            <div>
          <div className="text-center px-4 pt-4">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px]">{d.kicker}</p>
            <h1 className="disp text-[#FFF3CF] font-extrabold text-5xl leading-none mt-2">{d.title}</h1>
            <p className="text-[#B9BCE0] font-bold mt-2 leading-snug">{d.subtitle}</p>
          </div>
          <MoonVillage width={390} />
            </div>
          <div className="bg-[#FFF3CF] rounded-t-[28px] lg:rounded-[28px] px-4 pt-4 pb-6 -mt-1 lg:mt-0">
            <label className="disp font-extrabold text-sm">{d.name}</label>
            <input className="inp w-full px-4 py-3 font-bold mt-1" placeholder="VD: An"
              value={name} maxLength={20} onChange={e => { setName(e.target.value); sessionStorage.setItem('ct_name', e.target.value); }} />
            {!joinMode && (<button className={`${BTN} btn-amber w-full mt-3`} disabled={!name.trim() || !!status}
              onClick={() => { setError(''); getNet().createRoom(name.trim()); }}>🌙 {d.create}</button>)}
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
          </div>
          {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
        </div>
      </div>
    );
  }

  const secretBar = priv?.myRole && phase !== 'lobby' && (
    <div className="bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl px-3 py-2 mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="disp font-extrabold text-[#FFB020] text-sm tracking-wide">BÍ MẬT</span>
        <span className="font-extrabold text-[#FFF3CF]">{d.roleWord}: <span className={priv.myRole === 'wolf' ? 'text-[#FF8A80]' : 'text-[#FFB020]'}>{roleLabel(d, priv.myRole)}</span></span>
        {priv.myRole === 'wolf' && priv.wolfTeam.length > 1 && (
          <span className="text-[#B9BCE0] font-bold text-sm">{d.wolfTeammates}: {priv.wolfTeam.filter(w => w.id !== joined.playerId).map(w => w.name).join(', ')}</span>
        )}
        {amDead && <span className="text-red-300 font-bold text-sm">💀 {lang === 'vi' ? 'Bạn đã chết — đang theo dõi' : 'You are dead — watching'}</span>}
      </div>
      {priv.myRole === 'witch' && (
        <div className="text-[#B9BCE0] font-bold text-sm mt-0.5">{d.witchPotions(priv.witchSaveLeft ? 1 : 0, priv.witchKillLeft ? 1 : 0)}</div>
      )}
      {priv.myRole === 'seer' && priv.seerPeeks.length > 0 && (
        <div className="text-[#B9BCE0] font-bold text-sm mt-0.5">🔮 {priv.seerPeeks.length} {lang === 'vi' ? 'đã soi' : 'peeked'}</div>
      )}
    </div>
  );

  /* ---------- lobby role setup (host only): wolves 2/3, witch +
   *  hunter toggles. A toggle is disabled when the table would have no
   *  villager left — the engine would silently drop it, so the UI says
   *  so first. The role preview underneath updates live. */
  function RoleSettings({ showSummary, showDiscussion, collapsible, open, onToggle }: { showSummary?: boolean; showDiscussion?: boolean; collapsible?: boolean; open?: boolean; onToggle?: () => void }) {
    if (!joined?.isHost || !pub) return null;
    const n = connected;
    const o = pub.roleOverrides ?? {};
    const eff = effectiveRoleConfig(n, o);
    const canSet = (patch: Partial<RoleConfig>) => {
      const t = roleTable(n, { ...o, ...patch });
      if (patch.witch === true) return t.some(x => x.role === 'witch' && x.count === 1);
      if (patch.hunter === true) return t.some(x => x.role === 'hunter' && x.count === 1);
      if (patch.wolves === 3) return (t.find(x => x.role === 'villager')?.count ?? 0) >= 1;
      return true;
    };
    const set = (patch: Partial<RoleConfig>) => { if (!allowTap()) return; getNet().nightAction('setRoles', undefined, { overrides: patch }); };
    const pillStyle = (on: boolean, color: string) => on ? { background: color, color: '#FFF3CF' } : { background: '#FFFBef', color: '#2B2016' };
    return (
      <div className="mt-2 rounded-2xl border-2 border-dashed border-[#C9BFA5] p-1.5 text-[#2B2016]">
        {collapsible ? (
          <button className="disp font-extrabold text-sm w-full text-left flex items-center justify-between" onClick={onToggle}>
            <span>⚙️ {d.rolesSettings}</span><span>{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <div className="disp font-extrabold text-sm">⚙️ {d.rolesSettings}</div>
        )}
        {showSummary && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {roleTable(n, o).map(x => (<span key={x.role} className="inline-block bg-[#FFF3CF] border-2 border-[#E5DCC0] rounded-full px-2 py-0.5 font-extrabold text-xs text-[#2B2016]">{roleLabel(d, x.role)} ×{x.count}</span>))}
          </div>
        )}
        {(!collapsible || open) && (<>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="font-extrabold text-sm">🐺 {d.wolvesCount}:</span>
          {[2, 3].map(v => (
            <button key={v} disabled={v === 3 && !canSet({ wolves: 3 })}
              onClick={() => set({ wolves: v as 2 | 3 })}
              className={`disp px-3.5 py-2.5 min-h-[44px] rounded-full font-extrabold text-sm push ${eff.wolves === v ? 'bg-[#D63A2F] text-white hard-xs' : 'bg-white hard-xs'} disabled:opacity-30`}>
              {v}
            </button>
          ))}
          <button disabled={!eff.witch && !canSet({ witch: true })} onClick={() => set({ witch: !eff.witch })}
            className="disp px-3.5 py-2.5 min-h-[44px] rounded-full font-extrabold text-sm push hard-xs border-2 border-[#2B2016] disabled:opacity-30"
            style={pillStyle(eff.witch, '#7C4DBD')}>🧪 {d.witch}</button>
          <button disabled={!eff.hunter && !canSet({ hunter: true })} onClick={() => set({ hunter: !eff.hunter })}
            className="disp px-3.5 py-2.5 min-h-[44px] rounded-full font-extrabold text-sm push hard-xs border-2 border-[#2B2016] disabled:opacity-30"
            style={pillStyle(eff.hunter, '#B45309')}>🏹 {d.hunter}</button>
        </div>
        {showDiscussion && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="font-extrabold text-sm">{d.discussionTime}:</span>
            {[60000, 120000, 180000].map(ms => (
              <button key={ms} onClick={() => { if (allowTap()) getNet().setDiscussion(ms); }}
                className={`disp px-3.5 py-2.5 min-h-[44px] rounded-full font-extrabold text-sm push ${pub!.discussionMs === ms ? 'bg-[#2B2016] text-[#FFF3CF] hard-xs' : 'bg-white hard-xs'}`}>
                {ms / 60000}:00
              </button>
            ))}
          </div>
        )}
        </>)}
      </div>
    );
  }

  // Night step tabs (mockup): only the steps this game actually has, in
  // night order; the current step is filled with its role color.
  const nightSteps = (): { key: string; label: string; color: string }[] => {
    const steps: { key: string; label: string; color: string }[] = [];
    if (pub?.pendingHunterShot || pub?.nightStep === 'hunter') steps.push({ key: 'hunter', label: d.stepHunterShort, color: '#B45309' });
    steps.push({ key: 'wolves', label: d.stepWolfShort, color: '#D63A2F' });
    steps.push({ key: 'seer', label: d.stepSeerShort, color: '#2E7CD6' });
    steps.push({ key: 'guardian', label: d.stepGuardShort, color: '#0E9F6E' });
    if (roleTable(pub?.players.length ?? 0, pub?.roleOverrides ?? {}).some(t => t.role === 'witch')) steps.push({ key: 'witch', label: d.stepWitchShort, color: '#7C4DBD' });
    return steps;
  };

  const chatAside = pub && phase === 'day' && (
    <aside className="hidden lg:flex flex-col min-h-0">
      <div className="card-cream p-3 flex flex-col flex-1 min-h-0">
        <div className="disp font-extrabold text-lg mb-2">💬 {d.villageChat}</div>
        <ChatPanel chat={pub.chat} myId={joined.playerId} d={d} height="flex" onChat={onChat} reactions={WOLF_REACTIONS} readOnly={!!amDead} />
        {amDead
          ? <p className="text-center font-extrabold text-[#8A7B63] mt-3">{d.deadSpectate}</p>
          : pub!.dayReady.includes(joined.playerId) || optReadyVote
          ? <p className="text-center font-extrabold text-[#0E9F6E] mt-3">{d.readyVoteDone}</p>
          : <button className={`${BTN} btn-dark w-full mt-3`} onClick={() => { setOptReadyVote(true); pendingRef.current.readyVote = { kind: 'readyVote' }; getNet().readyVote(); }}>
            {d.readyVoteBtn}
          </button>}
        <p className="text-center font-bold text-[#8A7B63] text-sm mt-2">{d.readyVoteOf(pub!.dayReady.length, pub!.players.filter(p => p.connected && p.alive).length)}</p>
        {joined.isHost && (
          <button className="disp w-full text-center font-extrabold text-sm text-[#D63A2F] mt-1" onClick={() => getNet().toVoting()}>{d.toVote}</button>
        )}
      </div>
    </aside>
  );
  const chatPreviewBar = pub && lastChat && (phase === 'lobby' || phase === 'day' || phase === 'results') && (
    <button className="lg:hidden w-full text-left bg-[#FFFBef] hard-sm rounded-2xl px-3 py-2 mb-2 flex items-center gap-2" onClick={() => { setSeenChat(pub.chat.length); setChatSheet(true); }}>
      <span className="font-bold text-sm text-[#5C4B33] shrink-0">💬 {lastChat.fromName}: </span>
      <span className="font-bold text-sm truncate flex-1">{chatPreview(d, lastChat.text, WOLF_REACTIONS)}</span>
      {unreadChat > 0 && <span className="flex-none bg-[#D63A2F] text-white text-xs font-extrabold rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center">{unreadChat}</span>}
    </button>
  );

  return (
    <div className={`min-h-dvh ${tone === 'navy' ? 'bg-[#14142B] text-[#FFF3CF]' : 'bg-[#FFF3CF] text-[#2B2016]'} transition-colors duration-1000`}>
      <div className="max-w-3xl lg:max-w-6xl mx-auto px-3 py-4">
        <TopBar logo={<span className="text-2xl">🐺</span>} d={d} lang={lang} muted={muted} onToggleMuted={toggleMuted} onHelp={() => setShowHelp(true)} onToggleLang={() => setLang(l => { const n: Lang = l === 'en' ? 'vi' : 'en'; localStorage.setItem('ct_lang', n); return n; })} voice={voice} tone={tone} />
        {phase !== 'lobby' && (<button className="disp font-extrabold text-[#FFB020] text-sm mb-2" onClick={() => { location.href = location.pathname; }}>{d.backToHub}</button>)}
        {secretBar}
        {connLost && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">{d.connLost}</div>}
        {migrating && <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl px-3 py-2 mb-2 font-bold text-amber-800 text-center">🔄 {d.statusMigrating}</div>}
        {error && <><div className="bg-red-100 border-2 border-red-400 rounded-2xl px-3 py-2 mb-2 font-bold text-red-700 text-center">{error}</div><RetryDefaultButton d={d} /></>}

        {phase === 'lobby' && (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <button className="w-11 h-11 flex-none rounded-2xl bg-[#FFFBef] hard-xs push font-extrabold text-xl text-[#2B2016]" onClick={() => { location.href = location.pathname; }}>‹</button>
              <div className="min-w-0">
                <h2 className="disp font-extrabold text-2xl leading-none">🐺 {d.title} · {d.lobby}</h2>
                <p className="font-bold text-[#8A7B63] text-sm mt-1">{d.waiting}</p>
              </div>
            </div>
            {/* room code bar: dark navy, tiles + copy link (mockup "Ma Sói 2") */}
            <div className="bg-[#14142B] rounded-[20px] px-4 py-2 flex items-center gap-3 hard">
              <div className="min-w-0">
                <div className="disp text-[#FFB020] font-extrabold text-[11px] tracking-[0.18em]">{d.roomCode}</div>
                <div className="flex gap-1.5 mt-1" data-testid="room-code">
                  {pub!.roomCode.split('').map((c, i) => (
                    <span key={i} className="w-7 h-8 sm:w-9 sm:h-10 rounded-lg bg-[#FFFBef] text-[#2B2016] font-extrabold text-lg sm:text-xl flex items-center justify-center">{c}</span>
                  ))}
                </div>
              </div>
              <span className="flex-1" />
              <button className="disp flex-none px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0] + `?game=ma-soi&room=${pub!.roomCode}`); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}>{linkCopied ? `✅ ${d.copied}` : `🔗 ${d.copyLink}`}</button>
            </div>
            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4 mt-3">
              <div className="lg:card-cream lg:p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="disp font-extrabold text-xl">{d.players}</h3>
                  <span className="font-bold text-[#8A7B63] text-sm">{connected}/12 · {d.needAtLeast(MIN_PLAYERS)}</span>
                </div>
                <PlayerGrid variant="lobby" />
                {joined.isHost && <p className="font-bold text-[#8A7B63] text-sm hidden lg:block">{d.kickHint}</p>}
                {joined.isHost && pub!.players.length < MAX_PLAYERS && (
                  <div className="mt-2">
                    <button className={`${BTN} btn-dark w-full`} disabled={botAdding} onClick={() => { setBotAdding(true); getNet().nightAction('addBot'); }}>🤖 {d.addBot}</button>
                    <p className="font-bold text-[#8A7B63] text-sm text-center mt-1.5">{d.botHint}</p>
                  </div>
                )}
                <div className="mt-2 lg:hidden">
                  <RoleSettings showSummary showDiscussion collapsible open={roleSettingsOpen} onToggle={() => setRoleSettingsOpen(o => !o)} />
                  {!joined.isHost && (
                    <div className="mt-2">
                      <div className="disp font-extrabold text-sm">{d.rolesPreview}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {roleTable(connected, pub?.roleOverrides ?? {}).map(t => (
                          <span key={t.role} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ background: t.role === 'villager' ? '#E8DCC0' : ROLE_STRONG[t.role], color: t.role === 'villager' ? '#2B2016' : '#FFF3CF' }}>{ROLE_EMOJI[t.role]} {roleLabel(d, t.role)} ×{t.count}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 lg:mt-0">
                <div className="hidden lg:block lg:card-cream lg:p-5">
                  <div className="disp font-extrabold text-xl">{d.rolesPreview}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {roleTable(connected, pub?.roleOverrides ?? {}).map(t => (
                      <span key={t.role} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ background: t.role === 'villager' ? '#E8DCC0' : ROLE_STRONG[t.role], color: t.role === 'villager' ? '#2B2016' : '#FFF3CF' }}>{ROLE_EMOJI[t.role]} {roleLabel(d, t.role)} ×{t.count}</span>
                    ))}
                  </div>
                  <RoleSettings />
                  {joined.isHost && (
                    <div className="hidden lg:block mt-4">
                      <span className="font-extrabold text-sm">{d.discussionTime}:</span>
                      <div className="flex gap-2 mt-2">
                        {[60000, 120000, 180000].map(ms => (
                          <button key={ms} onClick={() => getNet().setDiscussion(ms)}
                            className={`disp px-3 py-1.5 rounded-full font-extrabold text-sm push ${pub!.discussionMs === ms ? 'bg-[#FFB020] text-[#2B2016] hard-xs' : 'bg-white hard-xs'}`}>
                            {ms / 60000}:00
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {joined.isHost ? (
                  <>
                    <button className={`${BTN} btn-amber w-full mt-4`} disabled={connected < MIN_PLAYERS}
                      onClick={() => { setError(''); getNet().startGame(); }}>▶ {d.start}</button>
                    {connected < MIN_PLAYERS && <p className="hidden lg:block text-center font-bold text-red-600 text-sm mt-2">{d.need6}</p>}
                  </>
                ) : (
                  <p className="text-center font-bold text-[#8A7B63] mt-4">{d.waiting}</p>
                )}
                <button className={`${BTN} bg-[#FFFBef] text-[#D63A2F] w-full mt-2`} onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } getNet().leave(); setJoined(null); setPub(null); setPriv(null); }}>🚪 {d.leave}</button>
              </div>
            </div>
            {chatPreviewBar}
          </div>
        )}

        {phase === 'roleReveal' && (
          <div className="max-w-md mx-auto text-center">
            <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-xs">{d.revealKicker}</p>
            <p className="text-[#B9BCE0] font-bold mt-1">{d.revealHide}</p>
            <div className="mt-4 anim-card-flip flex justify-center">
              <RoleCard
                color={ROLE_STRONG[priv?.myRole ?? 'villager']}
                title={roleLabel(d, priv?.myRole)}
                sub={priv?.myRole === 'wolf' ? d.factionWolves : d.factionVillagers}
                artKey={priv?.myRole ?? 'villager'}
                ability={priv?.myRole ? d[priv.myRole + 'Desc' as keyof typeof d] as string : ''}
                size="lg" />
            </div>
            {priv?.myRole === 'wolf' && priv.wolfTeam.length > 1 && (
              <p className="text-[#F87171] font-bold mt-3">{d.wolfTeammates}: {priv.wolfTeam.filter(w => w.id !== joined.playerId).map(w => w.name).join(', ')}</p>
            )}
            {pub!.revealReady.includes(joined.playerId) || optReady
              ? <p className="text-center font-extrabold text-[#0E9F6E] mt-5">{d.imReady}</p>
              : <button className={`${BTN} btn-amber w-full mt-5`} onClick={() => { setOptReady(true); pendingRef.current.ready = { kind: 'ready' }; getNet().ready(); }}>
                {d.imReady}
              </button>}
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {Array.from({ length: connected }).map((_, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${i < pub!.revealReady.length ? 'bg-[#FFB020]' : 'bg-[#3D3D63]'}`} />
              ))}
              <span className="text-[#B9BCE0] font-bold text-sm ml-2">{d.readyOf(pub!.revealReady.length, connected)}</span>
            </div>
            {joined.isHost && <button className="disp font-extrabold text-sm text-[#FFB020] mt-2 py-2 px-3 push rounded-full bg-[#23233F] border-2 border-[#3D3D63]" onClick={() => getNet().beginNight()}>{d.forceNight}</button>}
          </div>
        )}

        {phase === 'night' && (
          <div className="lg:max-w-6xl mx-auto">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h2 className="disp font-extrabold text-3xl text-[#FFF3CF] leading-none">{d.night} {pub!.night}</h2>
                <p className="text-[#B9BCE0] font-bold mt-1">{nightStepTitle}</p>
              </div>
              <TimerPill endsAt={pub!.nightEndsAt} dark />
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              {nightSteps().map(st => {
                const active = pub!.nightStep === st.key;
                return (
                  <span key={st.key} className={`disp px-3 py-1.5 rounded-full font-extrabold text-sm border-2 ${active ? 'text-white' : 'bg-transparent border-[#3D3D63] text-[#B9BCE0]'}`}
                    style={active ? { background: st.color, borderColor: st.color } : undefined}>{st.label}</span>
                );
              })}
            </div>
            <div className={amWolf ? 'lg:grid lg:grid-cols-[1fr_340px] lg:gap-4' : 'max-w-3xl mx-auto'}>
              <div key={pub!.nightStep} className="anim-enter">
                {amDead ? (
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-5 text-center">
                    <div className="text-6xl mb-2">💀</div>
                    <p className="text-[#B9BCE0] font-bold">{lang === 'vi' ? 'Bạn đã chết — đang theo dõi ván đấu.' : 'You are dead — watching the game.'}</p>
                    <PlayerGrid variant="day" />
                  </div>
                ) : pub!.nightStep === 'wolves' && amWolf ? (
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                    <p className="font-extrabold text-[#FFF3CF] text-lg">{d.wolfPrompt}</p>
                    {priv!.wolfTeam.filter(w => w.id !== joined.playerId && w.alive).length > 0 && (
                      <p className="text-[#B9BCE0] font-bold text-sm mt-1">{priv!.wolfTeam.filter(w => w.id !== joined.playerId && w.alive).map(w => {
                        const pick = priv!.wolfPicks.find(x => x.id === w.id);
                        return pick ? d.matePicking(w.name, playerName(pick.targetId)) : `${w.name} (${d.looking})`;
                      }).join(' · ')}</p>
                    )}
                    <PlayerGrid variant="pick"
                      pickable={p => p.alive && p.id !== joined.playerId && !priv!.wolfTeam.some(w => w.id === p.id)}
                      onPick={id => { setNightPick(id); doNight('wolfPick', id); }}
                      selectedId={nightPick ?? priv!.wolfPick}
                    />
                    <div className="text-center font-bold text-[#FFF3CF] text-sm mb-3">
                      {priv!.wolfPick ? <>Bạn đã chọn <span className="text-[#FF8A80]">{playerName(priv!.wolfPick)}</span></> : d.wolfWaiting}
                    </div>
                    <div className="flex gap-2">
                      <button className="disp flex-1 px-4 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63]" onClick={() => { setNightPick(null); doNight('wolfPass'); }}>{d.passNoKill}</button>
                      <button className="disp flex-1 px-4 py-2.5 rounded-2xl font-extrabold hard push bg-[#D63A2F] text-white disabled:opacity-40" disabled={!priv!.wolfPick || priv!.wolfConfirmed} onClick={() => getNet().nightAction('wolfConfirm')}>{priv!.wolfConfirmed ? d.pickLocked : d.confirmPick}</button>
                    </div>
                    <p className="text-center text-[#B9BCE0] font-bold text-xs mt-3">{d.wolfTimeoutNote}</p>
                  </div>
                ) : pub!.nightStep === 'seer' && amSeer ? (
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                    <p className="font-extrabold text-[#FFF3CF] text-lg">{d.seerPrompt}</p>
                    <PlayerGrid variant="pick"
                      pickable={p => p.alive && p.id !== joined.playerId && !priv!.seerPeeks.some(x => x.targetId === p.id)}
                      onPick={id => { setNightPick(id); doNight('seerPeek', id); }}
                      selectedId={nightPick ?? priv!.seerPeeks[priv!.seerPeeks.length - 1]?.targetId}
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
                    <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63] mt-3" onClick={() => doNight('seerPass')}>{d.seerPass}</button>
                  </div>
                ) : pub!.nightStep === 'guardian' && amGuardian ? (
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                    <p className="font-extrabold text-[#FFF3CF] text-lg">{d.guardPrompt}</p>
                    {priv!.guardianLastTarget && <p className="text-[#FFB020] font-bold text-sm mt-1">{d.guardLast(playerName(priv!.guardianLastTarget))}</p>}
                    <PlayerGrid variant="pick"
                      pickable={p => p.alive && p.id !== priv!.guardianLastTarget}
                      onPick={id => { setNightPick(id); doNight('guardProtect', id); }}
                      selectedId={nightPick}
                    />
                    {nightPick && <p className="text-center font-bold text-[#0E9F6E] text-sm mb-2">{d.guardDone(playerName(nightPick))}</p>}
                    <button className="disp w-full px-5 py-2.5 rounded-2xl font-extrabold hard push bg-[#23233F] text-[#B9BCE0] border-2 border-[#3D3D63]" onClick={() => doNight('guardPass')}>{d.guardPass}</button>
                  </div>
                ) : pub!.nightStep === 'witch' && amWitch ? (
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4">
                    <div className="bg-[#2B2140] border-2 border-[#7C4DBD] rounded-2xl p-3 flex items-center gap-3">
                      <PlayerAvatar avatarId={pub!.players.find(x => x.id === priv!.nightVictim)?.avatar} size={48} fallback={<MouseAvatar seed={priv!.nightVictim ?? 'witch-none'} size={48} state="dead" />} />
                      <div className="min-w-0">
                        <div className="text-[#B9BCE0] font-bold text-sm">{d.witchVictimTitle}</div>
                        <div className="disp font-extrabold text-xl text-[#FFF3CF] truncate">{priv!.nightVictim ? playerName(priv!.nightVictim) : d.witchVictimNone}</div>
                      </div>
                    </div>
                    {priv!.witchSaveLeft && priv!.nightVictim && (
                      <button className={`${BTN} btn-green w-full mt-3`} onClick={() => doNight('witchSave')}>{d.witchSaveBtn}</button>
                    )}
                    {priv!.witchKillLeft && (
                      <>
                        <p className="font-extrabold text-[#FFF3CF] mt-4 mb-1">{d.witchKillBtn}</p>
                        <PlayerGrid variant="pick"
                          pickable={p => p.alive && p.id !== joined.playerId}
                          onPick={id => { setNightPick(id); doNight('witchKill', id); }}
                          selectedId={nightPick}
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
                    <PlayerGrid variant="pick"
                      pickable={p => p.alive}
                      onPick={id => { setNightPick(id); doNight('hunterShoot', id); }}
                      selectedId={nightPick}
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
              {amWolf && (
                <aside className="hidden lg:flex flex-col min-h-0 mt-4 lg:mt-0">
                  <div className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-4 flex flex-col flex-1 min-h-0">
                    <div className="disp font-extrabold text-lg text-[#FFF3CF] mb-2">🐺 {d.wolfChatTitle}</div>
                    <div className="flex-1 min-h-[200px] overflow-auto space-y-2">
                      {(priv?.wolfChat ?? []).map((m, i) => (
                        <div key={i} className={`max-w-[88%] rounded-2xl px-3 py-2 font-bold text-sm leading-snug ${m.fromId === joined.playerId ? 'ml-auto bg-[#D63A2F] text-white' : 'bg-[#3D3D63] text-[#FFF3CF]'}`}>
                          {m.fromId !== joined.playerId && <span className="text-[#FFB020]">{m.fromName}: </span>}{m.text}
                        </div>
                      ))}
                      {!(priv?.wolfChat?.length) && <p className="text-[#B9BCE0] font-bold text-sm">{lang === 'vi' ? 'Bàn với đồng bọn xem tối nay ăn ai…' : 'Plan tonight’s victim with your fellow wolves…'}</p>}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input className="flex-1 min-w-0 px-3 py-2.5 font-bold bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl text-[#FFF3CF] placeholder:text-[#7C83B8] outline-none" placeholder={d.wolfChatPh}
                        value={wolfChatText} maxLength={300} onChange={e => setWolfChatText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && wolfChatText.trim()) { getNet().wolfChat(wolfChatText.trim()); setWolfChatText(''); } }} />
                      <button className="disp px-3.5 py-2.5 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016]" onClick={() => { if (wolfChatText.trim()) { getNet().wolfChat(wolfChatText.trim()); setWolfChatText(''); } }}>➤</button>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}

        {phase === 'day' && (
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-12 h-12 flex-none rounded-full bg-[#FFB020] hard-xs flex items-center justify-center">
                  <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden>
                    <circle cx="50" cy="50" r="22" fill="#2B2016" />
                    <g stroke="#2B2016" strokeWidth="7" strokeLinecap="round">
                      <path d="M50 8 V20 M50 80 V92 M8 50 H20 M80 50 H92 M20 20 L28 28 M72 72 L80 80 M80 20 L72 28 M28 72 L20 80" />
                    </g>
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="disp font-extrabold text-2xl leading-none">{d.day} · {d.dayNum(pub!.night)}</h2>
                  <p className="font-bold text-[#8A7B63] text-sm mt-1">{d.discussSub}</p>
                </div>
                <TimerPill endsAt={pub!.discussionEndsAt} />
              </div>
              <p className="font-bold text-[#8A7B63] text-xs mt-1">{d.discussTimeout}</p>
              {(pub!.nightDeaths.length > 0 || pub!.lastVoteOut || pub!.voteTie) ? (
                <div className={`${CARD}`}>
                  {pub!.nightDeaths.length > 0 ? (<>
                    <p className="font-extrabold">{d.diedLastNight}</p>
                    <div className="grid sm:grid-cols-2 gap-2 mt-2">
                      {pub!.nightDeaths.map((x, di) => (
                        <div key={x.id} className="flex items-center gap-2 bg-white hard-sm rounded-2xl px-3 py-2 anim-slide-up" style={{ animationDelay: `${di * 90}ms` }}>
                          <PlayerAvatar avatarId={pub!.players.find(pp => pp.id === x.id)?.avatar} size={40} fallback={<MouseAvatar seed={x.id} size={40} state="dead" />} />
                          <div className="font-bold min-w-0 truncate">{x.name}</div>
                        </div>
                      ))}
                    </div>
                  </>) : (
                    <p className="font-extrabold text-[#0E9F6E]">{d.peacefulNight}</p>
                  )}
                  {pub!.lastVoteOut && <p className="font-bold text-[#8A7B63] mt-2">{d.votedOutYesterday(pub!.lastVoteOut.name)}</p>}
                  {pub!.voteTie && <p className="font-bold text-[#8A7B63] mt-2">{d.voteTieYesterday}</p>}
                </div>
              ) : (
                <p className="font-extrabold mt-1 text-[#0E9F6E]">{d.peacefulNight}</p>
              )}
              <p className="font-extrabold text-lg mt-4">{d.discuss}</p>
              <PlayerGrid variant="day" />
              <div className="lg:hidden">
                {amDead
                  ? <p className="text-center font-extrabold text-[#8A7B63] mt-2">{d.deadSpectate}</p>
                  : pub!.dayReady.includes(joined.playerId) || optReadyVote
                  ? <p className="text-center font-extrabold text-[#0E9F6E] mt-2">{d.readyVoteDone}</p>
                  : <button className={`${BTN} btn-dark w-full mt-2`} onClick={() => { setOptReadyVote(true); pendingRef.current.readyVote = { kind: 'readyVote' }; getNet().readyVote(); }}>
                    {d.readyVoteBtn}
                  </button>}
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
            <div className="flex items-center gap-3 mb-3">
              <span className="w-12 h-12 flex-none rounded-full bg-[#D63A2F] hard-xs flex items-center justify-center overflow-hidden">
                <WolfAvatar seed="vote-icon" size={44} state="wolf" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="disp font-extrabold text-2xl leading-none">{d.voting}</h2>
                <p className="font-bold text-[#8A7B63] text-xs sm:text-sm mt-1">{d.votedCount(pub!.players.filter(p => p.alive && p.hasVoted).length, pub!.players.filter(p => p.alive).length)}</p>
              </div>
              <TimerPill endsAt={pub!.voteEndsAt} />
            </div>
            <p className="font-bold text-[#8A7B63] text-xs mt-1">{d.voteTimeout}</p>
            <div className={`${CARD}`}>
              <p className="font-bold text-[#8A7B63]">{d.voteHint}</p>
              <PlayerGrid variant="vote"
                pickable={p => p.alive && p.id !== joined.playerId}
                onPick={id => doVote(id)}
              />
              {((me?.hasVoted && priv?.myVote) || optVote) && <p className="text-center font-extrabold text-[#0E9F6E]">{d.votedFor(playerName(priv?.myVote || optVote))}</p>}
            </div>
            <p className="text-center font-bold text-[#8A7B63] text-sm mt-3">{d.voteFoot}</p>
          </div>
        )}

        {phase === 'results' && (
          <div className="lg:max-w-6xl mx-auto">
            <p className="disp text-center font-extrabold tracking-[0.22em] text-[#FFB020] text-xs mt-1">{d.results.toUpperCase()}</p>
            <h2 className="disp font-extrabold text-4xl text-center text-[#FFF3CF] leading-tight">
              {pub!.winner === 'wolves' ? d.wolvesWin : d.villagersWin}
            </h2>
            <p className="text-center text-[#B9BCE0] font-bold mt-1">{pub!.winner === 'wolves' ? d.wolvesWinSub : d.villagersWinSub}</p>
            <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-4 mt-4">
              <PlayerGrid variant="results" />
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 mt-3 lg:mt-0">
                {pub!.players.some(p => (p.wins ?? 0) > 0) && (
                  <div className="card-cream p-4 text-[#2B2016]">
                    <div className="font-extrabold text-sm">{d.standings}</div>
                    <div className="mt-2 space-y-1">
                      {[...pub!.players].filter(p => (p.wins ?? 0) > 0).sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0)).map(p => (
                        <div key={p.id} className="flex items-center justify-between font-bold text-sm">
                          <span className="truncate">{p.name}</span>
                          <span className="font-extrabold">{p.wins}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {myRecord.w + myRecord.l > 0 && (
                  <div className="rounded-[20px] border-2 border-[#2B2016] bg-[#FBE3E0] p-4 hard-sm">
                    <div className="font-extrabold text-sm text-[#D63A2F]">{d.recordTitle}</div>
                    <div className="disp font-extrabold text-2xl text-[#2B2016] mt-1">{d.recordLine(myRecord.w, myRecord.l)}</div>
                    {priv?.myRole && <div className="font-bold text-sm text-[#D63A2F] mt-1">{d.recordAs(roleLabel(d, priv.myRole))}</div>}
                  </div>
                )}
                <div className="col-span-2 lg:col-span-1 flex gap-2 lg:flex-col">
                  <button className="disp flex-1 px-3 py-2.5 rounded-2xl font-extrabold hard push bg-[#FFFBef] text-[#2B2016] whitespace-nowrap" onClick={doShare}>
                    {shareCopied ? '✓ ' + d.copied : '📣 ' + d.shareResults}
                  </button>
                  {joined.isHost ? (
                    <button className="disp flex-1 px-3 py-2.5 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] whitespace-nowrap" onClick={() => getNet().playAgain()}>{d.backLobby}</button>
                  ) : (
                    <p className="flex-1 text-center font-bold text-[#B9BCE0] self-center text-[13px] leading-tight">{d.waiting}</p>
                  )}
                </div>
              </div>
            </div>
            {chatPreviewBar}
          </div>
        )}
      </div>
      {chatSheet && pub && <ChatSheet open={chatSheet} onClose={() => setChatSheet(false)} chat={pub.chat} myId={joined.playerId} d={d} onChat={onChat} reactions={WOLF_REACTIONS} readOnly={!!amDead && phase === 'day'} />}
      {showHelp && <HelpModal d={d} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
