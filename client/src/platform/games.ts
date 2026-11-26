// Platform game registry — the hub renders one card per entry, and
// PlatformApp mounts the registered component for ?game=<id>.
// Adding a game = one entry here + its component (and, for server mode,
// an engine in games/<id>/ + an id in the server's GAME_IDS set).
// Each game is lazy-loaded: the Sảnh only downloads the game the player
// actually opens (A1 — the old static imports shipped all 4 games +
// both extra transports in the first bundle).
import { lazy, type ComponentType } from 'react';

const CheeseThiefApp = lazy(() => import('../games/cheese-thief/GameApp'));
const MaSoiApp = lazy(() => import('../games/ma-soi/GameApp'));
const UnoApp = lazy(() => import('../games/uno/GameApp'));
const MeoNoApp = lazy(() => import('../games/meo-no/GameApp'));

export interface GameDef {
  id: string;
  /** Component mounted for ?game=<id>; absent for coming-soon cards. */
  component?: ComponentType;
  comingSoon?: boolean;
}

export const GAMES: GameDef[] = [
  { id: 'cheese-thief', component: CheeseThiefApp },
  { id: 'ma-soi', component: MaSoiApp },
  { id: 'uno', component: UnoApp },
  { id: 'meo-no', component: MeoNoApp },
  { id: 'gian-diep', comingSoon: true },
];

export const GAME_IDS = new Set(GAMES.filter(g => !g.comingSoon).map(g => g.id));
