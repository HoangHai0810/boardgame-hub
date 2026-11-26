// Shared in-game shell UI: every game reuses the same TopBar, chat panel
// and chat sheet. The only game-specific bits arrive as props (logo,
// reactions) or through the game's own i18n dict (d).
import { useEffect, useRef, useState } from 'react';
import type { Lang } from './i18n';

const BTN = 'disp px-5 py-3 rounded-2xl font-extrabold hard push disabled:opacity-40';

export function TopBar({ d, lang, muted, onToggleMuted, onHelp, onToggleLang, voice, tone = 'navy', logo }: { d: any; lang: Lang; muted: boolean; onToggleMuted: () => void; onHelp: () => void; onToggleLang: () => void; tone?: 'navy' | 'cream'; logo?: React.ReactNode; voice?: { speaker: 'off' | 'busy' | 'on'; mic: 'off' | 'busy' | 'on'; muted: boolean; onSpeaker: () => void; onMic: () => void } }) {
  const chip = tone === 'navy'
    ? 'bg-[#23233F] border-2 border-[#3D3D63] text-[#EDEDF7]'
    : 'bg-[#FFFBef] hard-xs text-[#2B2016]';
  const chipCls = `rounded-xl min-h-[44px] min-w-[44px] px-3 py-2.5 text-base leading-none flex items-center justify-center ${chip} push`;
  return (
    <div className="flex items-center justify-between gap-2 mb-2 relative z-20">
      <div className={`disp font-extrabold text-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 ${tone === 'navy' ? 'text-[#FFF3CF]' : 'text-[#2B2016]'}`}>{logo} {d.title}</div>
      <div className="flex gap-1.5 items-center">
        {voice && (voice.speaker === 'off'
          ? <button title={d.voiceListen} className={chipCls} onClick={voice.onSpeaker}>🎧</button>
          : voice.speaker === 'busy'
            ? <button title={d.voiceListen} className={`${chipCls} !bg-[#FFB020] !text-[#2B2016] anim-pulse-soft`} onClick={voice.onSpeaker}>🎧</button>
            : <>
              <button title={d.voiceLeave} className={`${chipCls} !bg-[#0E9F6E] !text-white`} onClick={voice.onSpeaker}>🎧</button>
              {voice.mic === 'off'
                ? <button title={d.voiceMicOn} className={chipCls} onClick={voice.onMic}>🎤</button>
                : voice.mic === 'busy'
                  ? <button title={d.voiceMicOn} className={`${chipCls} !bg-[#FFB020] !text-[#2B2016] anim-pulse-soft`} onClick={voice.onMic}>🎤</button>
                  : <button title={voice.muted ? d.voiceUnmute : d.voiceMute} className={`${chipCls} relative ${voice.muted ? '!bg-[#D63A2F] !text-white' : '!bg-[#0E9F6E] !text-white'}`} onClick={voice.onMic}>🎤{voice.muted && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-[#D63A2F] text-[11px] leading-none font-extrabold flex items-center justify-center border-2 border-[#D63A2F]">✕</span>}</button>}
            </>)}
        <button aria-label="sound" title={muted ? '🔕' : '🔊'} className={chipCls} onClick={onToggleMuted}>{muted ? '🔕' : '🔊'}</button>
        <button title={d.help} className={`${chipCls} disp font-extrabold`} onClick={onHelp}>?</button>
        <div className={`flex rounded-xl overflow-hidden ${tone === 'navy' ? 'border-2 border-[#3D3D63]' : 'hard-xs !shadow-none border-2'}`} role="group" aria-label="language">
          <button className={`disp px-3 py-2.5 min-h-[44px] font-extrabold text-sm leading-none ${lang === 'vi' ? 'bg-[#FFB020] text-[#2B2016]' : tone === 'navy' ? 'bg-[#23233F] text-[#B9BCE0]' : 'bg-[#FFFBef] text-[#8A7B63]'}`} onClick={() => lang !== 'vi' && onToggleLang()}>VI</button>
          <button className={`disp px-3 py-2.5 min-h-[44px] font-extrabold text-sm leading-none ${lang === 'en' ? 'bg-[#FFB020] text-[#2B2016]' : tone === 'navy' ? 'bg-[#23233F] text-[#B9BCE0]' : 'bg-[#FFFBef] text-[#8A7B63]'}`} onClick={() => lang !== 'en' && onToggleLang()}>EN</button>
        </div>
      </div>
    </div>
  );
}

// Quick reactions + preset phrases: one-tap chat. Phrases travel as QC
// tokens and render localized in the VIEWER's language.

export const DEFAULT_REACTIONS = ['👀', '🧀', '😱', '🤔', '👍', '👎', '😂', '❓'];
const QC_KEYS = ['qc1', 'qc2', 'qc3', 'qc4'] as const;

export function chatPreview(d: any, text: string, reactions: string[] = DEFAULT_REACTIONS): string {
  const qc = /^QC([1-4])$/.exec(text);
  if (qc) return d['qc' + qc[1]];
  return text;
}

export function renderChatText(d: any, text: string, reactions: string[] = DEFAULT_REACTIONS) {
  if (reactions.includes(text)) return <span className="text-4xl leading-tight">{text}</span>;
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

// "Retry in default mode" button for transport errors that tell the player
// to leave ?server= / ?net= behind — the UI now offers the action itself.
export function RetryDefaultButton({ d }: { d: any }) {
  let show = false;
  try { const q = new URLSearchParams(location.search); show = q.has('server') || q.has('net'); } catch { /* ignore */ }
  if (!show) return null;
  return (
    <div className="text-center mt-2">
      <button className={`${BTN} btn-amber !py-2.5`} onClick={() => { const u = new URL(location.href); u.searchParams.delete('server'); u.searchParams.delete('net'); location.href = u.toString(); }}>{d.retryDefault}</button>
    </div>
  );
}

export function ChatPanel({ chat, myId, d, height = 'h-48', onChat, reactions = DEFAULT_REACTIONS, readOnly = false }: { chat: any[]; myId?: string; d: any; height?: string; onChat: (text: string) => void; reactions?: string[]; readOnly?: boolean }) {
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
        className={`bg-[#FFFBef] hard-sm !shadow-none rounded-3xl p-3 ${height === 'flex' ? 'flex-1 min-h-0' : height} overflow-y-auto space-y-2`}>
        {chat.length === 0 && <p className="text-center text-gray-400 font-bold py-4">{d.chatEmpty}</p>}
        {chat.map((m: any, i: number) => {
          const mine = m.fromId === myId;
          return (
            <div key={`${m.ts}-${m.fromId}-${i}`} className={`flex ${mine ? 'justify-end' : 'justify-start'} anim-slide-up`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 border-2 border-[#2B2016] shadow-[0_2px_0_#2B2016] ${mine ? 'bg-[#FFDF8E] rounded-br-md' : 'bg-white rounded-bl-md'}`}>
                <div className="text-xs font-extrabold text-[#8A7B63]">{m.fromName} · {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="leading-snug">{renderChatText(d, m.text, reactions)}</div>
              </div>
            </div>);
        })}
      </div>
      {readOnly ? (
        <p className="text-center font-extrabold text-[#8A7B63] text-sm mt-2 py-2">{d.deadSpectate ?? ''}</p>
      ) : (<>
      <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1" aria-label="quick reactions">
        {reactions.map(e => (
          <button key={e} className="text-2xl bg-white hard-xs rounded-full w-10 h-10 shrink-0 active:scale-90 transition"
            onClick={() => onChat(e)}>{e}</button>
        ))}
        {QC_KEYS.map((k, i) => (
          <button key={k} className="text-xs font-extrabold bg-[#DCEBFB] text-[#1D4E89] hard-xs rounded-full px-3 h-10 shrink-0 active:scale-95 transition whitespace-nowrap"
            onClick={() => onChat('QC' + (i + 1))}>{d[k]}</button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input className="inp flex-1 min-w-0 px-4 py-2.5 font-bold" placeholder={d.chatPh} maxLength={300}
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <button className={`${BTN} btn-amber !px-4 !py-2`} onClick={send} title={d.send}>➤</button>
      </div>
      </>)}
    </div>
  );
}

export function ChatSheet({ open, onClose, chat, myId, d, onChat, reactions = DEFAULT_REACTIONS, readOnly = false }: { open: boolean; onClose: () => void; chat: any[]; myId?: string; d: any; onChat: (t: string) => void; reactions?: string[]; readOnly?: boolean }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl mx-auto h-[62%] bg-[#FFF3CF] border-t-[3px] border-x-[3px] border-[#2B2016] rounded-t-[28px] p-3 flex flex-col anim-slide-up shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <span className="disp font-extrabold text-lg text-[#2B2016]">💬 {d.chatTitle ?? 'Chat'}</span>
          <button className="bg-white hard-xs push rounded-full w-11 h-11 font-extrabold text-[#2B2016] flex items-center justify-center" onClick={onClose}>✕</button>
        </div>
        <ChatPanel chat={chat} myId={myId} d={d} height="flex" onChat={onChat} reactions={reactions} readOnly={readOnly} />
      </div>
    </div>
  );
}
