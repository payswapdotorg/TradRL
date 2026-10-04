// Tests for the injected-instant discipline (the wall-clock law).
//
// Laws pinned here (clock.ts header):
//   - instants come from injected sources (fixed / scripted), never the wall clock;
//   - a wall-clock read inside a render/model pass is the typed WallClockReadError;
//   - the guard is re-entrant and disarms on exit (even on error);
//   - outside a render pass the system seam is readable (boot/scheduler boundary only).

import { describe, expect, it } from 'vitest';
import {
  browserScheduler,
  fixedInstant,
  isRenderPassArmed,
  scriptedInstants,
  systemNowMs,
  withRenderGuard,
} from './clock';
import { ConsoleLawError, WallClockReadError } from './errors';

describe('clock: injected instant sources', () => {
  it('fixedInstant always returns the one injected instant', () => {
    const source = fixedInstant(1_717_171_717_171);
    expect(source.nowMs()).toBe(1_717_171_717_171);
    expect(source.nowMs()).toBe(1_717_171_717_171);
  });

  it('scriptedInstants yields the scripted sequence in order', () => {
    const source = scriptedInstants([10, 20, 30]);
    expect([source.nowMs(), source.nowMs(), source.nowMs()]).toEqual([10, 20, 30]);
  });

  it('scriptedInstants fails loudly when the sequence is exhausted (never invents time)', () => {
    const source = scriptedInstants([7]);
    expect(source.nowMs()).toBe(7);
    expect(() => source.nowMs()).toThrow(/exhausted/);
  });
});

describe('clock: the render guard (typed WallClockReadError)', () => {
  it('the guard is disarmed outside a pass', () => {
    expect(isRenderPassArmed()).toBe(false);
    expect(systemNowMs()).toBeGreaterThan(0); // the boot-boundary seam is readable here
  });

  it('a wall-clock read inside a render path is the typed WallClockReadError', () => {
    let caught: unknown;
    withRenderGuard(() => {
      try {
        systemNowMs();
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toBeInstanceOf(WallClockReadError);
    const violation = caught as WallClockReadError;
    expect(violation.name).toBe('WallClockReadError');
    expect(violation.code).toBe('wall_clock_read');
    expect(violation).toBeInstanceOf(ConsoleLawError);
    expect(violation.message).toContain('render path');
  });

  it('isRenderPassArmed is true only inside the pass', () => {
    expect(isRenderPassArmed()).toBe(false);
    withRenderGuard(() => {
      expect(isRenderPassArmed()).toBe(true);
    });
    expect(isRenderPassArmed()).toBe(false);
  });

  it('nested guards stay armed until the outermost pass ends (re-entrant)', () => {
    let innerReadFailed = false;
    withRenderGuard(() => {
      withRenderGuard(() => {
        try {
          systemNowMs();
        } catch {
          innerReadFailed = true;
        }
      });
      // the inner guard's exit must NOT disarm the outer pass
      expect(() => systemNowMs()).toThrow(WallClockReadError);
    });
    expect(innerReadFailed).toBe(true);
    expect(isRenderPassArmed()).toBe(false);
  });

  it('the guard disarms even when the pass throws', () => {
    expect(() =>
      withRenderGuard(() => {
        throw new Error('render failed');
      }),
    ).toThrow('render failed');
    expect(isRenderPassArmed()).toBe(false);
    expect(systemNowMs()).toBeGreaterThan(0);
  });

  it('a value computed inside the guard is returned intact', () => {
    expect(withRenderGuard(() => fixedInstant(123).nowMs())).toBe(123);
  });
});

describe('clock: the scheduler seam', () => {
  it('browserScheduler schedules through setTimeout (the injected tick seam)', () => {
    const scheduler = browserScheduler();
    let ticked = false;
    scheduler.schedule(0, () => {
      ticked = true;
    });
    expect(typeof scheduler.schedule).toBe('function');
    // The browser timer is async; awaiting a macrotask proves the tick fired.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(ticked).toBe(true);
        resolve();
      }, 20);
    });
  });
});
