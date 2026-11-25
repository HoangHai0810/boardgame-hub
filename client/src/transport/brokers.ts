// Shared MQTT broker selection for the game bus and the voice bus.
//
// THE BUG THIS FIXES (v27): brokers were raced in parallel and the first
// to answer won — per PLAYER. Two players of the same room could land on
// DIFFERENT brokers (EMQX vs HiveMQ), and separate brokers are separate
// MQTT universes: the room became invisible across them, joins hung on
// "connecting…" forever, and in-game actions vanished — the "unstable WS"
// the PO kept hitting on real networks.
//
// THE RULE NOW: broker choice is deterministic PER ROOM. The room code
// hashes (FNV-1a) to a rotation of the broker list; host and guests walk
// the SAME order, first reachable broker wins, and a mid-session failover
// advances to the NEXT broker in that same order — so a room always
// gathers, and re-gathers, on exactly one broker.
import mqtt, { MqttClient } from 'mqtt';

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
];

let cachedBase: string[] | null = null;
export function baseBrokers(): string[] {
  if (cachedBase) return cachedBase;
  try {
    const q = new URLSearchParams(location.search);
    // ?brokers=a,b exists so tests can simulate the production multi-broker
    // world locally; ?broker=x pins a single broker (also used by tests).
    const multi = q.get('brokers');
    if (multi) return (cachedBase = multi.split(',').map(s => s.trim()).filter(Boolean));
    const single = q.get('broker');
    if (single) return (cachedBase = [single]);
  } catch { /* non-browser test env */ }
  return (cachedBase = BROKERS);
}

/** The broker walk order for one room — identical for everyone in it. */
export function brokerOrder(roomCode: string): string[] {
  const base = baseBrokers();
  if (base.length < 2) return base.slice();
  let h = 2166136261; // FNV-1a
  const code = roomCode.toUpperCase();
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 16777619); }
  const start = Math.abs(h) % base.length;
  return base.map((_, i) => base[(start + i) % base.length]);
}

function tryOneBroker(url: string, extra: mqtt.IClientOptions): Promise<MqttClient | null> {
  return new Promise((resolve) => {
    let c: MqttClient;
    try { c = mqtt.connect(url, { connectTimeout: 4000, reconnectPeriod: 0, ...extra }); }
    catch { resolve(null); return; }
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (!ok) { try { c.end(true); } catch { /* noop */ } resolve(null); }
      else resolve(c);
    };
    // Hard cap for silent blackholes; an 'error' with no connect inside a
    // 900ms grace means the broker is dead for this network — fail in
    // ~1.5s instead of burning the whole cap on every dead entry (the
    // old behaviour stacked up to ~30s joins).
    const timer = setTimeout(() => finish(false), 4000);
    c.on('connect', () => finish(true));
    c.on('error', () => { setTimeout(() => finish(false), 900); });
  });
}

/** Walk `order` starting at `startIdx`; resolves with the winner + its index. */
export async function connectMqttSequential(
  order: string[], startIdx: number, extra: mqtt.IClientOptions,
): Promise<{ client: MqttClient; idx: number }> {
  for (let k = 0; k < order.length; k++) {
    const idx = (startIdx + k) % order.length;
    const c = await tryOneBroker(order[idx], extra);
    if (c) {
      // The walk itself must not auto-reconnect (a dead broker has to
      // fail fast), but the WINNER is a long-lived bus: restore normal
      // auto-reconnect on it, or a single socket blink silently kills
      // QoS-0 traffic (WebRTC ICE candidates) while QoS-1 messages get
      // queued and everything LOOKS connected — v29 voice regression.
      (c as any).options.reconnectPeriod = 2000;
      return { client: c, idx };
    }
  }
  throw new Error('bus unreachable');
}

/** Connect to every broker in `order` IN PARALLEL; `onClient` fires for
 *  each one as soon as it connects (with the per-client `tag` the extra
 *  factory returned). Resolves when every attempt has settled. Used ONLY
 *  by the guest join race (v40): the guest sends its join on every
 *  connected broker and follows the first 'joined' answer, so it lands on
 *  the host's broker in ~1–2s even when that broker is not first in the
 *  room's order. The HOST never uses this — its broker choice stays
 *  deterministic per room (see the v27 rule above). */
export async function connectMqttParallel<T>(
  order: string[],
  extra: () => { opts: mqtt.IClientOptions; tag: T },
  onClient: (client: MqttClient, idx: number, tag: T) => void,
): Promise<void> {
  await Promise.all(order.map(async (url, idx) => {
    const { opts, tag } = extra();
    const c = await tryOneBroker(url, opts);
    if (c) onClient(c, idx, tag);
  }));
}
