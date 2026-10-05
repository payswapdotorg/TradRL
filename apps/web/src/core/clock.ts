// @tradrl/web-console — the injected-instant discipline.
//
// THE LAW (Work Order T042): "Injected instants only (the console
// receives time from the API/adapter; a wall-clock read in a render
// path is a typed error — determinism tests REQUIRED on the
// workspace state machine)."
//
// The console's ONLY system-time seam is `systemNowMs` (used
// exclusively by the boot/scheduler boundary to stamp UI ticks —
// never by the state machine, never by a render path). Everything
// else receives instants explicitly: API records carry them (asOf/
// at/submittedAt), and every model/render function takes `at` as a
// parameter. The RENDER GUARD arms the typed WallClockReadError for
// the duration of every render/model pass — a wall-clock read in a
// render path surfaces loudly, never as a wrong pixel.
//
// The source-scan trip wire (src/conformance.test.ts) pins that no
// module outside this one touches Date.now / performance.now / new
// Date.

import { WallClockReadError } from './errors';

/** A source of instants (epoch ms). Injected everywhere; never read from the wall clock inside the model. */
export interface InstantSource {
  nowMs(): number;
}

/** The scripted instant source: a fixed sequence, consumed in order (deterministic tests drive whole sessions with it). */
export function scriptedInstants(instants: readonly number[]): InstantSource {
  let index = 0;
  return {
    nowMs(): number {
      if (index >= instants.length) throw new Error('scriptedInstants: the scripted sequence is exhausted');
      const value = instants[index] as number;
      index += 1;
      return value;
    },
  };
}

/** The fixed instant source: one constant instant (a frozen view, a deterministic render). */
export function fixedInstant(at: number): InstantSource {
  return { nowMs: () => at };
}

/** `true` while a render/model pass is armed (the wall-clock trip wire's state). */
let renderDepth = 0;

/**
 * THE RENDER GUARD: run a model/render pass with the wall-clock trip
 * wire armed. Any read of the system instant source inside the pass
 * throws the typed WallClockReadError (the console's time inside a
 * render is the injected `at`, the record instants, and nothing
 * else). Re-entrant (nested guards keep the outer pass armed).
 */
/** One render/model pass under guard (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
export type RenderPass<T> = () => T;

export function withRenderGuard<T>(pass: RenderPass<T>): T {
  renderDepth += 1;
  try {
    return pass();
  } finally {
    renderDepth -= 1;
  }
}

/** `true` while a render/model pass is armed. */
export function isRenderPassArmed(): boolean {
  return renderDepth > 0;
}

/**
 * THE SYSTEM INSTANT SEAM — the console's only wall-clock read.
 * Boot/scheduler boundaries call it (UI tick stamping); the render
 * guard makes any call from inside a render/model pass the typed
 * WallClockReadError. The app can inject a different source
 * entirely (a replayed session, a scripted test) — this function is
 * simply the default binding at the boot boundary.
 */
export function systemNowMs(): number {
  if (isRenderPassArmed()) {
    throw new WallClockReadError('a wall-clock read inside a render path — the console renders at an injected instant (the API/adapter is the time source), never at the system clock');
  }
  return Date.now();
}

/** The scheduled-tick scheduler seam: the app injects this (browser: setTimeout; tests: scripted). */
export interface TickScheduler {
  schedule(delayMs: number, tick: () => void): void;
}

/** The browser scheduler binding (the only DOM-timer seam; boot boundary only). */
export function browserScheduler(): TickScheduler {
  return {
    schedule(delayMs, tick) {
      setTimeout(tick, delayMs);
    },
  };
}
