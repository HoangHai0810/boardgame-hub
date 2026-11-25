// Sảnh Board Game — the platform front door. One card per game in the
// registry; live games open, the rest are visible placeholders so the
// platform direction is obvious before the next game lands.
import { useState } from 'react';
import { t, Lang } from './i18n';
import { CheeseWedge, MouseAvatar } from '../games/cheese-thief/GameApp';
import { WolfAvatar } from '../games/ma-soi/GameApp';

const CHIP = 'inline-block bg-[#23233F] text-[#B9BCE0] text-xs font-bold rounded-full px-2.5 py-1 border border-[#3D3D63]';

function playUrl(id: string) {
  const q = new URLSearchParams(location.search);
  q.set('game', id);
  return location.pathname + '?' + q.toString();
}

export default function Hub() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  const setL = (l: Lang) => { localStorage.setItem('ct_lang', l); setLang(l); };
  return (
    <div className="min-h-dvh bg-[#14142B] p-3 sm:p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2.5 pt-1">
          <CheeseWedge size={34} />
          <span className="disp text-[#FFF3CF] font-extrabold text-2xl leading-none">Sảnh Board Game</span>
          <span className="flex-1" />
          <span className="inline-flex rounded-full overflow-hidden border-2 border-[#3D3D63] text-sm font-black">
            <button className={`px-2.5 py-1 ${lang === 'vi' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => setL('vi')}>VI</button>
            <button className={`px-2.5 py-1 ${lang === 'en' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => setL('en')}>EN</button>
          </span>
        </div>

        <div className="relative bg-[#171731] px-5 pt-4 pb-4 sm:pt-6 sm:pb-6 text-center overflow-hidden rounded-[28px] hard mt-3">
          <div className="stars" style={{ position: 'absolute' }} />
          <p className="disp relative text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px] sm:text-xs">{d.hubKicker}</p>
          <h1 className="disp relative text-[#FFF3CF] font-extrabold text-3xl sm:text-5xl leading-[1.05] mt-1">{d.hubTitle}</h1>
          <p className="relative text-[#B9BCE0] font-bold mt-1.5 sm:mt-2 max-w-md mx-auto leading-snug text-sm sm:text-base">{d.hubSub}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {/* Chuột Phô Mai — live */}
          <div className="card-cream !rounded-[28px] p-3.5 sm:p-5 flex flex-row sm:flex-col items-center sm:items-stretch gap-3">
            <div className="flex -space-x-2 flex-none">
              <MouseAvatar seed="hub-thief" size={44} state="thief" halo="#FFFBef" />
              <MouseAvatar seed="hub-village" size={44} state="awake" halo="#FFFBef" />
              <MouseAvatar seed="hub-fall" size={44} state="dead" halo="#FFFBef" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="disp text-lg sm:text-2xl font-extrabold text-[#2B2016] leading-tight sm:leading-none">{d.cheeseName}</div>
              <span className="inline-block whitespace-nowrap bg-[#0E9F6E] text-white text-[10px] sm:text-[11px] font-black rounded-full px-2 py-px mt-1">{d.playable}</span>
              <p className="hidden sm:block font-bold text-[#5C4B33] text-[15px] leading-snug mt-3">{d.cheeseTag}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5 sm:mt-3">
                <span className={CHIP}>{d.players(4, 8)}</span>
                <span className={CHIP}>{d.minutes(20)}</span>
                <span className={`${CHIP} hidden sm:inline-block`}>🎧 {d.hasVoice}</span>
              </div>
            </div>
            <a href={playUrl('cheese-thief')} className="disp text-center shrink-0 px-3 py-2.5 sm:px-5 sm:py-3 sm:w-full rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm sm:text-lg sm:mt-4 no-underline">▶ {d.playNow}</a>
          </div>

          {/* Ma Sói — live */}
          <div className="card-cream !rounded-[28px] p-3.5 sm:p-5 flex flex-row sm:flex-col items-center sm:items-stretch gap-3">
            <div className="flex -space-x-2 flex-none">
              <WolfAvatar seed="hub-wolf" size={44} state="wolf" halo="#FFFBef" />
              <WolfAvatar seed="hub-village" size={44} state="villager" halo="#FFFBef" />
              <WolfAvatar seed="hub-dead" size={44} state="dead" halo="#FFFBef" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="disp text-lg sm:text-2xl font-extrabold text-[#2B2016] leading-tight sm:leading-none">{d.wolfName}</div>
              <span className="inline-block whitespace-nowrap bg-[#0E9F6E] text-white text-[10px] sm:text-[11px] font-black rounded-full px-2 py-px mt-1">{d.playable}</span>
              <p className="hidden sm:block font-bold text-[#5C4B33] text-[15px] leading-snug mt-3">{d.wolfTag}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5 sm:mt-3">
                <span className={CHIP}>{d.players(6, 12)}</span>
                <span className={CHIP}>{d.minutes(30)}</span>
                <span className={`${CHIP} hidden sm:inline-block`}>🎧 {d.hasVoice}</span>
              </div>
            </div>
            <a href={playUrl('ma-soi')} className="disp text-center shrink-0 px-3 py-2.5 sm:px-5 sm:py-3 sm:w-full rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-sm sm:text-lg sm:mt-4 no-underline">▶ {d.playNow}</a>
          </div>

          {/* Coming soon — the next games, visible as placeholders */}
          {[
            { emoji: '🃏', name: d.unoName, tag: d.unoTag, meta: [d.players(2, 10), d.minutes(15)] },
            { emoji: '🕵️', name: d.spyName, tag: d.spyTag, meta: [d.players(3, 8), d.minutes(10)] },
          ].map(c => (
            <div key={c.name} className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-3.5 sm:p-5 flex flex-row sm:flex-col items-center sm:items-stretch gap-3 opacity-90">
              <span className="text-4xl sm:text-5xl flex-none">{c.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="disp text-xl sm:text-2xl font-extrabold text-[#FFF3CF] leading-none">{c.name}</span>
                  <span className="inline-block border-2 border-[#FFB020] text-[#FFB020] text-[10px] sm:text-[11px] font-black rounded-full px-2 py-px">{d.comingSoon}</span>
                </div>
                <p className="hidden sm:block font-bold text-[#B9BCE0] text-[15px] leading-snug mt-3">{c.tag}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5 sm:mt-3">
                  {c.meta.map(m => <span key={m} className={CHIP}>{m}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center font-bold text-[#7C83B8] text-sm mt-4 mb-2">{d.hubFoot}</p>
      </div>
    </div>
  );
}
