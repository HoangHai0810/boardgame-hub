// Registry of the authoritative host engines, one per game.
// The transports (MQTT + PeerJS) are payload-agnostic: they construct the
// engine for the room's game and forward intents/states as JSON. The only
// contract an engine must satisfy is this surface (states are JSON, so the
// transport never inspects their shape).
import { HostEngine as CheeseThiefEngine } from '../games/cheese-thief/hostEngine';
import { HostEngine as MaSoiEngine } from '../games/ma-soi/hostEngine';
import { HostEngine as UnoEngine } from '../games/uno/hostEngine';
import { HostEngine as MeoNoEngine } from '../games/meo-no/hostEngine';

export interface EngineLike {
  state: any;
  resumeTimers(): void;
  broadcast(): void;
  dispose?(): void;
  addPlayer(id: string, name: string, isHost: boolean): any;
  disconnect(playerId: string): void;
  canAcceptJoin(playerId: string): 'ok' | 'started' | 'full';
  handle(player: any, msg: any): void;
}

export type EngineCtor = new (code: string, hooks: any) => EngineLike;

export const ENGINES: Record<string, EngineCtor> = {
  'cheese-thief': CheeseThiefEngine as unknown as EngineCtor,
  'ma-soi': MaSoiEngine as unknown as EngineCtor,
  'uno': UnoEngine as unknown as EngineCtor,
  'meo-no': MeoNoEngine as unknown as EngineCtor,
};

export function engineFor(gameId: string): EngineCtor | null {
  return ENGINES[gameId] ?? null;
}
