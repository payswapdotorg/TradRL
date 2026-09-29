// @tradrl/research (service) — the resumable, chain-verified run state.
//
// Work Order T021, section 5: "resumable run state (serialize -> parse ->
// resume, chain-verified)."
//
// The discipline mirrors services/body-forge's attempt log (T017):
// - Every pipeline stage completion appends a step record carrying a
//   CHAINED digest (`stableDigest(prevChain + canonicalJson(step))`); the
//   state's `chainHead` is the last step's digest ('genesis' before any).
// - `parseSentimentRunState` validates the record AND RECOMPUTES the
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
  type ObservationSource,
  type ResearchError,
  type ResearchPublicationPort,
  type ResearchResult,
  type SentimentResearcherBodySpec,
  type UnsupportedObservation,
  type ResearchObservation,
  SENTIMENT_RESEARCHER_BODY,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  type TimestampMs,
} from './imports';
import {
  type ResearchRunConfig,
  type ResearchRunOutcome,
  researchRunId,
  runIntake,
  runResearchPipeline,
  validateResearchRunConfig,
} from './pipeline';

// ---------------------------------------------------------------------------
// The step chain (append-only; genesis -> intake -> ... -> published)
// ---------------------------------------------------------------------------

/** The schema version of the run-state record (parse gate). */
export const SENTIMENT_RUN_STATE_SCHEMA = 1;

/** One completed pipeline stage: ordinal, stage name, note, chained digest. */
export interface SentimentRunStep {
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
function withStep(state: SentimentRunState, stage: string, note: string): SentimentRunState {
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
export interface SentimentRunState {
  readonly schemaVersion: number;
  /** DERIVED: `research-run-<digest of the config>` — never accepted. */
  readonly runId: string;
  readonly config: ResearchRunConfig;
  readonly steps: readonly SentimentRunStep[];
  /** The chain head: the last step's digest, or 'genesis'. */
  readonly chainHead: string;
  readonly admitted: readonly ResearchObservation[];
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly coverage: CoverageAccounting;
  /** The report ids this run has published (a published run is immutable). */
  readonly publishedReportIds: readonly string[];
}

/** The empty run state for a config (genesis — zero steps). */
export function createSentimentRunState(config: ResearchRunConfig): SentimentRunState {
  const errors = validateResearchRunConfig(config);
  if (errors.length > 0) {
    throw new TypeError(`createSentimentRunState: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return deepFreeze({
    schemaVersion: SENTIMENT_RUN_STATE_SCHEMA,
    runId: researchRunId(config),
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
export function serializeSentimentRunState(state: SentimentRunState): string {
  return canonicalJson(state as never);
}

// ---------------------------------------------------------------------------
// Parsing + chain verification
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run-state record (structure + laws). */
export function validateSentimentRunState(v: unknown): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) {
    return [{ code: 'invalid_type', path: 'runState', message: 'must be a run-state object' }];
  }
  if (v.schemaVersion !== SENTIMENT_RUN_STATE_SCHEMA) {
    errors.push({
      code: 'schema_version_mismatch',
      path: 'schemaVersion',
      message: `expected schema ${SENTIMENT_RUN_STATE_SCHEMA}, found ${JSON.stringify(v.schemaVersion)}`,
    });
  }
  const configErrors = validateResearchRunConfig(v.config);
  if (configErrors.length > 0) {
    errors.push(...configErrors.map((e) => ({ ...e, path: `config.${e.path}` })));
    return errors;
  }
  const config = v.config as ResearchRunConfig;
  if (v.runId !== researchRunId(config)) {
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
export function parseSentimentRunState(bytes: string): ResearchResult<SentimentRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return {
      ok: false,
      errors: [{ code: 'invalid_type', path: 'runState', message: 'run-state bytes must be canonical JSON' }],
    };
  }
  const errors = validateSentimentRunState(parsed);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(parsed as SentimentRunState) };
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
export function intakeSentimentRunState(
  state: SentimentRunState,
  sources: readonly ObservationSource[],
): ResearchResult<SentimentRunState> {
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
  const intake = runIntake(sources, state.config.asOf);
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

  const merged: SentimentRunState = deepFreeze({
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
export interface SentimentRunCompletion {
  readonly state: SentimentRunState;
  readonly outcome: ResearchRunOutcome;
}

/**
 * COMPLETE: runs the pipeline's research stages over the RETAINED
 * admitted set and publishes exactly once through the envelope-mirror
 * port, appending the four remaining steps. A published run refuses to
 * complete again.
 */
export function completeSentimentRunState(
  state: SentimentRunState,
  publisher: ResearchPublicationPort,
  bodySpec: SentimentResearcherBodySpec = SENTIMENT_RESEARCHER_BODY,
): ResearchResult<SentimentRunCompletion> {
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
    descriptor: { id: 'research-run-retained', version: '1.0.0', provider: 'tradrl-research' },
    next(): ResearchObservation | null {
      return queue.length > 0 ? (queue.shift() as ResearchObservation) : null;
    },
  };
  const outcome = runResearchPipeline(
    state.config,
    { sources: [mergedSource], publisher },
    bodySpec,
  );
  if (!outcome.ok) return outcome;

  const completed: SentimentRunState = withStep(
    withStep(
      withStep(
        withStep(
          deepFreeze({ ...state, publishedReportIds: deepFreeze([outcome.value.reportId]) }),
          'aggregate',
          `readings=${outcome.value.readings.length}`,
        ),
        'detect-events',
        `digests=${outcome.value.digests.length}`,
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
export function advanceSentimentRunState(
  state: SentimentRunState,
  inputs: { readonly sources: readonly ObservationSource[]; readonly publisher: ResearchPublicationPort },
  bodySpec: SentimentResearcherBodySpec = SENTIMENT_RESEARCHER_BODY,
): ResearchResult<SentimentRunCompletion> {
  const intake = intakeSentimentRunState(state, inputs.sources);
  if (!intake.ok) return intake;
  return completeSentimentRunState(intake.value, inputs.publisher, bodySpec);
}

/**
 * THE RESUME: parse canonical bytes (chain-verified), intake the fresh
 * sources into the recovered state, then complete the run (publish).
 * Serialize -> parse -> resume, end to end.
 */
export function resumeSentimentRunState(
  bytes: string,
  inputs: { readonly sources: readonly ObservationSource[]; readonly publisher: ResearchPublicationPort },
  bodySpec: SentimentResearcherBodySpec = SENTIMENT_RESEARCHER_BODY,
): ResearchResult<SentimentRunCompletion> {
  const parsed = parseSentimentRunState(bytes);
  if (!parsed.ok) return parsed;
  return advanceSentimentRunState(parsed.value, inputs, bodySpec);
}
