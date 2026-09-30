/**
 * @tradrl/search-lineage — the SEARCH RECORD: the append-only, chain-verified
 * search log (Work Order T031).
 *
 * Spec anchors: ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to expose selection effects"), L9 ("Reproducible
 * lineage"), L12 ("Tenant isolation"), L4 (point-in-time truth — injected
 * instants); spec/EVALUATION-PROTOCOL.md ("Retain search histories and
 * distinguish in-search performance from holdout performance"); R20.
 *
 * THE APPEND-ONLY LAW: the {@link SearchRecord}'s `entries` list grows ONLY
 * through {@link appendSearchTrial}. There is no update, removal or
 * reordering API anywhere in this package (structurally tested). A trial is
 * ONE entry — re-appending a trial id is `duplicate_trial`, so the search
 * DAG never rewrites history.
 *
 * THE CHAIN LAW (L9/L11): every record carries a `chain_head` — a digest
 * that binds the record's binding block (experiment, evaluator, tenant,
 * project) and EVERY entry, in append order:
 *
 *     h(-1)  = digest(canonical(binding))
 *     h(i)   = digest("h(i-1)" + ":" + digest(canonical(entries[i])))
 *     head   = h(entries.length - 1)
 *
 * {@link verifySearchRecord} recomputes the whole chain; ANY tamper — a
 * mutated field, a REORDERED log, or a REMOVED (hidden) entry — breaks the
 * head and fails `chain_mismatch`. Hiding a trial is therefore not merely a
 * typed error at the projection layer (see coverage.ts): it is
 * cryptographically (in the change-detection sense) impossible to do
 * silently against a record whose head was published.
 *
 * THE SNAPSHOT LAW: every entry references a CONTENT-ADDRESSED config
 * snapshot held in the record's dedupe store. The append API takes the
 * config VALUE and derives the address itself — content and address cannot
 * disagree by construction.
 *
 * THE LINEAGE LAWS ENFORCED ON APPEND (each a typed error, each
 * negative-tested):
 * - `tenant_mismatch` — L12: the entry's tenant/project must agree with the
 *   record's; a search never crosses tenants or projects.
 * - `duplicate_trial` — one id, one entry (L11: no rewrites).
 * - `unknown_parent` — the search DAG's edges point at trials already in
 *   the log (the DAG is built forward, edge by edge).
 * - `holdout_parent` — NO optimization trial may take a holdout-classified
 *   trial as parent: holdout evidence that steers optimization has stopped
 *   being holdout evidence (the backtest-overfitting hole this package
 *   exists to close).
 * - `non_monotonic_instant` — the log is ordered by the injected recording
 *   instants (L4: the caller supplies instants; the log keeps them honest).
 */

import { canonicalJson, deepFreeze, isDigest, isJsonObject, isRecord, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { isExperimentId, isEvaluatorVersionRef, isProjectId, isSearchRecordId, isTenantId } from './ids';
import type { ExperimentId, EvaluatorVersionRef, ProjectId, SearchRecordId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type SearchError, type SearchResult } from './errors';
import { configSnapshotId, isConfigSnapshot, validateConfigSnapshot } from './snapshot';
import type { ConfigSnapshot } from './snapshot';
import {
  isSearchTrialEntry,
  validateSearchTrialEntry,
  SEARCH_CLASSIFICATIONS,
} from './trial';
import type { SearchClassification, SearchTrialEntry, SearchTrialInput } from './trial';
import { isArmId, isTrialId } from './ids';
import type { ArmId, TrialId } from './ids';

/** The derivation prefix of every search record id. */
export const SEARCH_RECORD_ID_PREFIX = 'srch:' as const;

/** The binding block a search record is identity-bound to (L9/L12/L15). */
export interface SearchBinding {
  readonly experiment: ExperimentId;
  readonly evaluator: EvaluatorVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * The immutable, append-only SEARCH RECORD: the binding block, the
 * chain-verified entry log (the search DAG's nodes in append order), the
 * content-addressed config snapshot store (deduped by address), and the
 * chain head that binds all of it.
 */
export interface SearchRecord {
  /** Derived identity: `srch:<digest over the canonical binding block>` (L9). */
  readonly search_id: SearchRecordId;
  readonly experiment: ExperimentId;
  readonly evaluator: EvaluatorVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The append-only search log — one entry per optimization trial. */
  readonly entries: readonly SearchTrialEntry[];
  /** The content-addressed config store (unique by snapshot id). */
  readonly snapshots: readonly ConfigSnapshot[];
  /** The chain head: digest(binding || entries in order) — see module header. */
  readonly chain_head: string;
}

/** Guard: `SearchBinding`. */
export function isSearchBinding(value: unknown): value is SearchBinding {
  if (!isRecord(value)) return false;
  return isExperimentId(value.experiment) && isEvaluatorVersionRef(value.evaluator) && isTenantId(value.tenant) && isProjectId(value.project);
}

/** The canonical binding JSON — the digest input of the record identity and the chain genesis. */
function bindingJson(binding: SearchBinding): JsonObject {
  return {
    experiment: binding.experiment,
    evaluator: binding.evaluator,
    tenant: binding.tenant,
    project: binding.project,
  };
}

/** The record's derived identity: `srch:<digest over the canonical binding block>`. */
export function searchRecordId(binding: SearchBinding): SearchRecordId {
  return `srch:${stableDigestJson(bindingJson(binding))}` as SearchRecordId;
}

/** The chain's genesis head: the digest of the canonical binding block. */
export function chainGenesis(binding: SearchBinding): string {
  return stableDigestJson(bindingJson(binding));
}

/**
 * Fold one entry onto the chain: `digest(previousHead + ":" + digest(entry))`.
 * Pure and deterministic — the T028 generative lane's `chainDigest`
 * discipline, rendered with this lane's dual-lane digest.
 */
export function chainFold(previousHead: string, entry: SearchTrialEntry): string {
  return stableDigest(`${previousHead}:${stableDigestJson(entry as unknown as JsonObject)}`);
}

/** Recompute the full chain head over a binding and an entry sequence. */
export function computeChainHead(binding: SearchBinding, entries: readonly SearchTrialEntry[]): string {
  let head = chainGenesis(binding);
  for (const entry of entries) head = chainFold(head, entry);
  return head;
}

/**
 * Construct an open search record (empty log, empty snapshot store). The
 * binding block is validated; the identity and genesis head are DERIVED.
 * Smuggling a non-empty `entries` or `snapshots` array through the input is
 * rejected — the ONLY way to grow the record is {@link appendSearchTrial}.
 */
export function createSearchRecord(value: unknown): SearchResult<SearchRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('search record input must be an object')] };
  }
  const errors: SearchError[] = [];
  if (value.experiment === undefined) errors.push(missingField('experiment'));
  else if (!isExperimentId(value.experiment)) errors.push(invalidField('experiment', 'must be a non-empty experiment id (T011 identity space)'));

  if (value.evaluator === undefined) errors.push(missingField('evaluator'));
  else if (!isEvaluatorVersionRef(value.evaluator)) errors.push(invalidField('evaluator', 'must be a non-empty evaluator version ref (T011 identity space)'));

  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));

  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));

  if (Array.isArray(value.entries) && value.entries.length > 0) {
    errors.push(invalidField('entries', 'createSearchRecord builds an OPEN record; use appendSearchTrial to grow the log'));
  }
  if (Array.isArray(value.snapshots) && value.snapshots.length > 0) {
    errors.push(invalidField('snapshots', 'createSearchRecord builds an OPEN record; snapshots arrive with appended trials'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const binding: SearchBinding = {
    experiment: value.experiment as ExperimentId,
    evaluator: value.evaluator as EvaluatorVersionRef,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  return ok(
    deepFreeze({
      search_id: searchRecordId(binding),
      experiment: binding.experiment,
      evaluator: binding.evaluator,
      tenant: binding.tenant,
      project: binding.project,
      entries: [],
      snapshots: [],
      chain_head: chainGenesis(binding),
    } satisfies SearchRecord),
  );
}

/**
 * Append one optimization trial (the ONLY mutation API — L11). The input
 * carries the trial's fields AND its config VALUE; the snapshot address is
 * derived here and stored in the record's content-addressed store.
 *
 * Typed error laws (see module header): `tenant_mismatch`, `invalid_trial`,
 * `duplicate_trial`, `unknown_parent`, `holdout_parent`,
 * `non_monotonic_instant`. Returns a NEW record with the entry appended,
 * the snapshot stored (deduped by address) and the chain head advanced; the
 * original record is untouched.
 */
export function appendSearchTrial(record: SearchRecord, input: unknown): SearchResult<SearchRecord> {
  if (!isRecord(record)) {
    return { ok: false, errors: [invalidType('record must be a search record')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('trial input must be an object')] };
  }

  // L12: the entry's scoping must agree with the record's.
  const tenantError = ensureSameScope(input, record, 'tenant', isTenantId);
  if (tenantError) return { ok: false, errors: [tenantError] };
  const projectError = ensureSameScope(input, record, 'project', isProjectId);
  if (projectError) return { ok: false, errors: [projectError] };

  // The config VALUE mints the snapshot here (content addressing by construction).
  if (input.config === undefined) {
    return { ok: false, errors: [missingField('config')] };
  }
  if (!isJsonObject(input.config)) {
    return { ok: false, errors: [invalidField('config', 'must be a JSON object (the opaque optimization config)')] };
  }
  const config = input.config;
  const snapshotId = configSnapshotId(config);

  // Build the stored entry: the caller's fields plus the derived snapshot id.
  const entryCandidate = {
    trial: input.trial,
    arm: input.arm === undefined ? null : input.arm,
    classification: input.classification,
    config: snapshotId,
    parents: input.parents === undefined ? [] : input.parents,
    splits: input.splits,
    datasets: input.datasets === undefined ? [] : input.datasets,
    window: input.window === undefined ? null : input.window,
    evaluation_policy: input.evaluation_policy,
    recorded_at: input.recorded_at,
    tenant: input.tenant,
    project: input.project,
  };
  const entryResult = validateSearchTrialEntry(entryCandidate, 'trial');
  if (!entryResult.ok) {
    return { ok: false, errors: entryResult.errors.map((e) => (e.code === 'invalid_trial' ? e : e)) };
  }
  const entry = entryResult.value;

  // One id, one entry (L11: no rewrites).
  if (record.entries.some((existing) => existing.trial === entry.trial)) {
    return fail('duplicate_trial', `trial "${entry.trial}" is already an entry of search "${record.search_id}" — a search trial is one entry and history never rewrites (L11)`, 'trial.trial');
  }

  // The DAG law: parents exist, and no optimization trial takes a holdout parent.
  const known = new Map<TrialId, SearchTrialEntry>();
  for (const existing of record.entries) known.set(existing.trial, existing);
  for (const parent of entry.parents) {
    const parentEntry = known.get(parent);
    if (parentEntry === undefined) {
      return fail('unknown_parent', `trial "${entry.trial}" names parent "${parent}" which is not in the search record — DAG edges point at logged trials`, 'trial.parents');
    }
    if (parentEntry.classification === 'holdout') {
      return fail(
        'holdout_parent',
        `trial "${entry.trial}" takes holdout trial "${parent}" as an optimization parent — holdout evidence that steers optimization has stopped being holdout evidence (L11)`,
        'trial.parents',
      );
    }
  }

  // The log is ordered by the injected recording instants (L4).
  const lastEntry = record.entries[record.entries.length - 1];
  if (lastEntry !== undefined && entry.recorded_at < lastEntry.recorded_at) {
    return fail(
      'non_monotonic_instant',
      `trial "${entry.trial}" records instant ${entry.recorded_at} before the previous entry's ${lastEntry.recorded_at} — the search log is ordered (L4)`,
      'trial.recorded_at',
    );
  }

  // The content-addressed store: add the snapshot when the address is new.
  const snapshots = record.snapshots.some((s) => s.snapshot_id === snapshotId)
    ? record.snapshots
    : [...record.snapshots, deepFreeze({ snapshot_id: snapshotId, config })];

  const entries = [...record.entries, entry];
  const binding: SearchBinding = { experiment: record.experiment, evaluator: record.evaluator, tenant: record.tenant, project: record.project };
  return ok(
    deepFreeze({
      search_id: record.search_id,
      experiment: record.experiment,
      evaluator: record.evaluator,
      tenant: record.tenant,
      project: record.project,
      entries,
      snapshots,
      chain_head: computeChainHead(binding, entries),
    } satisfies SearchRecord),
  );
}

function ensureSameScope(
  input: Record<string, unknown>,
  record: SearchRecord,
  field: 'tenant' | 'project',
  guard: (v: unknown) => boolean,
): SearchError | undefined {
  const claimed = input[field];
  if (claimed === undefined) return missingField(field);
  if (!guard(claimed)) return invalidField(field, `must be a non-empty ${field} id`);
  if (claimed !== record[field]) {
    return {
      code: 'tenant_mismatch',
      path: field,
      message: `trial's ${field} "${claimed}" does not match search record's "${record[field]}" — a search never crosses ${field === 'tenant' ? 'tenants (L12)' : 'projects (L15)'}`,
    };
  }
  return undefined;
}

/**
 * Verify an entire search record against its own chain: the binding's
 * derived identity, every entry's structural law, the content-addressing of
 * every stored snapshot, the uniqueness of trial ids, the DAG laws (known
 * parents, no holdout parents, monotone instants) and — the point of the
 * chain — the recomputed head over the entries AS STORED. Any tamper
 * (mutation, reorder, removal) fails `chain_mismatch`. On success the
 * record is returned narrowed, deeply frozen.
 */
export function verifySearchRecord(value: unknown): SearchResult<SearchRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('search record must be an object')] };
  }
  const errors: SearchError[] = [];

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

  const binding: SearchBinding = {
    experiment: value.experiment as ExperimentId,
    evaluator: value.evaluator as EvaluatorVersionRef,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.search_id !== searchRecordId(binding)) {
    return fail('chain_mismatch', `search_id "${value.search_id}" does not match the binding's derived identity — identity and binding cannot disagree (L9)`, 'search_id');
  }

  // Snapshots: content-addressed and unique.
  const snapshotIds = new Set<string>();
  for (let index = 0; index < (value.snapshots as unknown[]).length; index++) {
    const snapshotResult = validateConfigSnapshot((value.snapshots as unknown[])[index], `snapshots[${index}]`);
    if (!snapshotResult.ok) return { ok: false, errors: snapshotResult.errors };
    if (snapshotIds.has(snapshotResult.value.snapshot_id)) {
      return fail('duplicate_snapshot', `snapshot "${snapshotResult.value.snapshot_id}" is listed twice — a content-addressed store lists each address once`, `snapshots[${index}].snapshot_id`);
    }
    snapshotIds.add(snapshotResult.value.snapshot_id);
  }

  // Entries: structural law + log-level laws, in order.
  const entries: SearchTrialEntry[] = [];
  const known = new Map<TrialId, SearchTrialEntry>();
  let previousInstant: TimestampMs | undefined;
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const entryResult = validateSearchTrialEntry((value.entries as unknown[])[index], `entries[${index}]`);
    if (!entryResult.ok) return { ok: false, errors: entryResult.errors };
    const entry = entryResult.value;

    if (known.has(entry.trial)) {
      return fail('duplicate_trial', `trial "${entry.trial}" appears twice in the log — a search trial is one entry (L11)`, `entries[${index}].trial`);
    }
    for (const parent of entry.parents) {
      const parentEntry = known.get(parent);
      if (parentEntry === undefined) {
        return fail('unknown_parent', `trial "${entry.trial}" names parent "${parent}" not logged before it — DAG edges point at earlier trials`, `entries[${index}].parents`);
      }
      if (parentEntry.classification === 'holdout') {
        return fail('holdout_parent', `trial "${entry.trial}" takes holdout trial "${parent}" as an optimization parent (L11)`, `entries[${index}].parents`);
      }
    }
    if (previousInstant !== undefined && entry.recorded_at < previousInstant) {
      return fail('non_monotonic_instant', `entry ${index} records instant ${entry.recorded_at} before the previous entry's ${previousInstant} — the log is ordered (L4)`, `entries[${index}].recorded_at`);
    }
    previousInstant = entry.recorded_at;

    if (!snapshotIds.has(entry.config)) {
      return fail('snapshot_mismatch', `entry ${index} references config snapshot "${entry.config}" the record does not store — a trial's config must be retained (L9/L11)`, `entries[${index}].config`);
    }

    known.set(entry.trial, entry);
    entries.push(entry);
  }

  // The chain: recomputed over the entries AS STORED.
  const expectedHead = computeChainHead(binding, entries);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or truncated (L9/L11)`,
      'chain_head',
    );
  }

  return ok(
    deepFreeze({
      search_id: value.search_id as SearchRecordId,
      experiment: binding.experiment,
      evaluator: binding.evaluator,
      tenant: binding.tenant,
      project: binding.project,
      entries,
      snapshots: (value.snapshots as readonly ConfigSnapshot[]).slice(),
      chain_head: expectedHead,
    } satisfies SearchRecord),
  );
}

// ---------------------------------------------------------------------------
// The search DAG projection (pure)
// ---------------------------------------------------------------------------

/** One node of the search DAG projection. */
export interface SearchDagNode {
  readonly trial: TrialId;
  readonly classification: SearchClassification;
  readonly config: string;
  readonly parents: readonly TrialId[];
  /** Depth in the DAG: roots (no parents) are 0; depth(t) = 1 + max(depth(parents)). */
  readonly depth: number;
}

/** The search DAG: nodes in first-appearance order plus the maximal depth. */
export interface SearchDag {
  readonly nodes: readonly SearchDagNode[];
  readonly edges: readonly { readonly from: TrialId; readonly to: TrialId }[];
  readonly maxDepth: number;
}

/**
 * Project the search DAG from the record: nodes (trial, classification,
 * config address, parents, depth) in append order, edges (parent -> trial)
 * in append order, and the maximal depth. Pure: the same record always
 * projects to the deeply-equal DAG.
 */
export function searchDag(record: SearchRecord): SearchDag {
  const depthByTrial = new Map<TrialId, number>();
  const nodes: SearchDagNode[] = [];
  const edges: { from: TrialId; to: TrialId }[] = [];
  let maxDepth = 0;
  for (const entry of record.entries) {
    let depth = 0;
    for (const parent of entry.parents) {
      const parentDepth = depthByTrial.get(parent) ?? 0;
      depth = Math.max(depth, parentDepth + 1);
      edges.push({ from: parent, to: entry.trial });
    }
    depthByTrial.set(entry.trial, depth);
    maxDepth = Math.max(maxDepth, depth);
    nodes.push({ trial: entry.trial, classification: entry.classification, config: entry.config, parents: entry.parents, depth });
  }
  return deepFreeze({ nodes, edges, maxDepth });
}

/** The canonical JSON bytes of a search record (determinism anchor: identical records -> identical bytes). */
export function canonicalSearchRecord(record: SearchRecord): string {
  return canonicalJson(record as unknown as JsonObject);
}

/** Classification vocabulary re-exported for consumers reasoning about the discriminator. */
export { SEARCH_CLASSIFICATIONS, isSearchTrialEntry, isArmId, isTrialId };
export type { SearchTrialEntry, SearchTrialInput, SearchClassification };
export { isConfigSnapshot, configSnapshotId };
export type { ConfigSnapshot };
