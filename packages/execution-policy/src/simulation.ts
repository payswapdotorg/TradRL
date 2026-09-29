// @tradrl/execution-policy — the ExecutionSimulationSpec and the
// SimulatedFill: the honest simulator declaration.
//
// SIMULATION HONESTY (L5/L6 — the Work Order: "the execution simulator
// declares its fidelity mode (paper_venue / simulated_matching over
// exchange-sim physics); simulated fills carry their venue lineage
// (engine record refs, fee/latency/slippage/impact configs — mirrors);
// a simulated record claiming live fidelity is a typed error (negative
// test)"):
//
//   - {@link SimulationFidelity} admits EXACTLY the two modes a
//     simulator can serve: `paper_venue` (fills quoted at declared
//     reference prices — a paper venue) and `simulated_matching`
//     (fills from walking a seeded book over the exchange-sim physics
//     mirrors — fees, latency, slippage, impact). EVERY other value —
//     `live` above all — fails validation with the typed
//     `fidelity_claim_dishonest`: this lane SIMULATES; live execution
//     authority is T040's lane, and a simulated record claiming live
//     fidelity is a lie with money attached.
//   - Every {@link SimulatedFill} carries its fidelity mode AND its
//     full venue lineage: the venue model ref, the config digest (the
//     L9 anchor — byte-parity with exchange-sim's `configHash`), the
//     scripted engine's order/fill record refs, and the four physics
//     config refs (fees/latency/slippage/impact). A fill without venue
//     lineage is not evidence of anything.
//
// L6 (microstructure fidelity — "relevant execution behavior is modeled
// or explicitly declared as approximate"): the spec's venue models
// carry the FULL exchange-sim config mirrors, and the SIMULATOR
// FIDELITY declaration ({@link SIMULATION_FIDELITY}) names what each
// mode models and what it does not.
//
// DETERMINISM (L9): same (spec, approved intents, venue state, seed)
// -> byte-identical fill sequence. The seed is declared on the spec;
// every latency draw derives from it through the mirrored counter-
// keyed derivation (venue-mirror.ts `latencyDelayMsMirror`); fill ids
// are ordinal-minted (`xsf-` + zero-padded ordinal — the exchange-sim
// minting law, mirrored).
//
// L12: the spec and every fill carry TenantId + ProjectId.
//
// Spec anchors: spec/ARCHITECTURE.md (Market World's three modes;
// Execution), spec/ARCHITECTURE-LOCK.md L5, L6, L8, L9, L12.

import { deepFreeze, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import { isNonNegativeDecimalInput, isPositiveDecimal } from './decimals';
import type { InstrumentId, ProjectId, Seed, SimulationSpecId, TenantId, VenueId } from './ids';
import { isInstrumentId, isProjectId, isSeed, isSimulationSpecId, isTenantId, isVenueId, mintSimulationSpecId } from './ids';
import type { VenueModelConfigMirror } from './venue-mirror';
import { isVenueModelConfigMirror, validateVenueModelConfig, venueModelDigest } from './venue-mirror';
import type { ExecutionLineage } from './check-machine';
import { isExecutionLineage } from './check-machine';
import { credentialValueViolations } from './credentials';
import {
  type ExecutionPolicyError,
  type ExecutionPolicyResult,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The fidelity modes (L5 — the honest declaration)
// ---------------------------------------------------------------------------

/** The two fidelity modes an execution SIMULATOR can serve (live is T040's lane — claiming it here is a typed error). */
export type SimulationFidelity = 'paper_venue' | 'simulated_matching';

export const SIMULATION_FIDELITY_MODES: readonly SimulationFidelity[] = ['paper_venue', 'simulated_matching'] as const;

/** Guard: a simulation fidelity mode. */
export function isSimulationFidelity(value: unknown): value is SimulationFidelity {
  return isMemberOf(SIMULATION_FIDELITY_MODES, value);
}

/**
 * The explicit L6 fidelity declaration of the execution simulator —
 * what each mode models and what it does not (asserted to exist by
 * tests; nothing here is a silent approximation).
 */
export const SIMULATION_FIDELITY = deepFreeze({
  modeled: [
    'paper_venue: fills are quoted at the venue state\'s declared reference price, with fees per the fee-schedule mirror and latency per the latency-config mirror',
    'simulated_matching: fills emerge from walking a seeded visible book (price-time priority) over the exchange-sim physics mirrors — fees, latency, slippage, impact',
    'every simulated fill carries its fidelity mode and its full venue lineage (engine record refs + config digest + the four physics config refs)',
  ],
  declared_limitations: [
    'no live venue binding — live execution authority is the T040 lane; a simulated record claiming live fidelity is the typed fidelity_claim_dishonest error',
    'paper_venue fills do not consume liquidity — the reference price is a declaration, not a market',
    'simulated_matching models the visible book only: no hidden liquidity, no queue-position dynamics, no endogenous market impact beyond the book walk (the T027 lane owns endogenous reaction)',
    'latency is information latency (when a fill may be observed), not matching latency — mirroring the exchange-sim declaration',
  ],
} as const);

// ---------------------------------------------------------------------------
// The venue model reference (a config mirror + its digest, bound by value)
// ---------------------------------------------------------------------------

/**
 * One venue model bound into a simulation spec: the FULL
 * exchange-sim config mirror (venue identity, instrument, grids,
 * depth, seed, venue-side fidelity, fees/latency/slippage/impact) plus
 * the derived config digest (L9 — byte-parity with exchange-sim's
 * `configHash` over the mirrored config). Bound BY VALUE: the spec is
 * self-describing; a venue model cannot drift between declaration and
 * execution.
 */
export interface VenueModelRef {
  readonly config: VenueModelConfigMirror;
  /** The config's digest — the L9 anchor (venue-mirror.ts `venueModelDigest`). */
  readonly configDigest: string;
  /** An opaque engine record ref namespace for this model (lineage carrier). */
  readonly engineRef: string;
}

/** Guard: `VenueModelRef`. */
export function isVenueModelRef(v: unknown): v is VenueModelRef {
  if (!isRecord(v)) return false;
  if (!isVenueModelConfigMirror(v.config)) return false;
  if (typeof v.configDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.configDigest)) return false;
  if (!isNonEmptyString(v.engineRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The simulation spec
// ---------------------------------------------------------------------------

/**
 * The simulator declaration: the fidelity mode, the venue models (the
 * exchange-sim config mirrors this simulation drives), the seed, and
 * the tenant/project scope. The spec id is content-addressed
 * (`xsim:` + digest of the canonical content).
 */
export interface ExecutionSimulationSpec {
  /** Content-addressed identity: `xsim:` + digest of the canonical content. */
  readonly specId: SimulationSpecId;
  /** The declared fidelity mode (paper_venue | simulated_matching — NEVER live). */
  readonly fidelity: SimulationFidelity;
  /** The venue models this simulation drives (unique (venue, instrument) pairs). */
  readonly venueModels: readonly VenueModelRef[];
  /** The deterministic seed — every draw derives from it (L9). */
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `ExecutionSimulationSpec` (structural; the honesty laws live in `validateExecutionSimulationSpec`). */
export function isExecutionSimulationSpec(v: unknown): v is ExecutionSimulationSpec {
  if (!isRecord(v)) return false;
  if (!isSimulationSpecId(v.specId)) return false;
  if (!isSimulationFidelity(v.fidelity)) return false;
  if (!Array.isArray(v.venueModels) || !v.venueModels.every((x) => isVenueModelRef(x))) return false;
  if (!isSeed(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  // The opacity trip wire (credential values never ride a spec).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/** The canonical JSON tree of a spec's CONTENT (everything except the content-addressed `specId`). */
export function simulationSpecContentTree(spec: Omit<ExecutionSimulationSpec, 'specId'>): JsonValue {
  return {
    fidelity: spec.fidelity,
    venueModels: spec.venueModels.map((model) => ({
      configDigest: model.configDigest,
      engineRef: model.engineRef,
      venue: model.config.venue,
      instrument: model.config.instrument,
    })),
    seed: spec.seed,
    tenant: spec.tenant,
    project: spec.project,
  };
}

/**
 * Collect-all validation of an untrusted simulation spec. Enforces,
 * beyond the structural guard:
 *   - the HONESTY law: `fidelity` must be one of the two simulated
 *     modes — `live` (or anything else) fails with
 *     `fidelity_claim_dishonest`;
 *   - every venue model passes the full config-mirror validation and
 *     its declared digest matches the derived one (a drifted digest is
 *     a forged lineage anchor);
 *   - unique (venue, instrument) pairs;
 *   - credential opacity (the trip wire over the whole record);
 *   - L12 scope.
 * On success the value is returned narrowed, deeply frozen, with the
 * content-addressed `specId` derived.
 */
export function validateExecutionSimulationSpec(value: unknown, path = 'simulationSpec'): ExecutionPolicyResult<ExecutionSimulationSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (value.fidelity === 'live' || value.fidelity === 'paper' || value.fidelity === 'real') {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: `"${String(value.fidelity)}" is not a fidelity a SIMULATOR may claim — this lane simulates (paper_venue | simulated_matching); live execution authority is the T040 lane (L5/L6 honesty)`,
    });
  } else if (!isSimulationFidelity(value.fidelity)) {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: `must be one of ${SIMULATION_FIDELITY_MODES.join(' | ')} — the simulator declares its fidelity mode (L5)`,
    });
  }

  let venueModels: readonly VenueModelRef[] | undefined;
  if (value.venueModels === undefined) {
    errors.push(missingField(`${path}.venueModels`));
  } else if (!Array.isArray(value.venueModels) || value.venueModels.length === 0) {
    errors.push(invalidField(`${path}.venueModels`, 'must be a non-empty array of venue model refs (the simulation drives at least one venue)'));
  } else {
    const validated: VenueModelRef[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.venueModels.length; index++) {
      const candidate = value.venueModels[index];
      if (!isRecord(candidate)) {
        errors.push(invalidField(`${path}.venueModels[${index}]`, 'must be a venue model ref { config, configDigest, engineRef }'));
        continue;
      }
      const configResult = validateVenueModelConfig(candidate.config, `${path}.venueModels[${index}].config`);
      if (!configResult.ok) {
        errors.push(...configResult.errors);
        continue;
      }
      const config = configResult.value;
      const key = `${config.venue}|${config.instrument}`;
      if (seen.has(key)) {
        errors.push(invalidField(`${path}.venueModels[${index}]`, `duplicate pair (${key}) — one model per (venue, instrument)`));
        continue;
      }
      seen.add(key);
      const derivedDigest = venueModelDigest(config);
      if (candidate.configDigest !== derivedDigest) {
        errors.push({
          code: 'lineage_gap',
          path: `${path}.venueModels[${index}].configDigest`,
          message: `the declared digest does not match the config's derived digest (expected "${derivedDigest}") — the lineage anchor is forged (L9)`,
        });
        continue;
      }
      if (!isNonEmptyString(candidate.engineRef)) {
        errors.push(invalidField(`${path}.venueModels[${index}].engineRef`, 'must be a non-empty engine record ref namespace'));
        continue;
      }
      validated.push(deepFreeze({ config, configDigest: derivedDigest, engineRef: candidate.engineRef }));
    }
    if (errors.length === 0) venueModels = validated;
  }

  if (value.seed === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the spec carries no seed (L9 determinism contract)' });
  } else if (!isSeed(value.seed)) {
    errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the seed must be a non-empty string' });
  }

  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the spec carries no tenant scope (L12)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the tenant scope must be a non-empty id (L12)' });
  }

  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the spec carries no project scope (L12/L15)' });
  } else if (!isProjectId(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the project scope must be a non-empty id (L12/L15)' });
  }

  for (const crimePath of credentialValueViolations(value)) {
    errors.push({
      code: 'credential_value_present',
      path: `${path}.${crimePath}`,
      message: `simulation specs carry credential REFERENCES at most, never values ("${crimePath}") — values live in the secrets lane (T044) (L12)`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: Omit<ExecutionSimulationSpec, 'specId'> = {
    fidelity: value.fidelity as SimulationFidelity,
    venueModels: venueModels as readonly VenueModelRef[],
    seed: value.seed as Seed,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  const derivedId = mintSimulationSpecId(stableDigest(simulationSpecContentTree(payload)));
  if (value.specId !== undefined && value.specId !== derivedId) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid_state',
          path: `${path}.specId`,
          message: `the supplied spec id does not match the declared content (expected "${derivedId}") — identity is content-addressed (L9)`,
        },
      ],
    };
  }
  return ok(deepFreeze({ ...payload, specId: derivedId }));
}

// ---------------------------------------------------------------------------
// The simulated fill (honest by construction)
// ---------------------------------------------------------------------------

/**
 * The venue lineage of one simulated fill: the venue model ref's
 * identity anchors (config digest + engine record refs) and the four
 * physics config refs the fill was produced under. Mirrors of the
 * exchange-sim lineage carriers — a fill without venue lineage is not
 * evidence of anything (L6/L9).
 */
export interface SimulatedFillVenueLineage {
  /** The venue model's digest (byte-parity with exchange-sim's configHash — the L9 anchor). */
  readonly configDigest: string;
  /** The scripted engine's order record ref for the driving order. */
  readonly engineOrderRef: string;
  /** The scripted engine's fill record ref for this fill. */
  readonly engineFillRef: string;
  /** The fee-schedule config ref (the venue model's fees, by digest). */
  readonly feesRef: string;
  /** The latency config ref. */
  readonly latencyRef: string;
  /** The slippage config ref. */
  readonly slippageRef: string;
  /** The market-impact policy ref. */
  readonly impactRef: string;
}

/** Guard: `SimulatedFillVenueLineage`. */
export function isSimulatedFillVenueLineage(v: unknown): v is SimulatedFillVenueLineage {
  if (!isRecord(v)) return false;
  if (typeof v.configDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.configDigest)) return false;
  if (!isNonEmptyString(v.engineOrderRef)) return false;
  if (!isNonEmptyString(v.engineFillRef)) return false;
  if (!isNonEmptyString(v.feesRef)) return false;
  if (!isNonEmptyString(v.latencyRef)) return false;
  if (!isNonEmptyString(v.slippageRef)) return false;
  if (!isNonEmptyString(v.impactRef)) return false;
  return true;
}

/**
 * One simulated fill: the execution report the simulator emits for an
 * APPROVED intent. Carries the venue/instrument, the account's side,
 * the print price, the aggressor price (post-slippage), the executed
 * quantity, the account's fee, the injected latency, the fill ordinal
 * (ordinal-minted id), the approving decision ref, the HONEST
 * fidelity mode, the full venue lineage, the L9 execution lineage and
 * the tenant/project scope.
 */
export interface SimulatedFill {
  /** Ordinal-minted identity: `xsf-` + zero-padded 8-digit ordinal (the exchange-sim minting law, mirrored). */
  readonly fillId: string;
  /** The fill ordinal within the simulation (strictly increasing in emission order). */
  readonly sequence: number;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The account's side of the fill. */
  readonly side: 'buy' | 'sell';
  /** The trade print price (the maker's level price under simulated_matching; the reference price under paper_venue). */
  readonly price: string;
  /** The aggressor's execution price after the slippage model. */
  readonly aggressorPrice: string;
  /** The executed quantity (canonical positive decimal). */
  readonly quantity: string;
  /** The account's fee (non-negative decimal, rounded per the fee schedule). */
  readonly fee: string;
  /** The injected information latency (whole ms) — explicit, never hidden. */
  readonly latencyMs: number;
  /** The approving decision this fill derives from (`xd:`-prefixed). */
  readonly decisionId: string;
  /** The gated strategy intent's identity. */
  readonly intentRef: string;
  /** The HONEST fidelity mode this fill was produced under (paper_venue | simulated_matching — NEVER live). */
  readonly fidelity: SimulationFidelity;
  /** The full venue lineage (engine record refs + config anchors). */
  readonly venueLineage: SimulatedFillVenueLineage;
  /** The full L9 execution lineage block. */
  readonly lineage: ExecutionLineage;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The fill's event instant (epoch ms). */
  readonly asOf: TimestampMs;
}

/** Guard: `SimulatedFill` (structural; the honesty laws live in `validateSimulatedFill`). */
export function isSimulatedFill(v: unknown): v is SimulatedFill {
  if (!isRecord(v)) return false;
  if (typeof v.fillId !== 'string' || !v.fillId.startsWith('xsf-')) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (!isNonEmptyString(v.price) || !isPositiveDecimal(v.price)) return false;
  if (!isNonEmptyString(v.aggressorPrice) || !isPositiveDecimal(v.aggressorPrice)) return false;
  if (!isNonEmptyString(v.quantity) || !isPositiveDecimal(v.quantity)) return false;
  if (!isNonNegativeDecimalInput(v.fee)) return false;
  if (typeof v.latencyMs !== 'number' || !Number.isSafeInteger(v.latencyMs) || v.latencyMs < 0) return false;
  if (!isNonEmptyString(v.decisionId) || !v.decisionId.startsWith('xd:')) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (!isSimulationFidelity(v.fidelity)) return false;
  if (!isSimulatedFillVenueLineage(v.venueLineage)) return false;
  if (!isExecutionLineage(v.lineage)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted simulated fill. Enforces,
 * beyond the structural guard:
 *   - the HONESTY law: `fidelity` must be one of the two simulated
 *     modes — a fill claiming `live` (or any other mode) fails with
 *     `fidelity_claim_dishonest` (the negative test's crime scene);
 *   - the fill's decision/intent refs and lineage are coherent
 *     (the fill's lineage must bind the same intent it names — L9);
 *   - the tenant/project scope matches the lineage's (L12).
 * On success the value is returned narrowed, deeply frozen.
 */
export function validateSimulatedFill(value: unknown, path = 'fill'): ExecutionPolicyResult<SimulatedFill> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];

  if (value.fillId === undefined) {
    errors.push(missingField(`${path}.fillId`));
  } else if (typeof value.fillId !== 'string' || !value.fillId.startsWith('xsf-')) {
    errors.push(invalidField(`${path}.fillId`, 'must be an ordinal-minted simulated-fill id ("xsf-" + zero-padded ordinal)'));
  }

  if (value.sequence === undefined) {
    errors.push(missingField(`${path}.sequence`));
  } else if (!isPositiveSafeInteger(value.sequence)) {
    errors.push(invalidField(`${path}.sequence`, 'must be a positive safe integer (the emission ordinal)'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (value.fidelity === 'live' || value.fidelity === 'paper' || value.fidelity === 'real') {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: `a SIMULATED fill may not claim "${String(value.fidelity)}" fidelity — this lane simulates (paper_venue | simulated_matching); live execution authority is the T040 lane (L5/L6 honesty)`,
    });
  } else if (!isSimulationFidelity(value.fidelity)) {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: `must be one of ${SIMULATION_FIDELITY_MODES.join(' | ')}`,
    });
  }

  if (value.decisionId === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.decisionId`, message: 'the fill carries no approving decision ref (L9)' });
  } else if (typeof value.decisionId !== 'string' || !value.decisionId.startsWith('xd:')) {
    errors.push({ code: 'lineage_gap', path: `${path}.decisionId`, message: 'the approving decision ref must be an xd:-prefixed id (L9)' });
  }

  if (value.intentRef === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.intentRef`, message: 'the fill carries no intent ref (L9)' });
  } else if (!isNonEmptyString(value.intentRef)) {
    errors.push({ code: 'lineage_gap', path: `${path}.intentRef`, message: 'the intent ref must be a non-empty id (L9)' });
  }

  if (value.venueLineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.venueLineage`, message: 'a simulated fill carries its venue lineage (engine record refs + config anchors) or it is not evidence (L6/L9)' });
  } else if (!isSimulatedFillVenueLineage(value.venueLineage)) {
    errors.push(invalidField(`${path}.venueLineage`, 'must be { configDigest, engineOrderRef, engineFillRef, feesRef, latencyRef, slippageRef, impactRef }'));
  }

  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the fill carries no execution lineage block (L9)' });
  } else if (!isExecutionLineage(value.lineage)) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the execution lineage block is malformed (intent -> strategy -> goal, policy, venues, seed, tenant, project)' });
  }

  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the fill carries no tenant scope (L12)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the tenant scope must be a non-empty id (L12)' });
  }

  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the fill carries no project scope (L12/L15)' });
  } else if (!isProjectId(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the project scope must be a non-empty id (L12/L15)' });
  }

  // Coherence: the fill's lineage binds the same intent it names.
  if (isExecutionLineage(value.lineage) && isNonEmptyString(value.intentRef) && value.lineage.intentRef !== value.intentRef) {
    errors.push({
      code: 'lineage_gap',
      path: `${path}.intentRef`,
      message: `the fill names intent "${value.intentRef}" but its lineage binds "${value.lineage.intentRef}" — incoherent lineage is a lineage gap (L9)`,
    });
  }
  if (isExecutionLineage(value.lineage) && isNonEmptyString(value.decisionId) && isNonEmptyString(value.lineage.tenant)) {
    if (value.tenant !== undefined && value.tenant !== value.lineage.tenant) {
      errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the fill\'s tenant scope must match its lineage\'s (L12)' });
    }
    if (value.project !== undefined && value.project !== value.lineage.project) {
      errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the fill\'s project scope must match its lineage\'s (L12/L15)' });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (!isSimulatedFill(value)) {
    return {
      ok: false,
      errors: [{ code: 'invalid_type', path, message: `${path} failed the structural simulated-fill guard` }],
    };
  }
  return ok(deepFreeze(value));
}

/** The L9 anchor: the canonical JSON of a validated simulation spec. */
export function canonicalSimulationSpecJson(spec: ExecutionSimulationSpec): string {
  return canonicalJson(simulationSpecContentTree(spec));
}
