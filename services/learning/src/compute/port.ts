/**
 * @tradrl/learning (service) — the scripted fake ComputePort (T014 test
 * fixture).
 *
 * A deterministic in-memory substrate implementing the contract package's
 * {@link ComputePort}: submit executes the task EAGERLY through an
 * injected {@link EpisodeGenerator} under a deterministic worker
 * assignment (slot -> worker), and collect() drains the emissions in
 * scripted rounds. The script can inject the distributed-lane failure
 * modes the acceptance criteria demand:
 *
 *   - `duplicate` — at-least-once re-execution: the duplicated submission
 *     executes a SECOND time under the NEXT worker (identical digests —
 *     the aggregate must deduplicate);
 *   - `corrupt` — mutate the duplicate copy's digest or trial record (the
 *     DIVERGENCE trip wire's test instrument — same key, contradicting
 *     evidence);
 *   - `fail` — a task fails: emit `keep_results` results then a RETAINED
 *     failure record (the L11 manifest's input);
 *   - `vanish` — a task's outcomes never surface (the failure_hidden trip
 *     wire's input — a worker lost mid-flight);
 *   - `reverse` — emit in reversed order (completion reordering: the
 *     aggregate is order-independent);
 *   - `rounds` — split the emissions across N collect rounds (partial
 *     progress: the resume flow's input).
 *
 * The fixture is deterministic given (script, submit order): same script,
 * same emissions, twice. Substrate error codes are the port's own plain
 * string vocabulary (the contract maps them onto `port_error`).
 */

import {
  deepFreeze,
  isComputeTask,
  validateJobFailure,
  type ComputePort,
  type ComputeResult,
  type ComputeTask,
  type FailureKind,
  type JobFailure,
  type JobResult,
  type JobOutcome,
  type SubmissionId,
  type WorkerRef,
} from '../../../../packages/compute/src/index';

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

/** One scripted task failure: the retained record the substrate reports. */
export interface ScriptedFailurePlan {
  readonly submission: SubmissionId;
  readonly kind: FailureKind;
  readonly detail?: string;
  /** How many leading results to emit before failing (default 0). */
  readonly keep_results?: number;
}

/** The scripted substrate's behavior controls (all optional except workers + generator). */
export interface ScriptedComputePortOptions {
  /** The substrate's workers (non-empty; slot i is served by workers[i % length]). */
  readonly workers: readonly WorkerRef[];
  /** The executing generator (the reference: createDriverEpisodeGenerator). */
  readonly generator: (task: ComputeTask, worker: WorkerRef) => ComputeResult<readonly JobResult[]>;
  /** Submissions to execute TWICE (at-least-once re-execution). */
  readonly duplicate?: readonly SubmissionId[];
  /** Mutate the duplicate copy (the divergence trip wire's instrument). */
  readonly corrupt?: 'digest' | 'trial';
  /** Tasks that fail: results up to keep_results, then a retained failure record. */
  readonly fail?: readonly ScriptedFailurePlan[];
  /** Tasks whose outcomes never surface (worker lost mid-flight). */
  readonly vanish?: readonly SubmissionId[];
  /** Emit in reversed order (completion reordering). */
  readonly reverse?: boolean;
  /** Split the emissions across N collect rounds (default 1: everything at once). */
  readonly rounds?: number;
}

// ---------------------------------------------------------------------------
// The scripted port
// ---------------------------------------------------------------------------

/**
 * Create the scripted fake compute port. Deterministic: the same (script,
 * submit order) yields the same emissions — tests rely on it as their
 * substrate oracle.
 */
export function createScriptedComputePort(options: ScriptedComputePortOptions): ComputePort {
  const workers = options.workers;
  const rounds = options.rounds === undefined ? 1 : Math.max(1, Math.floor(options.rounds));
  const duplicate = new Set<string>((options.duplicate ?? []).map((id) => id as string));
  const vanish = new Set<string>((options.vanish ?? []).map((id) => id as string));
  const failures = new Map<string, ScriptedFailurePlan>((options.fail ?? []).map((plan) => [plan.submission as string, plan]));

  const submitted = new Set<string>();
  const queue: JobOutcome[] = [];
  let reversed = false;
  let collects = 0;

  const workerFor = (task: ComputeTask): WorkerRef => workers[(task.slot % workers.length) as number] as WorkerRef;
  const reexecutionWorkerFor = (task: ComputeTask): WorkerRef => workers[((task.slot + 1) % workers.length) as number] as WorkerRef;

  /** Corrupt a duplicate deterministically while keeping the record guard-valid. */
  const corruptResult = (result: JobResult): JobResult => {
    if (options.corrupt === 'digest') {
      // Flip the first hex char (0 <-> 1): still an 8-char lowercase digest,
      // so the DIVERGENCE check fires (not the shape validator).
      const digest = result.digest.startsWith('1') ? `0${result.digest.slice(1)}` : `1${result.digest.slice(1)}`;
      return deepFreeze({ ...result, digest });
    }
    // corrupt === 'trial': same digest, contradicting outcome content.
    const steps = result.trial.outcome === null ? 0 : (result.trial.outcome.steps as number);
    const outcome = { ...(result.trial.outcome ?? {}), steps: steps + 1 };
    return deepFreeze({ ...result, trial: deepFreeze({ ...result.trial, outcome }) });
  };

  return {
    submit(task: ComputeTask): { readonly ok: true; readonly value: SubmissionId } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] } {
      if (!isComputeTask(task)) {
        return { ok: false, errors: [{ code: 'invalid_task', path: '', message: 'submit requires a structurally valid compute task' }] };
      }
      if (submitted.has(task.submission)) {
        return { ok: false, errors: [{ code: 'duplicate_submission', path: '', message: `submission "${task.submission}" was already accepted` }] };
      }
      submitted.add(task.submission);

      if (vanish.has(task.submission)) {
        // The worker was lost mid-flight: accepted, executed, never reported.
        return { ok: true, value: task.submission };
      }

      const emitFailure = (kind: FailureKind, detail: string): void => {
        const failure = validateJobFailure({
          kind: 'failure',
          submission: task.submission,
          job: task.job.job_id,
          worker: workerFor(task),
          failure_kind: kind,
          detail,
          lineage: task.job.lineage,
        });
        // A fixture-internal validation failure is a fixture bug; the
        // contract's own validator is the authority.
        if (failure.ok) queue.push(failure.value);
      };

      const generated = options.generator(task, workerFor(task));
      if (!generated.ok) {
        // The worker's generation itself failed: a RETAINED protocol
        // failure record (L11 — failures are records, not exceptions).
        const first = generated.errors[0];
        emitFailure('protocol', `[${first?.code ?? 'unknown'}] ${first?.message ?? 'generation failed'}`);
        return { ok: true, value: task.submission };
      }

      const plan = failures.get(task.submission);
      if (plan !== undefined) {
        for (const result of generated.value.slice(0, plan.keep_results ?? 0)) queue.push(result);
        emitFailure(plan.kind, plan.detail ?? `scripted ${plan.kind} of job "${task.job.job_id}" slot ${task.slot}`);
        return { ok: true, value: task.submission };
      }

      for (const result of generated.value) queue.push(result);

      if (duplicate.has(task.submission)) {
        // At-least-once re-execution under the NEXT worker (identical
        // content — the aggregate must deduplicate by digest equality).
        const reexecuted = options.generator(task, reexecutionWorkerFor(task));
        if (!reexecuted.ok) {
          const first = reexecuted.errors[0];
          emitFailure('protocol', `re-execution failed: [${first?.code ?? 'unknown'}] ${first?.message ?? 'generation failed'}`);
          return { ok: true, value: task.submission };
        }
        for (const result of reexecuted.value) {
          queue.push(options.corrupt === undefined ? result : corruptResult(result));
        }
      }
      return { ok: true, value: task.submission };
    },

    collect(): { readonly ok: true; readonly value: readonly JobOutcome[] } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] } {
      if (options.reverse === true && !reversed) {
        queue.reverse();
        reversed = true;
      }
      const perRound = Math.ceil(queue.length / rounds);
      const chunk = queue.splice(0, perRound);
      collects += 1;
      return { ok: true, value: deepFreeze(chunk) };
    },

    cancel(submission: SubmissionId): { readonly ok: true; readonly value: true } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] } {
      if (!submitted.has(submission)) {
        return { ok: false, errors: [{ code: 'unknown_submission', path: '', message: `submission "${submission}" was never accepted` }] };
      }
      // Retract PENDING work only — already-collected outcomes stay
      // collected (history is never rewritten).
      for (let index = queue.length - 1; index >= 0; index--) {
        if ((queue[index] as JobOutcome).submission === submission) queue.splice(index, 1);
      }
      return { ok: true, value: true };
    },
  };
}

/** The scripted port's PortResult shape (the substrate's own error vocabulary). */
export type ScriptedPortReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };
