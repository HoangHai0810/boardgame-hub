// Synthesized sound effects via Web Audio — zero audio files, zero deps.
// Every cue is one oscillator + a gain envelope. Audio must NEVER crash the
// game: all entry points are guarded, and browsers require a user gesture
// before an AudioContext may start (see ensureCtx / App's pointerdown hook).

export type SfxKind = 'hour' | 'wake' | 'steal' | 'morning' | 'vote' | 'win' | 'lose' | 'pop';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function ensureCtx(): void {
  try {
    if (!ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const c: AudioContext = new AC();
      const g = c.createGain();
      g.gain.value = 0.2; // conservative: several phones play in one room
      g.connect(c.destination);
      master = g;
      ctx = c;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio is best-effort only */ }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  // Exponential ramps cannot reach 0 — target 0.0001 (inaudible).
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

const CUES: Record<SfxKind, () => void> = {
  hour: () => tone(660, 0.07, 'sine', 0.5),
  wake: () => { tone(523, 0.1, 'sine', 0.7); tone(784, 0.14, 'sine', 0.7, 0.09); },
  steal: () => tone(392, 0.25, 'triangle', 0.7, 0, 196),
  morning: () => { tone(523, 0.1, 'triangle', 0.6); tone(659, 0.1, 'triangle', 0.6, 0.08); tone(784, 0.16, 'triangle', 0.6, 0.16); },
  vote: () => tone(880, 0.05, 'square', 0.25),
  win: () => { tone(523, 0.12, 'sine', 0.7); tone(659, 0.12, 'sine', 0.7, 0.1); tone(784, 0.12, 'sine', 0.7, 0.2); tone(1047, 0.22, 'sine', 0.7, 0.3); },
  lose: () => { tone(392, 0.16, 'sine', 0.6); tone(262, 0.26, 'sine', 0.6, 0.14); },
  pop: () => tone(1200, 0.03, 'sine', 0.25),
};

export function sfx(kind: SfxKind, muted: boolean): void {
  if (muted) return;
  try {
    ensureCtx();
    if (!ctx || ctx.state !== 'running') return; // no gesture yet — stay silent
    CUES[kind]();
    // Testability hook: counts cues actually played (browser self-play asserts on it).
    (window as any).__ctSfx = ((window as any).__ctSfx ?? 0) + 1;
  } catch { /* best-effort only */ }
}
