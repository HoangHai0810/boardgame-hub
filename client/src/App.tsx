import { useEffect, useMemo, useRef, useState } from 'react';
import { createNet, Net, Pub, Priv } from './net';
import { t, Lang } from './i18n';

const MICE = ['🐭', '🐹', '🐰', '🦊', '🐱', '🐶', '🐷', '🐨'];
const mouseFor = (id: string) => MICE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % MICE.length];
const AVATAR_BG = ['bg-rose-100', 'bg-sky-100', 'bg-lime-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-pink-100', 'bg-indigo-100'];
const avatarBg = (id: string) => AVATAR_BG[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];

const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
export function DiceFace({ value, size = 96 }: { value: number; size?: number }) {
  const pips = PIPS[value] || [];
  return (
    <div className="dice-face" style={{ width: size, height: size }} aria-label={`dice ${value}`}>
      {Array.from({ length: 9 }, (_, i) => pips.includes(i + 1)
        ? <div key={i} className="dice-pip" />
        : <div key={i} />)}
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

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const d = t(lang);
  const [name, setName] = useState(() => localStorage.getItem('ct_name') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const [joined, setJoined] = useState<{ code: string; playerId: string; isHost: boolean } | null>(null);
  const [pub, setPub] = useState<Pub | null>(null);
  const [priv, setPriv] = useState<Priv | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const netRef = useRef<Net | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const getNet = () => {
    if (!netRef.current) {
      netRef.current = createNet({
        onState: (s) => { setPub(s); setStatus(''); },
        onPrivate: (p) => setPriv(p),
        onJoined: (c, pid, isHost) => {
          setJoined({ code: c, playerId: pid, isHost });
          history.replaceState(null, '', '?room=' + c);
        },
        onError: (m) => { setError(m); setStatus(''); },
        onStatus: setStatus,
      });
    }
    return netRef.current;
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [pub?.chat?.length]);
  const me = useMemo(() => pub?.players.find(p => p.id === joined?.playerId), [pub, joined]);
  const isHost = joined?.isHost || me?.isHost;
  const phase = pub?.phase;

  const btn = 'px-5 py-3 rounded-2xl font-bold shadow-lg transition active:scale-95 disabled:opacity-40 disabled:active:scale-100';
  const card = 'bg-white/95 rounded-3xl shadow-2xl p-5 sm:p-7';

  const HelpModal = () => !showHelp ? null : (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
      <div className={`${card} max-w-lg w-full max-h-[85vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-extrabold mb-3">🧀 {d.how}</h2>
        <ol className="space-y-2 text-left text-[15px] leading-snug">
          {d.tutorial.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <button className={`${btn} bg-amber-400 w-full mt-4`} onClick={() => setShowHelp(false)}>OK 👍</button>
      </div>
    </div>
  );

  const TopBar = () => (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="font-extrabold text-white drop-shadow text-lg">🧀 {d.title}</div>
      <div className="flex gap-2">
        <button aria-label="sound" className="bg-white/20 text-white rounded-full px-3 py-1" onClick={() => setMuted(m => !m)}>{muted ? '🔇' : '🔊'}</button>
        <button className="bg-white/20 text-white rounded-full px-3 py-1 font-bold" onClick={() => setShowHelp(true)}>❓ {d.help}</button>
        <button className="bg-white/20 text-white rounded-full px-3 py-1 font-bold" onClick={() => setLang(l => l === 'en' ? 'vi' : 'en')}>{lang === 'en' ? '🇻🇳 VI' : '🇬🇧 EN'}</button>
      </div>
    </div>
  );

  const PlayerChips = ({ onPick, pickable }: { onPick?: (id: string) => void; pickable?: (p: any) => boolean }) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
      {pub!.players.map(p => (
        <button key={p.id} disabled={!onPick || (pickable ? !pickable(p) : false)}
          onClick={() => onPick?.(p.id)}
          className={`rounded-2xl p-3 text-center shadow ${p.id === joined?.playerId ? 'bg-amber-200 ring-4 ring-amber-400' : 'bg-white'} ${onPick ? 'hover:scale-105 transition cursor-pointer' : 'cursor-default'} disabled:opacity-50 disabled:hover:scale-100`}>
          <div className={`text-4xl anim-bob w-16 h-16 mx-auto rounded-full flex items-center justify-center ${avatarBg(p.id)} shadow-inner`}>{mouseFor(p.id)}</div>
          <div className="font-bold truncate">{p.name} {p.id === joined?.playerId && <span className="text-amber-600">({d.you})</span>}</div>
          <div className="text-xs">{p.isHost && <span className="bg-purple-500 text-white rounded-full px-2 py-0.5">👑 {d.host}</span>} {!p.connected && <span className="text-red-500">• {d.offline}</span>}</div>
          {(phase === 'results') && <div className="text-sm mt-1 flex items-center justify-center gap-2">{(p as any).role === 'thief' ? '😈 ' + d.thief : '💤 ' + d.sleepy}<DiceFace value={(p as any).dice ?? 1} size={26} /></div>}
          {phase === 'voting' && <div className="text-xs mt-1">{p.hasVoted ? '✅ voted' : '🤔 …'}</div>}
        </button>
      ))}
    </div>
  );

  /* ---------- LANDING ---------- */
  if (!joined) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-300 via-orange-200 to-yellow-100 p-4">
        <div className="max-w-xl mx-auto pt-6">
          <TopBar />
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
              value={name} maxLength={20} onChange={e => { setName(e.target.value); localStorage.setItem('ct_name', e.target.value); }} />
            <button className={`${btn} bg-amber-400 hover:bg-amber-500 w-full mt-3 text-xl`}
              disabled={!name.trim()} onClick={() => { setError(''); getNet().createRoom(name); }}>{d.create} 🏠</button>
            <div className="flex gap-2 mt-3">
              <input className="flex-1 border-2 border-amber-300 rounded-2xl px-4 py-3 uppercase text-lg" placeholder={d.codePh}
                value={code} maxLength={5} onChange={e => setCode(e.target.value.toUpperCase())} />
              <button className={`${btn} bg-sky-400 hover:bg-sky-500 text-white`} disabled={!name.trim() || code.trim().length < 4}
                onClick={() => { setError(''); getNet().joinRoom(code, name); }}>{d.join}</button>
            </div>
            <button className="mt-4 underline font-bold text-amber-700" onClick={() => setShowHelp(true)}>📖 {d.how} (1 min)</button>
            {status && <p className="mt-3 text-sky-700 font-bold">{status}</p>}
            {error && <p className="mt-3 text-red-600 font-bold">{error}</p>}
          </div>
          <p className="text-center text-amber-800/70 mt-4 text-sm">4–8 players · ~5–15 min · free, no install 🎉</p>
        </div>
        <HelpModal />
      </div>
    );
  }

  if (!pub) return <div className="min-h-screen bg-indigo-950 text-white flex items-center justify-center text-2xl">⏳ {status || 'Connecting…'}</div>;

  const bg = phase === 'night' || phase === 'roleReveal'
    ? 'bg-gradient-to-b from-indigo-950 via-purple-950 to-slate-900'
    : 'bg-gradient-to-b from-amber-300 via-orange-200 to-yellow-100';

  return (
    <div className={`min-h-screen ${bg} p-4 transition-colors duration-1000`}>
      <div className="max-w-3xl mx-auto">
        <TopBar />
        {error && <div className="bg-red-100 border border-red-400 text-red-700 rounded-2xl px-4 py-2 mb-3 font-bold">{error}
          <button className="float-right" onClick={() => setError('')}>✕</button></div>}

        {/* Persistent secret info — your role & dice stay visible all game */}
        {priv?.role && (phase === 'night' || phase === 'day' || phase === 'voting') && (
          <div className="bg-black/70 text-white rounded-2xl px-4 py-2 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-bold backdrop-blur">
            <span>🤫 {d.yourInfo}:</span>
            <span>{priv.role === 'thief' ? '😈 ' + d.thief : '🐭 ' + d.sleepy}</span>
            <span>🎲 {priv.dice ?? '?'} · ⏰ {priv.dice ? d.wakeAt(priv.dice) : ''}</span>
            {phase === 'night' && <span>{priv.awake ? '👀 ' + d.youAwake : '💤 ' + d.sleeping}</span>}
          </div>
        )}

        {/* ---------- LOBBY ---------- */}
        {phase === 'lobby' && (
          <div className={`${card} anim-pop`}>
            <h2 className="text-2xl font-extrabold">🏠 {d.lobby} · {d.round} {pub.round}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-3xl font-extrabold tracking-widest bg-amber-100 rounded-2xl px-4 py-1">{pub.roomCode}</span>
              <button className={`${btn} bg-sky-400 text-white !py-2`} onClick={() => {
                navigator.clipboard?.writeText(location.origin + location.pathname + '?room=' + pub.roomCode);
                setCopied(true); setTimeout(() => setCopied(false), 1500);
              }}>{copied ? '✅ ' + d.copied : '🔗 ' + d.copyLink}</button>
              <span className="font-bold">{d.players}: {pub.players.length}/8</span>
            </div>
            <PlayerChips />
            {isHost ? (
              <>
                <button className={`${btn} bg-green-500 hover:bg-green-600 text-white w-full text-xl`}
                  disabled={pub.players.filter(p => p.connected).length < 4}
                  onClick={() => getNet().startGame()}>▶️ {d.start}</button>
                {pub.players.length < 4 && <p className="text-center text-red-500 font-bold mt-2">{d.need4}</p>}
              </>
            ) : <p className="text-center font-bold text-gray-500">{d.waiting}</p>}
            <button className="mt-4 underline text-gray-500" onClick={() => { getNet().leave(); location.href = location.pathname; }}>{d.leave}</button>
          </div>
        )}

        {/* ---------- ROLE REVEAL ---------- */}
        {phase === 'roleReveal' && priv && (
          <div className={`${card} text-center anim-pop`}>
            <h2 className="text-xl font-bold text-gray-500">{d.yourRole} 🤫</h2>
            <div className="text-8xl my-3">{priv.role === 'thief' ? '😈' : '🐭'}</div>
            <div className={`text-3xl font-extrabold ${priv.role === 'thief' ? 'text-red-500' : 'text-sky-600'}`}>
              {priv.role === 'thief' ? d.thief : d.sleepy}</div>
            <p className="mt-2 text-gray-600">{priv.role === 'thief' ? d.thiefDesc : d.sleepyDesc}</p>
            <div className={`mt-4 inline-block rounded-3xl px-8 py-4 ${priv.role === 'thief' ? 'bg-red-50 ring-2 ring-red-200' : 'bg-indigo-50 ring-2 ring-indigo-200'}`}>
              <div className="text-sm font-bold text-gray-500 mb-2">{d.yourDice}</div>
              <div className="flex justify-center"><DiceFace value={priv.dice ?? 1} size={104} /></div>
              <div className="text-2xl font-extrabold mt-2">{priv.dice}</div>
            </div>
            <div>
              {pub.revealReady?.includes(joined.playerId)
                ? <p className="mt-5 font-extrabold text-green-600">✅ {d.readyOf(pub.revealReady.length, pub.players.filter(p => p.connected).length)}</p>
                : <button className={`${btn} bg-green-500 hover:bg-green-600 text-white mt-5 text-lg`} onClick={() => getNet().ready()}>{d.imReady}</button>}
              <p className="mt-2 font-bold text-gray-400">{d.readyOf(pub.revealReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
              {isHost && <button className="mt-2 underline text-indigo-500 font-bold" onClick={() => getNet().beginNight()}>🌙 {d.forceNight}</button>}
            </div>
          </div>
        )}

        {/* ---------- NIGHT ---------- */}
        {phase === 'night' && priv && (
          <div className="text-center relative">
            <div className="stars" /><div className="stars2" />
            <h2 className="text-3xl font-extrabold text-indigo-200">🌙 {d.night} — {d.hour} {pub.currentHour}/6
              <span className="ml-3 text-xl bg-white/10 rounded-full px-3 py-1">⏱ {secsLeft(pub.hourEndsAt, now)}s</span></h2>
            <div className="flex justify-center gap-1 my-3">
              {[1, 2, 3, 4, 5, 6].map(h => <div key={h} className={`w-9 h-9 rounded-full flex items-center justify-center font-extrabold ${h === pub.currentHour ? 'bg-amber-400 text-black scale-110' : h < pub.currentHour ? 'bg-indigo-700 text-white' : 'bg-white/10 text-indigo-300'}`}>{h}</div>)}
            </div>
            {/* Table indicator must reflect what THIS player can actually see:
                wakers see the real table (cheese present or gone); sleepers
                have their eyes closed and must NOT be told the cheese is
                "on the table" when it may already be stolen. */}
            <div className="wood-table max-w-md mx-auto px-4 pt-4 pb-3 my-3 relative z-10">
              <div className="text-7xl leading-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.4)]">
                {priv.awake
                  ? (priv.cheesePresentWhenAwake === false ? '🍽️' : <span className="anim-wiggle inline-block">🧀</span>)
                  : <span className="opacity-40">🧀</span>}
              </div>
              <div className="text-lg font-bold text-amber-100 drop-shadow mt-1">
                {priv.awake
                  ? (priv.cheesePresentWhenAwake === false
                      ? <span className="text-red-300">💨 {d.tableGone}</span>
                      : <>✨ on the table</>)
                  : <span className="opacity-70">💤 {d.eyesClosed}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              {pub.players.map(p => (
                <div key={p.id} className={`rounded-2xl p-3 relative z-10 ${p.id === joined.playerId && priv.awake ? 'bg-amber-300 text-black ring-4 ring-amber-100 awake-glow' : 'bg-white/10 text-indigo-100'}`}>
                  <div className={`text-4xl relative inline-block w-14 h-14 rounded-full ${avatarBg(p.id)} items-center justify-center inline-flex`}>{mouseFor(p.id)}
                    {!(p.id === joined.playerId && priv.awake) && <span className="zzz absolute -top-2 -right-3 text-lg text-sky-300 font-bold">z</span>}
                  </div>
                  <div className="font-bold truncate text-sm">{p.name}</div>
                  {p.id === joined.playerId && <div className="text-xs font-bold">{priv.awake ? '👀 ' + d.youAwake : '💤'}</div>}
                </div>
              ))}
            </div>
            {priv.awake ? (
              <div className={`${card} anim-pop max-w-xl mx-auto`}>
                <div className="text-2xl font-extrabold">👀 {d.youAwake}</div>
                {priv.cheesePresentWhenAwake === false && <p className="font-bold text-red-500 mt-1">{d.cheeseGoneWake}</p>}
                {priv.cheesePresentWhenAwake === true && <p className="text-gray-500 mt-1">{d.cheeseHere}</p>}
                {priv.fellowWakers.length > 0 && <p className="mt-1 font-bold text-purple-600">👀👀 {d.fellow} ({priv.fellowWakers.map(id => pub.players.find(p => p.id === id)?.name).join(', ')})</p>}
                {priv.canSteal && !priv.hasActedThisHour && (
                  <button className={`${btn} bg-red-500 hover:bg-red-600 text-white w-full mt-3 text-xl`} onClick={() => getNet().nightAction('steal')}>{d.stealBtn}</button>)}
                {priv.role === 'thief' && priv.hasActedThisHour && <p className="mt-3 font-bold text-green-600">{d.stolenOk}</p>}
                {priv.canInspect && (
                  <div className="mt-3">
                    <div className="font-bold mb-2">{d.inspectTitle}</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {pub.players.filter(p => p.id !== joined.playerId).map(p => (
                        <button key={p.id} className={`${btn} bg-sky-400 text-white !py-2`} onClick={() => getNet().nightAction('inspect', p.id)}>{mouseFor(p.id)} {p.name}</button>))}
                    </div>
                  </div>)}
                {priv.inspected && <p className="mt-3 font-extrabold text-sky-700 text-lg">🔎 {d.inspected(pub.players.find(p => p.id === priv.inspected!.targetId)?.name || '?', priv.inspected.dice)}</p>}
              </div>
            ) : (
              <p className="text-indigo-200 font-bold text-xl">{d.sleeping}</p>
            )}
          </div>
        )}

        {/* ---------- DAY ---------- */}
        {phase === 'day' && (
          <div className={`${card} anim-pop`}>
            <h2 className="text-2xl font-extrabold text-center">{d.day}</h2>
            <p className="text-center font-bold text-gray-600">{d.discuss} <span className="bg-amber-100 rounded-full px-3 py-0.5">⏱ {secsLeft(pub.discussionEndsAt, now)}s</span></p>
            <PlayerChips />
            <div className="bg-gradient-to-b from-amber-50 to-orange-50 rounded-2xl p-3 h-56 overflow-y-auto text-left space-y-2">
              {pub.chat.map((m, i) => {
                const mine = m.fromId === joined.playerId;
                return (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'} anim-slide-up`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 shadow ${mine ? 'bg-amber-400 rounded-br-md' : 'bg-white rounded-bl-md'}`}>
                      <div className="text-xs font-extrabold opacity-70">{mouseFor(m.fromId)} {m.fromName}
                        <span className="font-normal ml-2">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                      <div className="leading-snug">{m.text}</div>
                    </div>
                  </div>);
              })}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 mt-3">
              <input className="flex-1 border-2 border-amber-300 rounded-2xl px-4 py-2.5" placeholder={d.chatPh} maxLength={300}
                value={chatText} onChange={e => setChatText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && chatText.trim()) { getNet().chat(chatText); setChatText(''); } }} />
              <button className={`${btn} bg-amber-400 !py-2`} onClick={() => { if (chatText.trim()) { getNet().chat(chatText); setChatText(''); } }}>{d.send}</button>
            </div>
            <div className="mt-3 text-center">
              {pub.dayReady?.includes(joined.playerId)
                ? <p className="font-extrabold text-green-600">{d.readyVoteDone}</p>
                : <button className={`${btn} bg-green-500 hover:bg-green-600 text-white`} onClick={() => getNet().readyVote()}>{d.readyVoteBtn}</button>}
              <p className="font-bold text-gray-500 mt-1">{d.readyVoteOf(pub.dayReady?.length ?? 0, pub.players.filter(p => p.connected).length)}</p>
            </div>
            {isHost && <button className={`${btn} bg-purple-500 text-white w-full mt-3`} onClick={() => getNet().toVoting()}>🗳️ {d.toVote}</button>}
          </div>
        )}

        {/* ---------- VOTING ---------- */}
        {phase === 'voting' && (
          <div className={`${card} anim-pop text-center`}>
            <h2 className="text-3xl font-extrabold">🗳️ {d.voting} <span className="text-xl bg-amber-100 rounded-full px-3 py-1">⏱ {secsLeft(pub.voteEndsAt, now)}s</span></h2>
            <p className="text-gray-500 font-bold">{d.voteHint}</p>
            <p className="font-bold mt-1">{pub.players.filter(p => p.hasVoted).length}/{pub.players.length} voted</p>
            {priv?.myVote
              ? <p className="mt-4 font-extrabold text-green-600 text-lg">{d.votedFor(pub.players.find(p => p.id === priv.myVote)?.name || '?')}</p>
              : <PlayerChips onPick={(id) => getNet().vote(id)} pickable={(p) => p.id !== joined.playerId} />}
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {phase === 'results' && (
          <div className={`${card} anim-pop text-center`}>
            <Confetti />
            <div className="text-7xl anim-bob inline-block">{pub.winner === 'sleepyheads' ? '🎉' : '😈'}</div>
            <h2 className="text-3xl font-extrabold">{pub.winner === 'sleepyheads' ? d.sleepyWin : d.thiefWin}</h2>
            <p className="font-bold text-lg mt-1">{d.thiefWas(pub.players.find(p => p.id === pub.thiefId)?.name || '?')} {mouseFor(pub.thiefId || '')}</p>
            <PlayerChips />
            <div className="text-left max-w-sm mx-auto bg-amber-50 rounded-2xl p-3">
              {pub.voteCounts?.map(v => (
                <div key={v.id} className="flex justify-between font-bold">
                  <span>{mouseFor(v.id)} {pub.players.find(p => p.id === v.id)?.name}</span><span>{v.count} {d.votes}</span>
                </div>))}
            </div>
            {isHost
              ? <button className={`${btn} bg-green-500 text-white w-full mt-4 text-xl`} onClick={() => getNet().playAgain()}>🔁 {d.playAgain} ({d.backLobby})</button>
              : <p className="mt-4 font-bold text-gray-500">{d.waiting}</p>}
          </div>
        )}
      </div>
      <HelpModal />
    </div>
  );
}
