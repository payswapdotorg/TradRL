// @tradrl/body-execution — the DECLARED-METHOD discipline for order
// lifecycle management.
//
// Owning Work Order: T025, "methods.ts: the declared-method discipline
// (`OrderLifecycleMethodRecord`/`MethodRegistry`) — an
// order-management procedure without a declared, versioned method is a
// typed error."
//
// A MethodRecord is a versioned, structured, deeply-frozen declaration
// of HOW an order-management procedure runs: its kind, its declared
// input class, its enumerated parameters (deadlines, grid steps,
// response policies — every knob is a declared field, never an implicit
// constant). The registry is the closed set the execution body may
// run; every lifecycle, escalation and reconciliation record cites
// (methodId, methodVersion) and validation re-resolves the citation
// against the registry — a record citing an unknown method id, a stale
// version, or a method of the wrong kind is a TYPED ERROR, not a
// warning.
//
// The five declared kinds (the Work Order's procedure list):
//   order-preparation      — how an APPROVED decision + intent become a
//                            prepared order request (the exact-decimal
//                            carrying law, the id derivation law)
//   stuck-order-detection  — the declared ack/fill deadlines; the
//                            response is ESCALATE-AND-RECORD, never an
//                            exception, never a silent timeout, never a
//                            fabricated terminal state
//   fill-reconciliation    — the declared exact-equality discipline and
//                            the declared smallest grid step
//   cancellation-policy    — the declared lawful cancellation states,
//                            the evidence requirement, the race
//                            recording
//   kill-switch-response   — the declared mid-flight response:
//                            escalate and record; NEVER fabricate a
//                            fill or a cancel; submissions fail closed
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled
// guards; no ambient clock (`declaredAt` is an explicit literal
// instant); deepFreeze everything public; deterministic registry
// digest (L9 — the registry identity binds into every record's
// lineage).

import {
  canonicalJson,
  deepFreeze,
  isDigest,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isPositiveSafeInteger,
  isRecord,
  isArrayOf,
  stableDigestJson,
} from './primitives';
import { type MethodId, type MethodVersionRef, isMethodId, isMethodVersionRef } from './ids';
import {
  type ExecutionBodyError,
  type ExecutionBodyResult,
  type ExecutionBodyValidation,
  invalidField,
  invalidType,
  validationOf,
} from './errors';
import { isCanonicalPositiveDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary (the five order-management procedures)
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const METHOD_KINDS = [
  'order-preparation',
  'stuck-order-detection',
  'fill-reconciliation',
  'cancellation-policy',
  'kill-switch-response',
] as const;

/** A declared method kind. */
export type MethodKind = (typeof METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isMethodKind = (v: unknown): v is MethodKind => isMemberOf(METHOD_KINDS, v);

/** The declared input classes (closed vocabulary). */
export const METHOD_INPUTS = [
  'execution-gate-decisions',
  'order-lifecycle-logs',
  'standing-switch-states',
] as const;

/** A declared method input class. */
export type MethodInput = (typeof METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isMethodInput = (v: unknown): v is MethodInput => isMemberOf(METHOD_INPUTS, v);

// ---------------------------------------------------------------------------
// Structured parameters per kind (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/**
 * Order-preparation parameters: how an APPROVED decision's gated intent
 * becomes a prepared order request. Every carrying law is declared.
 */
export interface OrderPreparationParameters {
  readonly kind: 'order-preparation';
  readonly input: 'execution-gate-decisions';
  /** Only APPROVE decisions are authority — refusals are records, never authority (L8). */
  readonly authority: 'approve-decisions-only';
  /** The order identity is derived from the intent's clientOrderId (idempotent). */
  readonly orderIdentity: 'client-order-id-derived';
  /** The intent's quantity is carried VERBATIM (exact decimal, never re-derived). */
  readonly quantityCarried: 'verbatim-intent-quantity';
  /** Float mediation on any quantity is refused (the typed decimal_imprecision). */
  readonly floatMediation: 'rejected';
  /** The first record's clock is the ORDER-level clock — never the decision's asOf (L16). */
  readonly clockBasis: 'order-level';
}

/** Stuck-order-detection parameters: the declared deadlines and response. */
export interface StuckOrderDetectionParameters {
  readonly kind: 'stuck-order-detection';
  readonly input: 'order-lifecycle-logs';
  /** The declared ack deadline: submitted without acknowledgment for longer than this => stuck. */
  readonly ackDeadlineMs: number;
  /** The declared fill deadline: acknowledged without fill progress for longer than this => stuck. */
  readonly fillDeadlineMs: number;
  /** The response is an escalation RECORD — never an exception, never a silent timeout. */
  readonly response: 'escalate-and-record';
  /** Terminal states are never fabricated by detection (never a fill, never a cancel). */
  readonly fabricatedTerminalStates: 'prohibited';
}

/** Fill-reconciliation parameters: the declared exact-equality discipline. */
export interface FillReconciliationParameters {
  readonly kind: 'fill-reconciliation';
  readonly input: 'order-lifecycle-logs';
  /** Exact equality between cumulative fills and the acknowledged quantity is REQUIRED. */
  readonly equality: 'exact';
  /** The declared smallest grid step (a canonical positive decimal). */
  readonly quantityGridStep: string;
  /** A mismatch is a typed reconciliation_gap RECORD (data, never an exception). */
  readonly gapReporting: 'typed-record';
  /** The declared scale and rounding of the exact arithmetic. */
  readonly scale: number;
  readonly rounding: 'half-even' | 'truncate';
}

/** Cancellation-policy parameters: the declared lawful cancellation rules. */
export interface CancellationPolicyParameters {
  readonly kind: 'cancellation-policy';
  readonly input: 'order-lifecycle-logs';
  /** The states from which a cancel transition is lawful (declared, never guessed). */
  readonly lawfulCancellationStates: readonly ('prepared' | 'submitted' | 'acknowledged' | 'partially_filled' | 'stuck')[];
  /** A cancel transition REQUIRES a gateway confirmation ref (never fabricated). */
  readonly confirmationRequired: 'evidence-ref-required';
  /** A cancel refused because the order filled first is RECORDED as a cancellation-race escalation. */
  readonly raceRecording: 'escalation-record';
}

/** Kill-switch-response parameters: the declared mid-flight response. */
export interface KillSwitchResponseParameters {
  readonly kind: 'kill-switch-response';
  readonly input: 'standing-switch-states';
  /** The mid-flight response: ESCALATE and RECORD. */
  readonly response: 'escalate-and-record';
  /** NEVER fabricate a fill or a cancel under a thrown switch. */
  readonly fabricatedTerminalStates: 'prohibited';
  /** New submissions under a thrown switch fail closed (the gate's law honored). */
  readonly submissionUnderThrownSwitch: 'fail-closed';
}

/** The union of declared parameter shapes. */
export type MethodParameters =
  | OrderPreparationParameters
  | StuckOrderDetectionParameters
  | FillReconciliationParameters
  | CancellationPolicyParameters
  | KillSwitchResponseParameters;

// ---------------------------------------------------------------------------
// MethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every
 * order-management output must cite. An order-management procedure
 * without one of these is an undeclared magic procedure, and a magic
 * procedure fails validation (the method-honesty law).
 */
export interface MethodRecord {
  /** Method identity (e.g. `method/execution/order-preparation`). */
  readonly methodId: MethodId;
  /** What the method is for. */
  readonly kind: MethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: MethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: MethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set the execution body may run. */
export interface MethodRegistry {
  /** The declared methods, canonically ordered by method id. */
  readonly methods: readonly MethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

/** Guard: the lawful cancellation states list (the closed subset law). */
const LAWFUL_CANCEL_STATES = ['prepared', 'submitted', 'acknowledged', 'partially_filled', 'stuck'] as const;

function isLawfulCancellationState(v: unknown): v is (typeof LAWFUL_CANCEL_STATES)[number] {
  return typeof v === 'string' && (LAWFUL_CANCEL_STATES as readonly string[]).includes(v);
}

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isMethodKind(kind)) return [`${path}.kind: must be one of ${METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isMethodInput(input)) return [`${path}.input: must be one of ${METHOD_INPUTS.join('|')}`];
  if (kind === 'order-preparation') {
    if (input !== 'execution-gate-decisions') {
      problems.push(`${path}.input: order preparation consumes execution-gate-decisions`);
    }
    if (v.authority !== 'approve-decisions-only') {
      problems.push(`${path}.authority: only APPROVE decisions are authority (L8)`);
    }
    if (v.orderIdentity !== 'client-order-id-derived') {
      problems.push(`${path}.orderIdentity: the order identity is client-order-id-derived`);
    }
    if (v.quantityCarried !== 'verbatim-intent-quantity') {
      problems.push(`${path}.quantityCarried: the intent quantity is carried verbatim`);
    }
    if (v.floatMediation !== 'rejected') {
      problems.push(`${path}.floatMediation: float mediation is rejected (decimal_imprecision)`);
    }
    if (v.clockBasis !== 'order-level') {
      problems.push(`${path}.clockBasis: the preparation clock is order-level (L16 — never the decision's asOf)`);
    }
  } else if (kind === 'stuck-order-detection') {
    if (input !== 'order-lifecycle-logs') {
      problems.push(`${path}.input: stuck detection runs over order-lifecycle-logs`);
    }
    if (!isPositiveInteger(v.ackDeadlineMs)) {
      problems.push(`${path}.ackDeadlineMs: must be a positive integer (epoch milliseconds)`);
    }
    if (!isPositiveInteger(v.fillDeadlineMs)) {
      problems.push(`${path}.fillDeadlineMs: must be a positive integer (epoch milliseconds)`);
    }
    if (v.response !== 'escalate-and-record') {
      problems.push(`${path}.response: must be 'escalate-and-record' (never an exception, never a silent timeout)`);
    }
    if (v.fabricatedTerminalStates !== 'prohibited') {
      problems.push(`${path}.fabricatedTerminalStates: must be 'prohibited' (never a fabricated fill or cancel)`);
    }
  } else if (kind === 'fill-reconciliation') {
    if (input !== 'order-lifecycle-logs') {
      problems.push(`${path}.input: fill reconciliation runs over order-lifecycle-logs`);
    }
    if (v.equality !== 'exact') {
      problems.push(`${path}.equality: must be 'exact' (cumulative fills vs acknowledged quantity at exact equality)`);
    }
    if (!isCanonicalPositiveDecimal(v.quantityGridStep)) {
      problems.push(`${path}.quantityGridStep: must be a canonical positive decimal (the smallest grid step)`);
    }
    if (v.gapReporting !== 'typed-record') {
      problems.push(`${path}.gapReporting: must be 'typed-record' (a typed reconciliation_gap record, never an exception)`);
    }
    if (!isPositiveInteger(v.scale) || (v.scale as number) > 18) {
      problems.push(`${path}.scale: must be an integer in [1, 18]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
  } else if (kind === 'cancellation-policy') {
    if (input !== 'order-lifecycle-logs') {
      problems.push(`${path}.input: the cancellation policy runs over order-lifecycle-logs`);
    }
    if (!isArrayOf(v.lawfulCancellationStates, isLawfulCancellationState)) {
      problems.push(`${path}.lawfulCancellationStates: must be an array of lawful cancellation states`);
    } else if ((v.lawfulCancellationStates as readonly string[]).length === 0) {
      problems.push(`${path}.lawfulCancellationStates: at least one lawful state must be declared`);
    } else if (new Set(v.lawfulCancellationStates as readonly string[]).size !== (v.lawfulCancellationStates as readonly string[]).length) {
      problems.push(`${path}.lawfulCancellationStates: duplicate states declared`);
    }
    if (v.confirmationRequired !== 'evidence-ref-required') {
      problems.push(`${path}.confirmationRequired: must be 'evidence-ref-required' (a cancel transition cites its confirmation)`);
    }
    if (v.raceRecording !== 'escalation-record') {
      problems.push(`${path}.raceRecording: must be 'escalation-record' (a lost race is recorded)`);
    }
  } else {
    if (input !== 'standing-switch-states') {
      problems.push(`${path}.input: the kill-switch response consumes standing-switch-states`);
    }
    if (v.response !== 'escalate-and-record') {
      problems.push(`${path}.response: must be 'escalate-and-record'`);
    }
    if (v.fabricatedTerminalStates !== 'prohibited') {
      problems.push(`${path}.fabricatedTerminalStates: must be 'prohibited' (NEVER fabricate a fill or a cancel under a thrown switch)`);
    }
    if (v.submissionUnderThrownSwitch !== 'fail-closed') {
      problems.push(`${path}.submissionUnderThrownSwitch: must be 'fail-closed'`);
    }
  }
  return problems;
}

/** Guard: `MethodRecord` (total — untrusted input never throws). */
export function isMethodRecord(v: unknown): v is MethodRecord {
  if (!isRecord(v)) return false;
  return (
    isMethodId(v.methodId) &&
    isMethodKind(v.kind) &&
    isMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateMethodRecord(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${METHOD_KINDS.join('|')}`));
  if (!isMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
  if (!isRecord(v.parameters)) {
    errors.push(invalidType(`${path}parameters`, 'an object'));
  } else {
    for (const problem of parametersProblems(`${path}parameters`, v.parameters)) {
      errors.push(invalidField(`${path}parameters`, problem.replace(/^parameters: /, '')));
    }
  }
  if (!isNonEmptyString(v.declaredBy)) errors.push(invalidField(`${path}declaredBy`, 'must be a non-empty string'));
  if (!isNonNegativeInteger(v.declaredAt)) errors.push(invalidField(`${path}declaredAt`, 'must be a non-negative epoch-millisecond integer'));
  return errors;
}

/**
 * Creates a validated, deeply-frozen method record. Refusal is typed data.
 */
export function createMethodRecord(draft: unknown): ExecutionBodyResult<MethodRecord> {
  const errors = validateMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as MethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateMethodRegistry(v: unknown): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isMethodId(method.methodId)) {
      if (seen.has(method.methodId)) {
        errors.push({ code: 'duplicate_method', path: `methods[${index}].methodId`, message: `duplicate method id ${method.methodId}` });
      }
      seen.add(method.methodId);
    }
  });
  return errors;
}

/**
 * Creates a validated, deeply-frozen method registry. Methods are stored
 * in CANONICAL ORDER (sorted by canonical JSON of the record — order can
 * never leak into the registry digest or into output bytes).
 */
export function createMethodRegistry(methods: readonly unknown[]): ExecutionBodyResult<MethodRegistry> {
  const errors = validateMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly MethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findMethod(registry: MethodRegistry, methodId: string): MethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/**
 * Resolves a (methodId, version) citation against a registry; typed
 * errors on drift — an order-management procedure without a declared,
 * versioned method is a TYPED ERROR (the Work Order's law).
 */
export function resolveMethodCitation(
  registry: MethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: MethodKind,
): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isMethodId(methodId)) {
    return [invalidField('methodId', 'must be a non-empty opaque method reference')];
  }
  if (!isMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — an order-management procedure without a declared, versioned method is a typed error, never a magic procedure`,
    });
    return errors;
  }
  if (isMethodVersionRef(version) && method.version !== version) {
    errors.push({
      code: 'method_version_mismatch',
      path: 'methodVersion',
      message: `method ${methodId} is declared at version ${method.version}, cited at ${version}`,
    });
  }
  if (method.kind !== expectedKind) {
    errors.push({
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${methodId} is declared as '${method.kind}', used as '${expectedKind}'`,
    });
  }
  return errors;
}

/** Guard: `MethodRegistry`. */
export function isMethodRegistry(v: unknown): v is MethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `MethodRegistry`. */
export function validateMethodRegistryRecord(v: unknown): ExecutionBodyValidation<MethodRegistry> {
  const errors = validateMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as ExecutionBodyValidation<MethodRegistry>;
  if (isRecord(v) && !isMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as ExecutionBodyValidation<MethodRegistry>;
  }
  return validationOf(v as MethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the execution body
// runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/** The declaring authority of the canonical registry (a literal, no clock). */
const DECLARED_BY = 'tradrl-execution-declaration/1';

/** The literal declaration instant of the canonical registry (no clock). */
const DECLARED_AT = 1_780_000_000_000;

/**
 * The canonical method registry for the execution body: one declared
 * method per order-management procedure, each with fully enumerated
 * parameters. `declaredAt` instants are explicit literals (no clock).
 */
export const EXECUTION_METHOD_REGISTRY: MethodRegistry = (() => {
  const construction = createMethodRegistry([
    {
      methodId: 'method/execution/order-preparation',
      kind: 'order-preparation',
      version: '1.0.0',
      parameters: {
        kind: 'order-preparation',
        input: 'execution-gate-decisions',
        authority: 'approve-decisions-only',
        orderIdentity: 'client-order-id-derived',
        quantityCarried: 'verbatim-intent-quantity',
        floatMediation: 'rejected',
        clockBasis: 'order-level',
      },
      declaredBy: DECLARED_BY,
      declaredAt: DECLARED_AT,
    },
    {
      methodId: 'method/execution/stuck-order-detection',
      kind: 'stuck-order-detection',
      version: '1.0.0',
      parameters: {
        kind: 'stuck-order-detection',
        input: 'order-lifecycle-logs',
        ackDeadlineMs: 2_000,
        fillDeadlineMs: 30_000,
        response: 'escalate-and-record',
        fabricatedTerminalStates: 'prohibited',
      },
      declaredBy: DECLARED_BY,
      declaredAt: DECLARED_AT,
    },
    {
      methodId: 'method/execution/fill-reconciliation',
      kind: 'fill-reconciliation',
      version: '1.0.0',
      parameters: {
        kind: 'fill-reconciliation',
        input: 'order-lifecycle-logs',
        equality: 'exact',
        quantityGridStep: '0.01',
        gapReporting: 'typed-record',
        scale: 8,
        rounding: 'half-even',
      },
      declaredBy: DECLARED_BY,
      declaredAt: DECLARED_AT,
    },
    {
      methodId: 'method/execution/cancellation-policy',
      kind: 'cancellation-policy',
      version: '1.0.0',
      parameters: {
        kind: 'cancellation-policy',
        input: 'order-lifecycle-logs',
        lawfulCancellationStates: ['prepared', 'acknowledged', 'partially_filled', 'stuck'],
        confirmationRequired: 'evidence-ref-required',
        raceRecording: 'escalation-record',
      },
      declaredBy: DECLARED_BY,
      declaredAt: DECLARED_AT,
    },
    {
      methodId: 'method/execution/kill-switch-response',
      kind: 'kill-switch-response',
      version: '1.0.0',
      parameters: {
        kind: 'kill-switch-response',
        input: 'standing-switch-states',
        response: 'escalate-and-record',
        fabricatedTerminalStates: 'prohibited',
        submissionUnderThrownSwitch: 'fail-closed',
      },
      declaredBy: DECLARED_BY,
      declaredAt: DECLARED_AT,
    },
  ]);
  if (!construction.ok) {
    throw new TypeError(
      `EXECUTION_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared order-preparation method of the canonical registry. */
export const EXECUTION_ORDER_PREPARATION_METHOD: MethodRecord = EXECUTION_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/execution/order-preparation',
) as MethodRecord;

/** The declared stuck-order-detection method of the canonical registry. */
export const EXECUTION_STUCK_ORDER_DETECTION_METHOD: MethodRecord = EXECUTION_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/execution/stuck-order-detection',
) as MethodRecord;

/** The declared fill-reconciliation method of the canonical registry. */
export const EXECUTION_FILL_RECONCILIATION_METHOD: MethodRecord = EXECUTION_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/execution/fill-reconciliation',
) as MethodRecord;

/** The declared cancellation-policy method of the canonical registry. */
export const EXECUTION_CANCELLATION_POLICY_METHOD: MethodRecord = EXECUTION_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/execution/cancellation-policy',
) as MethodRecord;

/** The declared kill-switch-response method of the canonical registry. */
export const EXECUTION_KILL_SWITCH_RESPONSE_METHOD: MethodRecord = EXECUTION_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/execution/kill-switch-response',
) as MethodRecord;
