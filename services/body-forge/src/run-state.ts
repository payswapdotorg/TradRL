/**
 * @tradrl/body-forge (service) — the resumable forge run state.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017, section 5 — "Resumable
 * forge run state (serialize -> parse -> resume, chain-verified)."
 *
 * The run state binds the forge's identity (run id, forge version, seed,
 * L12 scope) to its APPEND-ONLY attempt log (L11). The full round trip:
 *
 *   createForgeRunState(...) -> ForgeRunState
 *   forgeForRun(state, forgeInput, attemptedAt)
 *       -> { state: NEW state with the attempt appended, candidate? }    (pure)
 *   serializeForgeRunState(state) -> canonical JSON bytes               (L9)
 *   parseForgeRunState(bytes) -> SkillResult<ForgeRunState>             (chain-verified)
 *   resumeForgeRunState(bytes, forgeInput, attemptedAt)
 *       -> SkillResult<{ state, candidate? }>                            (parse + forge + append)
 *
 * Chain verification on parse: every attempt's chain link is recomputed
 * from the genesis and must land exactly on the recorded head
 * (`validateAttemptLog` — the L11 trip wires: `attempt_hidden`,
 * `attempt_rewrite`). A tampered byte anywhere in the log breaks the chain
 * and the parse REFUSES.
 *
 * Determinism: the run id is a pure FNV-1a function of (forgeVersion,
 * seed, tenant, project); the attempt ids are pure functions of
 * (forgeVersion, seed, ordinal). Same run identity, same attempts,
 * byte-identical serialization — twice, forever. No ambient clock
 * anywhere: every instant is an explicit parameter.
 */

import {
  type SkillError,
  type SkillResult,
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  fnv1a32,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
} from '../../../packages/skills/src/index';
import type { ForgedCandidate, ForgeResultValue } from './forge';
import { forgeBodyVersion } from './forge';
import {
  type AttemptLog,
  type ForgeAttempt,
  appendAttempt,
  createAttemptLog,
  forgeAttemptOf,
  validateAttemptLog,
} from './attempt-log';

// ---------------------------------------------------------------------------
// The run state
// ---------------------------------------------------------------------------

/** The run-state schema version (serialized forward-compatibility gate). */
export const FORGE_RUN_STATE_SCHEMA = 1;

/**
 * The resumable forge run state: the run identity (version, seed, L12
 * scope, derived run id) plus the append-only attempt log. Deeply frozen;
 * every transition returns a NEW state.
 */
export interface ForgeRunState {
  /** The schema version (must equal FORGE_RUN_STATE_SCHEMA on parse). */
  readonly schemaVersion: number;
  /** Deterministic derived id: pure FNV-1a of (forgeVersion, seed, tenant, project). */
  readonly runId: string;
  readonly forgeVersion: string;
  readonly seed: string;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Owning project (L12). */
  readonly projectId: string;
  /** The append-only attempt log (L11). */
  readonly log: AttemptLog;
}

/** Guard: `ForgeRunState` (structural; the log's law via `validateForgeRunState`). */
export function isForgeRunState(v: unknown): v is ForgeRunState {
  if (!isRecord(v)) return false;
  if (v.schemaVersion !== FORGE_RUN_STATE_SCHEMA) return false;
  if (!isNonEmptyString(v.runId)) return false;
  if (!isNonEmptyString(v.forgeVersion)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isNonEmptyString(v.tenantId)) return false;
  if (!isNonEmptyString(v.projectId)) return false;
  return isRecord(v.log);
}

/** Derives the run id: pure FNV-1a of (forgeVersion, seed, tenant, project). */
export function deriveForgeRunId(forgeVersion: string, seed: string, tenantId: string, projectId: string): string {
  return `forge-run-${fnv1a32(`${forgeVersion}|${seed}|${tenantId}|${projectId}`).toString(16).padStart(8, '0')}`;
}

/**
 * Creates a fresh run state (the genesis state: an empty attempt log).
 * The forge version and the seed are BOUND here — every resumed attempt
 * must agree with them (lineage coherence, L9). Deeply frozen.
 */
export function createForgeRunState(input: {
  readonly forgeVersion: string;
  readonly seed: string;
  readonly tenantId: string;
  readonly projectId: string;
}): ForgeRunState {
  const problems: string[] = [];
  if (!isNonEmptyString(input.forgeVersion)) problems.push('forgeVersion: must be a non-empty version reference');
  if (!isNonEmptyString(input.seed)) {
    problems.push('seed: the forge run must be seeded — there is no ambient randomness (the determinism law)');
  }
  if (!isNonEmptyString(input.tenantId)) problems.push('tenantId: must be a non-empty tenant id (L12)');
  if (!isNonEmptyString(input.projectId)) problems.push('projectId: must be a non-empty project id (L12)');
  if (problems.length > 0) {
    throw new TypeError(`createForgeRunState: ${problems.join('; ')}`);
  }
  return deepFreeze({
    schemaVersion: FORGE_RUN_STATE_SCHEMA,
    runId: deriveForgeRunId(input.forgeVersion, input.seed, input.tenantId, input.projectId),
    forgeVersion: input.forgeVersion,
    seed: input.seed,
    tenantId: input.tenantId,
    projectId: input.projectId,
    log: createAttemptLog(),
  });
}

// ---------------------------------------------------------------------------
// Forge-for-run (the pure transition)
// ---------------------------------------------------------------------------

/**
 * The result of one forge-for-run transition: the NEW state (with the
 * attempt appended — minted OR rejected, both retained), the minted
 * candidate (or `null` on refusal), and the attempt record itself.
 */
export interface ForgeForRunResult {
  readonly state: ForgeRunState;
  readonly candidate: ForgedCandidate | null;
  readonly attempt: ForgeAttempt;
}

/**
 * Runs ONE forge attempt under a run state and appends it to the log
 * (PURE — returns a NEW state; the input state is never mutated):
 *
 * 1. Scope + identity coherence: the forge input must carry the run's
 *    forge version, seed, tenant and project (L9/L12 — a resumed run
 *    cannot silently switch lineage).
 * 2. `forgeBodyVersion` mints (or refuses with structured reasons — DATA).
 * 3. The attempt is built (`forgeAttemptOf` — chain-linked) and appended
 *    (`appendAttempt` — the L11 laws).
 */
export function forgeForRun(
  state: ForgeRunState,
  forgeInput: unknown,
  attemptedAt: TimestampMs,
): SkillResult<ForgeForRunResult> {
  if (!isForgeRunState(state)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'runState', message: 'not a ForgeRunState' }] };
  }
  const logResult = validateAttemptLog(state.log);
  if (!logResult.ok) return logResult;
  const validatedLog = logResult.value;

  if (!isRecord(forgeInput)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'forgeInput', message: 'the forge input must be an object' }] };
  }
  const coherenceErrors: SkillError[] = [];
  if (forgeInput.forgeVersion !== state.forgeVersion) {
    coherenceErrors.push({
      code: 'invalid_field',
      path: 'forgeInput.forgeVersion',
      message: `the run is bound to forge version "${state.forgeVersion}" but the input declares "${String(forgeInput.forgeVersion)}" — lineage coherence (L9)`,
    });
  }
  if (forgeInput.seed !== state.seed) {
    coherenceErrors.push({
      code: 'invalid_field',
      path: 'forgeInput.seed',
      message: `the run is bound to seed "${state.seed}" but the input declares "${String(forgeInput.seed)}" — lineage coherence (L9)`,
    });
  }
  if (forgeInput.tenantId !== state.tenantId || forgeInput.projectId !== state.projectId) {
    coherenceErrors.push({
      code: 'tenant_mismatch',
      path: 'forgeInput',
      message: `the run scope is "${state.tenantId}"/"${state.projectId}" but the input carries "${String(forgeInput.tenantId)}"/"${String(forgeInput.projectId)}" — one tenant per lineage chain (L12)`,
    });
  }
  if (coherenceErrors.length > 0) return { ok: false, errors: coherenceErrors };

  const forgeResult: ForgeResultValue = forgeBodyVersion(forgeInput);
  const ordinal = validatedLog.attemptCount + 1;
  const attempt = forgeAttemptOf(
    state.forgeVersion,
    state.seed,
    ordinal,
    validatedLog.chainHead,
    {
      minted: forgeResult.minted,
      candidateRef: forgeResult.candidate === null ? null : forgeResult.candidate.candidate.id,
      reasons: forgeResult.reasons,
      inputDigest: forgeResult.inputDigest,
    },
    attemptedAt,
  );
  const appended = appendAttempt(validatedLog, attempt);
  if (!appended.ok) return appended;
  const newState = deepFreeze({
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    forgeVersion: state.forgeVersion,
    seed: state.seed,
    tenantId: state.tenantId,
    projectId: state.projectId,
    log: appended.value,
  });
  return { ok: true, value: { state: newState, candidate: forgeResult.candidate, attempt } };
}

// ---------------------------------------------------------------------------
// Serialize -> parse -> resume (chain-verified)
// ---------------------------------------------------------------------------

/** Serializes a run state to canonical JSON bytes (byte-determinism, L9). */
export function serializeForgeRunState(state: ForgeRunState): string {
  return canonicalJson(JSON.parse(JSON.stringify(state)) as never);
}

/**
 * Parses + validates canonical bytes back into a run state. CHAIN-VERIFIED:
 * the attempt log's digest chain is recomputed from the genesis and must
 * land exactly on the recorded head — a tampered byte anywhere in the log
 * refuses the parse (`attempt_rewrite` / `attempt_hidden` / L11 trip
 * wires). The schema version must match `FORGE_RUN_STATE_SCHEMA`.
 */
export function parseForgeRunState(bytes: string): SkillResult<ForgeRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'runState', message: 'the bytes are not JSON' }] };
  }
  return validateForgeRunState(parsed);
}

/** Validates an untrusted run state: schema, identity, and the FULL log law (chain-verified). */
export function validateForgeRunState(v: unknown, path = 'runState'): SkillResult<ForgeRunState> {
  if (!isRecord(v)) {
    return { ok: false, errors: [{ code: 'invalid_type', path, message: `${path} must be an object` }] };
  }
  const errors: SkillError[] = [];
  if (v.schemaVersion !== FORGE_RUN_STATE_SCHEMA) {
    errors.push({ code: 'invalid_field', path: `${path}.schemaVersion`, message: `unsupported schema version ${String(v.schemaVersion)} (expected ${FORGE_RUN_STATE_SCHEMA})` });
  }
  if (!isNonEmptyString(v.runId)) {
    errors.push({ code: 'invalid_field', path: `${path}.runId`, message: 'invalid derived run id' });
  } else if (
    isNonEmptyString(v.forgeVersion) &&
    isNonEmptyString(v.seed) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId) &&
    v.runId !== deriveForgeRunId(v.forgeVersion, v.seed, v.tenantId, v.projectId)
  ) {
    errors.push({
      code: 'lineage_gap',
      path: `${path}.runId`,
      message: `the derived run id "${v.runId}" does not bind (forgeVersion, seed, tenant, project) — a run id that does not match its lineage is a forgery (L9)`,
    });
  }
  if (!isNonEmptyString(v.forgeVersion)) {
    errors.push({ code: 'invalid_field', path: `${path}.forgeVersion`, message: 'invalid forge version reference (L9 lineage participant)' });
  }
  if (!isNonEmptyString(v.seed)) {
    errors.push({ code: 'unseeded_forge', path: `${path}.seed`, message: 'the run state must carry its seed — there is no ambient randomness (the determinism law)' });
  }
  if (!isNonEmptyString(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'the run state carries its owning tenant (L12)' });
  }
  if (!isNonEmptyString(v.projectId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'the run state carries its owning project (L12)' });
  }
  const logResult = validateAttemptLog(v.log, `${path}.log`);
  if (!logResult.ok) {
    return { ok: false, errors: [...errors, ...logResult.errors] };
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      schemaVersion: FORGE_RUN_STATE_SCHEMA,
      runId: v.runId,
      forgeVersion: v.forgeVersion,
      seed: v.seed,
      tenantId: v.tenantId,
      projectId: v.projectId,
      log: logResult.value,
    } as unknown as ForgeRunState),
  };
}

/**
 * RESUME: parse canonical bytes (chain-verified), then run ONE more forge
 * attempt under the resumed state. The parse refusal and the forge
 * refusal are both typed DATA — a resumed run never silently forgets its
 * history (L11) and never mints outside its bound lineage (L9/L12).
 */
export function resumeForgeRunState(
  bytes: string,
  forgeInput: unknown,
  attemptedAt: TimestampMs,
): SkillResult<ForgeForRunResult> {
  if (!isTimestampMs(attemptedAt)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'attemptedAt', message: 'invalid TimestampMs (explicit instant — never a wall clock)' }] };
  }
  const parsed = parseForgeRunState(bytes);
  if (!parsed.ok) return parsed;
  return forgeForRun(parsed.value, forgeInput, attemptedAt);
}
