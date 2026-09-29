// @tradrl/research (service) — the fundamental lane's resumable, chain-verified run state.
//
// Work Order T023, section 5: "resumable run states (serialize ->
// parse -> resume, chain-verified)." (the fundamental lane).
//
// The discipline mirrors services/body-forge's attempt log (T017):
// - Every pipeline stage completion appends a step record carrying a
//   CHAINED digest (`stableDigest(prevChain + canonicalJson(step))`); the
//   state's `chainHead` is the last step's digest ('genesis' before any).
// - `parseFundamentalRunState` validates the record AND RECOMPUTES the
//   chain from genesis — a state that does not land exactly on its
//   recorded head is a forgery (`chain_mismatch`, L9).
// - The run id is DERIVED from the config; a state whose id does not
//   match its config is a forgery (`run_config_mismatch`).
//
// Resume semantics (the honest shape): a run is a two-phase protocol —
//   INTAKE  (repeatable): pull sources, admit under the L4 gate, append
//            observations to the retained set (duplicate observation ids
//            are the `duplicate_observation_ref` typed error);
//   COMPLETE (once):      aggregate -> detect -> compose -> PUBLISH
//            through the envelope-mirror port, append the remaining
//            steps, mark the run published.
// A published run is immutable: every further intake or completion is
// refused (`run_config_mismatch` — the L3 discipline for runs).
//
// No ambient clock; no randomness; serialization is canonical JSON
// (byte-deterministic, L9).

import {
  type CoverageAccounting,
  type DeferredObservation,
  type FundamentalObservationSource,
  type FundamentalError,
  type FundamentalPublicationPort,
  type FundamentalResult,
  type FundamentalResearcherBodySpec,
  type UnsupportedObservation,
  type FundamentalObservation,
  FUNDAMENTAL_RESEARCHER_BODY,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  type TimestampMs,
} from './imports';
import {
  type FundamentalRunConfig,
  type FundamentalRunOutcome,
  fundamentalRunId,
  runFundamentalIntake,
  runFundamentalPipeline,
  validateFundamentalRunConfig,
} from './pipeline';

// ---------------------------------------------------------------------------
// The step chain (append-only; genesis -> intake -> ... -> published)
// ---------------------------------------------------------------------------

/** The schema version of the run-state record (parse gate). */
export const FUNDAMENTAL_RUN_STATE_SCHEMA = 1;

/** One completed pipeline stage: ordinal, stage name, note, chained digest. */
export interface FundamentalRunStep {
  readonly stage: string;
  readonly ordinal: number;
  readonly note: string;
  readonly chainDigest: string;
}

/** The chain digest of a step given its predecessor's digest. */
function stepChainDigest(previous: string, stage: string, ordinal: number, note: string): string {
  return stableDigest(`${previous}:${canonicalJson({ stage, ordinal, note } as never)}`);
}

/** Appends a step to a state (pure — returns the extended state). */
function withStep(state: FundamentalRunState, stage: string, note: string): FundamentalRunState {
  const ordinal = state.steps.length + 1;
  const chainDigest = stepChainDigest(state.chainHead, stage, ordinal, note);
  return deepFreeze({
    ...state,
    steps: deepFreeze([...state.steps, deepFreeze({ stage, ordinal, note, chainDigest })]),
    chainHead: chainDigest,
  });
}

// ---------------------------------------------------------------------------
// The run-state record
// ---------------------------------------------------------------------------

/**
 * The resumable run state: the config binding, the append-only step
 * chain, the retained intake (admitted/deferred/unsupported + coverage),
 * and the publication log. JSON-serializable end to end.
 */
export interface FundamentalRunState {
  readonly schemaVersion: number;
  /** DERIVED: `fundamental-run-<digest of the config>` — never accepted. */
  readonly runId: string;
  readonly config: FundamentalRunConfig;
  readonly steps: readonly FundamentalRunStep[];
  /** The chain head: the last step's digest, or 'genesis'. */
  readonly chainHead: string;
  readonly admitted: readonly FundamentalObservation[];
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly coverage: CoverageAccounting;
  /** The report ids this run has published (a published run is immutable). */
  readonly publishedReportIds: readonly string[];
}

/** The empty run state for a config (genesis — zero steps). */
export function createFundamentalRunState(config: FundamentalRunConfig): FundamentalRunState {
  const errors = validateFundamentalRunConfig(config);
  if (errors.length > 0) {
    throw new TypeError(`createFundamentalRunState: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return deepFreeze({
    schemaVersion: FUNDAMENTAL_RUN_STATE_SCHEMA,
    runId: fundamentalRunId(config),
    config,
    steps: [],
    chainHead: 'genesis',
    admitted: [],
    deferred: [],
    unsupported: [],
    coverage: deepFreeze({
      observationsOffered: 0,
      observationsAdmitted: 0,
      observationsDeferred: 0,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    }),
    publishedReportIds: [],
  });
}

// ---------------------------------------------------------------------------
// Serialization (canonical JSON — byte-deterministic, L9)
// ---------------------------------------------------------------------------

/** Serializes a run state to its canonical JSON bytes. */
export function serializeFundamentalRunState(state: FundamentalRunState): string {
  return canonicalJson(state as never);
}

// ---------------------------------------------------------------------------
// Parsing + chain verification
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run-state record (structure + laws). */
export function validateFundamentalRunState(v: unknown): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) {
    return [{ code: 'invalid_type', path: 'runState', message: 'must be a run-state object' }];
  }
  if (v.schemaVersion !== FUNDAMENTAL_RUN_STATE_SCHEMA) {
    errors.push({
      code: 'schema_version_mismatch',
      path: 'schemaVersion',
      message: `expected schema ${FUNDAMENTAL_RUN_STATE_SCHEMA}, found ${JSON.stringify(v.schemaVersion)}`,
    });
  }
  const configErrors = validateFundamentalRunConfig(v.config);
  if (configErrors.length > 0) {
    errors.push(...configErrors.map((e) => ({ ...e, path: `config.${e.path}` })));
    return errors;
  }
  const config = v.config as FundamentalRunConfig;
  if (v.runId !== fundamentalRunId(config)) {
    // a run id that does not match its lineage is a forgery — L9
    errors.push({
      code: 'run_config_mismatch',
      path: 'runId',
      message: 'the run id does not match its config — the run identity was tampered with',
    });
  }
  if (!isTimestampMs((v.config as { asOf: number }).asOf)) {
    errors.push({ code: 'invalid_field', path: 'config.asOf', message: 'must be a valid instant' });
  }
  if (!Array.isArray(v.steps)) {
    errors.push({ code: 'invalid_type', path: 'steps', message: 'must be an array of run steps' });
    return errors;
  }
  const steps = v.steps as readonly unknown[];
  // THE CHAIN: recompute from genesis and land exactly on chainHead.
  let chain = 'genesis';
  let ordinal = 0;
  for (const step of steps) {
    ordinal += 1;
    if (
      !isRecord(step) ||
      !isNonEmptyString(step.stage) ||
      typeof step.ordinal !== 'number' ||
      !isNonEmptyString(step.note)
    ) {
      errors.push({
        code: 'invalid_field',
        path: `steps[${ordinal - 1}]`,
        message: 'must be { stage, ordinal, note, chainDigest }',
      });
      continue;
    }
    if ((step.ordinal as number) !== ordinal) {
      errors.push({
        code: 'chain_mismatch',
        path: `steps[${ordinal - 1}].ordinal`,
        message: 'run steps are 1-based and append-only — a hidden or reordered step is a rewrite',
      });
    }
    const expected = stepChainDigest(chain, step.stage as string, ordinal, step.note as string);
    if (step.chainDigest !== expected) {
      errors.push({
        code: 'chain_mismatch',
        path: `steps[${ordinal - 1}].chainDigest`,
        message: 'the step digest does not match its chain position — the step log was rewritten',
      });
    }
    chain = expected;
  }
  if (isNonEmptyString(v.chainHead) && v.chainHead !== chain) {
    errors.push({
      code: 'chain_mismatch',
      path: 'chainHead',
      message: 'the chain head does not match the recomputed chain — the state was tampered with',
    });
  }
  return errors;
}

/** Parses canonical run-state bytes (structure + chain verified). */
export function parseFundamentalRunState(bytes: string): FundamentalResult<FundamentalRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return {
      ok: false,
      errors: [{ code: 'invalid_type', path: 'runState', message: 'run-state bytes must be canonical JSON' }],
    };
  }
  const errors = validateFundamentalRunState(parsed);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(parsed as FundamentalRunState) };
}

// ---------------------------------------------------------------------------
// The intake phase (repeatable; no publication)
// ---------------------------------------------------------------------------

/**
 * INTAKE: pulls the given sources under the run's as-of instant, admits
 * the knowable observations into the retained set, records the deferred
 * and unsupported buckets, and appends the two intake steps to the
 * chain. Duplicate observation ids are refused (evidence ids are
 * unique). A published run refuses further intake.
 */
export function intakeFundamentalRunState(
  state: FundamentalRunState,
  sources: readonly FundamentalObservationSource[],
): FundamentalResult<FundamentalRunState> {
  if (state.publishedReportIds.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'run_config_mismatch',
          path: 'publishedReportIds',
          message: 'this run already published its report — a published run is immutable',
        },
      ],
    };
  }
  const intake = runFundamentalIntake(sources, state.config.asOf);
  if (!intake.ok) return intake;

  // merge with the retained observations (evidence ids are unique)
  const seen = new Set(state.admitted.map((o) => o.event_id));
  for (const observation of intake.value.admitted) {
    if (seen.has(observation.event_id)) {
      return {
        ok: false,
        errors: [
          {
            code: 'duplicate_observation_ref',
            path: 'admitted',
            message: `observation ${JSON.stringify(observation.event_id)} was already admitted by this run — evidence ids are unique`,
          },
        ],
      };
    }
    seen.add(observation.event_id);
  }

  const merged: FundamentalRunState = deepFreeze({
    ...state,
    admitted: deepFreeze([...state.admitted, ...intake.value.admitted]),
    deferred: deepFreeze([...state.deferred, ...intake.value.deferred]),
    unsupported: deepFreeze([...state.unsupported, ...intake.value.unsupported]),
    coverage: deepFreeze({
      observationsOffered: state.coverage.observationsOffered + intake.value.coverage.observationsOffered,
      observationsAdmitted: state.coverage.observationsAdmitted + intake.value.coverage.observationsAdmitted,
      observationsDeferred: state.coverage.observationsDeferred + intake.value.coverage.observationsDeferred,
      observationsUnsupported: state.coverage.observationsUnsupported + intake.value.coverage.observationsUnsupported,
      observationsInvalid: state.coverage.observationsInvalid + intake.value.coverage.observationsInvalid,
    }),
  });
  return {
    ok: true,
    value: withStep(
      withStep(
        merged,
        'intake',
        `offered=${merged.coverage.observationsOffered},admitted=${merged.coverage.observationsAdmitted}`,
      ),
      'l4-gate',
      `deferred=${merged.coverage.observationsDeferred},unsupported=${merged.coverage.observationsUnsupported},invalid=${merged.coverage.observationsInvalid}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// The completion phase (once; publishes)
// ---------------------------------------------------------------------------

/** The result of completing a run state. */
export interface FundamentalRunCompletion {
  readonly state: FundamentalRunState;
  readonly outcome: FundamentalRunOutcome;
}

/**
 * COMPLETE: runs the pipeline's research stages over the RETAINED
 * admitted set and publishes exactly once through the envelope-mirror
 * port, appending the four remaining steps. A published run refuses to
 * complete again.
 */
export function completeFundamentalRunState(
  state: FundamentalRunState,
  publisher: FundamentalPublicationPort,
  bodySpec: FundamentalResearcherBodySpec = FUNDAMENTAL_RESEARCHER_BODY,
): FundamentalResult<FundamentalRunCompletion> {
  if (state.publishedReportIds.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'run_config_mismatch',
          path: 'publishedReportIds',
          message: 'this run already published its report — a published run is immutable',
        },
      ],
    };
  }
  // the pipeline's own L8 gate runs here (the doctored-spec refusal)
  const queue = state.admitted.slice();
  const mergedSource = {
    descriptor: { id: 'fundamental-run-retained', version: '1.0.0', provider: 'tradrl-research' },
    next(): FundamentalObservation | null {
      return queue.length > 0 ? (queue.shift() as FundamentalObservation) : null;
    },
  };
  const outcome = runFundamentalPipeline(
    state.config,
    { sources: [mergedSource], publisher },
    bodySpec,
  );
  if (!outcome.ok) return outcome;

  const completed: FundamentalRunState = withStep(
    withStep(
      withStep(
        withStep(
          deepFreeze({ ...state, publishedReportIds: deepFreeze([outcome.value.reportId]) }),
          'assess',
          `assessments=${outcome.value.assessments.length}`,
        ),
        'digest-actions',
        `digests=${outcome.value.actionDigests.length}`,
      ),
      'compose',
      `report=${outcome.value.reportId}`,
    ),
    'publish',
    `published=${outcome.value.reportId}`,
  );
  return { ok: true, value: deepFreeze({ state: completed, outcome: outcome.value }) };
}

// ---------------------------------------------------------------------------
// The one-pass convenience + the resume
// ---------------------------------------------------------------------------

/**
 * The one-pass run: intake the sources, then complete (publish). This is
 * the single-shot shape of the declared research-cycle procedure.
 */
export function advanceFundamentalRunState(
  state: FundamentalRunState,
  inputs: { readonly sources: readonly FundamentalObservationSource[]; readonly publisher: FundamentalPublicationPort },
  bodySpec: FundamentalResearcherBodySpec = FUNDAMENTAL_RESEARCHER_BODY,
): FundamentalResult<FundamentalRunCompletion> {
  const intake = intakeFundamentalRunState(state, inputs.sources);
  if (!intake.ok) return intake;
  return completeFundamentalRunState(intake.value, inputs.publisher, bodySpec);
}

/**
 * THE RESUME: parse canonical bytes (chain-verified), intake the fresh
 * sources into the recovered state, then complete the run (publish).
 * Serialize -> parse -> resume, end to end.
 */
export function resumeFundamentalRunState(
  bytes: string,
  inputs: { readonly sources: readonly FundamentalObservationSource[]; readonly publisher: FundamentalPublicationPort },
  bodySpec: FundamentalResearcherBodySpec = FUNDAMENTAL_RESEARCHER_BODY,
): FundamentalResult<FundamentalRunCompletion> {
  const parsed = parseFundamentalRunState(bytes);
  if (!parsed.ok) return parsed;
  return advanceFundamentalRunState(parsed.value, inputs, bodySpec);
}
