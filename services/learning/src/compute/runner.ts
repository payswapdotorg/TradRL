/**
 * @tradrl/learning (service) — the reference compute runner (T014).
 *
 * The orchestration spine over the contract package's pure protocol:
 *
 *   - {@link startComputeRun} — deep-validate the schedule, validate the
 *     injected port, submit every task in canonical order (the port
 *     acknowledges each task's own submission id — a mismatch is a typed
 *     `port_invalid` refusal);
 *   - {@link pumpComputeCollect} / {@link runComputeToCompletion} — the
 *     collect loop: every collected outcome is guard-validated (invalid
 *     outcomes fail the pump ATOMICALLY — the run state only ever holds
 *     valid records) and appended to the run's ledger with the outcome
 *     chain folded (the T013 step-chain discipline: one digest head per
 *     collected outcome, seeded from the schedule's canonical bytes);
 *     completion = every planned submission has reported at least one
 *     outcome (at-least-once: duplicates and reordering are the
 *     substrate's business — the AGGREGATE is where dedup and the
 *     failure-hidden law fire);
 *   - {@link serializeComputeRunState} / {@link resumeComputeRunState} —
 *     the resumable run state: canonical JSON bytes (schema
 *     `tradrl/compute-run-state@1`), and the resume gate — parse, enforce
 *     the schema, re-validate structurally, VERIFY THE OUTCOME CHAIN (a
 *     tampered or partial payload fails with `chain_mismatch`, never
 *     silently) — mirroring the T013 run-state discipline;
 *   - {@link aggregateComputeRun} — the canonical fold over the collected
 *     outcomes (the contract's `aggregateEpisodes`).
 *
 * No ambient clock anywhere: the collect loop is bounded by an EXPLICIT
 * `max_collects` parameter, never by time. All state transitions are pure
 * (state in, NEW deeply-frozen state out).
 */

import {
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isComputePort,
  isComputeSchedule,
  isDigest8,
  isJsonValue,
  isJobOutcome,
  isRecord,
  ok,
  outcomeDigest,
  portFailure,
  scheduleChainSeed,
  validateComputeSchedule,
  validateJobOutcome,
  aggregateEpisodes,
  type ComputePort,
  type ComputeResult,
  type ComputeSchedule,
  type EpisodeAggregate,
  type JobOutcome,
  type SubmissionId,
} from '../../../../packages/compute/src/index';

// ---------------------------------------------------------------------------
// The resumable run state
// ---------------------------------------------------------------------------

/** The run-state serialization schema marker (versioned with the compute protocol). */
export const COMPUTE_RUN_STATE_SCHEMA = 'tradrl/compute-run-state@1';

/** The run lifecycle: running (collecting), complete (every submission reported). */
export type ComputeRunStatus = 'running' | 'complete';

/**
 * The append-only compute run state: the schedule, the collected outcome
 * ledger in ARRIVAL order (the ledger records what arrived, duplicates
 * included — dedup is the aggregate's law), and the OUTCOME CHAIN — one
 * FNV-1a digest head per collected outcome, seeded from the schedule's
 * canonical bytes and folded in arrival order. The chain binds the
 * schedule and every outcome; a resumed run provably consumed the same
 * outcomes (`chain_mismatch` is typed).
 */
export interface ComputeRunState {
  readonly schedule: ComputeSchedule;
  readonly status: ComputeRunStatus;
  /** The collected outcomes in arrival order (append-only). */
  readonly collected: readonly JobOutcome[];
  /** Digest head after each collected outcome, in arrival order. */
  readonly outcome_chain: readonly string[];
}

/** Runtime guard for a structurally consistent run state. */
export function isComputeRunState(value: unknown): value is ComputeRunState {
  if (!isRecord(value)) return false;
  if (!isComputeSchedule(value.schedule)) return false;
  if (value.status !== 'running' && value.status !== 'complete') return false;
  if (!Array.isArray(value.collected)) return false;
  if (!(value.collected as readonly unknown[]).every((outcome) => isJobOutcome(outcome))) return false;
  if (!Array.isArray(value.outcome_chain)) return false;
  if (!(value.outcome_chain as readonly unknown[]).every((head) => isDigest8(head))) return false;
  if ((value.outcome_chain as readonly unknown[]).length !== (value.collected as readonly unknown[]).length) return false;
  // Status coherence: complete iff every planned submission reported.
  const reported = new Set<string>((value.collected as readonly JobOutcome[]).map((outcome) => outcome.submission as string));
  const everyReported = (value.schedule.tasks as readonly { readonly submission: SubmissionId }[]).every((task) => reported.has(task.submission as string));
  if (everyReported !== (value.status === 'complete')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Completion + chain verification
// ---------------------------------------------------------------------------

/** The submissions that have not reported any outcome yet (pure check). */
export function pendingSubmissions(state: ComputeRunState): readonly SubmissionId[] {
  const reported = new Set<string>(state.collected.map((outcome) => outcome.submission as string));
  return state.schedule.tasks.filter((task) => !reported.has(task.submission as string)).map((task) => task.submission);
}

/** `true` when every planned submission has reported at least one outcome. */
export function computeRunComplete(state: ComputeRunState): boolean {
  return state.status === 'complete';
}

/**
 * Verify the run's outcome chain: recompute the schedule seed and fold
 * every collected outcome in arrival order, comparing heads. A tampered
 * or partial serialized state fails with `chain_mismatch` — the resume
 * gate's whole point.
 */
export function verifyComputeRunChain(state: ComputeRunState): ComputeResult<true> {
  if (!isComputeRunState(state)) {
    return fail('invalid_run_state', 'verifyComputeRunChain requires a valid compute run state');
  }
  let head = scheduleChainSeed(state.schedule);
  let count = 0;
  for (const outcome of state.collected) {
    head = chainStep(head, outcome);
    const expected = state.outcome_chain[count];
    if (expected !== head) {
      return fail(
        'chain_mismatch',
        `run "${state.schedule.run}": outcome chain head ${count} is "${String(expected)}" but the collected outcomes fold to "${head}" — the ledger was tampered with or truncated`,
      );
    }
    count += 1;
  }
  if (count !== state.outcome_chain.length) {
    return fail(
      'chain_mismatch',
      `run "${state.schedule.run}": the chain records ${state.outcome_chain.length} heads but the ledger carries ${count} outcomes`,
    );
  }
  return ok(true);
}

/** One chain fold step (the T013 `fnv1a32(prev + ':' + digest)` discipline). */
function chainStep(previous: string, outcome: JobOutcome): string {
  return fnv1a32Hex(`${previous}:${outcomeDigest(outcome)}`);
}

// ---------------------------------------------------------------------------
// startComputeRun (validate + submit)
// ---------------------------------------------------------------------------

/**
 * Start a compute run: deep-validate the untrusted schedule (the planner's
 * laws — partition coherence, one experiment's batch, declared submission
 * ids), validate the port surface, refuse empty task lists (a run of
 * nothing is inexpressible), then submit every task in canonical order.
 * Port failures surface as typed `port_error` (substrate codes preserved
 * in the message); an acknowledgment that is not the task's own
 * submission id is a typed `port_invalid` refusal. Returns the fresh
 * `running` state with an empty ledger.
 */
export function startComputeRun(schedule: unknown, port: unknown): ComputeResult<ComputeRunState> {
  const planResult = validateComputeSchedule(schedule);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;
  if (plan.tasks.length === 0) {
    return fail('invalid_schedule', 'the schedule plans no tasks — a compute run of nothing is inexpressible', 'schedule.tasks');
  }
  if (!isComputePort(port)) {
    return fail('port_invalid', 'startComputeRun requires a structurally valid ComputePort (submit/collect/cancel)');
  }
  const substrate = port as ComputePort;

  for (const task of plan.tasks) {
    const submitted = substrate.submit(task);
    if (!submitted.ok) return portFailure(submitted.errors);
    if (submitted.value !== task.submission) {
      return fail(
        'port_invalid',
        `the port acknowledged "${submitted.value}" for task "${task.submission}" of job "${task.job.job_id}" — submissions acknowledge the task's own id (outcomes must map onto the schedule)`,
      );
    }
  }
  return ok(
    deepFreeze({
      schedule: plan,
      status: 'running' as const,
      collected: [],
      outcome_chain: [],
    }),
  );
}

// ---------------------------------------------------------------------------
// pumpComputeCollect / runComputeToCompletion (the collect loop)
// ---------------------------------------------------------------------------

/**
 * ONE collect round: drain the port's delta, guard-validate every outcome
 * (an invalid outcome fails the WHOLE pump atomically — the ledger only
 * ever holds valid records), append the batch to the ledger, fold the
 * chain, and recompute the status. An EMPTY delta returns the state
 * unchanged (same reference — the substrate is quiescent). Late outcomes
 * on a complete run are APPENDED, not dropped: the ledger records what
 * arrived, duplicates included (at-least-once — dedup and divergence are
 * the AGGREGATE's laws, and a divergent straggler must be seen).
 */
export function pumpComputeCollect(state: ComputeRunState, port: unknown): ComputeResult<ComputeRunState> {
  if (!isComputeRunState(state)) {
    return fail('invalid_run_state', 'pumpComputeCollect requires a valid compute run state');
  }
  if (!isComputePort(port)) {
    return fail('port_invalid', 'pumpComputeCollect requires a structurally valid ComputePort (submit/collect/cancel)');
  }

  const collected = (port as ComputePort).collect();
  if (!collected.ok) return portFailure(collected.errors);
  const batch = collected.value;
  if (!Array.isArray(batch)) {
    return fail('port_invalid', 'the compute port collect() must return an array of outcomes', 'collected');
  }
  if (batch.length === 0) return ok(state); // quiescent: nothing new arrived

  // Validate the whole batch before appending anything (atomic pump).
  const validated: JobOutcome[] = [];
  for (let index = 0; index < batch.length; index++) {
    const outcomeResult = validateJobOutcome(batch[index], `collected[${index}]`);
    if (!outcomeResult.ok) return outcomeResult;
    validated.push(outcomeResult.value);
  }

  let head = state.outcome_chain.length === 0 ? scheduleChainSeed(state.schedule) : (state.outcome_chain[state.outcome_chain.length - 1] as string);
  const chain = [...state.outcome_chain];
  for (const outcome of validated) {
    head = chainStep(head, outcome);
    chain.push(head);
  }

  const collectedAll = [...state.collected, ...validated];
  const reported = new Set<string>(collectedAll.map((outcome) => outcome.submission as string));
  const complete = state.schedule.tasks.every((task) => reported.has(task.submission as string));

  return ok(
    deepFreeze({
      schedule: state.schedule,
      status: (complete ? 'complete' : 'running') as ComputeRunStatus,
      collected: collectedAll,
      outcome_chain: chain,
    }),
  );
}

/** The completion-loop options: the explicit collect bound (no ambient time). */
export interface CompletionOptions {
  readonly max_collects: number;
}

/**
 * Run the collect loop to completion: pump until the run is COMPLETE
 * (every planned submission reported at least one outcome) AND QUIESCENT
 * (a collect round returned an empty delta — progressive substrates may
 * hold un-emitted outcomes after every task has reported; the quiescence
 * probe drains them so the ledger is the whole truth), bounded by
 * `max_collects` rounds (a positive safe integer — the loop is bounded by
 * rounds, never by time). A run that cannot complete within the bound
 * fails with the typed `run_not_complete` error naming the pending
 * submissions.
 */
export function runComputeToCompletion(state: ComputeRunState, port: unknown, options: CompletionOptions): ComputeResult<ComputeRunState> {
  if (!isComputeRunState(state)) {
    return fail('invalid_run_state', 'runComputeToCompletion requires a valid compute run state');
  }
  const bound = options.max_collects;
  if (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 1) {
    return fail('invalid_field', 'max_collects must be a positive safe integer (the explicit collect bound — no ambient time)', 'max_collects');
  }
  let current = state;
  let quiescent = false;
  for (let round = 0; round < bound && !quiescent; round++) {
    const before = current.collected.length;
    const pumped = pumpComputeCollect(current, port);
    if (!pumped.ok) return pumped;
    current = pumped.value;
    quiescent = current.status === 'complete' && current.collected.length === before;
  }
  if (current.status !== 'complete') {
    const pending = pendingSubmissions(current);
    return fail(
      'run_not_complete',
      `run "${current.schedule.run}" did not complete within ${bound} collect round(s); ${pending.length} submission(s) still lack outcomes: ${pending.slice(0, 4).map((id) => `"${id}"`).join(', ')}${pending.length > 4 ? ', …' : ''}`,
    );
  }
  return ok(current);
}

// ---------------------------------------------------------------------------
// Serialization / resume (the T013 run-state discipline)
// ---------------------------------------------------------------------------

/**
 * Serialize a compute run state to canonical JSON bytes. Deterministic:
 * equal states produce identical bytes (the resume artifact is portable
 * across processes — T008 persists them, someone else's business).
 */
export function serializeComputeRunState(state: ComputeRunState): ComputeResult<string> {
  if (!isComputeRunState(state)) {
    return fail('invalid_run_state', 'serializeComputeRunState requires a valid compute run state');
  }
  // The state is JSON-shaped by construction; the round-trip yields a fresh
  // tree the guard narrows (no casts) and canonicalJson orders.
  const roundTrip: unknown = JSON.parse(JSON.stringify(state));
  if (!isJsonValue(roundTrip)) {
    return fail('invalid_serialization', 'the run state did not survive the JSON round-trip (impossible by construction)');
  }
  const envelope = { schema: COMPUTE_RUN_STATE_SCHEMA, state: roundTrip };
  return ok(canonicalJson(envelope));
}

/**
 * Resume a compute run state from serialized bytes: parse, enforce the
 * schema, structurally re-validate (schedule shape, outcome shapes, chain
 * shape, status coherence), re-freeze, and VERIFY THE OUTCOME CHAIN.
 * Failures are typed:
 *   - `invalid_json` — unparseable bytes;
 *   - `invalid_serialization` — wrong schema marker or a structurally
 *     invalid state;
 *   - `chain_mismatch` — the collected outcomes do not fold onto the
 *     recorded chain (tampered content — the resume gate's whole point).
 */
export function resumeComputeRunState(bytes: string): ComputeResult<ComputeRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    return fail('invalid_serialization', 'the run state envelope must be an object');
  }
  if (parsed.schema !== COMPUTE_RUN_STATE_SCHEMA) {
    return fail('invalid_serialization', `expected schema "${COMPUTE_RUN_STATE_SCHEMA}", got ${JSON.stringify(parsed.schema)}`);
  }
  const state: unknown = parsed.state;
  if (!isComputeRunState(state)) {
    return fail('invalid_serialization', 'the parsed value fails the compute run state guard (schedule, outcomes, chain shape or status coherence)');
  }
  const verified = verifyComputeRunChain(state);
  if (!verified.ok) return verified;
  // Re-freeze after the JSON thaw (the resume artifact re-enters the
  // frozen world).
  return ok(deepFreeze(state));
}

// ---------------------------------------------------------------------------
// aggregateComputeRun (the canonical fold)
// ---------------------------------------------------------------------------

/**
 * Fold the run's collected outcomes into the experiment's
 * {@link EpisodeAggregate} — the contract's canonical fold (dedup by
 * digest equality, divergence trip wire, failure-hidden law, trial-id
 * order, retained failure manifest).
 */
export function aggregateComputeRun(state: ComputeRunState): ComputeResult<EpisodeAggregate> {
  if (!isComputeRunState(state)) {
    return fail('invalid_run_state', 'aggregateComputeRun requires a valid compute run state');
  }
  return aggregateEpisodes(state.schedule, state.collected);
}
