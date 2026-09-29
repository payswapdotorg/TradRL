/**
 * @tradrl/market-world (generative service) — the GenerativeWorldConfig:
 * the MODE-HONEST declaration of one generative/counterfactual world
 * (work order T028).
 *
 * L5 (ARCHITECTURE-LOCK: "replay, reactive replay and counterfactual/
 * generative simulation are distinct"): the config declares
 * `mode: 'generative'` as a LITERAL TYPE — a config claiming any other
 * mode does not validate, and a claim of `'exact_replay'` OR
 * `'reactive_replay'` fails with the dedicated `fidelity_claim_dishonest`
 * error (this world GENERATES its entire market from declared processes;
 * claiming either recorded fidelity would be a lie about what the run
 * is). The embedded exchange physics config is held to the same standard
 * (the modes must agree — the mirrored T010 law).
 *
 * WHAT THE CONFIG FULLY DETERMINES (L9 — the generative lane's analog of
 * "recorded stream + seed + script + physics + clock"): the seed, the
 * POPULATION spec (the declared initial book, the candidate organization,
 * the participant cohorts with their behavior-policy refs), the
 * STOCHASTIC-PROCESS declarations (versioned, seeded, cadenced — the
 * complete data-generation declaration: there IS no recorded stream), the
 * exchange physics (venue grids, fees, latency, slippage, impact), the
 * physics lineage refs bound into every fill, the temporal horizon, the
 * declared interleaving policy, and the tenant / project scope (L12 —
 * every derived record inherits it). Same config + same candidate action
 * script -> byte-identical world evolution (the fixtures prove it twice).
 *
 * THE INTERLEAVING POLICY (the deterministic order law): the closed
 * vocabulary below declares how the generated context events, the
 * generated population actions, and driver-submitted actions are ordered
 * — the order IS part of the deterministic function. It mirrors the
 * reactive lane's (T027) policy exactly, with the generative analog of
 * the recorded stream: the processes' generated market context.
 */

import { canonicalJson, deepFreeze, isFiniteNumber, isNonEmptyString, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type GenerativeError, type GenerativeResult } from './errors';
import { isTimestampMs, type ProjectId, type Seed, type TenantId, type TimestampMs } from './ids';
import type { ExchangePhysicsMirror } from './exchange-mirror';
import { validateExchangePhysics } from './exchange-mirror';
import type { ProcessDeclaration } from './process';
import { BEHAVIOR_KINDS, isProcessKind, validateProcessDeclaration } from './process';
import type { PopulationSpec } from './population';
import { cohortInstances, validatePopulationSpec } from './population';

// ---------------------------------------------------------------------------
// The declared interleaving policy (deterministic, explicit, closed)
// ---------------------------------------------------------------------------

/**
 * The declared interleaving of the generated context events, the
 * generated population actions, and driver-submitted actions — the Work
 * Order's "declared interleaving policy (how the process/population/
 * action ordering works — deterministic, explicit)".
 *
 * The world advances through BOUNDARIES (the next due process step
 * instant, or the advance target); each `advance` call processes exactly
 * ONE boundary. Within a boundary, the policy orders the context-event
 * emission against the population's order submissions; across
 * boundaries, the policy gates driver submits:
 *
 * - `processes_first` — at a shared instant the processes' generated
 *   context events (the walk's quotes) are logged BEFORE the population's
 *   generated intents are submitted to the engine, and a driver submit
 *   requires the world SETTLED (no due process step at or before `now` —
 *   the candidate acts only after the generated market at its instant
 *   has fully evolved). A submit while a process step is due is the
 *   typed `interleaving_violation` (acting mid-process-step).
 * - `population_first` — at a shared instant the population's generated
 *   intents are submitted BEFORE the boundary's context events are
 *   logged (the population moves on the prior information set — a
 *   stricter stress posture, mirroring the reactive lane's
 *   `actions_first`); driver submits require settled state, exactly as
 *   `processes_first`.
 * - `unrestricted` — driver submits are legal at ANY rest point (the
 *   actor declares it may act on a lagging view; the due-process count
 *   is always reported); at a shared instant the context events log
 *   first (the `processes_first` tie-break).
 */
export type InterleavingPolicy = {
  readonly kind: 'processes_first' | 'population_first' | 'unrestricted';
};

/** Runtime-checkable list of interleaving kinds. */
export const INTERLEAVING_KINDS: readonly string[] = ['processes_first', 'population_first', 'unrestricted'];

/** Runtime guard for an interleaving policy. */
export function isInterleavingPolicy(value: unknown): value is InterleavingPolicy {
  if (!isRecord(value)) return false;
  return typeof value.kind === 'string' && INTERLEAVING_KINDS.includes(value.kind);
}

/** Does the policy require the world settled before a driver submit? (the strict policies) */
export function policyRequiresSettled(policy: InterleavingPolicy): boolean {
  return policy.kind === 'processes_first' || policy.kind === 'population_first';
}

// ---------------------------------------------------------------------------
// The physics lineage refs (bound into every fill — the L6/L9 discipline)
// ---------------------------------------------------------------------------

/**
 * The versioned physics-policy references bound into EVERY engine-driven
 * fill record (the full physics lineage): the fee, latency, slippage and
 * impact policy refs, plus the engine config hash itself. A fill without
 * these refs fails its guard (`physics_lineage_missing`).
 */
export interface PhysicsRefs {
  readonly fee_policy: string;
  readonly latency_policy: string;
  readonly slippage_policy: string;
  readonly impact_policy: string;
}

/** Runtime guard for the physics refs block. */
export function isPhysicsRefs(value: unknown): value is PhysicsRefs {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.fee_policy) && isNonEmptyString(value.latency_policy) && isNonEmptyString(value.slippage_policy) && isNonEmptyString(value.impact_policy);
}

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

/**
 * The fully-determining generative world configuration (L9 + L5 + L12):
 *
 * - `world_id` — the identity episode specs bind to (`world_binding_mismatch` otherwise).
 * - `mode` — ALWAYS `'generative'` (the literal type); any other claim is
 *   a typed `fidelity_claim_dishonest` error (L5: the THIRD distinct
 *   fidelity class, never conflated).
 * - `information_policy` — `'point-in-time'` (the boundary is the law, L4).
 * - `tenant` / `project` — the L12 scope every derived record carries.
 * - `seed` — the world-level opaque deterministic seed, hashed into the
 *   config digest (per-process seeds live in the declarations).
 * - `horizon` — the temporal bound: no episode clock may anchor its
 *   `asOf` beyond it (the generative analog of the replay lane's `as_of`
 *   anchor — a declared bound, not a recorded one).
 * - `population` — the declared market population (initial book +
 *   candidate + cohorts with behavior-policy refs).
 * - `processes` — the declared stochastic processes (versioned, seeded,
 *   cadenced): exactly ONE `reference_price_walk` (the anchor) plus the
 *   behavior policies the cohorts bind.
 * - `exchange` — the exchange-sim physics configuration (structural
 *   mirror; the REAL engine validates it again at `createEngine`).
 * - `physics_refs` — the physics lineage refs bound into every fill.
 * - `interleaving` — the declared process/population/action ordering policy.
 * - `playback_speed` — positive finite multiplier (default 1).
 */
export interface GenerativeWorldConfig {
  readonly world_id: string;
  readonly mode: 'generative';
  readonly information_policy: 'point-in-time';
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly seed: Seed;
  readonly horizon: TimestampMs;
  readonly population: PopulationSpec;
  readonly processes: readonly ProcessDeclaration[];
  readonly exchange: ExchangePhysicsMirror;
  readonly physics_refs: PhysicsRefs;
  readonly interleaving: InterleavingPolicy;
  readonly playback_speed: number;
}

/**
 * Collect-all validation of an untrusted generative world config. Enforces
 * the L5 mode honesty (the literal `'generative'`; an `'exact_replay'` or
 * `'reactive_replay'` claim fails `fidelity_claim_dishonest` — this world
 * GENERATES its market and must never claim any recorded fidelity), the
 * process-declaration laws (unique ids, exactly one reference walk, every
 * cohort policy bound to a declared behavior process and vice versa), the
 * population laws (grid-coherent initial book, disjoint candidate), the
 * embargo/cadence coherence (every quote's availability lag is shorter
 * than the fastest process cadence — the L4-honest context law of
 * process.ts), the physics validation (mirrored T010 rules, mode
 * agreement included) and the L12 tenant/project presence. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateGenerativeWorldConfig(value: unknown, path = 'config'): GenerativeResult<GenerativeWorldConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: GenerativeError[] = [];

  if (value.world_id === undefined) {
    errors.push(missingField(`${path}.world_id`));
  } else if (!isNonEmptyString(value.world_id)) {
    errors.push(invalidField(`${path}.world_id`, 'must be a non-empty string'));
  }

  // L5 — the mode honesty. The type is the literal 'generative'; any other
  // claim is dishonest about what this world does (it GENERATES).
  if (value.mode === undefined) {
    errors.push(missingField(`${path}.mode`));
  } else if (value.mode !== 'generative') {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.mode`,
      message: `a generative world declares mode 'generative' — claiming '${String(value.mode)}' is dishonest (L5: exact != reactive != generative; this world GENERATES its entire market from declared processes, so it can never claim exact- or reactive-replay fidelity)`,
    });
  }

  if (value.information_policy === undefined) {
    errors.push(missingField(`${path}.information_policy`));
  } else if (value.information_policy !== 'point-in-time') {
    errors.push(invalidField(`${path}.information_policy`, "must be 'point-in-time'"));
  }

  // L12 — the tenant/project scope (every derived record inherits it).
  if (value.tenant === undefined) {
    errors.push(missingField(`${path}.tenant`));
  } else if (!isNonEmptyString(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12 — tenant isolation)'));
  }
  if (value.project === undefined) {
    errors.push(missingField(`${path}.project`));
  } else if (!isNonEmptyString(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15 — project continuity)'));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.horizon === undefined) {
    errors.push(missingField(`${path}.horizon`));
  } else if (!isTimestampMs(value.horizon)) {
    errors.push(invalidField(`${path}.horizon`, 'must be a valid epoch-millisecond timestamp — the declared temporal bound no episode clock may anchor beyond'));
  }

  let exchange: ExchangePhysicsMirror | undefined;
  if (value.exchange === undefined) {
    errors.push(missingField(`${path}.exchange`));
  } else {
    const physicsResult = validateExchangePhysics(value.exchange, `${path}.exchange`);
    if (physicsResult.ok) {
      exchange = physicsResult.value;
    } else {
      errors.push(...physicsResult.errors);
    }
  }

  // The process declarations (validated WITH the physics for grid coherence).
  let processes: readonly ProcessDeclaration[] | undefined;
  if (value.processes === undefined) {
    errors.push(missingField(`${path}.processes`));
  } else if (!Array.isArray(value.processes)) {
    errors.push(invalidField(`${path}.processes`, 'must be an array of declared stochastic processes (versioned, seeded, cadenced)'));
  } else {
    const declared: ProcessDeclaration[] = [];
    const seenIds = new Set<string>();
    let walks = 0;
    const list = value.processes as readonly unknown[];
    for (let index = 0; index < list.length; index++) {
      const physicsForValidation = exchange;
      const result = validateProcessDeclaration(list[index], `${path}.processes[${index}]`, physicsForValidation);
      if (!result.ok) {
        errors.push(...result.errors);
        continue;
      }
      const declaration = result.value;
      if (seenIds.has(declaration.process_id)) {
        errors.push({
          code: 'duplicate_process',
          path: `${path}.processes[${index}].process_id`,
          message: `duplicate process id "${declaration.process_id}" — one declaration per generative channel`,
        });
        continue;
      }
      seenIds.add(declaration.process_id);
      if (declaration.kind === 'reference_price_walk') walks += 1;
      declared.push(declaration);
    }
    if (walks !== 1) {
      errors.push({
        code: 'process_undeclared',
        path: `${path}.processes`,
        message: `exactly one 'reference_price_walk' process is required (found ${walks}) — the population's policies price off the declared anchor process; a world without an anchor has no coherent price discovery`,
      });
    }
    if (declared.length > 0) {
      processes = declared;
    }
  }

  // The population spec (validated WITH the physics for grid coherence).
  let population: PopulationSpec | undefined;
  if (value.population === undefined) {
    errors.push(missingField(`${path}.population`));
  } else {
    const populationResult = validatePopulationSpec(value.population, `${path}.population`, exchange);
    if (populationResult.ok) {
      population = populationResult.value;
    } else {
      errors.push(...populationResult.errors);
    }
  }

  if (value.physics_refs === undefined) {
    errors.push(missingField(`${path}.physics_refs`));
  } else if (!isPhysicsRefs(value.physics_refs)) {
    errors.push(invalidField(`${path}.physics_refs`, 'must carry non-empty fee/latency/slippage/impact policy refs — the physics lineage every fill binds (L6/L9)'));
  }

  if (value.interleaving === undefined) {
    errors.push(missingField(`${path}.interleaving`));
  } else if (!isInterleavingPolicy(value.interleaving)) {
    errors.push(invalidField(`${path}.interleaving`, `must be { kind: ${INTERLEAVING_KINDS.join(' | ')} } — the declared process/population/action ordering`));
  }

  const playbackSpeed = value.playback_speed === undefined ? 1 : value.playback_speed;
  if (!isFiniteNumber(playbackSpeed) || playbackSpeed <= 0) {
    errors.push(invalidField(`${path}.playback_speed`, `must be a positive finite number, got ${String(playbackSpeed)}`));
  }

  if (errors.length > 0) return { ok: false, errors };

  const physics = exchange as ExchangePhysicsMirror;
  const declaredProcesses = processes as readonly ProcessDeclaration[];
  const validPopulation = population as PopulationSpec;

  // Coherence (L5): the physics fidelity must equal the world mode.
  if (physics.fidelity !== 'generative') {
    return {
      ok: false,
      errors: [
        {
          code: 'fidelity_claim_dishonest',
          path: `${path}.exchange.fidelity`,
          message: `the generative world serves mode 'generative' but the exchange physics declare '${physics.fidelity}' — the modes must agree (L5: never conflated)`,
        },
      ],
    };
  }

  // Coherence: every cohort's policy ref resolves to a declared BEHAVIOR
  // process; every behavior process is bound by exactly one cohort (no
  // orphan policies, no double-bound policies — the lineage stays sharp).
  const byId = new Map<string, ProcessDeclaration>();
  for (const declaration of declaredProcesses) byId.set(declaration.process_id, declaration);
  const bound = new Set<string>();
  for (const cohort of validPopulation.cohorts) {
    const policy = byId.get(cohort.policy);
    if (policy === undefined) {
      return {
        ok: false,
        errors: [
          {
            code: 'process_undeclared',
            path: `${path}.population.cohorts`,
            message: `cohort "${cohort.cohort_id}" binds behavior policy ref "${cohort.policy}" which no declared process carries — every generated action must trace to a DECLARED process (ambient participants are the thing this lane exists to forbid)`,
          },
        ],
      };
    }
    if (!isProcessKind(policy.kind) || !(BEHAVIOR_KINDS as readonly string[]).includes(policy.kind)) {
      return {
        ok: false,
        errors: [
          {
            code: 'process_undeclared',
            path: `${path}.population.cohorts`,
            message: `cohort "${cohort.cohort_id}" binds process "${cohort.policy}" of kind '${policy.kind}' — cohorts bind BEHAVIOR policies (${BEHAVIOR_KINDS.join(' | ')}), never the world's anchor walk`,
          },
        ],
      };
    }
    bound.add(cohort.policy);
  }
  for (const declaration of declaredProcesses) {
    const isBehavior = (BEHAVIOR_KINDS as readonly string[]).includes(declaration.kind);
    if (isBehavior && !bound.has(declaration.process_id)) {
      return {
        ok: false,
        errors: [
          {
            code: 'process_undeclared',
            path: `${path}.processes`,
            message: `behavior process "${declaration.process_id}" (kind '${declaration.kind}') is declared but bound by no cohort — every declared policy must generate for a declared population (dead declarations muddy the lineage)`,
          },
        ],
      };
    }
  }

  // Coherence (the L4-honest context law of process.ts): every walk
  // quote's availability embargo must be shorter than the FASTEST process
  // cadence, so a policy stepping at any boundary can never see the quote
  // emitted at that same boundary (the anchor it reads is always the last
  // AVAILABLE one). The generator obeys the boundary by construction.
  const walk = declaredProcesses.find((declaration) => declaration.kind === 'reference_price_walk');
  if (walk !== undefined) {
    const embargo = walk.params.embargo_ms as number;
    const fastest = Math.min(...declaredProcesses.map((declaration) => declaration.step_ms));
    if (embargo >= fastest) {
      return {
        ok: false,
        errors: [
          invalidField(
            `${path}.processes`,
            `the reference walk's embargo_ms (${embargo}) must be shorter than the fastest process cadence (${fastest}ms) — otherwise a policy could step at a boundary where its own boundary's quote is the only 'available' anchor, breaking the L4-honest context law`,
          ),
        ],
      };
    }
  }

  // Coherence: every generated participant id must be unique across
  // cohorts (cohort ids are unique; the derivation `pop-<cohort>-<n>`
  // is therefore injective — checked defensively for the frozen record).
  const instanceSeen = new Set<string>();
  for (const cohort of validPopulation.cohorts) {
    for (const instance of cohortInstances(cohort)) {
      if (instanceSeen.has(instance)) {
        return {
          ok: false,
          errors: [invalidField(`${path}.population.cohorts`, `generated participant id "${instance}" collides across cohorts — impossible with unique cohort ids (tampered derivation)`)],
        };
      }
      instanceSeen.add(instance);
    }
  }

  return ok(
    deepFreeze({
      world_id: value.world_id as string,
      mode: 'generative' as const,
      information_policy: 'point-in-time' as const,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      seed: value.seed as Seed,
      horizon: value.horizon as TimestampMs,
      population: validPopulation,
      processes: declaredProcesses.map((declaration) => declaration),
      exchange: physics,
      physics_refs: deepFreeze({ ...(value.physics_refs as PhysicsRefs) }),
      interleaving: deepFreeze({ kind: (value.interleaving as InterleavingPolicy).kind }),
      playback_speed: playbackSpeed as number,
    }),
  );
}

// ---------------------------------------------------------------------------
// Canonical serialization + the config digest (L9)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of a validated config — the lineage anchor: equal configs
 * produce byte-identical bytes regardless of field order at construction
 * (L9). The tree is built field-by-field (no casts) so the compiler
 * proves JSON-safety. THE GENERATIVE NOTE: the processes and the
 * population are serialized IN DECLARATION ORDER — the order is part of
 * the deterministic function (the armed order, the firing order).
 */
export function canonicalConfigJson(config: GenerativeWorldConfig): string {
  const tree: JsonValue = {
    world_id: config.world_id,
    mode: config.mode,
    information_policy: config.information_policy,
    tenant: config.tenant,
    project: config.project,
    seed: config.seed,
    horizon: config.horizon,
    population: {
      initial_book: {
        bids: config.population.initial_book.bids.map((level) => ({ price: level.price, size: level.size })),
        asks: config.population.initial_book.asks.map((level) => ({ price: level.price, size: level.size })),
      },
      candidate: { instance: config.population.candidate.instance },
      cohorts: config.population.cohorts.map((cohort) => ({ cohort_id: cohort.cohort_id, label: cohort.label, policy: cohort.policy, size: cohort.size })),
    },
    processes: config.processes.map((declaration) => ({
      process_id: declaration.process_id,
      version: declaration.version,
      kind: declaration.kind,
      seed: declaration.seed,
      step_ms: declaration.step_ms,
      params: declaration.params,
    })),
    exchange: {
      venue: config.exchange.venue,
      instrument: config.exchange.instrument,
      asset_class: config.exchange.asset_class,
      tick_size: config.exchange.tick_size,
      lot_size: config.exchange.lot_size,
      max_book_depth: config.exchange.max_book_depth,
      seed: config.exchange.seed,
      fidelity: config.exchange.fidelity,
      fees: {
        tiers: config.exchange.fees.tiers.map((tier) => ({ up_to_notional: tier.up_to_notional, maker_bps: tier.maker_bps, taker_bps: tier.taker_bps })),
        fee_decimals: config.exchange.fees.fee_decimals,
      },
      latency: config.exchange.latency.kind === 'fixed'
        ? { kind: 'fixed', fixed_ms: config.exchange.latency.fixed_ms }
        : { kind: 'uniform', min_ms: config.exchange.latency.min_ms, max_ms: config.exchange.latency.max_ms },
      slippage: config.exchange.slippage.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: config.exchange.slippage.bps },
      impact: { kind: config.exchange.impact.kind, declaration: config.exchange.impact.declaration, limitation: config.exchange.impact.limitation },
    },
    physics_refs: {
      fee_policy: config.physics_refs.fee_policy,
      latency_policy: config.physics_refs.latency_policy,
      slippage_policy: config.physics_refs.slippage_policy,
      impact_policy: config.physics_refs.impact_policy,
    },
    interleaving: { kind: config.interleaving.kind },
    playback_speed: config.playback_speed,
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of a generative world config: FNV-1a 32-bit of
 * the canonical config JSON. Bound into every run record (L9) and seeding
 * the generation chain. THE GENERATIVE DIFFERENCE: because there is no
 * recorded stream, the config digest alone binds the ENTIRE data
 * declaration (the run id derives from it — see ids.ts).
 */
export function configHash(config: GenerativeWorldConfig): string {
  return fnv1a32HexOf(canonicalConfigJson(config));
}

/** Local alias so the digest derivation stays single-sourced. */
import { fnv1a32Hex as fnv1a32HexOf } from './primitives';
