// Platform game registry — the hub renders one card per entry, and
// PlatformApp mounts the registered component for ?game=<id>.
// Adding a game = one entry here + its component (and, for server mode,
// an engine in games/<id>/ + an id in the server's GAME_IDS set).
import type { ComponentType } from 'react';
import CheeseThiefApp from '../games/cheese-thief/GameApp';
import MaSoiApp from '../games/ma-soi/GameApp';
import UnoApp from '../games/uno/GameApp';
import MeoNoApp from '../games/meo-no/GameApp';

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
