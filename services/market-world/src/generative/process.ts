/**
 * @tradrl/market-world (generative service) — the DECLARED STOCHASTIC
 * PROCESSES (work order T028): the generative core.
 *
 * THE GENERATIVE DIFFERENCE (the existential law): there IS no recorded
 * stream — "market populations (participant cohorts with declared
 * behavior policies: market makers, momentum takers, mean-reverters,
 * noise traders) are GENERATED from declared seeded stochastic processes
 * (the process declarations are versioned records — never ambient
 * randomness); every generated event carries its process lineage (process
 * ref, seed, step)". This module owns that vocabulary:
 *
 *   - {@link ProcessDeclaration} — the VERSIONED, SEEDED, CADENCED record
 *     that fully determines one stochastic process (kind + parameters).
 *     Nothing here is ambient: no wall clock, no Math.random — the ONLY
 *     randomness is the seeded xorshift32 state carried in the
 *     serializable {@link ProcessRuntimeState} (so a resumed process
 *     draws the IDENTICAL future sequence — the resume law's hard part).
 *   - {@link PROCESS_KINDS} — the closed vocabulary:
 *       * `reference_price_walk` — the world process: a seeded random
 *         walk over the anchor price emitting generated `market_quote`
 *         events under a declared availability embargo (L4 exercised at
 *         the generation seam itself).
 *       * `market_maker` — two-sided gtt quotes around the L4-honest
 *         anchor, self-expiring at the next re-quote instant (the
 *         engine's own gtt physics rotates the book — no synthetic
 *         cancel plumbing).
 *       * `momentum_taker` — takes with the anchor's trend over its own
 *         sampling period, size drawn from the seed.
 *       * `mean_reverter` — fades book-vs-anchor deviations, firing only
 *         when a side deviates past the declared threshold.
 *       * `noise_trader` — random side/offset limit orders (seeded),
 *         self-expiring like the maker quotes.
 *   - {@link stepProcess} — the PURE step transition: (declaration,
 *     state, context) -> (emissions, state'). The context is L4-HONEST BY
 *     CONSTRUCTION: the anchor it exposes is the price of the last walk
 *     quote whose availability instant has passed (the walk's PRE-step
 *     price at a boundary where it steps), so a policy stepping at `t`
 *     can never see the embargoed quote emitted at `t` — the information
 *     boundary enforced at the generator, before any observation gate.
 *
 * THE L6 BOUNDARY (endogenous reaction composed AROUND the engine): the
 * policies EMIT ORDER INTENTS; the MatchingEngine (T010, injected) owns
 * matching, fees, latency, slippage. Nothing here prices a fill.
 *
 * DETERMINISM (L9): same (declarations, seeds, cadences, context
 * sequence) -> byte-identical emissions and terminal states — the golden
 * fixture proves it twice, and the serializable runtime states make the
 * determinism SURVIVE a resume mid-stream.
 */

import { canonicalJson, deepFreeze, drawUnit, isJsonObject, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord, renderScaledDecimal, seededState, shiftPriceByTicks } from './primitives';
import { parseCanonicalDecimal } from './primitives';
import { fnv1a32Hex } from './primitives';
import type { JsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type GenerativeError, type GenerativeResult } from './errors';
import { isTimestampMs, type TimestampMs } from './ids';
import type { BookTopView, ExchangePhysicsMirror } from './exchange-mirror';
import { isCanonicalPositiveDecimal } from './exchange-mirror';

// ---------------------------------------------------------------------------
// The process vocabulary (closed — the declared behavior-policy kinds)
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of declared stochastic processes:
 * - `reference_price_walk` — the WORLD process (exactly one per config):
 *   the seeded anchor-price walk emitting generated quote events.
 * - `market_maker` / `momentum_taker` / `mean_reverter` / `noise_trader` —
 *   the POPULATION behavior policies (cohorts bind these): each emits
 *   order intents for its participants every step.
 */
export type ProcessKind = 'reference_price_walk' | 'market_maker' | 'momentum_taker' | 'mean_reverter' | 'noise_trader';

/** Runtime-checkable list of process kinds. */
export const PROCESS_KINDS: readonly ProcessKind[] = ['reference_price_walk', 'market_maker', 'momentum_taker', 'mean_reverter', 'noise_trader'];

/** Runtime guard for a process kind. */
export function isProcessKind(value: unknown): value is ProcessKind {
  return typeof value === 'string' && (PROCESS_KINDS as readonly string[]).includes(value);
}

/** The behavior-policy kinds (the population processes a cohort may bind). */
export const BEHAVIOR_KINDS: readonly ProcessKind[] = ['market_maker', 'momentum_taker', 'mean_reverter', 'noise_trader'];

/** Is the kind a behavior policy (bound by a cohort)? */
export function isBehaviorKind(kind: ProcessKind): boolean {
  return (BEHAVIOR_KINDS as readonly string[]).includes(kind);
}

// ---------------------------------------------------------------------------
// The process declaration (versioned, seeded, cadenced — never ambient)
// ---------------------------------------------------------------------------

/**
 * One declared stochastic process: the versioned record that fully
 * determines a generative channel. The `version` participates in the
 * canonical serialization (a parameterization change is a NEW record —
 * lineage never mutates in place, L3's discipline applied to process
 * declarations); the `seed` derives every draw; the `step_ms` cadence
 * fixes the firing instants; the `params` carry the kind's declared
 * parameters (validated per kind, unknown keys rejected — a declaration
 * is closed, never a bag).
 */
export interface ProcessDeclaration {
  readonly process_id: string;
  readonly version: string;
  readonly kind: ProcessKind;
  readonly seed: string;
  readonly step_ms: number;
  readonly params: { readonly [key: string]: JsonValue };
}

/** The instance label of the (single) world process of a config. */
export const WORLD_PROCESS_INSTANCE = 'world';

/** The per-kind parameter keys (unknown keys fail validation — closed records). */
const PARAM_KEYS: ReadonlyMap<ProcessKind, readonly string[]> = new Map<ProcessKind, readonly string[]>([
  ['reference_price_walk', ['start_price', 'step_ticks', 'embargo_ms']],
  ['market_maker', ['half_spread_ticks', 'extra_spread_ticks', 'quantity']],
  ['momentum_taker', ['quantity', 'threshold_ticks', 'max_size_mult']],
  ['mean_reverter', ['quantity', 'threshold_ticks', 'max_size_mult']],
  ['noise_trader', ['quantity', 'max_offset_ticks']],
]);

/**
 * Collect-all validation of an untrusted process declaration. Structural
 * laws: non-empty ids/version/seed, a known kind, a positive safe-integer
 * cadence, and the kind's CLOSED parameter set (unknown keys fail — the
 * canonical serialization must cover every declared field or the lineage
 * digest would lie by omission). When `physics` is supplied (the config's
 * coherence pass), grid laws apply: the walk's start price is tick-aligned
 * and every policy quantity is lot-aligned (the REAL engine re-validates
 * everything it receives — this keeps the GENERATOR honest up front).
 */
export function validateProcessDeclaration(value: unknown, path = 'process', physics?: ExchangePhysicsMirror): GenerativeResult<ProcessDeclaration> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: GenerativeError[] = [];

  if (value.process_id === undefined) {
    errors.push(missingField(`${path}.process_id`));
  } else if (!isNonEmptyString(value.process_id)) {
    errors.push(invalidField(`${path}.process_id`, 'must be a non-empty string'));
  }

  if (value.version === undefined) {
    errors.push(missingField(`${path}.version`));
  } else if (!isNonEmptyString(value.version)) {
    errors.push(invalidField(`${path}.version`, 'must be a non-empty string — process declarations are VERSIONED records (L9 lineage)'));
  }

  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (!isProcessKind(value.kind)) {
    errors.push(invalidField(`${path}.kind`, `must be one of ${PROCESS_KINDS.join(' | ')}`));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string — the declared seed derives every draw (never ambient randomness)'));
  }

  if (value.step_ms === undefined) {
    errors.push(missingField(`${path}.step_ms`));
  } else if (!isPositiveSafeInteger(value.step_ms)) {
    errors.push(invalidField(`${path}.step_ms`, 'must be a positive safe integer — the declared cadence fixes every firing instant'));
  }

  let kind: ProcessKind | undefined;
  if (isProcessKind(value.kind)) {
    kind = value.kind;
    const allowed = PARAM_KEYS.get(kind) as readonly string[];
    if (value.params === undefined) {
      errors.push(missingField(`${path}.params`));
    } else if (!isJsonObject(value.params)) {
      errors.push(invalidField(`${path}.params`, 'must be an object of the kind\u2019s declared parameters'));
    } else {
      const params = value.params as { readonly [key: string]: JsonValue };
      for (const key of Object.keys(params)) {
        if (!allowed.includes(key)) {
          errors.push(invalidField(`${path}.params.${key}`, `unknown parameter for kind '${kind}' (allowed: ${allowed.join(' | ')}) — declarations are closed records`));
        }
      }
      errors.push(...validateParamsOf(kind, params, `${path}.params`, physics));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      process_id: value.process_id as string,
      version: value.version as string,
      kind: kind as ProcessKind,
      seed: value.seed as string,
      step_ms: value.step_ms as number,
      params: deepFreeze({ ...(value.params as { readonly [key: string]: JsonValue }) }),
    }),
  );
}

/** Per-kind parameter validation (the closed records' field laws). */
function validateParamsOf(kind: ProcessKind, params: { readonly [key: string]: JsonValue }, path: string, physics?: ExchangePhysicsMirror): GenerativeError[] {
  const errors: GenerativeError[] = [];
  const requirePositiveInt = (key: string): void => {
    const value = params[key];
    if (value === undefined) {
      errors.push(missingField(`${path}.${key}`));
    } else if (!isPositiveSafeInteger(value)) {
      errors.push(invalidField(`${path}.${key}`, 'must be a positive safe integer'));
    }
  };
  const requireNonNegativeInt = (key: string): void => {
    const value = params[key];
    if (value === undefined) {
      errors.push(missingField(`${path}.${key}`));
    } else if (!isNonNegativeSafeInteger(value)) {
      errors.push(invalidField(`${path}.${key}`, 'must be a non-negative safe integer'));
    }
  };
  const requireQuantity = (key: string): void => {
    const value = params[key];
    if (value === undefined) {
      errors.push(missingField(`${path}.${key}`));
    } else if (!isCanonicalPositiveDecimal(value)) {
      errors.push(invalidField(`${path}.${key}`, 'must be a canonical decimal string greater than zero (e.g. "0.5")'));
    } else if (physics !== undefined && !isLotAligned(value, physics)) {
      errors.push(invalidField(`${path}.${key}`, `"${String(value)}" is not aligned to the venue lot grid ${physics.lot_size} — the engine would reject every emitted order (grid coherence)`));
    }
  };

  if (kind === 'reference_price_walk') {
    const start = params.start_price;
    if (start === undefined) {
      errors.push(missingField(`${path}.start_price`));
    } else if (!isCanonicalPositiveDecimal(start)) {
      errors.push(invalidField(`${path}.start_price`, 'must be a canonical decimal string greater than zero'));
    } else if (physics !== undefined && !isTickAligned(start, physics)) {
      errors.push(invalidField(`${path}.start_price`, `"${String(start)}" is not aligned to the venue tick grid ${physics.tick_size} — every walked price would be off-grid (grid coherence)`));
    }
    requirePositiveInt('step_ticks');
    requireNonNegativeInt('embargo_ms');
  } else if (kind === 'market_maker') {
    requirePositiveInt('half_spread_ticks');
    requireNonNegativeInt('extra_spread_ticks');
    requireQuantity('quantity');
  } else if (kind === 'momentum_taker') {
    requireQuantity('quantity');
    requirePositiveInt('threshold_ticks');
    requirePositiveInt('max_size_mult');
  } else if (kind === 'mean_reverter') {
    requireQuantity('quantity');
    requirePositiveInt('threshold_ticks');
    requirePositiveInt('max_size_mult');
  } else {
    requireQuantity('quantity');
    requirePositiveInt('max_offset_ticks');
  }
  return errors;
}

/** Grid coherence helpers (the venue-grid mirror of exchange-sim's law). */
function isTickAligned(price: string, physics: ExchangePhysicsMirror): boolean {
  return gridRemainder(price, physics.tick_size) === 0;
}

function isLotAligned(quantity: string, physics: ExchangePhysicsMirror): boolean {
  return gridRemainder(quantity, physics.lot_size) === 0;
}

/** The integer remainder of `value / step` at the decimals' common scale (NaN on malformed input). */
function gridRemainder(value: string, step: string): number {
  const scaledValue = parseCanonicalDecimal(value);
  const scaledStep = parseCanonicalDecimal(step);
  if (scaledValue === null || scaledStep === null || scaledStep.int === 0) return Number.NaN;
  const scale = Math.max(scaledValue.scale, scaledStep.scale);
  const lift = (candidate: { readonly int: number; readonly scale: number }): number => {
    let int = candidate.int;
    for (let index = candidate.scale; index < scale; index++) int *= 10;
    return int;
  };
  const liftedValue = lift(scaledValue);
  const liftedStep = lift(scaledStep);
  return liftedValue % liftedStep;
}

// ---------------------------------------------------------------------------
// Canonical serialization + digests (L9)
// ---------------------------------------------------------------------------

/** Canonical JSON of a validated declaration — the lineage anchor (equal declarations, byte-identical). */
export function canonicalProcessJson(declaration: ProcessDeclaration): string {
  const tree: JsonValue = {
    process_id: declaration.process_id,
    version: declaration.version,
    kind: declaration.kind,
    seed: declaration.seed,
    step_ms: declaration.step_ms,
    params: declaration.params,
  };
  return canonicalJson(tree);
}

/** The deterministic digest of a declaration (FNV-1a over the canonical JSON). */
export function processHash(declaration: ProcessDeclaration): string {
  return fnv1a32Hex(canonicalProcessJson(declaration));
}

// ---------------------------------------------------------------------------
// The process runtime state (serializable — the resume currency)
// ---------------------------------------------------------------------------

/**
 * The serializable runtime state of ONE process instance (the world
 * process, or one participant of a behavior-policy cohort). THE RESUME
 * LAW'S HARD PART: the `rng` field IS the process's entire randomness —
 * restoring it restores the identical future draw sequence, so
 * serialize -> parse -> resume continues a stochastic process
 * mid-stream deterministically. `price` is the walk's current drawn
 * anchor (the L4-honest available anchor at a boundary is the PRE-step
 * value); `last_anchor` is a momentum policy's last sampled anchor.
 */
export interface ProcessRuntimeState {
  /** The declared process this runtime executes. */
  readonly process: string;
  /** The emitting instance: 'world' for the walk, the participant id for policies. */
  readonly instance: string;
  /** Completed steps (the lineage `step` of every emission). */
  readonly step: number;
  /** The next firing instant (the cadence cursor). */
  readonly next_at: TimestampMs;
  /** The xorshift32 state — the ONLY randomness, carried, never ambient. */
  readonly rng: number;
  /** The walk's current anchor price (null for policy runtimes). */
  readonly price: string | null;
  /** A momentum policy's last sampled anchor (null until its first step). */
  readonly last_anchor: string | null;
}

/** Guard: a runtime state (structure + finite counters). */
export function isProcessRuntimeState(value: unknown): value is ProcessRuntimeState {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.process) || !isNonEmptyString(value.instance)) return false;
  if (!isNonNegativeSafeInteger(value.step)) return false;
  if (!isTimestampMs(value.next_at)) return false;
  if (typeof value.rng !== 'number' || !Number.isSafeInteger(value.rng) || value.rng < 0 || value.rng > 0xffff_ffff) return false;
  if (value.price !== null && !isNonEmptyString(value.price)) return false;
  if (value.last_anchor !== null && !isNonEmptyString(value.last_anchor)) return false;
  return true;
}

/**
 * Arm a process instance at an episode's start instant: the runtime seeds
 * the xorshift32 state from the DECLARED seed (namespaced by the emitting
 * instance — every participant of a cohort draws its OWN deterministic
 * sequence), zeroes the step counter, and schedules the first firing one
 * full cadence after the start (the declared initial state — the walk's
 * start price, the population's initial book — governs the opening
 * window).
 */
export function armProcess(declaration: ProcessDeclaration, instance: string, startAt: TimestampMs): ProcessRuntimeState {
  return deepFreeze({
    process: declaration.process_id,
    instance,
    step: 0,
    next_at: (startAt + declaration.step_ms) as TimestampMs,
    rng: seededState(`${declaration.seed}:${instance}`),
    price: declaration.kind === 'reference_price_walk' ? (declaration.params.start_price as string) : null,
    last_anchor: null,
  });
}

/**
 * The deterministic digest of a runtime-state array (L9): FNV-1a over the
 * canonical JSON of the array IN ARMED ORDER (the order is part of the
 * deterministic function). This is the PROCESS STATE HASH the run record
 * binds and the resume path verifies — the stochastic processes must
 * resume mid-stream deterministically, and the hash proves the restored
 * randomness is the recorded randomness.
 */
export function processStateHash(states: readonly ProcessRuntimeState[]): string {
  const tree: JsonValue = states.map((state) => ({
    process: state.process,
    instance: state.instance,
    step: state.step,
    next_at: state.next_at,
    rng: state.rng,
    price: state.price,
    last_anchor: state.last_anchor,
  }));
  return fnv1a32Hex(canonicalJson(tree));
}

// ---------------------------------------------------------------------------
// The step context (L4-honest by construction) + the emissions
// ---------------------------------------------------------------------------

/**
 * The context one process step sees. THE L4 LAW AT THE GENERATOR: the
 * `anchor` is the price of the last walk quote whose availability instant
 * has passed (the walk's PRE-step price when it fires at this boundary) —
 * a policy stepping at `t` can never see the quote emitted at `t` (it is
 * embargoed until `t + embargo_ms`); the `book` is the engine's top of
 * book as of the boundary start. Participants observe ONLY what the
 * firewall admits at the current simulation instant — enforced here,
 * before any observation gate, because the generator itself obeys the
 * boundary.
 */
export interface ProcessStepContext {
  /** The boundary instant this step fires at. */
  readonly now: TimestampMs;
  /** The L4-honest available anchor price (never the embargoed current draw). */
  readonly anchor: string;
  /** The engine's top of book at the boundary start (verbatim levels). */
  readonly book: BookTopView;
}

/** The lineage block every generated event carries (the generative existential law). */
export interface ProcessLineage {
  /** The declared process's id. */
  readonly process: string;
  /** The emitting instance ('world' or the participant id). */
  readonly instance: string;
  /** The declaration's version (L9 — versioned records). */
  readonly version: string;
  /** The declaration's seed (the draw ancestry root). */
  readonly seed: string;
  /** The emitting step ordinal (completed steps before this emission's step, 1-based). */
  readonly step: number;
}

/** Guard: a complete process lineage block. */
export function isProcessLineage(value: unknown): value is ProcessLineage {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.process) && isNonEmptyString(value.instance) && isNonEmptyString(value.version) && isNonEmptyString(value.seed) && isNonNegativeSafeInteger(value.step);
}

/**
 * One emission of a process step: a generated market event (the walk's
 * quote — becomes an observation with synthetic provenance) or a
 * generated population order intent (submitted to the engine with full
 * physics). The `event_id` is the deterministic lineage-derived identity;
 * `available_time` is the L4 input (quotes: at + embargo; intents: at).
 */
export interface ProcessEmission {
  readonly event_id: string;
  readonly kind: 'market_quote' | 'population_intent';
  readonly at: TimestampMs;
  readonly available_time: TimestampMs;
  /** The acting participant (population intents only; null for world events). */
  readonly actor: string | null;
  readonly payload: JsonValue;
  readonly process: ProcessLineage;
}

// ---------------------------------------------------------------------------
// Grid arithmetic helpers (exact, local — see primitives.ts's discipline note)
// ---------------------------------------------------------------------------

/** The signed tick count from `from` to `to` on the venue grid (null when off-grid/malformed). */
export function ticksBetween(from: string, to: string, tickSize: string): number | null {
  const scaledFrom = parseCanonicalDecimal(from);
  const scaledTo = parseCanonicalDecimal(to);
  const scaledTick = parseCanonicalDecimal(tickSize);
  if (scaledFrom === null || scaledTo === null || scaledTick === null || scaledTick.int === 0) return null;
  const scale = Math.max(Math.max(scaledFrom.scale, scaledTo.scale), scaledTick.scale);
  const lift = (candidate: { readonly int: number; readonly scale: number }): number => {
    let int = candidate.int;
    for (let index = candidate.scale; index < scale; index++) int *= 10;
    return int;
  };
  const liftedTick = lift(scaledTick);
  const delta = lift(scaledTo) - lift(scaledFrom);
  if (delta % liftedTick !== 0) return null;
  return delta / liftedTick;
}

/** Multiply a canonical decimal quantity by a positive integer, rendered canonically (lot-aligned stays lot-aligned). */
export function scaleQuantity(quantity: string, multiplier: number): string | null {
  const scaled = parseCanonicalDecimal(quantity);
  if (scaled === null || !isPositiveSafeInteger(multiplier)) return null;
  const product = scaled.int * multiplier;
  if (!Number.isSafeInteger(product)) return null;
  return renderScaledDecimal({ int: product, scale: scaled.scale });
}

// ---------------------------------------------------------------------------
// The pure step transition (THE generative act)
// ---------------------------------------------------------------------------

/** The product of one process step: the emissions plus the successor state. */
export interface ProcessStepOutcome {
  readonly events: readonly ProcessEmission[];
  readonly state: ProcessRuntimeState;
}

/**
 * Step ONE process instance at its firing instant (pure, total, typed).
 * The transition is a pure function of (declaration, state, context) —
 * the same triple always yields byte-identical emissions and successor
 * state, and the successor's `rng` is the only carried randomness.
 */
export function stepProcess(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
): GenerativeResult<ProcessStepOutcome> {
  if (state.process !== declaration.process_id) {
    return { ok: false, errors: [invalidField('process', `the runtime executes process "${state.process}" but the declaration is "${declaration.process_id}" — the armed binding is lineage`)] };
  }
  if ((state.next_at as number) !== (context.now as number)) {
    return { ok: false, errors: [invalidField('process.next_at', `the process fires at its declared cadence instant ${String(state.next_at)}, not at ${String(context.now)} (interleaving_violation by construction)`)] };
  }
  const nextStep = state.step + 1;
  const nextAt = (context.now + declaration.step_ms) as TimestampMs;
  const lineage: ProcessLineage = deepFreeze({
    process: declaration.process_id,
    instance: state.instance,
    version: declaration.version,
    seed: declaration.seed,
    step: nextStep,
  });

  if (declaration.kind === 'reference_price_walk') {
    return stepReferenceWalk(declaration, state, context, physics, lineage, nextStep, nextAt);
  }
  // Behavior policies: the emission's actor is the runtime's instance.
  if (declaration.kind === 'market_maker') {
    return stepMarketMaker(declaration, state, context, physics, lineage, nextStep, nextAt);
  }
  if (declaration.kind === 'momentum_taker') {
    return stepMomentumTaker(declaration, state, context, physics, lineage, nextStep, nextAt);
  }
  if (declaration.kind === 'mean_reverter') {
    return stepMeanReverter(declaration, state, context, physics, lineage, nextStep, nextAt);
  }
  return stepNoiseTrader(declaration, state, context, physics, lineage, nextStep, nextAt);
}

/** The base successor state (policies keep everything but step/next_at/rng). */
function successorOf(state: ProcessRuntimeState, nextStep: number, nextAt: TimestampMs, rng: number, overrides: { readonly price?: string | null; readonly last_anchor?: string | null } = {}): ProcessRuntimeState {
  return deepFreeze({
    process: state.process,
    instance: state.instance,
    step: nextStep,
    next_at: nextAt,
    rng,
    price: overrides.price !== undefined ? overrides.price : state.price,
    last_anchor: overrides.last_anchor !== undefined ? overrides.last_anchor : state.last_anchor,
  });
}

/** The seeded walk: draw a bounded move, emit the (embargoed) quote, carry the new anchor. */
function stepReferenceWalk(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
  lineage: ProcessLineage,
  nextStep: number,
  nextAt: TimestampMs,
): GenerativeResult<ProcessStepOutcome> {
  const stepTicks = declaration.params.step_ticks;
  if (!isPositiveSafeInteger(stepTicks)) {
    return { ok: false, errors: [invalidField('params.step_ticks', 'the walk requires a positive safe integer step_ticks (validated at declaration — tampered state)')] };
  }
  const embargoMs = declaration.params.embargo_ms;
  if (!isNonNegativeSafeInteger(embargoMs)) {
    return { ok: false, errors: [invalidField('params.embargo_ms', 'the walk requires a non-negative safe integer embargo_ms (validated at declaration — tampered state)')] };
  }
  const from = state.price;
  if (from === null) {
    return { ok: false, errors: [invalidField('process.price', 'the walk runtime carries no anchor price (tampered state)')] };
  }
  const draw = drawUnit(state.rng);
  const span = 2 * stepTicks;
  const moveTicks = Math.round(draw.u * span) - stepTicks; // bounded symmetric walk
  const moved = moveTicks === 0 ? from : shiftPriceByTicks(from, moveTicks, physics.tick_size);
  if (moved === null) {
    return { ok: false, errors: [invalidField('params.start_price', 'the walked price left the exact-decimal range (unreachable for realistic grids — kept total)')] };
  }
  const quote: ProcessEmission = deepFreeze({
    event_id: `gev-${declaration.process_id}:${state.instance}:${String(nextStep)}:quote`,
    kind: 'market_quote',
    at: context.now,
    available_time: (context.now + embargoMs) as TimestampMs,
    actor: null,
    payload: deepFreeze({ anchor_price: moved, move_ticks: moveTicks }),
    process: lineage,
  });
  const nextState = successorOf(state, nextStep, nextAt, draw.state, { price: moved });
  return ok(deepFreeze({ events: [quote], state: nextState }));
}

/** Build one population order-intent emission (the engine vocabulary — the service submits it verbatim). */
function intentEmission(
  lineage: ProcessLineage,
  at: TimestampMs,
  actor: string,
  label: string,
  intent: Record<string, JsonValue>,
): ProcessEmission {
  return deepFreeze({
    event_id: `gev-${lineage.process}:${lineage.instance}:${String(lineage.step)}:${label}`,
    kind: 'population_intent' as const,
    at,
    available_time: at,
    actor,
    payload: deepFreeze({ type: 'submit_order', intent: deepFreeze({ ...intent }) }),
    process: lineage,
  });
}

/** The market maker: two-sided gtt quotes around the L4-honest anchor, expiring at the next re-quote. */
function stepMarketMaker(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
  lineage: ProcessLineage,
  nextStep: number,
  nextAt: TimestampMs,
): GenerativeResult<ProcessStepOutcome> {
  const halfSpread = declaration.params.half_spread_ticks;
  const extraSpread = declaration.params.extra_spread_ticks ?? 0;
  const quantity = declaration.params.quantity;
  if (!isPositiveSafeInteger(halfSpread) || !isNonNegativeSafeInteger(extraSpread) || !isCanonicalPositiveDecimal(quantity)) {
    return { ok: false, errors: [invalidField('params', 'the maker requires half_spread_ticks (positive int), extra_spread_ticks (non-negative int) and quantity (canonical decimal) — validated at declaration; tampered state')] };
  }
  const draw = drawUnit(state.rng);
  const spread = halfSpread + Math.floor(draw.u * (extraSpread + 1)); // seeded spread jitter
  const bid = shiftPriceByTicks(context.anchor, -spread, physics.tick_size);
  const ask = shiftPriceByTicks(context.anchor, spread, physics.tick_size);
  if (bid === null || ask === null) {
    return { ok: false, errors: [invalidField('params.quantity', 'the quoted prices left the exact-decimal range (unreachable for realistic grids — kept total)')] };
  }
  const expiresAt = new Date(nextAt).toISOString(); // self-expiring quotes: the engine's gtt physics rotates the book
  const client = (label: string): string => `mm-${lineage.instance}-${label}-${String(nextStep)}`;
  const base: Record<string, JsonValue> = {
    instrumentId: physics.instrument,
    venueId: physics.venue,
    quantity,
    timeInForce: 'gtt',
    expiresAt,
    createdAt: new Date(context.now).toISOString(),
  };
  const events: ProcessEmission[] = [
    intentEmission(lineage, context.now, lineage.instance, 'bid', { ...base, clientOrderId: client('bid'), side: 'buy', kind: 'limit', price: bid }),
    intentEmission(lineage, context.now, lineage.instance, 'ask', { ...base, clientOrderId: client('ask'), side: 'sell', kind: 'limit', price: ask }),
  ];
  return ok(deepFreeze({ events, state: successorOf(state, nextStep, nextAt, draw.state) }));
}

/** The momentum taker: trade with the anchor's trend over the policy's own sampling period, size drawn from the seed. */
function stepMomentumTaker(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
  lineage: ProcessLineage,
  nextStep: number,
  nextAt: TimestampMs,
): GenerativeResult<ProcessStepOutcome> {
  const quantity = declaration.params.quantity;
  const threshold = declaration.params.threshold_ticks;
  const maxSize = declaration.params.max_size_mult;
  if (!isCanonicalPositiveDecimal(quantity) || !isPositiveSafeInteger(threshold) || !isPositiveSafeInteger(maxSize)) {
    return { ok: false, errors: [invalidField('params', 'the momentum taker requires quantity, threshold_ticks (positive int) and max_size_mult (positive int) — validated at declaration; tampered state')] };
  }
  const events: ProcessEmission[] = [];
  let rng = state.rng;
  const lastAnchor = state.last_anchor;
  if (lastAnchor !== null) {
    const moveTicks = ticksBetween(lastAnchor, context.anchor, physics.tick_size);
    if (moveTicks !== null && Math.abs(moveTicks) >= threshold) {
      const draw = drawUnit(rng);
      rng = draw.state;
      const multiplier = 1 + Math.floor(draw.u * maxSize); // seeded size multiplier in [1, max_size_mult]
      const size = scaleQuantity(quantity, multiplier);
      if (size === null) {
        return { ok: false, errors: [invalidField('params.quantity', 'the sized quantity left the exact-decimal range (unreachable for realistic grids — kept total)')] };
      }
      events.push(
        intentEmission(lineage, context.now, lineage.instance, 'take', {
          clientOrderId: `mt-${lineage.instance}-${String(nextStep)}`,
          instrumentId: physics.instrument,
          venueId: physics.venue,
          side: moveTicks > 0 ? 'buy' : 'sell',
          kind: 'market', // the taker crosses: no price, the engine sweeps the book
          quantity: size,
          timeInForce: 'gtc',
          createdAt: new Date(context.now).toISOString(),
        }),
      );
    }
  }
  return ok(deepFreeze({ events, state: successorOf(state, nextStep, nextAt, rng, { last_anchor: context.anchor }) }));
}

/** The mean reverter: fade book-vs-anchor deviations past the threshold, firing into the deviating side. */
function stepMeanReverter(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
  lineage: ProcessLineage,
  nextStep: number,
  nextAt: TimestampMs,
): GenerativeResult<ProcessStepOutcome> {
  const quantity = declaration.params.quantity;
  const threshold = declaration.params.threshold_ticks;
  const maxSize = declaration.params.max_size_mult;
  if (!isCanonicalPositiveDecimal(quantity) || !isPositiveSafeInteger(threshold) || !isPositiveSafeInteger(maxSize)) {
    return { ok: false, errors: [invalidField('params', 'the mean reverter requires quantity, threshold_ticks (positive int) and max_size_mult (positive int) — validated at declaration; tampered state')] };
  }
  const events: ProcessEmission[] = [];
  let rng = state.rng;
  const ask = context.book.ask_price;
  const bid = context.book.bid_price;
  const askDeviation = ask === null ? null : ticksBetween(context.anchor, ask, physics.tick_size); // > 0: ask above anchor
  const bidDeviation = bid === null ? null : ticksBetween(context.anchor, bid, physics.tick_size); // > 0: bid above anchor
  if (askDeviation !== null && askDeviation <= -threshold) {
    // The ask is CHEAP relative to the anchor: fade by buying into it.
    const draw = drawUnit(rng);
    rng = draw.state;
    const size = scaleQuantity(quantity, 1 + Math.floor(draw.u * maxSize));
    if (size === null) {
      return { ok: false, errors: [invalidField('params.quantity', 'the sized quantity left the exact-decimal range (unreachable for realistic grids — kept total)')] };
    }
    events.push(
      intentEmission(lineage, context.now, lineage.instance, 'fade-buy', {
        clientOrderId: `mr-${lineage.instance}-${String(nextStep)}`,
        instrumentId: physics.instrument,
        venueId: physics.venue,
        side: 'buy',
        kind: 'limit',
        quantity: size,
        price: ask,
        timeInForce: 'ioc', // fade and done — a reverter never rests stale
        createdAt: new Date(context.now).toISOString(),
      }),
    );
  } else if (bidDeviation !== null && bidDeviation >= threshold) {
    // The bid is RICH relative to the anchor: fade by selling into it.
    const draw = drawUnit(rng);
    rng = draw.state;
    const size = scaleQuantity(quantity, 1 + Math.floor(draw.u * maxSize));
    if (size === null) {
      return { ok: false, errors: [invalidField('params.quantity', 'the sized quantity left the exact-decimal range (unreachable for realistic grids — kept total)')] };
    }
    events.push(
      intentEmission(lineage, context.now, lineage.instance, 'fade-sell', {
        clientOrderId: `mr-${lineage.instance}-${String(nextStep)}`,
        instrumentId: physics.instrument,
        venueId: physics.venue,
        side: 'sell',
        kind: 'limit',
        quantity: size,
        price: bid,
        timeInForce: 'ioc',
        createdAt: new Date(context.now).toISOString(),
      }),
    );
  }
  return ok(deepFreeze({ events, state: successorOf(state, nextStep, nextAt, rng) }));
}

/** The noise trader: random side, seeded offset from the anchor, self-expiring limit order. */
function stepNoiseTrader(
  declaration: ProcessDeclaration,
  state: ProcessRuntimeState,
  context: ProcessStepContext,
  physics: ExchangePhysicsMirror,
  lineage: ProcessLineage,
  nextStep: number,
  nextAt: TimestampMs,
): GenerativeResult<ProcessStepOutcome> {
  const quantity = declaration.params.quantity;
  const maxOffset = declaration.params.max_offset_ticks;
  if (!isCanonicalPositiveDecimal(quantity) || !isPositiveSafeInteger(maxOffset)) {
    return { ok: false, errors: [invalidField('params', 'the noise trader requires quantity and max_offset_ticks (positive int) — validated at declaration; tampered state')] };
  }
  const sideDraw = drawUnit(state.rng);
  const offsetDraw = drawUnit(sideDraw.state);
  const buy = sideDraw.u < 0.5;
  const offset = Math.floor(offsetDraw.u * (maxOffset + 1)); // seeded offset in [0, max_offset_ticks]
  const price = shiftPriceByTicks(context.anchor, buy ? -offset : offset, physics.tick_size);
  if (price === null) {
    return { ok: false, errors: [invalidField('params.quantity', 'the noise price left the exact-decimal range (unreachable for realistic grids — kept total)')] };
  }
  const expiresAt = new Date(nextAt).toISOString(); // self-expiring: noise never accumulates
  const event = intentEmission(lineage, context.now, lineage.instance, 'noise', {
    clientOrderId: `nt-${lineage.instance}-${String(nextStep)}`,
    instrumentId: physics.instrument,
    venueId: physics.venue,
    side: buy ? 'buy' : 'sell',
    kind: 'limit',
    quantity,
    price,
    timeInForce: 'gtt',
    expiresAt,
    createdAt: new Date(context.now).toISOString(),
  });
  return ok(deepFreeze({ events: [event], state: successorOf(state, nextStep, nextAt, offsetDraw.state) }));
}