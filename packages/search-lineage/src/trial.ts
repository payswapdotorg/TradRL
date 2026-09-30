/**
 * @tradrl/search-lineage — the search trial entry (Work Order T031).
 *
 * A {@link SearchTrialEntry} is ONE OPTIMIZATION TRIAL of the search: one
 * point of the search DAG. Every field maps onto the work order's record
 * definition — "every optimization trial with its config, its parent links
 * (the search DAG), the data-split ids it consumed, the evaluation-policy
 * ref, in-search vs holdout classification":
 *
 *   - `trial`            — the trial's identity (T011 ExperimentId space
 *                          mirror; one id, one search entry).
 *   - `arm`              — the comparison arm it executed, when the search
 *                          ran inside an experiment design (T011 mirror).
 *   - `classification`   — 'in-search' (the trial optimized against its
 *                          data — the material the search selected on) or
 *                          'holdout' (the trial was evaluated on material
 *                          declared unseen). The discriminator
 *                          spec/EVALUATION-PROTOCOL.md demands: "distinguish
 *                          in-search performance from holdout performance".
 *   - `config`           — the CONTENT-ADDRESSED snapshot of the trial's
 *                          optimization config (see snapshot.ts).
 *   - `parents`          — the backward edges of the search DAG: the trials
 *                          whose results informed this point. The DAG law:
 *                          parents exist, no self-parent, and NO HOLDOUT
 *                          PARENT for optimization trials — a holdout
 *                          evaluation may never become optimization input
 *                          (that converts unseen evidence into training
 *                          material; enforced in record.ts).
 *   - `splits`           — the data-split ids the trial consumed (T012
 *                          split-policy identity space mirror).
 *   - `datasets`         — the dataset refs the trial consumed (T011 DataRef
 *                          space mirror).
 *   - `window`           — the time window the trial's OPTIMIZATION covered
 *                          (null when the trial optimized over non-windowed
 *                          material, e.g. a generative world). The leakage
 *                          detector (research/evaluation-integrity) judges
 *                          every evaluation against THIS window.
 *   - `evaluation_policy`— the split-policy ref under which the trial's
 *                          evaluation was computed (T012 identity space).
 *   - `recorded_at`      — the INJECTED recording instant (L4: no ambient
 *                          clock exists in this package; the caller provides
 *                          the instant, the log enforces monotone order).
 *   - `tenant`/`project` — the L12/L15 scoping of the entry; appends are
 *                          rejected when they disagree with the record's.
 *
 * There is no update API: a search trial is ONE entry; the only mutation of
 * the search record is APPEND (see record.ts). Re-appending a trial id is a
 * typed error (`duplicate_trial`) — the search DAG never rewrites history.
 */

import { deepFreeze, isJsonObject, isNonEmptyString, isPositiveInteger, isRecord, isTimestampMs } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import {
  isArmId,
  isConfigSnapshotId,
  isDataRef,
  isProjectId,
  isSplitPolicyRef,
  isTenantId,
  isTrialId,
} from './ids';
import type { ArmId, ConfigSnapshotId, DataRef, ProjectId, SplitPolicyRef, TenantId, TrialId } from './ids';
import { invalidField, invalidType, missingField, ok, type SearchError, type SearchResult } from './errors';

/** The closed search classification vocabulary (in-search vs holdout). */
export type SearchClassification = 'in-search' | 'holdout';

/** Runtime-checkable list of search classifications. */
export const SEARCH_CLASSIFICATIONS: readonly SearchClassification[] = ['in-search', 'holdout'] as const;

/** Runtime guard for a search classification. */
export function isSearchClassification(value: unknown): value is SearchClassification {
  return typeof value === 'string' && (SEARCH_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * The time window a trial's optimization covered, as a half-open interval
 * [start, end) of epoch milliseconds (L4: boundaries are TimestampMs).
 */
export interface SearchWindow {
  readonly start: TimestampMs;
  /** Exclusive end of the optimization window. */
  readonly end: TimestampMs;
}

/** Guard: `SearchWindow`. */
export function isSearchWindow(value: unknown): value is SearchWindow {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.start) || !isTimestampMs(value.end)) return false;
  return value.end > value.start;
}

/** One optimization trial of the search (see module header for the field laws). */
export interface SearchTrialEntry {
  readonly trial: TrialId;
  /** The comparison arm this trial executed, when applicable (T011 mirror). */
  readonly arm: ArmId | null;
  /** In-search vs holdout — the discriminator the evaluation protocol demands. */
  readonly classification: SearchClassification;
  /** The content-addressed snapshot of the trial's optimization config. */
  readonly config: ConfigSnapshotId;
  /** The backward edges of the search DAG (parents exist in the record; no self-parent; no holdout parent for in-search trials). */
  readonly parents: readonly TrialId[];
  /** The data-split ids the trial consumed (T012 split-policy identity space). */
  readonly splits: readonly SplitPolicyRef[];
  /** The dataset refs the trial consumed (T011 DataRef identity space). */
  readonly datasets: readonly DataRef[];
  /** The optimization window [start, end), or null for non-windowed material. */
  readonly window: SearchWindow | null;
  /** The split-policy ref under which the trial's evaluation was computed. */
  readonly evaluation_policy: SplitPolicyRef;
  /** The INJECTED recording instant (L4 — no ambient clock in this package). */
  readonly recorded_at: TimestampMs;
  /** L12 tenant scoping — must agree with the record's tenant on append. */
  readonly tenant: TenantId;
  /** L15 project continuity — must agree with the record's project on append. */
  readonly project: ProjectId;
}

/**
 * The APPEND INPUT for one optimization trial: the trial's fields plus the
 * config VALUE (the snapshot address is DERIVED by the record's append law —
 * content and address cannot disagree by construction; see record.ts).
 */
export interface SearchTrialInput {
  readonly trial: TrialId;
  readonly arm: ArmId | null;
  readonly classification: SearchClassification;
  /** The optimization config as an opaque JSON object — the record mints the snapshot id. */
  readonly config: JsonObject;
  readonly parents: readonly TrialId[];
  readonly splits: readonly SplitPolicyRef[];
  readonly datasets: readonly DataRef[];
  readonly window: SearchWindow | null;
  readonly evaluation_policy: SplitPolicyRef;
  readonly recorded_at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `SearchTrialEntry` (the structural law of search trials). */
export function isSearchTrialEntry(value: unknown): value is SearchTrialEntry {
  if (!isRecord(value)) return false;
  if (!isTrialId(value.trial)) return false;
  if (value.arm !== null && !isArmId(value.arm)) return false;
  if (!isSearchClassification(value.classification)) return false;
  if (!isConfigSnapshotId(value.config)) return false;
  if (!Array.isArray(value.parents)) return false;
  if (!(value.parents as readonly unknown[]).every((p) => isTrialId(p))) return false;
  if (new Set(value.parents as readonly string[]).size !== (value.parents as readonly unknown[]).length) return false;
  if (!Array.isArray(value.splits) || (value.splits as readonly unknown[]).length === 0) return false;
  if (!(value.splits as readonly unknown[]).every((s) => isSplitPolicyRef(s))) return false;
  if (new Set(value.splits as readonly string[]).size !== (value.splits as readonly string[]).length) return false;
  if (!Array.isArray(value.datasets)) return false;
  if (!(value.datasets as readonly unknown[]).every((d) => isDataRef(d))) return false;
  if (new Set(value.datasets as readonly string[]).size !== (value.datasets as readonly string[]).length) return false;
  if (value.window !== null && !isSearchWindow(value.window)) return false;
  if (!isSplitPolicyRef(value.evaluation_policy)) return false;
  if (!isTimestampMs(value.recorded_at)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  // Structural cross-fields: a holdout trial has no parents (holdout
  // evidence is a leaf check, never optimization input) and no splits of
  // its own — it consumes exactly its evaluation policy.
  if (value.classification === 'holdout') {
    if ((value.parents as readonly unknown[]).length > 0) return false;
    if ((value.splits as readonly unknown[]).length !== 1) return false;
    if ((value.splits as readonly SplitPolicyRef[])[0] !== value.evaluation_policy) return false;
  }
  return true;
}

/**
 * Collect-all validation of an untrusted search trial entry. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateSearchTrialEntry(value: unknown, path = 'trial'): SearchResult<SearchTrialEntry> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SearchError[] = [];

  if (value.trial === undefined) {
    errors.push(missingField(`${path}.trial`));
  } else if (!isTrialId(value.trial)) {
    errors.push(invalidField(`${path}.trial`, 'must be a non-empty trial id'));
  }

  if (value.arm === undefined) {
    errors.push(missingField(`${path}.arm`));
  } else if (value.arm !== null && !isArmId(value.arm)) {
    errors.push(invalidField(`${path}.arm`, 'must be a non-empty arm id or null'));
  }

  if (value.classification === undefined) {
    errors.push(missingField(`${path}.classification`));
  } else if (!isSearchClassification(value.classification)) {
    errors.push(invalidField(`${path}.classification`, `must be one of ${SEARCH_CLASSIFICATIONS.join(' | ')}`));
  }

  if (value.config === undefined) {
    errors.push(missingField(`${path}.config`));
  } else if (!isConfigSnapshotId(value.config)) {
    errors.push(invalidField(`${path}.config`, 'must be a content-addressed config snapshot id ("snap:<digest>")'));
  }

  if (value.parents === undefined) {
    errors.push(missingField(`${path}.parents`));
  } else if (!Array.isArray(value.parents)) {
    errors.push(invalidField(`${path}.parents`, 'must be an array of parent trial ids (the search DAG edges)'));
  } else {
    (value.parents as readonly unknown[]).forEach((parent, index) => {
      if (!isTrialId(parent)) {
        errors.push(invalidField(`${path}.parents[${index}]`, 'must be a non-empty parent trial id'));
      }
    });
    if (new Set(value.parents as readonly string[]).size !== (value.parents as readonly unknown[]).length) {
      errors.push(invalidField(`${path}.parents`, 'must not repeat a parent — the DAG has simple edges'));
    }
    if (isTrialId(value.trial) && (value.parents as readonly unknown[]).includes(value.trial)) {
      errors.push(invalidField(`${path}.parents`, 'must not name the trial itself — the DAG is acyclic by construction'));
    }
  }

  if (value.splits === undefined) {
    errors.push(missingField(`${path}.splits`));
  } else if (!Array.isArray(value.splits) || (value.splits as readonly unknown[]).length === 0) {
    errors.push(invalidField(`${path}.splits`, 'must be a non-empty array of data-split ids the trial consumed'));
  } else {
    (value.splits as readonly unknown[]).forEach((split, index) => {
      if (!isSplitPolicyRef(split)) {
        errors.push(invalidField(`${path}.splits[${index}]`, 'must be a non-empty split policy ref'));
      }
    });
    if (new Set(value.splits as readonly string[]).size !== (value.splits as readonly string[]).length) {
      errors.push(invalidField(`${path}.splits`, 'must not repeat a split id'));
    }
  }

  if (value.datasets === undefined) {
    errors.push(missingField(`${path}.datasets`));
  } else if (!Array.isArray(value.datasets)) {
    errors.push(invalidField(`${path}.datasets`, 'must be an array of dataset refs the trial consumed'));
  } else {
    (value.datasets as readonly unknown[]).forEach((dataset, index) => {
      if (!isDataRef(dataset)) {
        errors.push(invalidField(`${path}.datasets[${index}]`, 'must be a non-empty dataset ref'));
      }
    });
    if (new Set(value.datasets as readonly string[]).size !== (value.datasets as readonly string[]).length) {
      errors.push(invalidField(`${path}.datasets`, 'must not repeat a dataset ref'));
    }
  }

  if (value.window === undefined) {
    errors.push(missingField(`${path}.window`));
  } else if (value.window !== null && !isSearchWindow(value.window)) {
    errors.push(invalidField(`${path}.window`, 'must be { start, end } with end > start (TimestampMs), or null'));
  }

  if (value.evaluation_policy === undefined) {
    errors.push(missingField(`${path}.evaluation_policy`));
  } else if (!isSplitPolicyRef(value.evaluation_policy)) {
    errors.push(invalidField(`${path}.evaluation_policy`, 'must be a non-empty split policy ref'));
  }

  if (value.recorded_at === undefined) {
    errors.push(missingField(`${path}.recorded_at`));
  } else if (!isTimestampMs(value.recorded_at)) {
    errors.push(invalidField(`${path}.recorded_at`, 'must be a valid TimestampMs (the injected recording instant, L4)'));
  }

  if (value.tenant === undefined) {
    errors.push(missingField(`${path}.tenant`));
  } else if (!isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }

  if (value.project === undefined) {
    errors.push(missingField(`${path}.project`));
  } else if (!isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }

  // Classification cross-fields (only meaningful when the fields are valid).
  if (errors.length === 0 && isSearchClassification(value.classification)) {
    if (value.classification === 'holdout') {
      if ((value.parents as readonly unknown[]).length > 0) {
        errors.push(invalidField(`${path}.parents`, 'must be empty for a holdout trial — holdout evidence is a leaf check, never optimization input'));
      }
      if ((value.splits as readonly unknown[]).length !== 1) {
        errors.push(invalidField(`${path}.splits`, 'must name exactly the holdout evaluation policy for a holdout trial'));
      } else if ((value.splits as readonly SplitPolicyRef[])[0] !== value.evaluation_policy) {
        errors.push(invalidField(`${path}.splits`, 'must equal evaluation_policy for a holdout trial'));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      trial: value.trial as TrialId,
      arm: value.arm as ArmId | null,
      classification: value.classification as SearchClassification,
      config: value.config as ConfigSnapshotId,
      parents: (value.parents as readonly TrialId[]).slice(),
      splits: (value.splits as readonly SplitPolicyRef[]).slice(),
      datasets: (value.datasets as readonly DataRef[]).slice(),
      window: value.window === null ? null : deepFreeze({ ...(value.window as SearchWindow) }),
      evaluation_policy: value.evaluation_policy as SplitPolicyRef,
      recorded_at: value.recorded_at as TimestampMs,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
    } satisfies SearchTrialEntry),
  );
}

/**
 * The digest input of one search trial entry (the canonical JSON of its
 * full value) — the per-entry content the chain folds (see record.ts).
 * Pure function of the entry: identical entries digest identically.
 */
export function searchTrialDigestInput(entry: SearchTrialEntry): JsonObject {
  return entry as unknown as JsonObject;
}

/** Guard helper re-exported for the trial validators' callers. */
export { isPositiveInteger, isNonEmptyString, isJsonObject };
