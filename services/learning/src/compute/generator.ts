/**
 * @tradrl/learning (service) — the fake episode generator (T014).
 *
 * THE REFERENCE WORKER'S WORLD: this generator "honors the T013 driver
 * mirrors" by DRIVING THE REAL T013 MACHINERY — every episode of a task is
 * one {@link createReferenceTrainer} drive over the REAL scripted world
 * (`../rl/fixtures`) under the REAL scripted policy (`../rl/policy`):
 * distributed generation DRIVES the T013 contracts per worker, it does not
 * replace them (Work Order T014's law).
 *
 * DETERMINISM (the heart of the work order): every episode is a PURE
 * FUNCTION of (job specification, derived seed, world/policy script) —
 * the trainer declaration derives from the job + the ABSOLUTE ordinal
 * (never the worker count, never the slot, never the arrival order), so:
 *
 *   - re-running a completed job yields byte-identical episode digests
 *     (idempotency, tested twice);
 *   - a 1-worker run and an N-worker run over the same job set generate
 *     the SAME episodes, byte-identically (the equivalence test).
 *
 * The episode DIGEST is the T013 run-chain fold applied to one episode:
 * seeded from the episode seed, folded over `stepDigest` of every recorded
 * step (the market-world ingest-chain discipline).
 *
 * The emitted trial's OUTCOME is pure generation DATA (steps, digest,
 * chain head) — never an acceptance verdict: evaluation (T012) decides
 * (L7 — "raw PnL is never the sole acceptance criterion"; rewards are
 * data, episodes generate DATA, acceptance stays elsewhere).
 */

import {
  deepFreeze,
  deriveEnvironmentConfigRef,
  fnv1a32Hex,
  stepDigest,
  validateEnvironmentSpec,
  type EnvironmentId,
  type EnvironmentSpec,
  type EpisodeId,
  type RLResult,
  type Seed,
  type TimestampMs,
  type TrainingRunId,
  type TrajectoryStep,
  type WorldId,
} from '../../../../packages/rl-protocol/src/index';
import {
  episodeSeedAt,
  deriveJobTrialId,
  deriveJobTrajectoryId,
  fail,
  ok,
  validateJobResult,
  type ComputeError,
  type ComputeResult,
  type ComputeTask,
  type EpisodeJob,
  type JobResult,
  type WorkerRef,
} from '../../../../packages/compute/src/index';
import { createReferenceTrainer } from '../rl/trainer';
import { createScriptedEnvironment, scriptedWorldOptions } from '../rl/fixtures';
import { createScriptedPolicy } from '../rl/policy';

/**
 * Map a T013 (rl-protocol) drive failure onto the compute taxonomy: the
 * machinery's codes are foreign to this lane, so they ride in the message
 * (the environmentFailure discipline) under `generation_failed` — the
 * executing worker's episode generation failed.
 */
function fromRl<T>(result: RLResult<T>): ComputeResult<T> {
  if (result.ok) return ok(result.value);
  const errors: ComputeError[] = result.errors.map((error): ComputeError => ({
    code: 'generation_failed',
    path: error.path,
    message: `[${error.code}] ${error.message}`,
  }));
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The scripted compute universe (constants every derivation shares)
// ---------------------------------------------------------------------------

/** The opening instant of every scripted episode's simulated clock. */
export const SCRIPT_COMPUTE_BASE_TIME = 1_700_000_000_000;

/** The scripted world's tick count (observations per episode). */
export const SCRIPT_COMPUTE_TICKS = 6;

/** The declared policy ref of the scripted compute policy (the fixture's versioned identity). */
export const SCRIPT_COMPUTE_POLICY_REF = 'policy:scripted-compute@1';

// ---------------------------------------------------------------------------
// The generator's signature (the fake worker's world factory)
// ---------------------------------------------------------------------------

/**
 * One task's episode generation: for every ordinal of the task's seed
 * range, drive ONE T013 episode under the executing `worker` and emit its
 * {@link JobResult}. Deterministic given (task, worker) — the worker ref
 * only STAMPS the records; the episode content derives from the job spec
 * and the derived seed alone.
 */
export type EpisodeGenerator = (task: ComputeTask, worker: WorkerRef) => ComputeResult<readonly JobResult[]>;

// ---------------------------------------------------------------------------
// The scripted spec (the environment config the job's lineage names)
// ---------------------------------------------------------------------------

/**
 * The environment spec every episode of `job` drives in the scripted
 * compute universe: an `exact_replay` world anchored at
 * {@link SCRIPT_COMPUTE_BASE_TIME}, covering {@link SCRIPT_COMPUTE_TICKS}
 * ticks of `driver.step_ms` each, seeded from the job's seed base. The
 * job's `lineage.environment_config` MUST equal this spec's content-hash
 * ref (checked at generation — an incoherent job is a typed failure).
 */
export function scriptComputeSpec(job: EpisodeJob): EnvironmentSpec {
  const asOf = (SCRIPT_COMPUTE_BASE_TIME + SCRIPT_COMPUTE_TICKS * job.driver.step_ms) as TimestampMs;
  const spec: EnvironmentSpec = deepFreeze({
    profile: {
      environment_id: 'env-scripted-compute' as EnvironmentId,
      fidelity: 'exact_replay',
      clock: deepFreeze({
        now: SCRIPT_COMPUTE_BASE_TIME as TimestampMs,
        asOf,
        playbackSpeed: 1,
        paused: false,
        fidelity: 'exact_replay',
        informationPolicy: 'point-in-time',
      }),
      seed: job.seed_base,
      venue_scope: [],
      instrument_scope: [],
      latency_policy: null,
      fee_policy: null,
    },
    world: deepFreeze({ world_id: 'world-scripted-compute' as WorldId, kind: 'scripted' }),
    information_policy: 'point-in-time',
  });
  return spec;
}

// ---------------------------------------------------------------------------
// The episode digest (the T013 chain fold over one episode)
// ---------------------------------------------------------------------------

/**
 * The episode digest: fold `fnv1a32(prev + ':' + stepDigest(step))` over
 * the episode's recorded steps, seeded from the episode seed — the T013
 * run-state step-chain discipline applied to one episode's bytes. Same
 * (spec, seed, scripts) -> identical digest, twice, forever.
 */
export function scriptEpisodeDigest(seed: Seed, steps: readonly TrajectoryStep[]): string {
  let head = fnv1a32Hex(seed);
  for (const step of steps) {
    head = fnv1a32Hex(`${head}:${stepDigest(step)}`);
  }
  return head;
}

// ---------------------------------------------------------------------------
// The reference generator
// ---------------------------------------------------------------------------

/**
 * Create the fake episode generator (the reference worker's world): every
 * episode of a task drives the REAL T013 reference trainer over the REAL
 * scripted environment and policy, derives the trial from the episode's
 * recorded experience, and self-checks every result through the compute
 * contract's validator before emitting it. L9 coherence is enforced at
 * generation: the job's declared environment config ref must match the
 * scripted spec's content hash, and the declared policy ref must be the
 * scripted policy's versioned identity.
 */
export function createDriverEpisodeGenerator(): EpisodeGenerator {
  return (task: ComputeTask, worker: WorkerRef): ComputeResult<readonly JobResult[]> => {
    const job = task.job;

    // L9 coherence: the declared config IS the spec this generator drives.
    const spec = scriptComputeSpec(job);
    const derivedConfig = deriveEnvironmentConfigRef(spec);
    if (derivedConfig !== job.lineage.environment_config) {
      return fail(
        'lineage_mismatch',
        `job "${job.job_id}" declares environment config "${job.lineage.environment_config}" but the scripted compute universe derives "${derivedConfig}" — the declared config is the contract (L9)`,
        'task.job.lineage.environment_config',
      );
    }
    if (job.lineage.policy !== SCRIPT_COMPUTE_POLICY_REF) {
      return fail(
        'lineage_mismatch',
        `job "${job.job_id}" declares policy "${job.lineage.policy}" but the scripted compute generator runs "${SCRIPT_COMPUTE_POLICY_REF}" — the declared policy is the contract (L9)`,
        'task.job.lineage.policy',
      );
    }

    const specCheck = validateEnvironmentSpec(spec);
    if (!specCheck.ok) return fail('invalid_field', 'the scripted compute spec failed its own mirror validation (impossible by construction)');

    // One trainer per task: configured from the job's declared driver
    // configuration (the T013 trainer mirrors).
    const trainerResult = createReferenceTrainer({
      actor: job.driver.actor,
      step_ms: job.driver.step_ms,
      runtime: job.driver.runtime,
      body_versions: [...job.driver.body_versions],
      substrates: [...job.driver.substrates],
      ...(job.driver.data === undefined ? {} : { data: [...job.driver.data] }),
    });
    if (!trainerResult.ok) return fromRl(trainerResult);

    const results: JobResult[] = [];
    for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) {
      const seed = episodeSeedAt(job, ordinal);

      // One training-run drive per episode — the declaration derives from
      // the job + the ABSOLUTE ordinal (worker-count-independent by law).
      const runId = `run-${job.job_id}-${ordinal}` as TrainingRunId;
      const declaration = deepFreeze({
        run_id: runId,
        method: 'rl',
        environment_spec: spec,
        reward_models: [...job.lineage.reward_models],
        step_budget: job.step_budget,
        seed,
        tenant: job.lineage.tenant,
        project: job.lineage.project,
      });
      let run = trainerResult.value.prepareRun(declaration);
      if (!run.ok) return fromRl(run);

      // A FRESH world per episode (the scripted world serves one episode)
      // and the policy keyed to the episode's derived seed.
      const world = createScriptedEnvironment(
        scriptedWorldOptions({
          seed,
          baseTime: SCRIPT_COMPUTE_BASE_TIME,
          asOf: (SCRIPT_COMPUTE_BASE_TIME + SCRIPT_COMPUTE_TICKS * job.driver.step_ms) as TimestampMs,
          stepMs: job.driver.step_ms,
          ticks: SCRIPT_COMPUTE_TICKS,
          emitRewards: true,
        }),
      );
      const policy = createScriptedPolicy(seed);

      run = trainerResult.value.driveEpisode(run.value, world, policy);
      if (!run.ok) return fromRl(run);

      const line = run.value.episodes[0];
      if (line === undefined) {
        return fail('invalid_run_state', `the T013 drive of job "${job.job_id}" ordinal ${ordinal} recorded no episode (impossible when driveEpisode succeeds)`);
      }
      const steps = line.steps;
      const digest = scriptEpisodeDigest(seed, steps);
      const startedAt = spec.profile.clock.now;
      const lastStep = steps[steps.length - 1];
      const endedAt = (lastStep === undefined ? startedAt : lastStep.clock.now) as TimestampMs;
      const chainHead = run.value.step_chain[run.value.step_chain.length - 1] ?? null;

      const result = validateJobResult({
        kind: 'result',
        submission: task.submission,
        job: job.job_id,
        worker,
        episode_index: ordinal,
        seed,
        episode: line.episode as EpisodeId,
        digest,
        trial: {
          trial_id: deriveJobTrialId(job.job_id, ordinal),
          arm: job.arm,
          status: 'succeeded',
          trajectory: deriveJobTrajectoryId(job.job_id, ordinal),
          // Pure generation DATA — never an acceptance verdict (L7).
          outcome: { steps: steps.length, digest, chain_head: chainHead },
          started_at: startedAt,
          ended_at: endedAt,
          failure_reason: null,
        },
        lineage: job.lineage,
      });
      if (!result.ok) return result;
      results.push(result.value);
    }
    return ok(deepFreeze(results));
  };
}

/** Compile-time witness: the generator's result satisfies the compute contract. */
export function generatorResultShape(witness: ComputeResult<readonly JobResult[]>): ComputeResult<readonly JobResult[]> {
  return witness;
}
