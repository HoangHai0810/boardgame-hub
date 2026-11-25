// Platform shell: ?game=<id> mounts that game, anything else (or an
// unknown id) shows the Sảnh. The game itself owns everything below its
// own landing — the shell never reaches into a game's screens.
import { GAMES } from './games';
import Hub from './Hub';

export default function PlatformApp() {
  const gameId = new URLSearchParams(location.search).get('game') || '';
  const game = GAMES.find(g => g.id === gameId && g.component);
  if (!game?.component) return <Hub />;
  const Game = game.component;
  return <Game />;
}
