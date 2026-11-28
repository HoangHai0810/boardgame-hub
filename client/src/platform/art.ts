/* ---------- Generated 3D art (see loop/design-*.png + the Claude design
 *  files in ~/workspace/user/files). Sheets were generated once, sliced
 *  into panels and saved under client/public/art/. Public assets are
 *  copied to dist/ on build; base './' so relative URLs work on the
 *  GitHub Pages subpath. ---------- */
export const ART = (p: string) => `${import.meta.env.BASE_URL}art/${p}`;

/** Mèo Nổ card art, keyed by card kind. */
export const CAT_ART: Record<string, string> = {
  defuse: ART('cat-defuse.webp'),
  nope: ART('cat-nope.webp'),
  skip: ART('cat-skip.webp'),
  attack: ART('cat-attack.webp'),
  shuffle: ART('cat-shuffle.webp'),
  peek: ART('cat-peek.webp'),
  favor: ART('cat-favor.webp'),
  cat: ART('cat-cat.webp'),
  exploding: ART('cat-exploding.webp'),
};

/** Role-card art: Ma Sói roles + the Chuột Phô Mai thief. */
export const ROLE_ART: Record<string, string> = {
  wolf: ART('role-wolf.webp'),
  seer: ART('role-seer.webp'),
  guardian: ART('role-guardian.webp'),
  witch: ART('role-witch.webp'),
  hunter: ART('role-hunter.webp'),
  villager: ART('role-villager.webp'),
  thief: ART('ct-thief.svg'), // design v54: the design's own masked-mouse illustration (was role-thief.webp)
  /** The CT village mouse reuses the avatar mouse face as its card art. */
  mouse: ART('avatar-mouse.webp'),
};

/** Hub lobby art (design v47): one illustration per game, used for the
 *  mobile icon frame and the laptop banner of each Hub card. */
export const HUB_ART: Record<string, string> = {
  cheese: ART('hub-cheese.svg'),
  wolf: ART('hub-wolf.svg'),
  uno: ART('hub-uno.svg'),
  meo: ART('hub-meo.svg'),
  spy: ART('hub-spy.svg'),
  love: ART('hub-love.svg'),
  coup: ART('hub-coup.svg'),
};

/** Spyfall art (design v48): the spy portrait + the restaurant cloche. */
export const SPY_ART = ART('spy.svg');
export const CLOCHE_ART = ART('cloche.svg');

/** Love Letter card art (design v48). The 8 classic illustrations come
 *  from the design file; the Spy reuses the Spyfall portrait and the
 *  Chancellor panda is drawn in the same flat style, since the design
 *  is the 2012 edition and has neither. Values, names and counts stay
 *  the 2019 edition — only the artwork is reused. */
export const LL_ART: Record<string, string> = {
  spy: ART('spy.svg'),
  guard: ART('ll-guard.svg'),
  priest: ART('ll-priest.svg'),
  baron: ART('ll-baron.svg'),
  handmaid: ART('ll-handmaid.svg'),
  prince: ART('ll-prince.svg'),
  chancellor: ART('ll-chancellor.svg'),
  king: ART('ll-king.svg'),
  countess: ART('ll-countess.svg'),
  princess: ART('ll-princess.svg'),
};

/** Coup character art — flat-style portraits drawn for this game (one
 *  per character: Duke crown, Assassin hood + mask, Captain naval cap,
 *  Ambassador laurel, Contessa bun + jewel). */
export const COUP_ART: Record<string, string> = {
  duke: ART('coup-duke.svg'),
  assassin: ART('coup-assassin.svg'),
  captain: ART('coup-captain.svg'),
  ambassador: ART('coup-ambassador.svg'),
  contessa: ART('coup-contessa.svg'),
};

/** The 12 pickable avatars (design: "Chọn avatar của bạn"). */
export const AVATARS: { id: string; vi: string; en: string; bg: string }[] = [
  { id: 'cat-orange', vi: 'Mèo cam', en: 'Orange cat', bg: '#FFDCC8' },
  { id: 'cat-grey', vi: 'Mèo xám', en: 'Grey cat', bg: '#C8E4F5' },
  { id: 'mouse', vi: 'Chuột', en: 'Mouse', bg: '#D8C8F5' },
  { id: 'fox', vi: 'Cáo', en: 'Fox', bg: '#C8F5E0' },
  { id: 'wolf', vi: 'Sói', en: 'Wolf', bg: '#FFF3C0' },
  { id: 'bear', vi: 'Gấu', en: 'Bear', bg: '#FFD9E0' },
  { id: 'rabbit', vi: 'Thỏ', en: 'Rabbit', bg: '#C8F0F5' },
  { id: 'panda', vi: 'Gấu trúc', en: 'Panda', bg: '#FFF3D9' },
  { id: 'frog', vi: 'Ếch', en: 'Frog', bg: '#D9F5C0' },
  { id: 'owl', vi: 'Cú', en: 'Owl', bg: '#E0C8F5' },
  { id: 'pig', vi: 'Heo', en: 'Pig', bg: '#FFD9E8' },
  { id: 'dog', vi: 'Chó', en: 'Dog', bg: '#FFE0C0' },
];
export const AVATAR_BGS = ['#FFDCC8', '#D8C8F5', '#C8F0F5', '#D9F5C0', '#C8E4F5', '#FFF3C0'];
export const avatarSrc = (id: string) => ART(`avatar-${id}.webp`);

export type AvatarChoice = { animal: string; bg: string };
const AVATAR_KEY = 'ct_avatar';
export function getAvatar(): AvatarChoice {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.animal === 'string' && AVATARS.some(a => a.id === v.animal)) {
        return { animal: v.animal, bg: typeof v.bg === 'string' ? v.bg : AVATARS.find(a => a.id === v.animal)!.bg };
      }
    }
  } catch { /* ignore */ }
  return { animal: 'cat-orange', bg: '#FFDCC8' };
}
export function setAvatar(a: AvatarChoice) {
  try { localStorage.setItem(AVATAR_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

/** True when the id is one of the 12 picked avatars (join-payload guard). */
export function isAvatarId(id: unknown): id is string {
  return typeof id === 'string' && AVATARS.some(a => a.id === id);
}

/** This device's picked avatar id — always valid (getAvatar defaults). */
export function myAvatarId(): string {
  return getAvatar().animal;
}
