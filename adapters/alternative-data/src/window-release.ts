/**
 * @tradrl/adapter-alternative-data — the declared window->release law
 * (the observation availability policy).
 *
 * Work Order T038 (scope): "mapping (observation window -> available
 * time policy: an alt-datum covering window W becomes available at its
 * declared release time — never mid-window)"; acceptance criterion 9:
 * "alt-data window->release law". THIS module is the declaration, and
 * the guard transport (../guard-transport.ts) plus the mapping tables'
 * declared source-time policies are its enforcement:
 *
 *   - observation_basis `window-fields`: every documented observation
 *     record declares its observation window (windowStartMs,
 *     windowEndMs) and its release instant (releaseTimeMs) — the
 *     window is what the observation COVERS; the release is when the
 *     vendor makes it available;
 *   - availability `release-instant`: the observation's availability
 *     quartet is its DECLARED release instant — the mapping tables
 *     declare event_time from the release field with event-time
 *     availability basis, so available_time == releaseTimeMs ALWAYS,
 *     even when the host polls late (L4 point-in-time truth for
 *     backtests: a late poll does not move the availability instant);
 *   - mid_window_release `refuse`: a record whose release instant
 *     precedes its window's end is IMPOSSIBLE data (released before the
 *     observation completed) — a typed `release_before_window_close`
 *     protocol error, never an emitted dishonest quartet (the
 *     "never mid-window" law);
 *   - window_overlap `refuse`: a series observation window that starts
 *     before the series' previous window ended is a typed
 *     `observation_window_overlap` protocol error (the per-series
 *     sequencing law — windows tile, they do not overlap).
 *
 * Determinism: the law consumes no clock — every instant it judges is
 * declared in the record itself.
 */

import { invalidField, isRecord, missingField } from './contract/fields';
import type { SdkFieldError } from './contract/errors';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { deepFreeze } from './contract/freeze';

/** The declared observation window->release law of the alternative-data channels. */
export interface WindowReleaseLaw {
  /** Where the observation window and release instant come from: the documented window/release fields. */
  readonly observation_basis: 'window-fields';
  /** When an observation becomes available: at its declared release instant. */
  readonly availability: 'release-instant';
  /** A release before the window closes is: refused (typed error). */
  readonly mid_window_release: 'refuse';
  /** A window overlapping the series' previous window is: refused (typed error). */
  readonly window_overlap: 'refuse';
}

const OBSERVATION_BASIS = ['window-fields'] as const;
const AVAILABILITY = ['release-instant'] as const;
const REFUSE = ['refuse'] as const;

/** Validate an untrusted value as a WindowReleaseLaw (collect-all; frozen). */
export function validateWindowReleaseLaw(value: unknown): { readonly ok: true; readonly value: WindowReleaseLaw } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('window_release_law', 'must be an object')] };
  }
  if (value.observation_basis === undefined) errors.push(missingField('observation_basis'));
  else if (typeof value.observation_basis !== 'string' || !(OBSERVATION_BASIS as readonly string[]).includes(value.observation_basis))
    errors.push(invalidField('observation_basis', `must be ${OBSERVATION_BASIS.join(' | ')}`));
  if (value.availability === undefined) errors.push(missingField('availability'));
  else if (typeof value.availability !== 'string' || !(AVAILABILITY as readonly string[]).includes(value.availability))
    errors.push(invalidField('availability', `must be ${AVAILABILITY.join(' | ')}`));
  if (value.mid_window_release === undefined) errors.push(missingField('mid_window_release'));
  else if (typeof value.mid_window_release !== 'string' || !(REFUSE as readonly string[]).includes(value.mid_window_release))
    errors.push(invalidField('mid_window_release', `must be ${REFUSE.join(' | ')}`));
  if (value.window_overlap === undefined) errors.push(missingField('window_overlap'));
  else if (typeof value.window_overlap !== 'string' || !(REFUSE as readonly string[]).includes(value.window_overlap))
    errors.push(invalidField('window_overlap', `must be ${REFUSE.join(' | ')}`));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as WindowReleaseLaw) as unknown as WindowReleaseLaw };
}

const declaration = validateWindowReleaseLaw({
  observation_basis: 'window-fields',
  availability: 'release-instant',
  mid_window_release: 'refuse',
  window_overlap: 'refuse',
});

if (!declaration.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`ALTDATA_WINDOW_RELEASE_LAW is invalid: ${declaration.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen window->release law of the alternative-data channels. */
export const ALTDATA_WINDOW_RELEASE_LAW: WindowReleaseLaw = declaration.value;

/**
 * The mid-window predicate: true iff the record's declared release
 * instant precedes its observation window's end (a mid-window release —
 * the "never mid-window" law refuses it). Pure.
 */
export function isMidWindowRelease(windowEndMs: TimestampMs, releaseTimeMs: TimestampMs): boolean {
  if (!isTimestampMs(windowEndMs) || !isTimestampMs(releaseTimeMs)) return false;
  return releaseTimeMs < windowEndMs;
}

/**
 * The overlap predicate: true iff the next observation window starts
 * before the previous window ended (the series' windows must tile
 * without overlap). Pure.
 */
export function windowsOverlap(previousWindowEndMs: TimestampMs, nextWindowStartMs: TimestampMs): boolean {
  if (!isTimestampMs(previousWindowEndMs) || !isTimestampMs(nextWindowStartMs)) return false;
  return nextWindowStartMs < previousWindowEndMs;
}
