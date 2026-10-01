/**
 * @tradrl/evaluation-integrity — the split/holdout registry with walk-forward
 * and PURGED/EMBARGOED construction (Work Order T031).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md lines 21-24 ("Use unseen
 * periods, regimes, assets, venues or combinations not optimized against.
 * Retain search histories and distinguish in-search performance from
 * holdout performance. Use walk-forward and purged/embargoed designs where
 * appropriate."), R21 (walk-forward/unseen evaluation), L4 (every boundary
 * is a TimestampMs), L9 (content-addressed, deterministic construction),
 * L12 (tenant/project scoping on every registry).
 *
 * THE CONSTRUCTION LAWS (each fail-closed and typed):
 * - WALK-FORWARD (anchored, expanding): windows for test index
 *   i = minTrainSegments, +stepSegments, ... while i < segments.length;
 *   window i's train set is the PREFIX segments[0, i) — anchored, never
 *   sliding, so later windows never forget earlier history. An axis too
 *   short for one window fails `window_exhaustion` (mirroring T012's law).
 * - PURGED/EMBARGOED: the walk-forward above with the PURGE law — a train
 *   segment survives only when it ENDS at least `embargo_ms` before the
 *   test window starts (segment.end + embargo <= test.start). Train
 *   material too close in time to the test window is removed, because
 *   observations near the evaluation boundary carry information about it.
 *   A window whose train set is starved to empty by the embargo fails
 *   `embargo_overlap` — the design does not silently degrade to testing
 *   without training material.
 * - BLIND HOLDOUT: the LAST `holdoutCount` segments are masked blind; the
 *   visible prefix must end at least `embargo_ms` before the first blind
 *   segment starts (`embargo_overlap`), and a mask that would blind
 *   everything or nothing fails `degenerate_mask` (mirroring T012's law).
 *
 * THE REGISTRY LAW: split definitions are REGISTERED (append-only) with
 * their construction content; the definition id is CONTENT-ADDRESSED
 * (`sdef:<digest>` over the canonical definition), and one split policy ref
 * maps to EXACTLY ONE construction (`duplicate_split`). The registry is
 * the EMBARGO AUTHORITY: the leakage detector and the selection audit
 * resolve the embargo a policy demands from its registered definition
 * (`unknown_split_policy` when the policy was never registered).
 */

import { deepFreeze, isNonNegativeInteger, isPositiveInteger, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { isDataRef, isProjectId, isSplitPolicyRef, isTenantId } from './ids';
import type { ProjectId, SplitPolicyRef, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';
import { isDatasetAxis, validateDatasetAxis } from './axis';
import type { DatasetAxis, DatasetSegment } from './axis';

// ---------------------------------------------------------------------------
// Split definitions (DATA — the total interpreters live below)
// ---------------------------------------------------------------------------

/** The closed split-kind vocabulary. */
export const SPLIT_KINDS = ['walk-forward', 'purged-embargoed', 'blind-holdout'] as const;
export type SplitKind = (typeof SPLIT_KINDS)[number];

/** Runtime guard for a split kind. */
export function isSplitKind(value: unknown): value is SplitKind {
  return typeof value === 'string' && (SPLIT_KINDS as readonly string[]).includes(value);
}

/**
 * One registered split definition: the CONSTRUCTION CONTENT — kind, policy
 * ref, axis, and the kind's parameters. The id is content-addressed
 * (`sdef:<digest>` over the canonical definition) — identical designs
 * address identically (L9).
 */
export interface SplitDefinition {
  readonly definition_id: string;
  readonly kind: SplitKind;
  /** The split policy this construction implements (T012/T011 identity space). */
  readonly policy_ref: SplitPolicyRef;
  /** The axis the split is constructed over. */
  readonly axis: DatasetAxis;
  /** Leading segments the first train set must contain (walk-forward/purged kinds, >= 1). */
  readonly min_train_segments: number;
  /** Test-boundary advance per window (walk-forward/purged kinds, >= 1). */
  readonly step_segments: number;
  /** The embargo demanded between train material and test/blind material (>= 0; purged kind requires >= 1). */
  readonly embargo_ms: number;
  /** Trailing segments masked blind (blind-holdout kind, >= 1). */
  readonly holdout_count: number;
}

/** Guard: `SplitDefinition` (structural law, id form included). */
export function isSplitDefinition(value: unknown): value is SplitDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.definition_id !== 'string' || !value.definition_id.startsWith('sdef:')) return false;
  if (!isSplitKind(value.kind)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (!isDatasetAxis(value.axis)) return false;
  if (!isPositiveInteger(value.min_train_segments)) return false;
  if (!isPositiveInteger(value.step_segments)) return false;
  if (!isNonNegativeInteger(value.embargo_ms)) return false;
  if (!isPositiveInteger(value.holdout_count)) return false;
  if (value.kind === 'purged-embargoed' && value.embargo_ms < 1) return false;
  return true;
}

/** The canonical definition JSON (the content-addressing input). */
function definitionJson(value: Omit<SplitDefinition, 'definition_id'>): JsonObject {
  return {
    kind: value.kind,
    policy_ref: value.policy_ref,
    axis: value.axis as unknown as JsonObject,
    min_train_segments: value.min_train_segments,
    step_segments: value.step_segments,
    embargo_ms: value.embargo_ms,
    holdout_count: value.holdout_count,
  };
}

/** Compute the content address of a split definition: `sdef:<digest>`. */
export function splitDefinitionId(content: Omit<SplitDefinition, 'definition_id'>): string {
  return `sdef:${stableDigestJson(definitionJson(content))}`;
}

/**
 * Collect-all validation of an untrusted split definition. The caller may
 * omit `definition_id` (it is DERIVED from the content); a supplied id that
 * disagrees with the content fails `invalid_field` — content and address
 * cannot disagree. Kind-parameter coherence is enforced (a purged design
 * with zero embargo is a plain walk-forward and fails `invalid_split`).
 */
export function validateSplitDefinition(value: unknown, path = 'definition'): IntegrityResult<SplitDefinition> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: IntegrityError[] = [];

  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (!isSplitKind(value.kind)) {
    errors.push(invalidField(`${path}.kind`, `must be one of ${SPLIT_KINDS.join(' | ')}`));
  }

  if (value.policy_ref === undefined) {
    errors.push(missingField(`${path}.policy_ref`));
  } else if (!isSplitPolicyRef(value.policy_ref)) {
    errors.push(invalidField(`${path}.policy_ref`, 'must be a non-empty split policy ref'));
  }

  let axis: DatasetAxis | undefined;
  if (value.axis === undefined) {
    errors.push(missingField(`${path}.axis`));
  } else {
    const axisResult = validateDatasetAxis(value.axis, `${path}.axis`);
    if (axisResult.ok) {
      axis = axisResult.value;
    } else {
      errors.push(...axisResult.errors);
    }
  }

  if (value.min_train_segments === undefined) {
    errors.push(missingField(`${path}.min_train_segments`));
  } else if (!isPositiveInteger(value.min_train_segments)) {
    errors.push(invalidField(`${path}.min_train_segments`, 'must be an integer >= 1'));
  }

  if (value.step_segments === undefined) {
    errors.push(missingField(`${path}.step_segments`));
  } else if (!isPositiveInteger(value.step_segments)) {
    errors.push(invalidField(`${path}.step_segments`, 'must be an integer >= 1'));
  }

  if (value.embargo_ms === undefined) {
    errors.push(missingField(`${path}.embargo_ms`));
  } else if (!isNonNegativeInteger(value.embargo_ms)) {
    errors.push(invalidField(`${path}.embargo_ms`, 'must be an integer >= 0 epoch ms'));
  }

  if (value.holdout_count === undefined) {
    errors.push(missingField(`${path}.holdout_count`));
  } else if (!isPositiveInteger(value.holdout_count)) {
    errors.push(invalidField(`${path}.holdout_count`, 'must be an integer >= 1'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const content = {
    kind: value.kind as SplitKind,
    policy_ref: value.policy_ref as SplitPolicyRef,
    axis: axis as DatasetAxis,
    min_train_segments: value.min_train_segments as number,
    step_segments: value.step_segments as number,
    embargo_ms: value.embargo_ms as number,
    holdout_count: value.holdout_count as number,
  };

  if (content.kind === 'purged-embargoed' && content.embargo_ms < 1) {
    return fail('invalid_split', `purged/embargoed definition "${content.policy_ref}" declares embargo 0 — that is a plain walk-forward design; declare the embargo or use the walk-forward kind`, `${path}.embargo_ms`);
  }
  if (content.kind === 'walk-forward' && content.embargo_ms !== 0) {
    return fail('invalid_split', `walk-forward definition "${content.policy_ref}" declares embargo ${content.embargo_ms} — an embargoed design is the purged-embargoed kind`, `${path}.embargo_ms`);
  }

  const derivedId = splitDefinitionId(content);
  if (value.definition_id !== undefined && value.definition_id !== derivedId) {
    return fail('invalid_field', `definition id "${value.definition_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.definition_id`);
  }

  return ok(deepFreeze({ definition_id: derivedId, ...content } satisfies SplitDefinition));
}

// ---------------------------------------------------------------------------
// The split interpreters (pure, total, fail-closed)
// ---------------------------------------------------------------------------

/** One constructed window: the (purged) train prefix and its held-out test segment. */
export interface SplitWindow {
  /** Train segments (the axis prefix, purged of embargo-adjacent material; non-empty). */
  readonly train: readonly DatasetSegment[];
  /** The held-out test segment (never in this window's train set). */
  readonly test: DatasetSegment;
  /** How many prefix segments the embargo purged from this window's train set. */
  readonly purged: number;
}

/** The blind holdout split: the visible prefix and the masked blind suffix. */
export interface BlindHoldoutSplit {
  /** Visible segments (the leading prefix — in-search material). */
  readonly visible: readonly DatasetSegment[];
  /** Blind segments (the masked suffix — unseen, never optimized against). */
  readonly blind: readonly DatasetSegment[];
}

/**
 * Compute the anchored expanding-window walk-forward windows of a
 * walk-forward or purged/embargoed definition.
 *
 * Purge law (purged-embargoed): window i's train set is the prefix
 * segments[0, i) filtered to segments with `end + embargo_ms <= test.start`
 * — train material that ends within the embargo horizon of the test window
 * is REMOVED (its observations carry information about the evaluation
 * boundary). A window starved to an empty train set fails `embargo_overlap`
 * (never a silent window without training material). No complete window
 * fails `window_exhaustion`. Deterministic and pure.
 */
export function constructWalkForward(definition: SplitDefinition): IntegrityResult<readonly SplitWindow[]> {
  if (!isSplitDefinition(definition)) {
    return fail('invalid_split', 'constructWalkForward requires a valid split definition');
  }
  if (definition.kind === 'blind-holdout') {
    return fail('invalid_split', `definition "${definition.policy_ref}" is a blind-holdout design — construct the holdout mask with constructBlindHoldout`);
  }
  const segments = definition.axis.segments;
  const windows: SplitWindow[] = [];
  for (let testIndex = definition.min_train_segments; testIndex < segments.length; testIndex += definition.step_segments) {
    const test = segments[testIndex];
    if (test === undefined) continue; // unreachable under the loop bound; kept fail-closed
    const prefix = segments.slice(0, testIndex);
    const train = definition.kind === 'purged-embargoed'
      ? prefix.filter((segment) => segment.end + definition.embargo_ms <= test.start)
      : prefix;
    if (train.length === 0) {
      return fail(
        'embargo_overlap',
        `embargo of ${definition.embargo_ms} ms purges the ENTIRE train set of the window testing segment "${test.ref}" (start ${test.start}) — the axis cannot support this purged/embargoed design`,
      );
    }
    windows.push({ train, test, purged: prefix.length - train.length });
  }
  if (windows.length === 0) {
    return fail(
      'window_exhaustion',
      `axis has ${segments.length} segment(s); the definition requires at least ${definition.min_train_segments + 1} for one complete window — no window exists`,
    );
  }
  return ok(deepFreeze(windows));
}

/**
 * Compute the blind holdout mask of a definition: the last `holdout_count`
 * segments are blind, the leading prefix stays visible, and the visible
 * prefix must end at least `embargo_ms` before the first blind segment
 * starts (`embargo_overlap`). A mask that would blind everything or
 * nothing fails `degenerate_mask` (mirroring T012's law).
 */
export function constructBlindHoldout(definition: SplitDefinition): IntegrityResult<BlindHoldoutSplit> {
  if (!isSplitDefinition(definition)) {
    return fail('invalid_split', 'constructBlindHoldout requires a valid split definition');
  }
  if (definition.kind !== 'blind-holdout') {
    return fail('invalid_split', `definition "${definition.policy_ref}" is a ${definition.kind} design — construct the windows with constructWalkForward`);
  }
  const segments = definition.axis.segments;
  const total = segments.length;
  if (definition.holdout_count >= total) {
    return fail(
      'degenerate_mask',
      `blind-holdout definition "${definition.policy_ref}" masks all ${total} segment(s) — the visible part would be empty (holdout_count must be < segments.length)`,
    );
  }
  if (definition.holdout_count < 1) {
    return fail('degenerate_mask', `blind-holdout definition "${definition.policy_ref}" masks nothing (holdout_count must be >= 1)`);
  }
  const splitAt = total - definition.holdout_count;
  const visible = segments.slice(0, splitAt);
  const blind = segments.slice(splitAt);
  const lastVisibleEnd = visible[visible.length - 1]?.end;
  const firstBlindStart = blind[0]?.start;
  if (lastVisibleEnd !== undefined && firstBlindStart !== undefined && firstBlindStart - lastVisibleEnd < definition.embargo_ms) {
    return fail(
      'embargo_overlap',
      `visible prefix ends at ${lastVisibleEnd} but the blind suffix starts at ${firstBlindStart} — the declared embargo of ${definition.embargo_ms} ms is not satisfied (embargoed holdout demands the gap)`,
    );
  }
  return ok(deepFreeze({ visible, blind } satisfies BlindHoldoutSplit));
}

/** The total dispatcher: construct whatever the definition's kind constructs. */
export function constructSplits(definition: SplitDefinition): IntegrityResult<readonly SplitWindow[] | BlindHoldoutSplit> {
  if (definition.kind === 'blind-holdout') return constructBlindHoldout(definition);
  return constructWalkForward(definition);
}

// ---------------------------------------------------------------------------
// The split registry (append-only; the embargo authority)
// ---------------------------------------------------------------------------

/** One registered split: the definition plus its registration instant (L4 injected). */
export interface RegisteredSplit {
  readonly definition: SplitDefinition;
  readonly registered_at: TimestampMs;
}

/** The split/holdout registry: tenant/project-scoped, append-only. */
export interface SplitRegistry {
  /** Derived identity: `sreg:<digest over the canonical binding>`. */
  readonly registry_id: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly registered: readonly RegisteredSplit[];
}

/** Guard: `SplitRegistry`. */
export function isSplitRegistry(value: unknown): value is SplitRegistry {
  if (!isRecord(value)) return false;
  if (typeof value.registry_id !== 'string' || !value.registry_id.startsWith('sreg:')) return false;
  if (!isTenantId(value.tenant) || !isProjectId(value.project)) return false;
  if (!Array.isArray(value.registered)) return false;
  return (value.registered as readonly unknown[]).every((entry) =>
    isRecord(entry) && isSplitDefinition(entry.definition) && isTimestampMs(entry.registered_at),
  );
}

/** The registry's derived identity: `sreg:<digest over tenant/project>`. */
export function splitRegistryId(tenant: TenantId, project: ProjectId): string {
  return `sreg:${stableDigestJson({ tenant, project })}`;
}

/** Construct an open split registry (no registered definitions). */
export function createSplitRegistry(value: unknown): IntegrityResult<SplitRegistry> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('registry input must be an object')] };
  }
  const errors: IntegrityError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (Array.isArray(value.registered) && value.registered.length > 0) {
    errors.push(invalidField('registered', 'createSplitRegistry builds an OPEN registry; use registerSplit to grow it'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const tenant = value.tenant as TenantId;
  const project = value.project as ProjectId;
  return ok(
    deepFreeze({
      registry_id: splitRegistryId(tenant, project),
      tenant,
      project,
      registered: [],
    } satisfies SplitRegistry),
  );
}

/**
 * Register one split definition (the ONLY mutation API — the registry is
 * append-only). The definition is validated (id derived from content); the
 * registration instant is INJECTED (L4). One split policy ref maps to
 * exactly one construction: a second registration under a registered
 * policy ref fails `duplicate_split`; a duplicate content address fails
 * `duplicate_split` too. Returns a NEW registry; the original is untouched.
 */
export function registerSplit(registry: SplitRegistry, input: unknown): IntegrityResult<SplitRegistry> {
  if (!isSplitRegistry(registry)) {
    return { ok: false, errors: [invalidType('registry must be a split registry')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('registration input must be an object')] };
  }
  if (input.definition === undefined) {
    return { ok: false, errors: [missingField('definition')] };
  }
  const definitionResult = validateSplitDefinition(input.definition);
  if (!definitionResult.ok) return definitionResult;
  const definition = definitionResult.value;

  if (input.registered_at === undefined) {
    return { ok: false, errors: [missingField('registered_at')] };
  }
  if (!isTimestampMs(input.registered_at)) {
    return { ok: false, errors: [invalidField('registered_at', 'must be a valid TimestampMs (the injected registration instant, L4)')] };
  }

  const registeredAt = input.registered_at as TimestampMs;
  const lastRegistered = registry.registered[registry.registered.length - 1];
  if (lastRegistered !== undefined && registeredAt < lastRegistered.registered_at) {
    return fail('invalid_registry', `registration instant ${registeredAt} precedes the previous registration's ${lastRegistered.registered_at} — the registry is ordered (L4)`, 'registered_at');
  }

  for (const existing of registry.registered) {
    if (existing.definition.policy_ref === definition.policy_ref) {
      return fail(
        'duplicate_split',
        `split policy "${definition.policy_ref}" is already registered (definition "${existing.definition.definition_id}") — a policy maps to exactly one construction; the registry is append-only and never rewrites`,
        'definition.policy_ref',
      );
    }
    if (existing.definition.definition_id === definition.definition_id) {
      return fail('duplicate_split', `definition "${definition.definition_id}" is already registered`, 'definition.definition_id');
    }
  }

  return ok(
    deepFreeze({
      ...registry,
      registered: [...registry.registered, deepFreeze({ definition, registered_at: registeredAt })],
    } satisfies SplitRegistry),
  );
}

/**
 * Resolve the embargo a split policy demands: the registered definition's
 * `embargo_ms`. An unregistered policy fails `unknown_split_policy` — the
 * embargo authority refuses to invent separations.
 */
export function embargoOfPolicy(registry: SplitRegistry, policyRef: unknown): IntegrityResult<number> {
  if (!isSplitPolicyRef(policyRef)) {
    return { ok: false, errors: [invalidField('policy_ref', 'must be a non-empty split policy ref')] };
  }
  for (const entry of registry.registered) {
    if (entry.definition.policy_ref === policyRef) return ok(entry.definition.embargo_ms);
  }
  return fail('unknown_split_policy', `split policy "${policyRef}" is not registered — the embargo authority refuses to invent a separation`);
}

/** The segment refs a registered definition evaluates over (reporting/lineage projection). */
export function policySegmentRefs(registry: SplitRegistry, policyRef: unknown): IntegrityResult<readonly string[]> {
  if (!isSplitPolicyRef(policyRef)) {
    return { ok: false, errors: [invalidField('policy_ref', 'must be a non-empty split policy ref')] };
  }
  const entry = registry.registered.find((candidate) => candidate.definition.policy_ref === policyRef);
  if (entry === undefined) {
    return fail('unknown_split_policy', `split policy "${policyRef}" is not registered`);
  }
  const construction = constructSplits(entry.definition);
  if (!construction.ok) return construction;
  const value = construction.value;
  if (entry.definition.kind === 'blind-holdout') {
    const holdout = value as BlindHoldoutSplit;
    return ok(deepFreeze(holdout.blind.map((segment) => segment.ref)));
  }
  const windows = value as readonly SplitWindow[];
  return ok(deepFreeze(windows.map((window) => window.test.ref)));
}

export { isDataRef };
