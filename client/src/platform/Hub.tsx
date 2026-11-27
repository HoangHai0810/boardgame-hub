// Sảnh Board Game — the platform front door. One card per game in the
// registry; live games open, the rest are visible placeholders so the
// platform direction is obvious before the next game lands.
// v35 redesign (mockup "Sảnh · Chọn game"): navy page, left-aligned hero,
// cream live cards with a color band (thin strip on mobile, tall banner on
// laptop — the whole card is the link, the amber button is the mobile
// affordance), dark coming-soon cards. Laptop: all 4 cards in one row.
import { useState } from 'react';
import { t, Lang } from './i18n';
import { CheeseWedge, MouseAvatar, WolfAvatar, CatAvatar } from './avatars';
import AvatarPicker from './AvatarPicker';
import { MyAvatar } from './GameCard';
import { CAT_ART, HUB_ART, ROLE_ART } from './art';

function playUrl(id: string) {
  const q = new URLSearchParams(location.search);
  q.set('game', id);
  return location.pathname + '?' + q.toString();
}

const CHIP_DARK = 'inline-block bg-[#23233F] text-[#B9BCE0] text-xs font-bold rounded-full px-2.5 py-1 border border-[#3D3D63]';
const CHIP_OUTLINE = 'inline-block border-2 border-[#2B2016] text-[#2B2016] text-xs font-bold rounded-full px-2.5 py-1';

/** Uno = two overlapping cards; Spy = an eye. Flat lavender line icons for
 *  the dark coming-soon cards. */
function UnoIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect x="14" y="22" width="52" height="68" rx="10" fill="none" stroke="#B9BCE0" strokeWidth="6" transform="rotate(-8 40 56)" />
      <rect x="36" y="14" width="52" height="68" rx="10" fill="#FFB020" stroke="#2B2016" strokeWidth="3" transform="rotate(8 62 48)" />
      <text x="62" y="62" textAnchor="middle" fontSize="30" fontWeight="800" fill="#2B2016" transform="rotate(8 62 48)">7</text>
    </svg>
  );
}
function SpyIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d="M8 50 Q50 12 92 50 Q50 88 8 50 Z" fill="none" stroke="#B9BCE0" strokeWidth="6" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="18" fill="none" stroke="#B9BCE0" strokeWidth="6" />
      <circle cx="50" cy="50" r="7" fill="#B9BCE0" />
    </svg>
  );
}
/** Love Letter = a sealed envelope. Flat line icon, readable at 44px. */
function LetterIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect x="12" y="26" width="76" height="52" rx="8" fill="#FFF3CF" stroke="#2B2016" strokeWidth="3" />
      <path d="M14 30 L50 58 L86 30" fill="none" stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="50" cy="56" r="11" fill="#D63A6B" stroke="#2B2016" strokeWidth="3" />
      <path d="M50 61 C46 58 44 55 44 52 C44 49 47 48 50 50 C53 48 56 49 56 52 C56 55 54 58 50 61 Z" fill="#FFF3CF" />
    </svg>
  );
}

/** Uno banner = two overlapping cards (design: "hai lá bài Uno"). */
function UnoBanner() {
  const card = (bg: string, sym: string, rot: string, ml: string) => (
    <span className={`relative inline-flex flex-none w-[54px] h-[78px] rounded-lg border-[3px] border-white items-center justify-center ${rot} ${ml}`} style={{ background: bg, boxShadow: '0 3px 0 rgba(43,32,22,0.9)' }}>
      <span className="absolute inset-x-[6px] top-1/2 -translate-y-1/2 h-[46%] bg-white rounded-[50%] rotate-[-24deg]" />
      <span className="relative disp font-extrabold text-2xl" style={{ color: bg }}>{sym}</span>
    </span>
  );
  return (
    <span className="inline-flex items-center">
      {card('#D63A2F', '7', 'rotate-[-10deg]', '')}
      {card('#FFB020', '+2', 'rotate-[10deg] translate-y-1', '-ml-2')}
    </span>
  );
}

export default function Hub() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('ct_lang') as Lang) || 'vi');
  const d = t(lang);
  const setL = (l: Lang) => { localStorage.setItem('ct_lang', l); setLang(l); };
  const [showAvatar, setShowAvatar] = useState(false);
  const myName = sessionStorage.getItem('ct_name') || '';
  const live = [
    {
      id: 'cheese-thief', name: d.cheeseName, tag: d.cheeseTag, tagWide: d.cheeseTagWide,
      color: '#FFB020', min: 4, max: 8, minsMobile: 10, minsWide: 10,
      hubArt: HUB_ART.cheese,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#F5E9C8] border-2 border-[#2B2016] flex-none"><MouseAvatar seed="hub-thief" size={48} state="thief" /></span>,
      bannerIcon: <CheeseWedge size={72} />,
      bannerArt: ROLE_ART.thief,
    },
    {
      id: 'ma-soi', name: d.wolfName, tag: d.wolfTag, tagWide: d.wolfTagWide,
      color: '#D63A2F', min: 6, max: 12, minsMobile: 20, minsWide: 20,
      hubArt: HUB_ART.wolf,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#E8E8E8] border-2 border-[#2B2016] flex-none"><WolfAvatar seed="hub-wolf" size={48} state="wolf" /></span>,
      bannerIcon: <WolfAvatar seed="hub-wolf" size={72} state="wolf" />,
      bannerArt: ROLE_ART.wolf,
    },
    {
      id: 'uno', name: d.unoName, tag: d.unoTag, tagWide: d.unoTag,
      color: '#2E7CD6', min: 2, max: 10, minsMobile: 15, minsWide: 15,
      hubArt: HUB_ART.uno,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#14142B] border-2 border-[#2B2016] flex-none"><UnoIcon size={44} /></span>,
      bannerIcon: <UnoBanner />,
      bannerArt: undefined,
    },
    {
      id: 'meo-no', name: d.meoName, tag: d.meoTag, tagWide: d.meoTagWide,
      color: '#F08A1D', min: 2, max: 5, minsMobile: 10, minsWide: 10,
      hubArt: HUB_ART.meo,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#F5E9C8] border-2 border-[#2B2016] flex-none"><CatAvatar seed="hub-cat" size={48} /></span>,
      bannerIcon: <CatAvatar seed="hub-cat" size={72} />,
      bannerArt: CAT_ART.exploding,
    },
    {
      id: 'gian-diep', name: d.spyName, tag: d.spyTag, tagWide: d.spyTagWide,
      color: '#7C4DBD', min: 3, max: 8, minsMobile: 60, minsWide: 60,
      hubArt: HUB_ART.spy,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#14142B] border-2 border-[#2B2016] flex-none"><SpyIcon size={44} /></span>,
      bannerIcon: <SpyIcon size={72} />,
      bannerArt: undefined,
    },
    {
      id: 'love-letter', name: d.loveName, tag: d.loveTag, tagWide: d.loveTagWide,
      color: '#D63A6B', min: 2, max: 6, minsMobile: 20, minsWide: 20,
      hubArt: HUB_ART.love,
      icon: <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#F5E9C8] border-2 border-[#2B2016] flex-none"><LetterIcon size={44} /></span>,
      bannerIcon: <LetterIcon size={72} />,
      bannerArt: undefined,
    },
  ];
  const soon: { name: string; tag: string; min: number; max: number; mins: number; icon: React.ReactNode }[] = [];
  return (
    <div className="min-h-dvh bg-[#14142B] p-3 sm:p-4">
      <div className="max-w-3xl lg:max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5 pt-1">
          <CheeseWedge size={34} />
          <span className="disp text-[#FFF3CF] font-extrabold text-2xl leading-none">Sảnh Board Game</span>
          <span className="flex-1" />
          <button className="flex items-center gap-2 rounded-full bg-[#23233F] border-2 border-[#3D3D63] pl-1 pr-3 py-1 push" onClick={() => setShowAvatar(true)} title={d.pickAvatar}>
            <MyAvatar size={32} />
            <span className="font-extrabold text-sm text-[#FFF3CF] max-w-[150px] truncate">{myName || d.pickAvatar}</span>
          </button>
          <span className="inline-flex rounded-full overflow-hidden border-2 border-[#3D3D63] text-sm font-black">
            <button className={`px-2.5 py-1 ${lang === 'vi' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => setL('vi')}>VI</button>
            <button className={`px-2.5 py-1 ${lang === 'en' ? 'bg-[#FFB020] text-[#2B2016]' : 'bg-[#23233F] text-[#B9BCE0]'}`} onClick={() => setL('en')}>EN</button>
          </span>
        </div>

        <div className="mt-2 lg:mt-6">
          <p className="disp text-[#FFB020] font-extrabold tracking-[0.22em] text-[11px] sm:text-sm">{d.hubKicker}</p>
          <h1 className="disp text-[#FFF3CF] font-extrabold text-[32px] sm:text-5xl lg:text-6xl leading-[1.05] mt-1">{d.hubTitle}</h1>
          <p className="text-[#B9BCE0] font-bold mt-2 max-w-xl leading-snug text-sm sm:text-base">
            <span className="lg:hidden">{d.hubSub}</span>
            <span className="hidden lg:inline">{d.hubSubWide}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5 mt-4 sm:mt-5">
          {live.map((g, gi) => (
            <a key={g.id} href={playUrl(g.id)} className="col-span-2 lg:col-span-1 card-cream !rounded-[28px] overflow-hidden flex flex-col no-underline anim-enter lift" style={{ animationDelay: `${gi * 70}ms` }}>
              {/* mobile: thin color strip; laptop: tall banner with art/icon + pill */}
              <div className="h-2.5 lg:hidden flex-none" style={{ background: g.color }} />
              <div className="hidden lg:flex relative items-center px-5 h-[110px] flex-none overflow-hidden" style={{ background: g.color }}>
                <img src={g.hubArt} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                <span className="absolute top-3 right-3 bg-[#0E9F6E] text-white text-[11px] font-black rounded-full px-2.5 py-1">{d.openNow}</span>
              </div>
              <div className="p-3 sm:p-5 flex flex-col flex-1">
                <div className="flex items-center gap-3 lg:hidden">
                  <img src={g.hubArt} alt="" className="w-24 h-24 rounded-2xl object-cover flex-none border-2 border-[#2B2016]" draggable={false} />
                  <div className="min-w-0">
                    <div className="disp text-xl font-extrabold text-[#2B2016] leading-tight">{g.name}</div>
                    <span className="inline-block whitespace-nowrap bg-[#0E9F6E] text-white text-[10px] font-black rounded-full px-2 py-px mt-1">{d.playable}</span>
                  </div>
                </div>
                <div className="hidden lg:block disp text-2xl font-extrabold text-[#2B2016] leading-tight">{g.name}</div>
                <p className="font-bold text-[#5C4B33] text-[15px] leading-snug mt-2 lg:mt-3">
                  <span className="lg:hidden">{g.tag}</span>
                  <span className="hidden lg:inline">{g.tagWide}</span>
                </p>
                {/* mobile: outline chips + amber button; laptop: meta line at the bottom */}
                <div className="flex flex-wrap gap-1.5 mt-2 lg:hidden">
                  <span className={CHIP_OUTLINE}>{d.players(g.min, g.max)}</span>
                  <span className={CHIP_OUTLINE}>{d.minutes(g.minsMobile)}</span>
                  <span className={CHIP_OUTLINE}>🎧 {d.hasVoice}</span>
                </div>
                <span className="disp lg:hidden block text-center px-3 py-2 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-base mt-2.5">▶ {d.playNow}</span>
                <p className="hidden lg:block mt-auto pt-4 font-bold text-[#2B2016]">{d.players(g.min, g.max)} · {d.minutesPlain(g.minsWide)}</p>
              </div>
            </a>
          ))}

          {soon.map((c, ci) => (
            <div key={c.name} className="bg-[#1D1D38] border-2 border-[#3D3D63] rounded-[28px] p-3 sm:p-5 flex flex-col opacity-95 anim-enter" style={{ animationDelay: `${(live.length + ci) * 70}ms` }}>
              <div className="flex items-start justify-between gap-2">
                {c.icon}
                <span className="lg:hidden inline-block border-2 border-[#FFB020] text-[#FFB020] text-[10px] font-black rounded-full px-2 py-px whitespace-nowrap">{d.comingSoon}</span>
                <span className="hidden lg:inline-block bg-[#2B2B4A] text-[#B9BCE0] text-[11px] font-black rounded-full px-2.5 py-1 whitespace-nowrap">{d.comingSoon}</span>
              </div>
              <div className="disp text-lg lg:text-2xl font-extrabold text-[#FFF3CF] leading-tight mt-2">{c.name}</div>
              <p className="hidden lg:block font-bold text-[#B9BCE0] text-[15px] leading-snug mt-3">{c.tag}</p>
              <div className="flex flex-wrap gap-1.5 mt-2 lg:mt-auto lg:pt-4">
                <span className={CHIP_DARK}>{d.players(c.min, c.max)}</span>
                <span className={CHIP_DARK}>{d.minutes(c.mins)}</span>
              </div>
              <p className="hidden lg:block font-bold text-[#B9BCE0] text-sm mt-2">{d.workingOn}</p>
            </div>
          ))}
        </div>
      </div>
      {showAvatar && <AvatarPicker lang={lang} onClose={() => setShowAvatar(false)} />}
    </div>
  );
}
