/**
 * @tradrl/market-world (reactive service) — the ReactiveWorldConfig: the
 * MODE-HONEST declaration of one reactive world (work order T027).
 *
 * L5 (ARCHITECTURE-LOCK: "replay, reactive replay and counterfactual/
 * generative simulation are distinct"): the config declares
 * `mode: 'reactive_replay'` as a LITERAL TYPE — a config claiming any
 * other mode does not validate, and a claim of `'exact_replay'` fails
 * with the dedicated `fidelity_claim_dishonest` error (this world MATCHES
 * endogenous intents; asserting exact-replay fidelity for that would be a
 * lie about what the run is). The embedded exchange physics config is
 * held to the same standard (an exchange simulator serves
 * reactive_replay/generative only — the mirrored T010 law).
 *
 * WHAT THE CONFIG FULLY DETERMINES (with the recorded stream and the
 * scripted feeds — L9): the seed, the recorded stream selection, the
 * `as_of` information anchor, the exchange physics (venue grids, fees,
 * latency, slippage, impact), the physics lineage refs bound into every
 * fill, the participant roster (opaque instance refs + declared
 * action-feed refs), the declared interleaving policy, and the tenant /
 * project scope (L12 — every derived record inherits it).
 *
 * THE INTERLEAVING POLICY (the deterministic order law): the closed
 * vocabulary below declares how the recorded stream, the scripted
 * participant actions, and driver-submitted actions are ordered. It is a
 * first-class config field — the order IS part of the deterministic
 * function (same inputs + same policy = byte-identical evolution).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isFiniteNumber, isNonEmptyString, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type ReactiveError, type ReactiveResult } from './errors';
import { isTimestampMs, type AgentInstanceId, type FeedRef, type ProjectId, type Seed, type TenantId, type TimestampMs } from './ids';
import type { ExchangePhysicsMirror } from './exchange-mirror';
import { validateExchangePhysics } from './exchange-mirror';

// ---------------------------------------------------------------------------
// The declared interleaving policy (deterministic, explicit, closed)
// ---------------------------------------------------------------------------

/**
 * The declared interleaving of the recorded stream, the scripted
 * participant actions, and driver-submitted actions — the work order's
 * "declared interleaving policy (how the recorded stream and participant
 * actions are ordered — deterministic, explicit)".
 *
 * The world advances through BOUNDARIES (the next recorded-event
 * availability instant, the next scripted-action instant, or the advance
 * target); each `advance` call processes exactly ONE boundary. Within a
 * boundary, the policy orders the stream step against the scripted
 * actions; across boundaries, the policy gates driver submits:
 *
 * - `stream_first` — at a shared instant the recorded stream applies
 *   BEFORE scripted actions fire, and a driver submit requires the world
 *   SETTLED (no unapplied recorded event at or before `now` — you act
 *   only after the market's recorded moves at your instant are absorbed).
 *   A submit while a stream step is pending is the typed
 *   `interleaving_violation` (acting mid-stream-step).
 * - `actions_first` — at a shared instant scripted actions fire BEFORE
 *   the recorded stream applies (the adversaries move on the prior
 *   information set — a stricter stress posture); driver submits require
 *   settled state, exactly as `stream_first`.
 * - `unrestricted` — driver submits are legal at ANY rest point (the
 *   actor declares it may act on a lagging view; the pending count is
 *   always reported); at a shared instant the stream applies first (the
 *   `stream_first` tie-break).
 */
export type InterleavingPolicy = {
  readonly kind: 'stream_first' | 'actions_first' | 'unrestricted';
};

/** Runtime-checkable list of interleaving kinds. */
export const INTERLEAVING_KINDS: readonly string[] = ['stream_first', 'actions_first', 'unrestricted'];

/** Runtime guard for an interleaving policy. */
export function isInterleavingPolicy(value: unknown): value is InterleavingPolicy {
  if (!isRecord(value)) return false;
  return typeof value.kind === 'string' && INTERLEAVING_KINDS.includes(value.kind);
}

/** Does the policy require the world settled before a driver submit? (the strict policies) */
export function policyRequiresSettled(policy: InterleavingPolicy): boolean {
  return policy.kind === 'stream_first' || policy.kind === 'actions_first';
}

// ---------------------------------------------------------------------------
// The participant roster (opaque instance refs + declared feed refs)
// ---------------------------------------------------------------------------

/**
 * The role of a declared participant in the reactive world. `candidate`
 * is the organization under evaluation (its actions arrive through the
 * driver-facing submit); `adversary` and `co_participant` are the
 * scripted co-inhabitants (their actions arrive through their declared
 * feeds). The vocabulary is honest labeling, never authority (L8 — the
 * engine is authority-free; roles are for lineage and audit).
 */
export type ParticipantRole = 'candidate' | 'adversary' | 'co_participant';

/** Runtime-checkable list of participant roles. */
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['candidate', 'adversary', 'co_participant'];

/** Runtime guard for a participant role. */
export function isParticipantRole(value: unknown): value is ParticipantRole {
  return typeof value === 'string' && (PARTICIPANT_ROLES as readonly string[]).includes(value);
}

/**
 * One declared participant: an opaque agent-instance reference, its role,
 * and — for scripted participants — the DECLARED action-feed reference
 * (`feed`: an opaque FeedRef bound to an actual port at construction;
 * `null` for the candidate, whose actions arrive through submit). Exactly
 * one candidate is required (the reactive world evaluates one candidate
 * organization against the market and its adversaries).
 */
export interface ParticipantDeclaration {
  readonly instance: AgentInstanceId;
  readonly role: ParticipantRole;
  /** The declared action-feed reference (bound at construction), or null for driver-driven participants. */
  readonly feed: FeedRef | null;
}

/** Runtime guard for a participant declaration. */
export function isParticipantDeclaration(value: unknown): value is ParticipantDeclaration {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.instance)) return false;
  if (!isParticipantRole(value.role)) return false;
  if (value.feed !== null && !isNonEmptyString(value.feed)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The stream selection (mirror of T009's StreamSelection)
// ---------------------------------------------------------------------------

/** One selected recorded stream: a (venue, instrument) pair. */
export interface StreamSelection {
  readonly venue: string;
  readonly instrument: string;
}

/** Runtime guard for a stream selection. */
export function isStreamSelection(value: unknown): value is StreamSelection {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.venue) && isNonEmptyString(value.instrument);
}

/** The stream scope key of a selection: `venue|instrument`. */
export function streamSelectionKey(selection: StreamSelection): string {
  return `${selection.venue}|${selection.instrument}`;
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
 * The fully-determining reactive world configuration (L9 + L5 + L12):
 *
 * - `world_id` — the identity episode specs bind to (`world_binding_mismatch` otherwise).
 * - `mode` — ALWAYS `'reactive_replay'` (the literal type); any other
 *   claim is a typed `fidelity_claim_dishonest` error (L5).
 * - `information_policy` — `'point-in-time'` (the boundary is the law, L4).
 * - `tenant` / `project` — the L12 scope every derived record carries.
 * - `seed` — opaque deterministic seed, hashed into the config digest.
 * - `as_of` — the information anchor: ingestion rejects events with
 *   `available_time > as_of`, and no episode clock may anchor beyond it.
 * - `streams` — the recorded-stream selection (at least one pair; unique).
 * - `exchange` — the exchange-sim physics configuration (structural
 *   mirror; the REAL engine validates it again at `createEngine`).
 * - `physics_refs` — the physics lineage refs bound into every fill.
 * - `participants` — the roster (exactly one candidate; unique instances;
 *   feed refs unique when present).
 * - `interleaving` — the declared stream/action ordering policy.
 * - `playback_speed` — positive finite multiplier (default 1).
 */
export interface ReactiveWorldConfig {
  readonly world_id: string;
  readonly mode: 'reactive_replay';
  readonly information_policy: 'point-in-time';
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly seed: Seed;
  readonly as_of: TimestampMs;
  readonly streams: readonly StreamSelection[];
  readonly exchange: ExchangePhysicsMirror;
  readonly physics_refs: PhysicsRefs;
  readonly participants: readonly ParticipantDeclaration[];
  readonly interleaving: InterleavingPolicy;
  readonly playback_speed: number;
}

/**
 * Collect-all validation of an untrusted reactive world config. Enforces
 * the L5 mode honesty (the literal `'reactive_replay'`; an `'exact_replay'`
 * claim fails `fidelity_claim_dishonest` — this world MATCHES endogenous
 * intents and must never claim exact-replay fidelity), the stream
 * selection law, the roster law (exactly one candidate, unique instances,
 * unique feed refs), the physics validation (mirrored T010 rules) and the
 * L12 tenant/project presence. On success the value is returned narrowed,
 * deeply frozen.
 */
export function validateReactiveWorldConfig(value: unknown, path = 'config'): ReactiveResult<ReactiveWorldConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: ReactiveError[] = [];

  if (value.world_id === undefined) {
    errors.push(missingField(`${path}.world_id`));
  } else if (!isNonEmptyString(value.world_id)) {
    errors.push(invalidField(`${path}.world_id`, 'must be a non-empty string'));
  }

  // L5 — the mode honesty. The type is the literal 'reactive_replay'; any
  // other claim is dishonest about what this world does (it MATCHES).
  if (value.mode === undefined) {
    errors.push(missingField(`${path}.mode`));
  } else if (value.mode !== 'reactive_replay') {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.mode`,
      message: `a reactive world declares mode 'reactive_replay' — claiming '${String(value.mode)}' is dishonest (L5: exact != reactive != generative; this world MATCHES endogenous intents, so it can never claim exact-replay fidelity)`,
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

  if (value.as_of === undefined) {
    errors.push(missingField(`${path}.as_of`));
  } else if (!isTimestampMs(value.as_of)) {
    errors.push(invalidField(`${path}.as_of`, 'must be a valid epoch-millisecond timestamp'));
  }

  if (value.streams === undefined) {
    errors.push(missingField(`${path}.streams`));
  } else if (!Array.isArray(value.streams)) {
    errors.push(invalidField(`${path}.streams`, 'must be an array of { venue, instrument } selections'));
  } else {
    const streams = value.streams as readonly unknown[];
    if (streams.length === 0) {
      errors.push(invalidField(`${path}.streams`, 'must select at least one (venue, instrument) stream — a world with an empty data universe reacts to nothing'));
    }
    const seen = new Set<string>();
    for (let index = 0; index < streams.length; index++) {
      const selection = streams[index];
      if (!isStreamSelection(selection)) {
        errors.push(invalidField(`${path}.streams[${index}]`, 'must be an object with non-empty venue and instrument strings'));
        continue;
      }
      const key = streamSelectionKey(selection);
      if (seen.has(key)) {
        errors.push(invalidField(`${path}.streams[${index}]`, `duplicate stream selection "${key}"`));
      }
      seen.add(key);
    }
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

  if (value.physics_refs === undefined) {
    errors.push(missingField(`${path}.physics_refs`));
  } else if (!isPhysicsRefs(value.physics_refs)) {
    errors.push(invalidField(`${path}.physics_refs`, 'must carry non-empty fee/latency/slippage/impact policy refs — the physics lineage every fill binds (L6/L9)'));
  }

  if (value.participants === undefined) {
    errors.push(missingField(`${path}.participants`));
  } else if (!Array.isArray(value.participants)) {
    errors.push(invalidField(`${path}.participants`, 'must be an array of participant declarations'));
  } else {
    const participants = value.participants as readonly unknown[];
    if (participants.length === 0) {
      errors.push(invalidField(`${path}.participants`, 'must declare at least one participant (the candidate organization) — a reactive world without endogenous participants is exact replay with extra steps'));
    }
    const seenInstances = new Set<string>();
    const seenFeeds = new Set<string>();
    let candidates = 0;
    for (let index = 0; index < participants.length; index++) {
      const participant = participants[index];
      if (!isParticipantDeclaration(participant)) {
        errors.push(invalidField(`${path}.participants[${index}]`, 'must be { instance: non-empty id, role: candidate|adversary|co_participant, feed: ref|null }'));
        continue;
      }
      if (seenInstances.has(participant.instance)) {
        errors.push(invalidField(`${path}.participants[${index}].instance`, `duplicate participant instance "${participant.instance}"`));
      }
      seenInstances.add(participant.instance);
      if (participant.feed !== null) {
        if (seenFeeds.has(participant.feed)) {
          errors.push(invalidField(`${path}.participants[${index}].feed`, `duplicate feed ref "${participant.feed}" — one feed per participant`));
        }
        seenFeeds.add(participant.feed);
      }
      if (participant.role === 'candidate') {
        candidates += 1;
        if (participant.feed !== null) {
          errors.push(invalidField(`${path}.participants[${index}].feed`, "the candidate organization acts through the driver's submit — a scripted candidate feed is not a candidate"));
        }
      }
    }
    if (participants.length > 0 && candidates !== 1) {
      errors.push(invalidField(`${path}.participants`, `exactly one 'candidate' participant is required (found ${candidates}) — the reactive world evaluates one candidate organization`));
    }
  }

  if (value.interleaving === undefined) {
    errors.push(missingField(`${path}.interleaving`));
  } else if (!isInterleavingPolicy(value.interleaving)) {
    errors.push(invalidField(`${path}.interleaving`, `must be { kind: ${INTERLEAVING_KINDS.join(' | ')} } — the declared stream/action ordering`));
  }

  const playbackSpeed = value.playback_speed === undefined ? 1 : value.playback_speed;
  if (!isFiniteNumber(playbackSpeed) || playbackSpeed <= 0) {
    errors.push(invalidField(`${path}.playback_speed`, `must be a positive finite number, got ${String(playbackSpeed)}`));
  }

  if (errors.length > 0) return { ok: false, errors };

  // Coherence: the exchange trades a selected stream.
  const validatedStreams = (value.streams as readonly unknown[]).filter(isStreamSelection).map((selection) =>
    deepFreeze({ venue: selection.venue, instrument: selection.instrument }),
  );
  const physics = exchange as ExchangePhysicsMirror;
  const tradesSelectedStream = validatedStreams.some((selection) => selection.venue === physics.venue && selection.instrument === physics.instrument);
  if (!tradesSelectedStream) {
    return {
      ok: false,
      errors: [
        invalidField(
          `${path}.exchange`,
          `the exchange trades (${physics.venue}, ${physics.instrument}) but the stream selection does not carry that pair — the engine's market must be one of the recorded streams`,
        ),
      ],
    };
  }
  // Coherence (L5): the physics fidelity must equal the world mode.
  if (physics.fidelity !== 'reactive_replay') {
    return {
      ok: false,
      errors: [
        {
          code: 'fidelity_claim_dishonest',
          path: `${path}.exchange.fidelity`,
          message: `the reactive world serves mode 'reactive_replay' but the exchange physics declare '${physics.fidelity}' — the modes must agree (L5: never conflated)`,
        },
      ],
    };
  }

  return ok(
    deepFreeze({
      world_id: value.world_id as string,
      mode: 'reactive_replay' as const,
      information_policy: 'point-in-time' as const,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      seed: value.seed as Seed,
      as_of: value.as_of as TimestampMs,
      streams: validatedStreams,
      exchange: physics,
      physics_refs: deepFreeze({ ...(value.physics_refs as PhysicsRefs) }),
      participants: (value.participants as readonly unknown[]).filter(isParticipantDeclaration).map((participant) =>
        deepFreeze({ instance: participant.instance, role: participant.role, feed: participant.feed }),
      ),
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
 * proves JSON-safety.
 */
export function canonicalConfigJson(config: ReactiveWorldConfig): string {
  const tree: JsonValue = {
    world_id: config.world_id,
    mode: config.mode,
    information_policy: config.information_policy,
    tenant: config.tenant,
    project: config.project,
    seed: config.seed,
    as_of: config.as_of,
    streams: config.streams.map((selection) => ({ venue: selection.venue, instrument: selection.instrument })),
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
    participants: config.participants.map((participant) => ({ instance: participant.instance, role: participant.role, feed: participant.feed })),
    interleaving: { kind: config.interleaving.kind },
    playback_speed: config.playback_speed,
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of a reactive world config: FNV-1a 32-bit of
 * the canonical config JSON. Bound into every run record (L9) and seeding
 * the ingest chain.
 */
export function configHash(config: ReactiveWorldConfig): string {
  return fnv1a32Hex(canonicalConfigJson(config));
}
