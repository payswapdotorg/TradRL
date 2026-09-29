// @tradrl/trading-strategy — the strategy spec: the versioned,
// deterministic strategy DECLARATION.
//
// A {@link StrategySpec} is the compiled form of "what the organization
// learned, expressed as a tradable policy" (spec/ARCHITECTURE.md core
// flow: "Research/Learning -> Strategy/Portfolio/Risk -> Execution").
// It is DATA, never code: the allocation policy, the rebalancing policy
// and the price discipline are DECLARED, VERSIONED, pure-function SHAPES
// — the run compiler (run.ts) is their DECLARED interpreter, so the same
// (spec, observation window, constraint set, portfolio state, seed)
// always yields a byte-identical intent sequence (the determinism law).
//
// Laws this module enforces:
// - Versioning discipline: a spec is immutable; a revision is a NEW
//   VERSION under the same id (mirroring the goal/constraint-set
//   discipline). Identity is `(specId, version)`.
// - Universe discipline: entries are unique by (instrument, venue) — a
//   duplicate is the typed `universe_violation`; grids (lot/tick) are
//   positive decimals (the order-emission discipline).
// - Stochasticity discipline: a stochastic strategy DECLARES its seeded
//   generators here (name + algorithm, unique names); a spec with no
//   declarations declares itself deterministic, and its runs must not
//   touch a generator (the reference policies of this Work Order are
//   deterministic — zero declarations).
// - L8 (authority trip wire): a spec embedding execution authority
//   anywhere fails validation with `authority_in_strategy` — the spec
//   carries OPAQUE `riskPolicyRefs` (T020 owns the engine), never
//   grants, tokens, credentials or venue permissions.
// - L12: the spec carries its tenant and project scope.
// - L9/L15: organization + blueprint bindings are OPAQUE refs (T016
//   owns the structure; this lane never re-defines it).
//
// Spec anchors: spec/DOMAIN-MODEL.md (Goal — "allowed markets/data/actions
// and risk policy" — compiled INTO the universe and the risk-policy refs),
// spec/ARCHITECTURE-LOCK.md L8, L9, L11, L12, L15.

import { deepFreeze, isNonEmptyString, isPositiveInteger, isPositiveSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import {
  type BlueprintAssignmentRef,
  type GoalRef,
  type InstrumentId,
  type OrganizationRef,
  type ProjectId,
  type RiskPolicyRef,
  type Seed,
  type StrategySpecId,
  type TenantId,
  type VenueId,
  isBlueprintAssignmentRef,
  isGoalRef,
  isInstrumentId,
  isOrganizationRef,
  isProjectId,
  isRiskPolicyRef,
  isStrategySpecId,
  isTenantId,
  isVenueId,
} from './ids';
import { divideRoundHalfUp, isCanonicalPositiveDecimal } from './decimals';
import { authorityViolations } from './authority';
import { type StrategyError, type StrategyResult, fail, failures, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

/**
 * One universe entry: the instrument this strategy MAY trade, on the
 * venue it trades it on, with the venue's LOT and TICK grids (the
 * order-emission discipline — emitted quantities are lot-aligned, limit
 * prices are tick-aligned; the exchange would mechanically reject
 * anything else, and the strategy does not emit known-invalid requests).
 */
export interface UniverseEntry {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  /** Lot size (minimum quantity multiple), positive decimal. */
  readonly lotSize: string;
  /** Tick size (minimum price multiple), positive decimal. */
  readonly tickSize: string;
}

// ---------------------------------------------------------------------------
// Allocation policy (declared, versioned, pure-function shape)
// ---------------------------------------------------------------------------

/**
 * The closed allocation-policy vocabulary of this Work Order:
 *   - `equal_weight`: every universe instrument targets weight
 *     `1 / N` (N = universe size), computed as an exact decimal
 *     division at the spec's declared precision from the OBSERVATION
 *     window (weights FROM observations — the pure-function shape; the
 *     interpreter is run.ts, the reference implementation is
 *     services/strategy).
 * New policies (fixed weights, inverse volatility, ...) are NEW
 * VOCABULARY MEMBERS with a new interpreter case — a versioned contract
 * change, never a mutation of this one.
 */
export type AllocationPolicy =
  | { readonly kind: 'equal_weight' }
  | { readonly kind: 'fixed_weights'; readonly weights: readonly { readonly instrumentId: InstrumentId; readonly weight: string }[] };

export const ALLOCATION_POLICY_KINDS: readonly AllocationPolicy['kind'][] = ['equal_weight', 'fixed_weights'] as const;

/** Guard: `AllocationPolicy`. */
export function isAllocationPolicy(v: unknown): v is AllocationPolicy {
  if (!isRecord(v)) return false;
  if (v.kind === 'equal_weight') return true;
  if (v.kind === 'fixed_weights') {
    if (!Array.isArray(v.weights) || v.weights.length === 0) return false;
    const seen = new Set<string>();
    for (const entry of v.weights) {
      if (!isRecord(entry)) return false;
      if (!isInstrumentId(entry.instrumentId)) return false;
      if (!isCanonicalPositiveDecimal(entry.weight)) return false;
      if (seen.has(entry.instrumentId)) return false; // one weight per instrument
      seen.add(entry.instrumentId);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rebalancing policy (drift bands, cadence, declared triggers)
// ---------------------------------------------------------------------------

/** The closed rebalance-trigger vocabulary. */
export type RebalanceTrigger = 'drift_band' | 'scheduled';

export const REBALANCE_TRIGGERS: readonly RebalanceTrigger[] = ['drift_band', 'scheduled'] as const;

/**
 * The declared rebalancing policy:
 *   - `drift_band` trigger: rebalance an instrument when
 *     `|current_weight - target_weight|` EXCEEDS the band (strictly —
 *     exactly-at-band does NOT trigger; tested at the boundary);
 *   - `scheduled` trigger: rebalance at the declared cadence regardless
 *     of drift;
 *   - `band`: the drift band as a decimal string in [0, 1] (e.g. "0.05"
 *     = 5%); REQUIRED for `drift_band`, absent for `scheduled`;
 *   - `cadenceMs`: the minimum spacing between rebalance decisions
 *     (epoch-ms distance), positive.
 */
export interface RebalancingPolicy {
  readonly trigger: RebalanceTrigger;
  /** Drift band, decimal in [0, 1]. REQUIRED for `drift_band`; absent for `scheduled`. */
  readonly band?: string;
  /** Minimum time between rebalance decisions (ms), positive. */
  readonly cadenceMs: number;
  /** Human context. NEVER interpreted. */
  readonly description?: string;
}

/** Guard: `RebalancingPolicy` (the band presence matrix included). */
export function isRebalancingPolicy(v: unknown): v is RebalancingPolicy {
  if (!isRecord(v)) return false;
  if (v.trigger !== 'drift_band' && v.trigger !== 'scheduled') return false;
  if (v.band !== undefined && !isCanonicalPositiveDecimal(v.band)) return false;
  if (v.trigger === 'drift_band' && v.band === undefined) return false;
  if (v.trigger === 'scheduled' && v.band !== undefined) return false;
  if (!isPositiveSafeInteger(v.cadenceMs)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Price discipline (the declared price rule of emitted intents)
// ---------------------------------------------------------------------------

/** The anchor the limit price derives from, deterministically. */
export type PriceAnchor = 'last_trade' | 'mid_quote';

export const PRICE_ANCHORS: readonly PriceAnchor[] = ['last_trade', 'mid_quote'] as const;

/**
 * The declared price discipline of emitted intents:
 *   - `market`: market intents (no price on the order-intent mirror);
 *   - `limit`: limit intents at the anchor price derived from the
 *     observation window (last trade print, or top-of-book mid),
 *     tick-aligned — the DECLARED price rule, deterministic from the
 *     window.
 */
export type PriceDiscipline =
  | { readonly kind: 'market' }
  | { readonly kind: 'limit'; readonly anchor: PriceAnchor };

export const PRICE_DISCIPLINE_KINDS: readonly PriceDiscipline['kind'][] = ['market', 'limit'] as const;

/** Guard: `PriceDiscipline`. */
export function isPriceDiscipline(v: unknown): v is PriceDiscipline {
  if (!isRecord(v)) return false;
  if (v.kind === 'market') return true;
  if (v.kind === 'limit') {
    return v.anchor === 'last_trade' || v.anchor === 'mid_quote';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Seeded-generator declarations (the stochasticity discipline)
// ---------------------------------------------------------------------------

/** The closed seeded-generator algorithm vocabulary (the program's discipline). */
export type GeneratorAlgorithm = 'mulberry32';

export const GENERATOR_ALGORITHMS: readonly GeneratorAlgorithm[] = ['mulberry32'] as const;

/**
 * One declared seeded generator: `name` binds a draw site inside the
 * policy interpreter (each declared name is a distinct, named use);
 * `algorithm` names the deterministic generator. A spec with an empty
 * `generators` list DECLARES itself deterministic.
 */
export interface SeedGeneratorDeclaration {
  readonly name: string;
  readonly algorithm: GeneratorAlgorithm;
}

/** Guard: `SeedGeneratorDeclaration`. */
export function isSeedGeneratorDeclaration(v: unknown): v is SeedGeneratorDeclaration {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.name)) return false;
  return v.algorithm === 'mulberry32';
}

// ---------------------------------------------------------------------------
// Organization binding (opaque — T016 owns the structure)
// ---------------------------------------------------------------------------

/**
 * The organization a strategy runs inside: OPAQUE refs only (the
 * organization id + the blueprint assignment entries that carry this
 * strategy's mandate). This lane NEVER re-defines organization structure
// — it pins the binding for lineage (L9/L15).
 */
export interface OrganizationBinding {
  readonly organizationId: OrganizationRef;
  /** Opaque refs to the blueprint assignment entries carrying the strategy mandate. */
  readonly assignmentRefs: readonly BlueprintAssignmentRef[];
}

/** Guard: `OrganizationBinding`. */
export function isOrganizationBinding(v: unknown): v is OrganizationBinding {
  if (!isRecord(v)) return false;
  if (!isOrganizationRef(v.organizationId)) return false;
  if (!Array.isArray(v.assignmentRefs)) return false;
  if (!v.assignmentRefs.every((x) => isBlueprintAssignmentRef(x))) return false;
  const seen = new Set<string>();
  for (const ref of v.assignmentRefs) {
    const value = ref as BlueprintAssignmentRef;
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The strategy spec
// ---------------------------------------------------------------------------

/**
 * The versioned, deterministic strategy declaration (see the module
 * header). Identity is `(specId, version)`; records are immutable once
 * published — a change is a new version.
 */
export interface StrategySpec {
  readonly specId: StrategySpecId;
  /** Integer >= 1; monotonically increasing per specId. */
  readonly version: number;
  /** Owning tenant (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L12/L15). */
  readonly project: ProjectId;
  /** The goal this strategy serves (L15 lineage; opaque versioned ref is carried by runs). */
  readonly goal: GoalRef;
  /** Human-readable name. NEVER interpreted. */
  readonly name?: string;
  /** The tradable universe (unique by (instrument, venue)). */
  readonly universe: readonly UniverseEntry[];
  /** The declared allocation policy (weights from observations). */
  readonly allocation: AllocationPolicy;
  /** The declared rebalancing policy (drift bands, cadence, triggers). */
  readonly rebalancing: RebalancingPolicy;
  /** The declared price discipline of emitted intents. */
  readonly priceDiscipline: PriceDiscipline;
  /** OPAQUE risk-policy refs (T020 owns the engine; L8: refs, never grants). */
  readonly riskPolicyRefs: readonly RiskPolicyRef[];
  /** Declared seeded generators (EMPTY = the spec declares itself deterministic). */
  readonly generators: readonly SeedGeneratorDeclaration[];
  /** Declared decimal precision of every division site (weights, per-unit costs), 0..18. */
  readonly decimalPrecision: number;
  /** The organization binding (opaque; T016 owns the structure). */
  readonly organization: OrganizationBinding | null;
  /** Publication instant (explicit — no ambient clock). */
  readonly createdAt: TimestampMs;
  /** Human context. NEVER interpreted. */
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Guards and validation
// ---------------------------------------------------------------------------

/** Guard: `UniverseEntry`. */
export function isUniverseEntry(v: unknown): v is UniverseEntry {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isCanonicalPositiveDecimal(v.lotSize)) return false;
  if (!isCanonicalPositiveDecimal(v.tickSize)) return false;
  return true;
}

/** Guard: `StrategySpec` (structural; the universe/authority/precision laws live in `validateStrategySpec`). */
export function isStrategySpec(v: unknown): v is StrategySpec {
  if (!isRecord(v)) return false;
  if (!isStrategySpecId(v.specId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.universe) || v.universe.length === 0) return false;
  if (!v.universe.every((x) => isUniverseEntry(x))) return false;
  if (!isAllocationPolicy(v.allocation)) return false;
  if (!isRebalancingPolicy(v.rebalancing)) return false;
  if (!isPriceDiscipline(v.priceDiscipline)) return false;
  if (!Array.isArray(v.riskPolicyRefs)) return false;
  if (!v.riskPolicyRefs.every((x) => isRiskPolicyRef(x))) return false;
  if (!Array.isArray(v.generators)) return false;
  if (!v.generators.every((x) => isSeedGeneratorDeclaration(x))) return false;
  if (!isPositiveSafeInteger(v.decimalPrecision) || v.decimalPrecision > 18) return false;
  if (v.organization !== null && !isOrganizationBinding(v.organization)) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  // The band is a unit-interval decimal.
  if (v.rebalancing !== undefined && typeof v.rebalancing === 'object' && v.rebalancing !== null) {
    const rebalancing = v.rebalancing as unknown as Record<string, unknown>;
    const band: unknown = rebalancing.band;
    if (band !== undefined && (!isCanonicalPositiveDecimal(band) || Number(band) > 1)) return false;
    // The drift-band presence matrix.
    if (rebalancing.trigger === 'drift_band' && rebalancing.band === undefined) return false;
    if (rebalancing.trigger === 'scheduled' && rebalancing.band !== undefined) return false;
  }
  // Safety: no embedded authority (the guard half of the L8 trip wire).
  if (authorityViolations(v).length > 0) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted strategy spec. Beyond the
 * structural guard this enforces the LAWS:
 *   - `universe_violation` — duplicate (instrument, venue) pairs, or a
 *     fixed-weight allocation that does not cover exactly the universe;
 *   - `authority_in_strategy` — any authority-embedding key or authority
 *     verb anywhere in the spec's JSON tree (the L8 trip wire);
 *   - `invalid_field` — duplicate generator names, duplicate
 *     risk-policy refs, a decimal precision outside 0..18.
 * On success the value is returned narrowed, deeply frozen.
 */
export function validateStrategySpec(value: unknown, path = 'spec'): StrategyResult<StrategySpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.specId === undefined) errors.push(missingField(`${path}.specId`));
  else if (!isStrategySpecId(value.specId)) errors.push(invalidField(`${path}.specId`, 'must be a non-empty string'));

  if (value.version === undefined) errors.push(missingField(`${path}.version`));
  else if (!isPositiveInteger(value.version)) errors.push(invalidField(`${path}.version`, 'must be an integer >= 1'));

  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));

  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L12/L15)'));

  if (value.goal === undefined) errors.push(missingField(`${path}.goal`));
  else if (!isGoalRef(value.goal)) errors.push(invalidField(`${path}.goal`, 'must be a non-empty goal ref'));

  if (value.name !== undefined && !isNonEmptyString(value.name)) {
    errors.push(invalidField(`${path}.name`, 'must be a non-empty string when present'));
  }

  if (value.universe === undefined) {
    errors.push(missingField(`${path}.universe`));
  } else if (!Array.isArray(value.universe) || value.universe.length === 0) {
    errors.push(invalidField(`${path}.universe`, 'must be a non-empty array of universe entries'));
  } else {
    const seen = new Set<string>();
    value.universe.forEach((entry: unknown, index: number) => {
      if (!isUniverseEntry(entry)) {
        errors.push(invalidField(`${path}.universe[${index}]`, 'must be { instrumentId, venueId, lotSize, tickSize } with positive decimal grids'));
        return;
      }
      const universe = entry as UniverseEntry;
      const key = `${universe.instrumentId}|${universe.venueId}`;
      if (seen.has(key)) {
        errors.push({
          code: 'universe_violation',
          path: `${path}.universe[${index}]`,
          message: `duplicate universe entry for (${universe.instrumentId}, ${universe.venueId}) — the universe is a set of (instrument, venue) pairs`,
        });
      }
      seen.add(key);
    });
  }

  if (value.allocation === undefined) errors.push(missingField(`${path}.allocation`));
  else if (!isAllocationPolicy(value.allocation)) {
    errors.push(invalidField(`${path}.allocation`, `must be an allocation policy (${ALLOCATION_POLICY_KINDS.join(' | ')})`));
  } else {
    const allocation = value.allocation as AllocationPolicy;
    if (allocation.kind === 'fixed_weights' && Array.isArray(value.universe) && value.universe.length > 0) {
      // The coverage law: a fixed-weight allocation covers EXACTLY the
      // universe (one weight per universe instrument, no foreign weights).
      const universeInstruments = new Set<string>(
        (value.universe as readonly unknown[])
          .filter((entry): entry is Record<string, unknown> => isRecord(entry) && isInstrumentId(entry.instrumentId))
          .map((entry) => entry.instrumentId as string),
      );
      const weightInstruments = new Set<string>(allocation.weights.map((w) => w.instrumentId));
      for (const instrument of universeInstruments) {
        if (!weightInstruments.has(instrument)) {
          errors.push({
            code: 'universe_violation',
            path: `${path}.allocation.weights`,
            message: `universe instrument "${instrument}" has no declared weight — a fixed-weight allocation covers exactly the universe`,
          });
        }
      }
      for (const instrument of weightInstruments) {
        if (!universeInstruments.has(instrument)) {
          errors.push({
            code: 'universe_violation',
            path: `${path}.allocation.weights`,
            message: `weight declared for "${instrument}" which is not in the universe — a fixed-weight allocation covers exactly the universe`,
          });
        }
      }
    }
  }

  if (value.rebalancing === undefined) {
    errors.push(missingField(`${path}.rebalancing`));
  } else if (!isRebalancingPolicy(value.rebalancing)) {
    errors.push(invalidField(`${path}.rebalancing`, `must be a rebalancing policy (trigger ${REBALANCE_TRIGGERS.join(' | ')}; band required iff trigger is drift_band)`));
  }

  if (value.priceDiscipline === undefined) errors.push(missingField(`${path}.priceDiscipline`));
  else if (!isPriceDiscipline(value.priceDiscipline)) {
    errors.push(invalidField(`${path}.priceDiscipline`, `must be a price discipline (${PRICE_DISCIPLINE_KINDS.join(' | ')})`));
  }

  if (value.riskPolicyRefs === undefined) {
    errors.push(missingField(`${path}.riskPolicyRefs`));
  } else if (!Array.isArray(value.riskPolicyRefs)) {
    errors.push(invalidField(`${path}.riskPolicyRefs`, 'must be an array of opaque risk-policy refs'));
  } else {
    const seen = new Set<string>();
    value.riskPolicyRefs.forEach((entry: unknown, index: number) => {
      if (!isRiskPolicyRef(entry)) {
        errors.push(invalidField(`${path}.riskPolicyRefs[${index}]`, 'must be a non-empty opaque risk-policy ref'));
        return;
      }
      const ref = entry as RiskPolicyRef;
      if (seen.has(ref)) {
        errors.push(invalidField(`${path}.riskPolicyRefs[${index}]`, 'duplicate risk-policy ref'));
      }
      seen.add(ref);
    });
  }

  if (value.generators === undefined) {
    errors.push(missingField(`${path}.generators`));
  } else if (!Array.isArray(value.generators)) {
    errors.push(invalidField(`${path}.generators`, 'must be an array of seeded-generator declarations (empty = deterministic)'));
  } else {
    const seen = new Set<string>();
    value.generators.forEach((entry: unknown, index: number) => {
      if (!isSeedGeneratorDeclaration(entry)) {
        errors.push(invalidField(`${path}.generators[${index}]`, 'must be { name, algorithm: "mulberry32" }'));
        return;
      }
      const generator = entry as SeedGeneratorDeclaration;
      if (seen.has(generator.name)) {
        errors.push(invalidField(`${path}.generators[${index}]`, `duplicate generator name "${generator.name}"`));
      }
      seen.add(generator.name);
    });
  }

  if (value.decimalPrecision === undefined) {
    errors.push(missingField(`${path}.decimalPrecision`));
  } else if (!isPositiveSafeInteger(value.decimalPrecision) || value.decimalPrecision > 18) {
    errors.push(invalidField(`${path}.decimalPrecision`, 'must be a safe integer in 1..18 (the declared division-precision discipline)'));
  }

  if (value.organization === undefined) {
    errors.push(missingField(`${path}.organization`));
  } else if (value.organization !== null && !isOrganizationBinding(value.organization)) {
    errors.push(invalidField(`${path}.organization`, 'must be null or { organizationId, assignmentRefs[] } (opaque T016 refs)'));
  }

  if (value.createdAt === undefined) errors.push(missingField(`${path}.createdAt`));
  else if (!isTimestampMs(value.createdAt)) errors.push(invalidField(`${path}.createdAt`, 'must be an epoch-ms timestamp'));

  if (value.description !== undefined && !isNonEmptyString(value.description)) {
    errors.push(invalidField(`${path}.description`, 'must be a non-empty string when present'));
  }

  // The L8 trip wire (validated even when the structural guard already
  // failed, so the crime is always named).
  for (const crimePath of authorityViolations(value)) {
    errors.push({
      code: 'authority_in_strategy',
      path: `${path}.${crimePath}`,
      message: `strategy specs embed no execution authority ("${crimePath}") — risk/authorization are opaque refs to the T020 gate, never grants (L8)`,
    });
  }

  if (errors.length > 0) return failures(errors);
  if (!isStrategySpec(value)) {
    // Unreachable when every field check above passed; kept fail-closed.
    return fail('invalid_spec', `${path} failed the structural spec guard`);
  }
  return ok(deepFreeze(value) as StrategySpec);
}

/**
 * The seed material of a spec: the canonical identity that participates
 * in run lineage (L9) — `(specId, version)`. Pure.
 */
export function specIdentity(spec: StrategySpec): { readonly specId: StrategySpecId; readonly version: number } {
  return deepFreeze({ specId: spec.specId, version: spec.version });
}

/**
 * Derive the target weights of the spec's allocation policy over its
 * universe — the DECLARED pure-function shape ("weights from
 * observations"): under `equal_weight`, every instrument targets
 * `1 / N` at the spec's declared precision; under `fixed_weights`, the
 * declared per-instrument weights (validated to cover exactly the
 * universe). Pure and deterministic.
 */
export function targetWeights(
  spec: StrategySpec,
): readonly { readonly instrumentId: InstrumentId; readonly venueId: VenueId; readonly weight: string }[] {
  if (spec.allocation.kind === 'equal_weight') {
    const count = String(spec.universe.length);
    return spec.universe.map((entry) => ({
      instrumentId: entry.instrumentId,
      venueId: entry.venueId,
      weight: divideRoundHalfUp('1', count, spec.decimalPrecision),
    }));
  }
  const byInstrument = new Map<string, string>();
  for (const entry of spec.allocation.weights) {
    byInstrument.set(entry.instrumentId, entry.weight);
  }
  return spec.universe.map((entry) => ({
    instrumentId: entry.instrumentId,
    venueId: entry.venueId,
    weight: byInstrument.get(entry.instrumentId) as string,
  }));
}
