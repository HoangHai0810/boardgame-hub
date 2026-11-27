/* ---------- Real-card style (Claude design files, Nov 2026): a colored
 *  frame, header band with a small badge + name, a 3D art window, an
 *  ability box, and the name upside-down at the bottom-right — like a
 *  physical card. The art is generated 3D (platform/art.ts); the tiny
 *  badge glyphs below are only the header mark, never the main image. */
import { CAT_ART, ROLE_ART, avatarSrc, getAvatar } from './art';

const CARD_SHADOW = '0 3px 0 rgba(43,32,22,0.9), 0 10px 22px rgba(0,0,0,0.35)';

/** Tiny header glyph for a Mèo Nổ kind (same shapes as the old CardIcon). */
export function KindGlyph({ kind, size = 14 }: { kind: string; size?: number }) {
  const ink = '#FFFBef';
  const sw = 6;
  const common = { width: size, height: size, viewBox: '0 0 100 100', 'aria-hidden': true } as const;
  if (kind === 'defuse') return (<svg {...common}><path d="M50 8 L86 22 V52 Q86 76 50 92 Q14 76 14 52 V22 Z" fill="none" stroke={ink} strokeWidth={sw + 2} strokeLinejoin="round" /><path d="M34 50 L46 62 L68 36" fill="none" stroke={ink} strokeWidth={sw + 2} strokeLinecap="round" strokeLinejoin="round" /></svg>);
  if (kind === 'nope') return (<svg {...common}><circle cx="50" cy="50" r="36" fill="none" stroke={ink} strokeWidth={sw + 2} /><path d="M24 24 L76 76" stroke={ink} strokeWidth={sw + 2} strokeLinecap="round" /></svg>);
  if (kind === 'skip') return (<svg {...common}><path d="M28 22 L62 50 L28 78 Z" fill={ink} strokeLinejoin="round" /><rect x="66" y="22" width="10" height="56" rx="4" fill={ink} /></svg>);
  if (kind === 'shuffle') return (<svg {...common}><g fill="none" stroke={ink} strokeWidth={sw + 1} strokeLinecap="round" strokeLinejoin="round"><path d="M14 30 H52 Q66 30 72 44" /><path d="M14 70 H52 Q66 70 72 56" /><path d="M64 36 L76 44 L64 52" /><path d="M64 48 L76 56 L64 64" /><path d="M22 30 Q40 50 22 70" opacity="0.7" /></g></svg>);
  if (kind === 'peek') return (<svg {...common}><path d="M8 50 Q50 8 92 50 Q50 92 8 50 Z" fill="none" stroke={ink} strokeWidth={sw + 1} strokeLinejoin="round" /><circle cx="50" cy="50" r="18" fill={ink} /><circle cx="50" cy="50" r="7" fill="#0891B2" /></svg>);
  if (kind === 'attack') return (<svg {...common}><path d="M56 6 L18 56 H42 L38 94 L78 40 H52 Z" fill={ink} strokeLinejoin="round" /></svg>);
  if (kind === 'favor') return (<svg {...common}><rect x="18" y="38" width="64" height="48" rx="6" fill="none" stroke={ink} strokeWidth={sw + 1} /><path d="M18 52 H82 M50 38 V86" stroke={ink} strokeWidth={sw + 1} /><path d="M50 38 Q30 12 20 26 Q16 40 50 38 Q70 12 80 26 Q84 40 50 38" fill="none" stroke={ink} strokeWidth={sw} strokeLinecap="round" /></svg>);
  if (kind === 'exploding') return (<svg {...common}><circle cx="48" cy="58" r="32" fill={ink} /><path d="M66 34 Q78 18 88 14" fill="none" stroke={ink} strokeWidth={sw} strokeLinecap="round" /><circle cx="89" cy="13" r="6" fill="#FFB020" stroke={ink} strokeWidth="3" /><path d="M36 52 l10 10 M46 52 l-10 10" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" /><path d="M38 74 q10 6 20 0" stroke="#2B2016" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>);
  return (<svg {...common}><path d="M24 42 L16 12 L46 24 Z" fill={ink} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" /><path d="M76 42 L84 12 L54 24 Z" fill={ink} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" /><circle cx="50" cy="56" r="33" fill={ink} stroke="#2B2016" strokeWidth="3" /><circle cx="38" cy="52" r="4.5" fill="#2B2016" /><circle cx="62" cy="52" r="4.5" fill="#2B2016" /><path d="M45 66 h10 l-5 6 Z" fill="#F2728C" stroke="#2B2016" strokeWidth="1.6" strokeLinejoin="round" /></svg>);
}

export const MEO_CARD_COLORS: Record<string, string> = {
  defuse: '#0E9F6E', nope: '#7C4DBD', skip: '#2E7CD6', shuffle: '#0E7490',
  peek: '#6D28D9', attack: '#E4572E', favor: '#DB2777', cat: '#8A7B63', exploding: '#2B2016',
};

/** A Mèo Nổ card in the real-card style. `name`/`ability` come from i18n
 *  (card names stay English per Hải Anh's v40 decision). */
export function MeoCard({ kind, name, ability, size = 'md' }: {
  kind: string; name: string; ability: string; size?: 'sm' | 'md' | 'lg';
}) {
  const w = size === 'lg' ? 'w-[118px]' : size === 'sm' ? 'w-[72px]' : 'w-[100px]';
  const artH = size === 'lg' ? 'h-[92px]' : size === 'sm' ? 'h-[58px]' : 'h-[72px]';
  const nameCls = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  const abCls = size === 'sm' ? 'text-[9px] leading-[1.15]' : 'text-[10px] leading-[1.25]';
  const color = MEO_CARD_COLORS[kind] ?? '#8A7B63';
  return (
    <span className={`relative inline-flex flex-none flex-col overflow-hidden rounded-xl border-[3px] border-[#2B2016] ${w}`} style={{ background: color, boxShadow: CARD_SHADOW }}>
      <span className="flex items-center gap-1 px-1.5 pt-1 pb-0.5">
        <span className="flex-none w-[18px] h-[18px] rounded-full bg-white/25 border border-white/60 flex items-center justify-center"><KindGlyph kind={kind} size={12} /></span>
        <span className={`disp font-extrabold text-white uppercase tracking-wide truncate ${nameCls}`}>{name}</span>
      </span>
      <span className={`block mx-1.5 rounded-lg overflow-hidden border-2 border-white/70 ${artH}`}>
        <img src={CAT_ART[kind] ?? CAT_ART.cat} alt={name} className="w-full h-full object-cover" draggable={false} />
      </span>
      <span className={`mx-1.5 mt-1 mb-1 rounded-md bg-[#FFFBef] text-[#2B2016] font-bold text-center px-1 py-0.5 line-clamp-2 ${abCls}`}>{ability}</span>
      {size !== 'sm' && (
        <span className="block text-right pr-1.5 pb-0.5 text-[9px] font-extrabold text-white/75 uppercase tracking-wide" style={{ transform: 'rotate(180deg)', transformOrigin: 'center' }}>{name}</span>
      )}
    </span>
  );
}

/** A secret role card (Chuột Phô Mai / Ma Sói reveal), same card language. */
export function RoleCard({ color, title, sub, artKey, ability, size = 'md' }: {
  color: string; title: string; sub: string; artKey: string; ability: string; size?: 'md' | 'lg';
}) {
  const w = size === 'lg' ? 'w-[240px]' : 'w-[200px]';
  return (
    <span className={`relative inline-flex flex-none flex-col overflow-hidden rounded-2xl border-4 border-white ${w}`} style={{ background: color, boxShadow: CARD_SHADOW }}>
      <span className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="flex-none w-8 h-8 rounded-full bg-white/25 border-2 border-white/70 flex items-center justify-center text-white text-lg">◉</span>
        <span className="min-w-0">
          <span className="block disp font-extrabold text-white text-lg leading-none uppercase tracking-wide truncate">{title}</span>
          <span className="block font-bold text-white/85 text-[11px] tracking-[0.14em] uppercase mt-0.5">{sub}</span>
        </span>
      </span>
      <span className="block mx-2.5 rounded-xl overflow-hidden border-2 border-white/80 aspect-[3/2]">
        <img src={ROLE_ART[artKey] ?? ROLE_ART.villager} alt={title} className="w-full h-full object-cover" draggable={false} />
      </span>
      <span className="block mx-2.5 mt-2 mb-1 rounded-xl bg-[#FFFBef] text-[#2B2016] font-bold text-center text-[13px] leading-snug px-2.5 py-2">{ability}</span>
      <span className="block text-right pr-3 pb-1.5 text-[11px] font-extrabold text-white/75 uppercase tracking-wide" style={{ transform: 'rotate(180deg)', transformOrigin: 'center' }}>{title}</span>
    </span>
  );
}

/** A player's avatar: their picked 3D animal when synced (player.avatar),
 *  otherwise the game-local fallback avatar passed in. */
export function PlayerAvatar({ avatarId, size = 40, fallback }: {
  avatarId?: string | null; size?: number; fallback: React.ReactNode;
}) {
  if (avatarId && AVATARS_HAS(avatarId)) {
    return <img src={avatarSrc(avatarId)} alt="" width={size} height={size} className="rounded-full border-2 border-[#2B2016] object-cover flex-none" style={{ width: size, height: size }} draggable={false} />;
  }
  return <>{fallback}</>;
}
function AVATARS_HAS(id: string) {
  return ['cat-orange', 'cat-grey', 'mouse', 'fox', 'wolf', 'bear', 'rabbit', 'panda', 'frog', 'owl', 'pig', 'dog'].includes(id);
}

/** My own picked avatar (local choice, for the Hub corner / my cells). */
export function MyAvatar({ size = 40 }: { size?: number }) {
  const a = getAvatar();
  return <img src={avatarSrc(a.animal)} alt="" width={size} height={size} className="rounded-full border-2 border-[#2B2016] object-cover flex-none" style={{ width: size, height: size, background: a.bg }} draggable={false} />;
}

/** A notice that stays until the player taps "Đã hiểu" (design MN3/Uno3):
 *  important news must never auto-dismiss while the player is reading. */
export function NoticeBanner({ text, ackLabel, onAck, tone = 'amber' }: {
  text: string; ackLabel: string; onAck: () => void; tone?: 'amber' | 'red';
}) {
  const box = tone === 'red'
    ? 'bg-[#2B1214] border-[#D63A2F] text-[#FCA5A5]'
    : 'bg-[#FFF3CF] border-[#FFB020] text-[#2B2016]';
  return (
    <div className={`mt-2 border-2 rounded-2xl px-3 py-2 flex items-center gap-2 ${box}`} role="alert">
      <span className="font-bold text-sm flex-1 leading-snug">⚡ {text}</span>
      <button className="disp flex-none px-3 py-2 min-h-[44px] rounded-xl font-extrabold bg-[#FFB020] text-[#2B2016] border-2 border-[#2B2016] push text-sm" onClick={onAck}>{ackLabel}</button>
    </div>
  );
}
