// @tradrl/web-console — THE LAUNCH DRAFT STORE (FW-40-B, Round H —
// S2's wizard-race finding, the draft-lost-on-reload half the FW-40-C
// wizard race cluster documented for THIS wave: "the wizard draft
// does NOT persist across reload (all inputs lost)" — the round's
// most-frequent friction's cheapest half to close, and the one every
// persona who hit the silent freeze named afterward: losing a
// half-filled launch wizard to a reload is losing WORK, not state).
//
// THE LAW: a wizard draft with COMMITTED investment (any committed
// field edit, any chosen step) survives a page reload. The record is
// ONE versioned JSON value in the browser's own trust zone (the
// posture-record seam's class — spec/SECURITY.md: the same zone as
// the theme, the onboarding mark, the notice read-marks), keyed by
// the SCOPE it was authored under (tenant + project): a draft never
// restores into a DIFFERENT project's desk (the record's own scope
// gate — the desk that boots is the desk that gets its own draft
// back, exactly and only). The boot restore is disclosed in the
// wizard's own card (a subtle "draft restored" hint naming when it
// was saved), applies exactly once, only while the wizard is
// untouched (a driving user is never clobbered — the D-15 law), and
// the record CLEARS on a successful launch (the draft became a
// project — nothing to restore) and on an explicit reset (the user
// abandoned it). A draft left mid-launch (a reload between submit
// and completion) restores honestly: the user gets their draft back
// and the launched project arrives through the directory — the
// record never claims the launch happened, it only carries the work.
//
// THE HONEST LIMITS (stated, never papered over): a merely OPENED
// wizard (blank draft, no committed edit, no step move) never
// persists — the store records INVESTMENT, never a summon; the
// browser's trust zone is per-browser (a wiped profile is a new
// identity — the posture record's own limit); and a stored value is
// UNTRUSTED BYTES: the parse is structural and fail-closed (any
// malformed field degrades the WHOLE record to absent — never a
// half-applied draft, the same law the posture record rides), with
// the wizard's own validation still the teacher for a structurally
// sound but semantically empty restored draft.
//
// This module is PURE + storage-seamed (the posture precedent): the
// record's grammar is data, the read/write are best-effort against
// an INJECTED storage (localStorage in production), and the empty
// string is the canonical CLEARED value (the posture's legacy-key
// precedent — a storage seam with no removeItem stays honest).

import { LAUNCH_STEPS, type LaunchDraft, type LaunchStep } from './launch';
import type { WorkspaceScope } from './tenant';

/** The draft record's storage key (the browser's trust zone — one versioned JSON value). */
export const LAUNCH_DRAFT_STORAGE_KEY = 'tradrl_console_launch_draft';

/** The record's grammar version — a future draft shape change bumps this and the old records degrade to absent (fail-closed, never misread). */
const LAUNCH_DRAFT_RECORD_VERSION = 1;

/**
 * The persisted launch-draft record: WHAT the wizard carried (the
 * draft + the step), WHERE it was authored (the scope — the restore
 * gate), and WHEN (the saved-at instant the restored hint names).
 */
export interface StoredLaunchDraft {
  readonly version: number;
  readonly tenantId: string;
  readonly projectId: string;
  readonly savedAt: number;
  readonly step: LaunchStep;
  readonly draft: LaunchDraft;
}

/** The storage seam the draft record persists through (localStorage in production; the console's scope-storage seam's own shape). */
export interface LaunchDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A step string must be one of the wizard's own closed set (core/launch.ts LAUNCH_STEPS). */
function isLaunchStep(value: unknown): value is LaunchStep {
  return typeof value === 'string' && (LAUNCH_STEPS as readonly string[]).includes(value);
}

/** A finite integer epoch-ms instant (the horizon bounds + the saved-at). */
function isInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** A non-empty string array (the markets/venues/dataSources lists; empty is legal for preferences only — checked field-by-field). */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** One { key, value } preference pair. */
function isPreference(value: unknown): value is { readonly key: string; readonly value: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { readonly key?: unknown; readonly value?: unknown };
  return typeof record.key === 'string' && typeof record.value === 'string';
}

/** One success criterion / constraint statement's shallow shape (id + predicate-as-object + the closed string fields; the wizard's own validation remains the semantic teacher). */
function isStatement(value: unknown, closedFields: Readonly<Record<string, 'string' | 'boolean'>>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const [field, kind] of Object.entries(closedFields)) {
    if (typeof record[field] !== kind) return false;
  }
  if (record.description !== undefined && typeof record.description !== 'string') return false;
  return typeof record.predicate === 'object' && record.predicate !== null;
}

/** The draft's own structural grammar (every field checked; the predicate objects are shape-gated shallowly — their semantics is the wizard's validation, not the store's). */
function isLaunchDraftShape(value: unknown): value is LaunchDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (typeof draft.name !== 'string' || typeof draft.objective !== 'string') return false;
  if (typeof draft.horizon !== 'object' || draft.horizon === null) return false;
  const horizon = draft.horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown; readonly label?: unknown };
  if (!isInstant(horizon.startsAt) || !isInstant(horizon.endsAt)) return false;
  if (horizon.label !== undefined && typeof horizon.label !== 'string') return false;
  if (!Array.isArray(draft.successCriteria) || !draft.successCriteria.every((entry) => isStatement(entry, { id: 'string', metric: 'string' }))) return false;
  if (typeof draft.evaluation !== 'object' || draft.evaluation === null) return false;
  const evaluation = draft.evaluation as Record<string, unknown>;
  if (typeof evaluation.blindRef !== 'string' || typeof evaluation.walkForwardRef !== 'string' || typeof evaluation.regimeRef !== 'string' || typeof evaluation.adversarialRequired !== 'boolean') return false;
  if (!Array.isArray(draft.constraints) || !draft.constraints.every((entry) => isStatement(entry, { id: 'string', domain: 'string', subject: 'string', severity: 'string' }))) return false;
  if (typeof draft.capitalBudget !== 'string' || typeof draft.riskBudget !== 'string') return false;
  if (!isStringArray(draft.markets) || !isStringArray(draft.venues) || !isStringArray(draft.dataSources)) return false;
  if (draft.executionMode !== 'simulation' && draft.executionMode !== 'shadow' && draft.executionMode !== 'live') return false;
  if (!Array.isArray(draft.preferences) || !draft.preferences.every((entry) => isPreference(entry))) return false;
  return true;
}

/**
 * Parse one stored draft record (strict + fail-closed: a wrong
 * version, a malformed field, or a foreign scope shape degrades the
 * WHOLE record to absent — never a half-applied draft).
 */
export function parseStoredLaunchDraft(value: string | null): StoredLaunchDraft | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { readonly version?: unknown; readonly tenantId?: unknown; readonly projectId?: unknown; readonly savedAt?: unknown; readonly step?: unknown; readonly draft?: unknown };
  if (record.version !== LAUNCH_DRAFT_RECORD_VERSION) return null;
  if (typeof record.tenantId !== 'string' || record.tenantId.length === 0) return null;
  if (typeof record.projectId !== 'string' || record.projectId.length === 0) return null;
  if (!isInstant(record.savedAt)) return null;
  if (!isLaunchStep(record.step)) return null;
  if (!isLaunchDraftShape(record.draft)) return null;
  return { version: record.version, tenantId: record.tenantId, projectId: record.projectId, savedAt: record.savedAt, step: record.step, draft: record.draft };
}

/**
 * Read the stored draft record (parse-only, NO scope gate — the boot
 * capture's form: the console holds the record and gates it against
 * the SETTLED scope at restore time, after the stored-scope adoption
 * inside the listing read has settled the desk).
 */
export function readStoredLaunchDraftRecord(storage: LaunchDraftStorage): StoredLaunchDraft | null {
  let stored: string | null = null;
  try {
    stored = storage.getItem(LAUNCH_DRAFT_STORAGE_KEY);
  } catch {
    stored = null;
  }
  return parseStoredLaunchDraft(stored);
}

/**
 * Read the stored draft FOR ONE SCOPE (the restore gate, unit-pinned):
 * the record must carry the SAME tenant + project as the given scope —
 * a draft authored on another desk NEVER restores here (the desk that
 * boots is the desk that gets its own draft back, exactly and only).
 */
export function readStoredLaunchDraft(storage: LaunchDraftStorage, scope: WorkspaceScope): StoredLaunchDraft | null {
  const record = readStoredLaunchDraftRecord(storage);
  if (record === null) return null;
  if (record.tenantId !== scope.tenantId || record.projectId !== scope.projectId) return null;
  return record;
}

/**
 * Persist the wizard's current draft + step under the CURRENT scope
 * (best-effort: a storage that refuses writes — private mode, quota —
 * degrades to session-only, exactly the posture/theme seams' law).
 * The saved-at instant is INJECTED (never a wall clock — the test
 * seam's own discipline).
 */
export function persistLaunchDraft(storage: LaunchDraftStorage, scope: WorkspaceScope, draft: LaunchDraft, step: LaunchStep, savedAt: number): void {
  const record: StoredLaunchDraft = { version: LAUNCH_DRAFT_RECORD_VERSION, tenantId: scope.tenantId, projectId: scope.projectId, savedAt, step, draft };
  try {
    storage.setItem(LAUNCH_DRAFT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable: the draft holds for this session only
  }
}

/**
 * Clear the stored draft (a successful launch — the draft became a
 * project; or an explicit reset — the user abandoned it). The empty
 * string is the canonical cleared value (the posture legacy-key
 * precedent: the seam needs no removeItem and the parse reads ''
 * as absent).
 */
export function clearStoredLaunchDraft(storage: LaunchDraftStorage): void {
  try {
    storage.setItem(LAUNCH_DRAFT_STORAGE_KEY, '');
  } catch {
    // best-effort — nothing to clear is the same as cleared
  }
}
