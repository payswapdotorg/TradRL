// @tradrl/web-console — THE SESSION POSTURE SEAM (FW-34-B, Round C
// register §3.1 — the browser-restart residuals, L3/M1/S5/S2).
//
// THE LAW: the console's session posture — the wizard's dismissal, the
// workspace's scope pointer, and the Time Machine's mode + speed — was
// scattered across localStorage keys at best (tradrl_onboarded,
// tradrl_scope_project) and in-memory chrome state at worst (the Time
// Machine's mode + speed reset to LIVE/1x on EVERY reload — L3's
// finding: an incident review that reloads the page loses the view it
// was reviewing). This module is the ONE validated record that carries
// all of it:
//
//   - the WIZARD's dismissal (once this browser has completed or
//     skipped the intro, it never re-summons for THIS browser);
//   - the SCOPE POINTER (the desk the operator was working — restored
//     at boot after the directory read validates it, exactly the W-22
//     law, now through the unified record);
//   - the TIME MACHINE's posture: the speed (the select's key + the
//     free input's committed text — FW-34-B's own controls) and the
//     MODE + VIEW INSTANT (live follows the anchor; t-minus and
//     timestamp restore their selected instant; a playback session
//     restores as the SAME view instant in timestamp mode — a reload
//     resumes VIEWING where the analyst stood, paused by nature, never
//     a surprise auto-play).
//
// THE HONEST LIMIT (stated, never papered over): this is the BROWSER's
// own trust zone (spec/SECURITY.md — the same class as tradrl_theme,
// the session id, the notice read-marks). A browser whose profile is
// WIPED is a NEW browser identity by construction: nothing client-side
// survives to re-identify it, and the console honestly cannot know
// which desk it worked. For that path the product answers with FAST
// RECOVERY, not amnesia theater: the wizard is a real, labelled,
// mouse-dismissible dialog (never an invisible blocker), and the
// switcher's default listing is the session's OWN desks (the durable
// registry one explicit disclosure away — every desk stays reachable,
// the FW-31-B win).
//
// THE LEGACY FALLBACK: browsers that already carry the pre-FW-34-B
// keys (tradrl_onboarded, tradrl_scope_project) migrate transparently
// — the record reads them when it carries none of its own, and every
// write goes to BOTH (the record is the source of truth going forward;
// the legacy keys keep their exact prior meaning so a downgrade never
// loses the user's world).
//
// This module is PURE + storage-seamed (the W-22 scope-seam
// precedent): the record's grammar is data, the read/write are
// best-effort against an INJECTED storage, and a malformed stored
// value degrades to ABSENT (never a throw, never a half-applied
// posture).

import type { TimeMachineMode, PlaybackSpeedKey } from './timemachine';
import { isPlaybackSpeedKey } from './timemachine';
import { ONBOARDING_STORAGE_KEY } from './onboarding';

/**
 * The persisted-scope storage key (R6b, W-22 — localStorage
 * `tradrl_scope_project` in production). The canonical home moved here
 * with the unified posture record (FW-34-B); app/console.ts re-exports
 * it unchanged for its existing importers.
 */
export const SCOPE_STORAGE_KEY = 'tradrl_scope_project';

/**
 * The posture record's storage key (the browser's trust zone — one
 * validated JSON value, the same class as the theme/onboarding keys).
 */
export const CONSOLE_POSTURE_STORAGE_KEY = 'tradrl_console_posture';

/** The Time Machine posture: the speed controls + the view's own position. */
export interface PostureTimeMachine {
  /** The disclosed speed select's committed key (1x / 10x / 100x). */
  readonly speed: PlaybackSpeedKey;
  /** The free speed input's committed text ('' = the select's key is the effective step — FW-34-B). */
  readonly freeSpeed: string;
  /**
   * The view's mode at save time. A 'playback' session saves as
   * 'timestamp' (the same view instant, paused by nature — a reload
   * never auto-plays).
   */
  readonly mode: 'live' | 't-minus' | 'timestamp';
  /**
   * The selected view instant (epoch ms) for t-minus/timestamp modes;
   * null for live (the anchor follows the observed now — restoring a
   * wall instant for LIVE would be a fabricated pin).
   */
  readonly viewAt: number | null;
}

/** The console's session posture (one validated record). */
export interface ConsoleSessionPosture {
  /** True once this browser completed or skipped the intro wizard. */
  readonly onboarded: boolean;
  /** The workspace's scope pointer (the desk the operator worked; null = none stored). */
  readonly scopeProjectId: string | null;
  /** The Time Machine's posture (mode + speed + the selected instant). */
  readonly timeMachine: PostureTimeMachine;
}

/** The posture's own shape law for a stored mode value. */
function isStoredMode(value: unknown): value is PostureTimeMachine['mode'] {
  return value === 'live' || value === 't-minus' || value === 'timestamp';
}

/** The default posture (a first-run browser: the wizard shows, no scope, live at the anchor, the 1x step). */
export function initialConsolePosture(): ConsoleSessionPosture {
  return { onboarded: false, scopeProjectId: null, timeMachine: { speed: '1x', freeSpeed: '', mode: 'live', viewAt: null } };
}

/**
 * Parse one posture record's serialized form (strict: every field
 * carries its own grammar; anything malformed degrades the WHOLE
 * record to absent — never a half-applied posture, the same
 * fail-closed law the notice read-marks ride).
 */
export function parseStoredPosture(value: string | null): ConsoleSessionPosture | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { readonly onboarded?: unknown; readonly scopeProjectId?: unknown; readonly timeMachine?: unknown };
  if (typeof record.onboarded !== 'boolean') return null;
  if (record.scopeProjectId !== null && typeof record.scopeProjectId !== 'string') return null;
  if (typeof record.scopeProjectId === 'string' && record.scopeProjectId.length === 0) return null;
  if (typeof record.timeMachine !== 'object' || record.timeMachine === null) return null;
  const timeMachine = record.timeMachine as { readonly speed?: unknown; readonly freeSpeed?: unknown; readonly mode?: unknown; readonly viewAt?: unknown };
  if (typeof timeMachine.speed !== 'string' || !isPlaybackSpeedKey(timeMachine.speed)) return null;
  if (typeof timeMachine.freeSpeed !== 'string') return null;
  if (!isStoredMode(timeMachine.mode)) return null;
  if (timeMachine.viewAt !== null && (typeof timeMachine.viewAt !== 'number' || !Number.isFinite(timeMachine.viewAt) || !Number.isInteger(timeMachine.viewAt))) return null;
  return {
    onboarded: record.onboarded,
    scopeProjectId: typeof record.scopeProjectId === 'string' && record.scopeProjectId.length > 0 ? record.scopeProjectId : null,
    timeMachine: { speed: timeMachine.speed, freeSpeed: timeMachine.freeSpeed, mode: timeMachine.mode, viewAt: timeMachine.viewAt },
  };
}

/** Serialize one posture record (the storage's own form). */
export function serializePosture(posture: ConsoleSessionPosture): string {
  return JSON.stringify({ ...posture, timeMachine: { ...posture.timeMachine } });
}

/** The storage seam the posture persists through (localStorage in production). */
export interface PostureStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the stored posture (the record first; the LEGACY keys as the
 * transparent fallback for browsers that predate the record). The
 * legacy migration is read-only here: the next write-through persists
 * the unified record, and the legacy keys keep receiving their own
 * writes so a downgrade never loses the user's world.
 */
export function readStoredPosture(storage: PostureStorage): ConsoleSessionPosture | null {
  let stored: string | null = null;
  try {
    stored = storage.getItem(CONSOLE_POSTURE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const record = parseStoredPosture(stored);
  if (record !== null) return record;
  // THE LEGACY FALLBACK (the pre-FW-34-B keys, best-effort each — a
  // storage that refuses reads degrades to its own absent value).
  let legacyOnboarded = false;
  let legacyScope: string | null = null;
  try {
    legacyOnboarded = storage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    legacyOnboarded = false;
  }
  try {
    const scope = storage.getItem(SCOPE_STORAGE_KEY);
    legacyScope = typeof scope === 'string' && scope.length > 0 ? scope : null;
  } catch {
    legacyScope = null;
  }
  if (!legacyOnboarded && legacyScope === null) return null;
  return { ...initialConsolePosture(), onboarded: legacyOnboarded, scopeProjectId: legacyScope };
}

/**
 * Persist the posture record (best-effort: a storage that refuses
 * writes — private mode, quota — degrades to session-only posture,
 * exactly the theme/onboarding seams' own law). The LEGACY keys are
 * written alongside (their exact prior meanings) so a downgrade never
 * loses the user's world.
 */
export function persistPosture(storage: PostureStorage, posture: ConsoleSessionPosture): void {
  try {
    storage.setItem(CONSOLE_POSTURE_STORAGE_KEY, serializePosture(posture));
  } catch {
    // storage unavailable: the posture holds for this session only
  }
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, posture.onboarded ? 'true' : '');
  } catch {
    // best-effort — the unified record is the source of truth
  }
  try {
    storage.setItem(SCOPE_STORAGE_KEY, posture.scopeProjectId ?? '');
  } catch {
    // best-effort — the unified record is the source of truth
  }
}

/**
 * The Time Machine posture of a live machine state (the save-time
 * fold): live follows the anchor (viewAt null — never a fabricated
 * pin); t-minus/timestamp carry their selected instant; a PLAYBACK
 * session saves as the same instant in TIMESTAMP mode (a reload
 * resumes viewing where the analyst stood — paused by nature, never a
 * surprise auto-play).
 */
export function postureTimeMachineOf(mode: TimeMachineMode, viewAt: number, speed: PlaybackSpeedKey, freeSpeed: string): PostureTimeMachine {
  if (mode === 'live') return { speed, freeSpeed, mode: 'live', viewAt: null };
  return { speed, freeSpeed, mode: 'timestamp', viewAt };
}
