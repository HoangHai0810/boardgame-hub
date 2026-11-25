// Room codes are platform-level, not game-level: every game shares the
// same 5-letter code space, and the per-game topic/room namespaces
// (ct1/<game>/<code>/) are what keep two games from colliding.
export function makeRoomCode(rng: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}
