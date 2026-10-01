/**
 * @tradrl/evaluation-integrity — the SEARCH-LINEAGE STRUCTURAL MIRROR
 * (Work Order T031).
 *
 * Law D-003/D-004: this package (the platform service layer above
 * @tradrl/search-lineage, the same work order's record layer) NEVER imports
 * that package in its sources. Every shape it consumes is re-declared here
 * as a STRUCTURAL MIRROR — field-for-field, brand-for-brand — and the
 * mirrored CHAIN VERIFIER re-implements the record package's chain law over
 * the same mirrored digest function, so a record built by the REAL
 * @tradrl/search-lineage verifies here byte-for-byte. The interop
 * trip-wire tests prove exactly that: a real record (built through the real
 * package's append API) verifies under {@link verifySearchLineage}, and a
 * tampered one fails with the same typed error the record package reports.
 *
 * Mirrored shapes (canonical owner: packages/search-lineage, T031):
 * - `SearchTrialEntryMirror` — one optimization trial: trial ref, arm,
 *   classification, config snapshot ref, parents (the DAG), splits
 *   consumed, datasets consumed, optimization window, evaluation policy
 *   ref, injected recorded_at, tenant/project.
 * - `SearchRecordMirror` — binding block + append-only entries +
 *   content-addressed snapshot store + the chain head.
 * - The chain law: h(-1) = digest(canonical(binding));
 *   h(i) = digest("h(i-1)" + ":" + digest(canonical(entries[i])));
 *   head = h(n-1). Identity: `srch:<digest(canonical(binding))>`.
 */

import { canonicalJson, deepFreeze, isDigest, isRecord, isTimestampMs, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import {
  isConfigSnapshotId,
  isExperimentId,
  isProjectId,
  isSearchRecordId,
  isSplitPolicyRef,
  isTenantId,
  isTrialId,
  isArmId,
  isDataRef,
} from './ids';
import type { ArmId, ConfigSnapshotId, DataRef, ExperimentId, ProjectId, SplitPolicyRef, TenantId, TrialId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';

// ---------------------------------------------------------------------------
// The classification mirror (search-lineage's closed vocabulary)
// ---------------------------------------------------------------------------

/** In-search vs holdout — MIRROR of @tradrl/search-lineage's `SearchClassification`. */
export type SearchClassificationMirror = 'in-search' | 'holdout';

/** Runtime-checkable list (mirror of the record package's vocabulary). */
export const SEARCH_CLASSIFICATIONS_MIRROR: readonly SearchClassificationMirror[] = ['in-search', 'holdout'] as const;

/** Guard: a search classification (mirror). */
export function isSearchClassificationMirror(v: unknown): v is SearchClassificationMirror {
  return typeof v === 'string' && (SEARCH_CLASSIFICATIONS_MIRROR as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The entry mirror
// ---------------------------------------------------------------------------

/** The optimization-window mirror: half-open [start, end). */
export interface SearchWindowMirror {
  readonly start: TimestampMs;
  readonly end: TimestampMs;
}

/** Guard: `SearchWindowMirror`. */
export function isSearchWindowMirror(v: unknown): v is SearchWindowMirror {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.start) || !isTimestampMs(v.end)) return false;
  return v.end > v.start;
}

/**
 * One optimization trial — STRUCTURAL MIRROR of @tradrl/search-lineage's
 * `SearchTrialEntry` (DO NOT DIVERGE; the interop trip-wires prove mutual
 * assignability). The holdout structural law is mirrored too: a holdout
 * trial has no parents and consumes exactly its evaluation policy.
 */
export interface SearchTrialEntryMirror {
  readonly trial: TrialId;
  readonly arm: ArmId | null;
  readonly classification: SearchClassificationMirror;
  readonly config: ConfigSnapshotId;
  readonly parents: readonly TrialId[];
  readonly splits: readonly SplitPolicyRef[];
  readonly datasets: readonly DataRef[];
  readonly window: SearchWindowMirror | null;
  readonly evaluation_policy: SplitPolicyRef;
  readonly recorded_at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `SearchTrialEntryMirror` (the mirrored structural law). */
export function isSearchTrialEntryMirror(v: unknown): v is SearchTrialEntryMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial)) return false;
  if (v.arm !== null && !isArmId(v.arm)) return false;
  if (!isSearchClassificationMirror(v.classification)) return false;
  if (!isConfigSnapshotId(v.config)) return false;
  if (!Array.isArray(v.parents)) return false;
  if (!(v.parents as readonly unknown[]).every((p) => isTrialId(p))) return false;
  if (new Set(v.parents as readonly string[]).size !== (v.parents as readonly unknown[]).length) return false;
  if (!Array.isArray(v.splits) || (v.splits as readonly unknown[]).length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((s) => isSplitPolicyRef(s))) return false;
  if (new Set(v.splits as readonly string[]).size !== (v.splits as readonly string[]).length) return false;
  if (!Array.isArray(v.datasets)) return false;
  if (!(v.datasets as readonly unknown[]).every((d) => isDataRef(d))) return false;
  if (new Set(v.datasets as readonly string[]).size !== (v.datasets as readonly string[]).length) return false;
  if (v.window !== null && !isSearchWindowMirror(v.window)) return false;
  if (!isSplitPolicyRef(v.evaluation_policy)) return false;
  if (!isTimestampMs(v.recorded_at)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (v.classification === 'holdout') {
    if ((v.parents as readonly unknown[]).length > 0) return false;
    if ((v.splits as readonly unknown[]).length !== 1) return false;
    if ((v.splits as readonly SplitPolicyRef[])[0] !== v.evaluation_policy) return false;
  }
  return true;
}

/** Collect-all validation of an untrusted mirrored search trial entry. */
export function validateSearchTrialEntryMirror(value: unknown, path = 'trial'): IntegrityResult<SearchTrialEntryMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: IntegrityError[] = [];
  if (value.trial === undefined) errors.push(missingField(`${path}.trial`));
  else if (!isTrialId(value.trial)) errors.push(invalidField(`${path}.trial`, 'must be a non-empty trial id'));

  if (value.arm !== undefined && value.arm !== null && !isArmId(value.arm)) {
    errors.push(invalidField(`${path}.arm`, 'must be a non-empty arm id or null'));
  }
  if (value.classification === undefined) errors.push(missingField(`${path}.classification`));
  else if (!isSearchClassificationMirror(value.classification)) {
    errors.push(invalidField(`${path}.classification`, `must be one of ${SEARCH_CLASSIFICATIONS_MIRROR.join(' | ')}`));
  }
  if (value.config === undefined) errors.push(missingField(`${path}.config`));
  else if (!isConfigSnapshotId(value.config)) {
    errors.push(invalidField(`${path}.config`, 'must be a content-addressed config snapshot id ("snap:<digest>")'));
  }
  if (value.parents === undefined) errors.push(missingField(`${path}.parents`));
  else if (!Array.isArray(value.parents)) {
    errors.push(invalidField(`${path}.parents`, 'must be an array of parent trial ids'));
  } else if (new Set(value.parents as readonly string[]).size !== (value.parents as readonly unknown[]).length) {
    errors.push(invalidField(`${path}.parents`, 'must not repeat a parent'));
  } else if (isTrialId(value.trial) && (value.parents as readonly unknown[]).includes(value.trial)) {
    errors.push(invalidField(`${path}.parents`, 'must not name the trial itself'));
  }
  if (value.splits === undefined) errors.push(missingField(`${path}.splits`));
  else if (!Array.isArray(value.splits) || (value.splits as readonly unknown[]).length === 0) {
    errors.push(invalidField(`${path}.splits`, 'must be a non-empty array of split policy refs'));
  } else if (new Set(value.splits as readonly string[]).size !== (value.splits as readonly string[]).length) {
    errors.push(invalidField(`${path}.splits`, 'must not repeat a split id'));
  }
  if (value.datasets === undefined) errors.push(missingField(`${path}.datasets`));
  else if (!Array.isArray(value.datasets)) {
    errors.push(invalidField(`${path}.datasets`, 'must be an array of dataset refs'));
  } else if (new Set(value.datasets as readonly string[]).size !== (value.datasets as readonly string[]).length) {
    errors.push(invalidField(`${path}.datasets`, 'must not repeat a dataset ref'));
  }
  if (value.window === undefined) errors.push(missingField(`${path}.window`));
  else if (value.window !== null && !isSearchWindowMirror(value.window)) {
    errors.push(invalidField(`${path}.window`, 'must be { start, end } with end > start, or null'));
  }
  if (value.evaluation_policy === undefined) errors.push(missingField(`${path}.evaluation_policy`));
  else if (!isSplitPolicyRef(value.evaluation_policy)) {
    errors.push(invalidField(`${path}.evaluation_policy`, 'must be a non-empty split policy ref'));
  }
  if (value.recorded_at === undefined) errors.push(missingField(`${path}.recorded_at`));
  else if (!isTimestampMs(value.recorded_at)) {
    errors.push(invalidField(`${path}.recorded_at`, 'must be a valid TimestampMs (L4)'));
  }
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));

  if (errors.length === 0 && value.classification === 'holdout') {
    if ((value.parents as readonly unknown[]).length > 0) {
      errors.push(invalidField(`${path}.parents`, 'must be empty for a holdout trial'));
    }
    if ((value.splits as readonly unknown[]).length !== 1 || (value.splits as readonly SplitPolicyRef[])[0] !== value.evaluation_policy) {
      errors.push(invalidField(`${path}.splits`, 'must equal [evaluation_policy] for a holdout trial'));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ ...(value as object) } as SearchTrialEntryMirror));
}

// ---------------------------------------------------------------------------
// The record mirror + the mirrored chain verifier
// ---------------------------------------------------------------------------

/** One content-addressed config snapshot — MIRROR of search-lineage's `ConfigSnapshot`. */
export interface ConfigSnapshotMirror {
  readonly snapshot_id: ConfigSnapshotId;
  readonly config: JsonObject;
}

/** The binding block — MIRROR of search-lineage's `SearchBinding`. */
export interface SearchBindingMirror {
  readonly experiment: ExperimentId;
  readonly evaluator: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * The SEARCH RECORD — STRUCTURAL MIRROR of @tradrl/search-lineage's
 * `SearchRecord` (DO NOT DIVERGE): binding block, append-only entry log,
 * content-addressed snapshot store, chain head.
 */
export interface SearchRecordMirror {
  readonly search_id: string;
  readonly experiment: ExperimentId;
  readonly evaluator: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly SearchTrialEntryMirror[];
  readonly snapshots: readonly ConfigSnapshotMirror[];
  readonly chain_head: string;
}

// --- The mirrored chain law (identical derivation; DO NOT DIVERGE) -----------

/** The mirrored record identity: `srch:<digest over the canonical binding>`. */
export function searchRecordIdMirror(binding: SearchBindingMirror): string {
  return `srch:${stableDigestJson(bindingJsonMirror(binding))}`;
}

function bindingJsonMirror(binding: SearchBindingMirror): JsonObject {
  return {
    experiment: binding.experiment,
    evaluator: binding.evaluator,
    tenant: binding.tenant,
    project: binding.project,
  };
}

/** The mirrored chain genesis: digest(canonical(binding)). */
export function chainGenesisMirror(binding: SearchBindingMirror): string {
  return stableDigestJson(bindingJsonMirror(binding));
}

/** The mirrored chain fold: digest(prev + ":" + digest(entry)). */
export function chainFoldMirror(previousHead: string, entry: SearchTrialEntryMirror): string {
  return stableDigest(`${previousHead}:${stableDigestJson(entry as unknown as JsonObject)}`);
}

/** The mirrored head recomputation over a binding and an entry sequence. */
export function computeChainHeadMirror(binding: SearchBindingMirror, entries: readonly SearchTrialEntryMirror[]): string {
  let head = chainGenesisMirror(binding);
  for (const entry of entries) head = chainFoldMirror(head, entry);
  return head;
}

/**
 * The mirrored content-address law for snapshot entries: a snapshot's id
 * must be `snap:<digest(canonical(config))>` (mirrors search-lineage's
 * `configSnapshotId`).
 */
export function configSnapshotIdMirror(config: JsonObject): string {
  return `snap:${stableDigestJson(config)}`;
}

/**
 * VERIFY a search record through the mirrored chain law — the platform
 * gate every integrity service API routes through. Enforces:
 * - the binding's derived identity (a forged `search_id` fails);
 * - every entry's mirrored structural law, plus the log-level laws
 *   (unique trial ids, known parents, NO holdout parents, monotone
 *   instants);
 * - every snapshot's content addressing, and every entry's config being
 *   retained in the store;
 * - the CHAIN: the recomputed head over the entries AS STORED must equal
 *   the recorded head — mutation, reordering and HIDING all break it
 *   (`chain_mismatch`).
 * On success the record is returned narrowed, deeply frozen.
 */
export function verifySearchLineage(value: unknown): IntegrityResult<SearchRecordMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('search record must be an object')] };
  }
  const errors: IntegrityError[] = [];
  for (const field of ['experiment', 'evaluator', 'tenant', 'project'] as const) {
    if (value[field] === undefined) errors.push(missingField(field));
  }
  if (value.search_id === undefined) errors.push(missingField('search_id'));
  else if (!isSearchRecordId(value.search_id)) errors.push(invalidField('search_id', 'must be a search record id ("srch:<digest>")'));
  if (value.chain_head === undefined) errors.push(missingField('chain_head'));
  else if (!isDigest(value.chain_head)) errors.push(invalidField('chain_head', 'must be a 16-hex digest'));
  if (value.entries === undefined) errors.push(missingField('entries'));
  else if (!Array.isArray(value.entries)) errors.push(invalidField('entries', 'must be an array of search trial entries'));
  if (value.snapshots === undefined) errors.push(missingField('snapshots'));
  else if (!Array.isArray(value.snapshots)) errors.push(invalidField('snapshots', 'must be an array of config snapshots'));
  if (errors.length > 0) return { ok: false, errors };

  const binding: SearchBindingMirror = {
    experiment: value.experiment as ExperimentId,
    evaluator: value.evaluator as string,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.search_id !== searchRecordIdMirror(binding)) {
    return fail('chain_mismatch', `search_id "${value.search_id}" does not match the binding's derived identity (L9)`, 'search_id');
  }

  // Snapshots: content-addressed, unique.
  const snapshotIds = new Set<string>();
  for (let index = 0; index < (value.snapshots as unknown[]).length; index++) {
    const candidate = (value.snapshots as unknown[])[index];
    if (!isRecord(candidate)) {
      return { ok: false, errors: [invalidType(`snapshots[${index}] must be an object`)] };
    }
    if (candidate.snapshot_id === undefined || candidate.config === undefined) {
      return { ok: false, errors: [invalidField(`snapshots[${index}]`, 'must carry snapshot_id and config')] };
    }
    if (!isConfigSnapshotId(candidate.snapshot_id)) {
      return { ok: false, errors: [invalidField(`snapshots[${index}].snapshot_id`, 'must be a snapshot id ("snap:<digest>")')] };
    }
    if (candidate.snapshot_id !== configSnapshotIdMirror(candidate.config as JsonObject)) {
      return fail('invalid_field', `snapshot "${candidate.snapshot_id}" stores content addressing elsewhere — content and address cannot disagree (L9)`, `snapshots[${index}].snapshot_id`);
    }
    if (snapshotIds.has(candidate.snapshot_id as string)) {
      return fail('invalid_registry', `snapshot "${candidate.snapshot_id}" is listed twice`, `snapshots[${index}].snapshot_id`);
    }
    snapshotIds.add(candidate.snapshot_id as string);
  }

  // Entries: mirrored structural law + log-level laws, in order.
  const entries: SearchTrialEntryMirror[] = [];
  const known = new Map<TrialId, SearchTrialEntryMirror>();
  let previousInstant: TimestampMs | undefined;
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const entryResult = validateSearchTrialEntryMirror((value.entries as unknown[])[index], `entries[${index}]`);
    if (!entryResult.ok) return entryResult;
    const entry = entryResult.value;

    if (known.has(entry.trial)) {
      return fail('invalid_field', `trial "${entry.trial}" appears twice in the log (L11)`, `entries[${index}].trial`);
    }
    for (const parent of entry.parents) {
      const parentEntry = known.get(parent);
      if (parentEntry === undefined) {
        return fail('invalid_field', `trial "${entry.trial}" names parent "${parent}" not logged before it`, `entries[${index}].parents`);
      }
      if (parentEntry.classification === 'holdout') {
        return fail('invalid_field', `trial "${entry.trial}" takes holdout trial "${parent}" as an optimization parent (L11)`, `entries[${index}].parents`);
      }
    }
    if (previousInstant !== undefined && entry.recorded_at < previousInstant) {
      return fail('invalid_field', `entry ${index} rewinds the log's instants (L4)`, `entries[${index}].recorded_at`);
    }
    previousInstant = entry.recorded_at;
    if (!snapshotIds.has(entry.config)) {
      return fail('invalid_field', `entry ${index} references unstored config snapshot "${entry.config}" (L9/L11)`, `entries[${index}].config`);
    }
    known.set(entry.trial, entry);
    entries.push(entry);
  }

  // The chain, recomputed over the entries AS STORED.
  const expectedHead = computeChainHeadMirror(binding, entries);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or truncated (L9/L11)`,
      'chain_head',
    );
  }

  return ok(
    deepFreeze({
      search_id: value.search_id as string,
      experiment: binding.experiment,
      evaluator: binding.evaluator,
      tenant: binding.tenant,
      project: binding.project,
      entries,
      snapshots: (value.snapshots as readonly ConfigSnapshotMirror[]).slice(),
      chain_head: expectedHead,
    } satisfies SearchRecordMirror),
  );
}

/** The canonical JSON bytes of a mirrored record (determinism anchor). */
export function canonicalSearchRecordMirror(record: SearchRecordMirror): string {
  return canonicalJson(record as unknown as JsonObject);
}
