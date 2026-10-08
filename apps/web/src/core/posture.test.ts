// Tests for the console's session posture — FW-34-B (Round C register
// §3.1 — the browser-restart residuals, L3/M1/S5/S2).
//
// Laws pinned here (posture.ts header):
//   - ONE validated record carries the wizard's dismissal, the workspace's
//     scope pointer and the Time Machine's mode + speed + view instant;
//   - the grammar is STRICT: anything malformed degrades the WHOLE record
//     to absent (never a half-applied posture);
//   - the LEGACY FALLBACK: pre-FW-34-B keys (tradrl_onboarded,
//     tradrl_scope_project) migrate transparently, and every write goes to
//     BOTH (a downgrade never loses the user's world);
//   - the storage seam is best-effort (a refusing storage degrades to
//     session-only posture, never a throw);
//   - the TM fold: live saves viewAt null (never a fabricated pin);
//     t-minus/timestamp/playback save their selected instant in timestamp
//     mode (a reload resumes VIEWING where the analyst stood — paused by
//     nature, never a surprise auto-play).

import { describe, expect, it } from 'vitest';
import {
  CONSOLE_POSTURE_STORAGE_KEY,
  initialConsolePosture,
  parseStoredPosture,
  persistPosture,
  postureTimeMachineOf,
  readStoredPosture,
  SCOPE_STORAGE_KEY,
  serializePosture,
  type ConsoleSessionPosture,
  type PostureStorage,
} from './posture';
import { liveTimeMachine, setTMinus, setTimestamp, startPlayback, viewAtOf } from './timemachine';
import { ONBOARDING_STORAGE_KEY } from './onboarding';

const ANCHOR = 1_700_000_000_000;

/** An in-memory storage seam (localStorage in production). */
class MapStorage implements PostureStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** A posture fixture. */
function posture(overrides: Partial<ConsoleSessionPosture> = {}): ConsoleSessionPosture {
  return { ...initialConsolePosture(), ...overrides };
}

describe('FW-34-B: the posture record grammar (parseStoredPosture + serializePosture)', () => {
  it('the round-trip is byte-stable (serialize -> parse -> the same record)', () => {
    const record = posture({ onboarded: true, scopeProjectId: 'prj-mine', timeMachine: { speed: '10x', freeSpeed: '2.5', mode: 'timestamp', viewAt: ANCHOR - 60_000 } });
    expect(parseStoredPosture(serializePosture(record))).toEqual(record);
  });

  it('STRICT: anything malformed degrades the WHOLE record to absent — never a half-applied posture', () => {
    expect(parseStoredPosture(null)).toBeNull();
    expect(parseStoredPosture('')).toBeNull();
    expect(parseStoredPosture('not json')).toBeNull();
    expect(parseStoredPosture('[]')).toBeNull();
    expect(parseStoredPosture('42')).toBeNull(); // a scalar is not a record
    expect(parseStoredPosture(JSON.stringify({ ...posture({ onboarded: 'yes' as never }) }))).toBeNull(); // onboarded must be boolean
    expect(parseStoredPosture(JSON.stringify({ ...posture({ scopeProjectId: 7 as never }) }))).toBeNull(); // scope must be string-or-null
    expect(parseStoredPosture(JSON.stringify({ ...posture({ scopeProjectId: '' }) }))).toBeNull(); // the empty string is not a scope
    expect(parseStoredPosture(JSON.stringify({ ...posture(), timeMachine: { ...posture().timeMachine, speed: '10000x' } }))).toBeNull(); // an unknown speed key
    expect(parseStoredPosture(JSON.stringify({ ...posture(), timeMachine: { ...posture().timeMachine, freeSpeed: 2.5 as never } }))).toBeNull(); // freeSpeed must be a string
    expect(parseStoredPosture(JSON.stringify({ ...posture(), timeMachine: { ...posture().timeMachine, mode: 'playback' as never } }))).toBeNull(); // playback NEVER persists (the fold's own law)
    expect(parseStoredPosture(JSON.stringify({ ...posture(), timeMachine: { ...posture().timeMachine, viewAt: 'now' as never } }))).toBeNull(); // viewAt must be a finite integer or null
    expect(parseStoredPosture(JSON.stringify({ ...posture(), timeMachine: { ...posture().timeMachine, viewAt: 1.5 } }))).toBeNull(); // a fractional instant is not an instant
    // a record MISSING its timeMachine entirely is absent (never a default-filled half)
    expect(parseStoredPosture(JSON.stringify({ onboarded: true, scopeProjectId: null }))).toBeNull();
  });
});

describe('FW-34-B: the storage seam (readStoredPosture + persistPosture)', () => {
  it('the record is the source of truth; the LEGACY keys are written alongside (a downgrade never loses the world)', () => {
    const storage = new MapStorage();
    const record = posture({ onboarded: true, scopeProjectId: 'prj-mine', timeMachine: { speed: '100x', freeSpeed: '', mode: 'live', viewAt: null } });
    persistPosture(storage, record);
    expect(storage.map.get(CONSOLE_POSTURE_STORAGE_KEY)).toBe(serializePosture(record));
    expect(storage.map.get(ONBOARDING_STORAGE_KEY)).toBe('true'); // the legacy key keeps its exact prior meaning
    expect(storage.map.get(SCOPE_STORAGE_KEY)).toBe('prj-mine');
    expect(readStoredPosture(storage)).toEqual(record); // the record reads back first
  });

  it('the legacy fallback: a browser carrying ONLY the pre-FW-34-B keys migrates transparently', () => {
    const storage = new MapStorage();
    storage.map.set(ONBOARDING_STORAGE_KEY, 'true');
    storage.map.set(SCOPE_STORAGE_KEY, 'prj-legacy');
    const restored = readStoredPosture(storage);
    expect(restored).toEqual({ ...initialConsolePosture(), onboarded: true, scopeProjectId: 'prj-legacy' }); // the TM falls to the default (live, 1x) — never a fabricated posture
    // a browser with NEITHER the record NOR the legacy keys is a first run
    const fresh = new MapStorage();
    expect(readStoredPosture(fresh)).toBeNull();
  });

  it('a refusing storage degrades to session-only posture — never a throw (the theme/onboarding seams\u2019 own law)', () => {
    const exploding: PostureStorage = {
      getItem: (): string => { throw new Error('no storage'); },
      setItem: (): void => { throw new Error('no storage'); },
    };
    expect(readStoredPosture(exploding)).toBeNull();
    expect(() => persistPosture(exploding, posture({ onboarded: true }))).not.toThrow();
  });

  it('an onboarded=false record persists the legacy key as EMPTY (the pre-fix exact prior meaning)', () => {
    const storage = new MapStorage();
    persistPosture(storage, posture({ onboarded: false, scopeProjectId: null }));
    expect(storage.map.get(ONBOARDING_STORAGE_KEY)).toBe('');
    expect(storage.map.get(SCOPE_STORAGE_KEY)).toBe('');
  });
});

describe('FW-34-B: the Time-Machine posture fold (postureTimeMachineOf)', () => {
  it('LIVE saves viewAt null — the anchor follows the observed now, never a fabricated pin', () => {
    expect(postureTimeMachineOf('live', ANCHOR, '1x', '')).toEqual({ speed: '1x', freeSpeed: '', mode: 'live', viewAt: null });
  });

  it('a SCRUBBED TIMESTAMP saves the selected instant in timestamp mode (the reload resumes VIEWING it)', () => {
    const machine = setTimestamp(liveTimeMachine(ANCHOR), ANCHOR - 90_000);
    expect(postureTimeMachineOf(machine.mode, viewAtOf(machine), '10x', '2.5')).toEqual({ speed: '10x', freeSpeed: '2.5', mode: 'timestamp', viewAt: ANCHOR - 90_000 });
  });

  it('a T-MINUS lens saves as timestamp at the same instant (the lens restores through the same door)', () => {
    const machine = setTMinus(liveTimeMachine(ANCHOR), 60_000);
    expect(postureTimeMachineOf(machine.mode, viewAtOf(machine), '1x', '')).toEqual({ speed: '1x', freeSpeed: '', mode: 'timestamp', viewAt: ANCHOR - 60_000 });
  });

  it('a PLAYBACK session saves as the same instant in TIMESTAMP mode — a reload never auto-plays (paused by nature)', () => {
    const armed = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 30_000, 500);
    expect(armed.mode).toBe('playback');
    expect(postureTimeMachineOf(armed.mode, viewAtOf(armed), '100x', '')).toEqual({ speed: '100x', freeSpeed: '', mode: 'timestamp', viewAt: ANCHOR - 30_000 });
  });
});
