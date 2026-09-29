// @tradrl/execution-policy — the KillSwitch: the append-only standing
// switch log.
//
// THE LAWS (the Work Order):
//   - "kill switch (a standing switch record that refuses EVERYTHING
//     when thrown)" — while the log's CURRENT state is `thrown`, every
//     subsequent intent is refused with the kill-switch refusal kind
//     (check-machine.ts enforces it structurally: the kill switch is
//     ordered FIRST in every legal check order).
//   - "once thrown, ALL subsequent intents are refused with the
//     kill-switch refusal kind" — see above.
//   - "the switch record itself is append-only (thrown is forever in
//     the log; un-throwing is a NEW record, never a mutation —
//     negative test: rewriting switch history is a typed error)" —
//     there is NO mutation API: `throwKillSwitch` and
//     `restoreKillSwitch` APPEND records; the thrown record can never
//     be removed or edited because every record carries an FNV-1a
//     digest CHAIN head binding its content to everything before it,
//     and `verifyKillSwitchChain` recomputes the chain from the
//     records themselves (the rl-protocol run-step-chain discipline).
//     A log whose history was spliced, edited or truncated fails with
//     the typed `killswitch_rewrite` — the negative test's crime
//     scene.
//   - Illegal transitions (throw-when-thrown, restore-when-standing)
//     are the typed `invalid_switch_transition` — the log records
//     STATE CHANGES, not noise.
//
// L9/L12: every record carries the tenant/project scope and the
// content-addressed record identity; the log's `switchId` is derived
// from the genesis record's content (the same genesis inputs always
// yield the same switch id). No ambient clock: every instant is an
// explicit parameter.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution: "kill switch"),
// spec/ARCHITECTURE-LOCK.md L8, L9, L12, L20 ("Safety outside prompts:
// security, risk and authorization are implemented in code/infrastructure").

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import {
  type KillSwitchId,
  type KillSwitchRecordId,
  type ProjectId,
  type TenantId,
  isKillSwitchRecordId,
  isProjectId,
  isTenantId,
  mintKillSwitchId,
  mintKillSwitchRecordId,
} from './ids';
import {
  type ExecutionPolicyError,
  type ExecutionPolicyResult,
  fail,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The switch record
// ---------------------------------------------------------------------------

/** The switch state vocabulary: standing (armed, checks proceed) or thrown (refuse everything). */
export type KillSwitchState = 'standing' | 'thrown';

export const KILL_SWITCH_STATES: readonly KillSwitchState[] = ['standing', 'thrown'] as const;

/** Guard: a switch state. */
export function isKillSwitchState(value: unknown): value is KillSwitchState {
  return value === 'standing' || value === 'thrown';
}

/**
 * One append-only switch record. A `standing` record is either the
 * genesis (the log's first record — the switch exists, armed) or a
 * RESTORE (a new record after a thrown episode; the thrown record
 * stays in the log forever). A `thrown` record carries the non-empty
 * reason and the throw instant.
 */
export interface KillSwitchRecord {
  /** Content-addressed identity: `ksr:` + digest of the record's canonical content. */
  readonly recordId: KillSwitchRecordId;
  /** 1-based position in the log (contiguous — append-only). */
  readonly sequence: number;
  readonly state: KillSwitchState;
  /** The reason for the throw (non-empty iff state is 'thrown'). */
  readonly reason: string | null;
  /** The throw instant (epoch ms; null iff state is 'standing'). */
  readonly thrownAt: TimestampMs | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The record's instant (genesis/restore/throw — an explicit parameter, never a clock read). */
  readonly asOf: TimestampMs;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** Guard: `KillSwitchRecord` (structural; the status invariants included). */
export function isKillSwitchRecord(value: unknown): value is KillSwitchRecord {
  if (!isRecord(value)) return false;
  if (!isKillSwitchRecordId(value.recordId)) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isKillSwitchState(value.state)) return false;
  if (value.state === 'thrown') {
    if (!isNonEmptyString(value.reason)) return false;
    if (!isTimestampMs(value.thrownAt)) return false;
  } else {
    if (value.reason !== null) return false;
    if (value.thrownAt !== null) return false;
  }
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isTimestampMs(value.asOf)) return false;
  if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The chain (append-only history verification — the rewrite trip wire)
// ---------------------------------------------------------------------------

/** The canonical JSON tree of a record's CONTENT (everything except `recordId` and `chainHead`). */
function recordContentTree(record: Omit<KillSwitchRecord, 'recordId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    state: record.state,
    reason: record.reason,
    thrownAt: record.thrownAt,
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))` (the rl-protocol discipline). */
function expectedChainHead(previousHead: string, record: Omit<KillSwitchRecord, 'recordId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(recordContentTree(record))}`);
}

/** The expected record id of a record: `ksr:` + digest over (chainHead + content). */
function expectedRecordId(record: KillSwitchRecord): string {
  const content = canonicalJson(recordContentTree(record));
  return mintKillSwitchRecordId(fnv1a32Hex(`${record.chainHead}${content}`));
}

// ---------------------------------------------------------------------------
// The switch log
// ---------------------------------------------------------------------------

/**
 * The append-only switch log. The FIRST record is the genesis standing
 * record; later records are state transitions (throw / restore). The
 * current state is the LAST record's state. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export interface KillSwitchLog {
  /** The log's identity (`ksw:` + digest of the genesis content). */
  readonly switchId: KillSwitchId;
  readonly records: readonly KillSwitchRecord[];
}

/** Guard: `KillSwitchLog` (structural). */
export function isKillSwitchLog(value: unknown): value is KillSwitchLog {
  if (!isRecord(value)) return false;
  if (typeof value.switchId !== 'string' || !value.switchId.startsWith('ksw:')) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isKillSwitchRecord(record))) return false;
  if (value.records.length === 0) return false; // a log always carries its genesis
  return (value.records[0] as KillSwitchRecord).sequence === 1 && (value.records[0] as KillSwitchRecord).state === 'standing';
}

/**
 * Create a switch log: the genesis STANDING record (the switch exists,
 * armed) with the derived switch id. The genesis is the log's only
 * entry point — every later record comes from `throwKillSwitch` /
 * `restoreKillSwitch`.
 */
export function startKillSwitch(tenant: TenantId, project: ProjectId, asOf: TimestampMs): ExecutionPolicyResult<KillSwitchLog> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startKillSwitch requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startKillSwitch requires a project scope (L12/L15)');
  if (!isTimestampMs(asOf)) return fail('invalid_timestamp', 'startKillSwitch requires an epoch-ms genesis instant');
  const genesisContent: Omit<KillSwitchRecord, 'recordId' | 'chainHead'> = {
    sequence: 1,
    state: 'standing',
    reason: null,
    thrownAt: null,
    tenant,
    project,
    asOf,
  };
  const chainHead = expectedChainHead('ksw-genesis', genesisContent);
  const genesis: KillSwitchRecord = deepFreeze({
    ...genesisContent,
    recordId: mintKillSwitchRecordId(fnv1a32Hex(`${chainHead}${canonicalJson(recordContentTree(genesisContent))}`)),
    chainHead,
  });
  return ok(deepFreeze({ switchId: mintKillSwitchId(fnv1a32Hex(canonicalJson(recordContentTree(genesisContent)))), records: [genesis] }));
}

/**
 * THROW the switch: append a `thrown` record. While thrown, the check
 * machine refuses EVERY intent with the kill-switch refusal kind.
 * Fails with `invalid_switch_transition` when the switch is already
 * thrown (the log records STATE CHANGES; a re-throw is noise — the
 * standing refusal carries the original throw's evidence).
 */
export function throwKillSwitch(log: KillSwitchLog, reason: string, thrownAt: TimestampMs): ExecutionPolicyResult<KillSwitchLog> {
  const current = killSwitchState(log);
  if (current === 'thrown') {
    return fail('invalid_switch_transition', 'the switch is already thrown — every subsequent intent is refused with the kill-switch refusal kind; a re-throw is not a state change');
  }
  if (!isNonEmptyString(reason)) {
    return fail('invalid_field', 'throwKillSwitch requires a non-empty reason — an unexplained kill is not auditable', 'reason');
  }
  if (!isTimestampMs(thrownAt)) {
    return fail('invalid_timestamp', 'throwKillSwitch requires an epoch-ms throw instant');
  }
  return appendRecord(log, 'thrown', reason, thrownAt, thrownAt);
}

/**
 * RESTORE the switch: append a NEW standing record (the law: "un-
 * throwing is a NEW record, never a mutation"). The thrown episode
 * stays in the log forever — auditable history. Fails with
 * `invalid_switch_transition` when the switch is already standing.
 */
export function restoreKillSwitch(log: KillSwitchLog, asOf: TimestampMs): ExecutionPolicyResult<KillSwitchLog> {
  const current = killSwitchState(log);
  if (current === 'standing') {
    return fail('invalid_switch_transition', 'the switch is standing — there is nothing to restore');
  }
  if (!isTimestampMs(asOf)) {
    return fail('invalid_timestamp', 'restoreKillSwitch requires an epoch-ms restore instant');
  }
  return appendRecord(log, 'standing', null, null, asOf);
}

/** The log's CURRENT state: the last record's state ('thrown' refuses everything). */
export function killSwitchState(log: KillSwitchLog): KillSwitchState {
  const last = log.records[log.records.length - 1] as KillSwitchRecord;
  return last.state;
}

/** The evidence of the log's current thrown state (the last thrown record), or null while standing. */
export function currentThrowEvidence(log: KillSwitchLog): KillSwitchRecord | null {
  if (killSwitchState(log) !== 'thrown') return null;
  for (let index = log.records.length - 1; index >= 0; index--) {
    const record = log.records[index] as KillSwitchRecord;
    if (record.state === 'thrown') return record;
  }
  return null;
}

/** Append one state-change record (the shared transition core). */
function appendRecord(
  log: KillSwitchLog,
  state: KillSwitchState,
  reason: string | null,
  thrownAt: TimestampMs | null,
  asOf: TimestampMs,
): ExecutionPolicyResult<KillSwitchLog> {
  const previous = log.records[log.records.length - 1] as KillSwitchRecord;
  const content: Omit<KillSwitchRecord, 'recordId' | 'chainHead'> = {
    sequence: previous.sequence + 1,
    state,
    reason,
    thrownAt,
    tenant: previous.tenant,
    project: previous.project,
    asOf,
  };
  const chainHead = expectedChainHead(previous.chainHead, content);
  const record: KillSwitchRecord = deepFreeze({
    ...content,
    recordId: mintKillSwitchRecordId(fnv1a32Hex(`${chainHead}${canonicalJson(recordContentTree(content))}`)),
    chainHead,
  });
  return ok(deepFreeze({ switchId: log.switchId, records: [...log.records, record] }));
}

// ---------------------------------------------------------------------------
// Chain verification (the history-rewrite trip wire)
// ---------------------------------------------------------------------------

/**
 * Verify the switch log's chain: recompute every record's chain head
 * from the records themselves and check the sequence, the id
 * derivation, the genesis standing state, the transition legality
 * (standing->thrown / thrown->standing only) and the tenant/project
 * continuity. A log whose history was SPLICED (a thrown record
 * removed), EDITED (a reason changed) or TRUNCATED fails with the
 * typed `killswitch_rewrite` — rewriting switch history is impossible
 * to express through the API, and a forged log fails verification.
 */
export function verifyKillSwitchChain(log: KillSwitchLog): ExecutionPolicyResult<KillSwitchLog> {
  if (!isKillSwitchLog(log)) {
    return fail('invalid_type', 'verifyKillSwitchChain requires a structurally valid switch log');
  }
  const genesis = log.records[0] as KillSwitchRecord;
  if (genesis.state !== 'standing') {
    return fail('killswitch_rewrite', 'the log does not begin with a standing genesis record', 'records[0]');
  }
  // The switch id must be the genesis content's derivation.
  const expectedSwitchId = mintKillSwitchId(fnv1a32Hex(canonicalJson(recordContentTree(genesis))));
  if (log.switchId !== expectedSwitchId) {
    return fail('killswitch_rewrite', `the switch id does not match the genesis content (expected "${expectedSwitchId}") — the log was forged`, 'switchId');
  }
  let previousHead = 'ksw-genesis';
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index] as KillSwitchRecord;
    if (record.sequence !== index + 1) {
      return fail('killswitch_rewrite', `record ${index} carries sequence ${record.sequence} — the log is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const expectedHead = expectedChainHead(previousHead, record);
    if (record.chainHead !== expectedHead) {
      return fail('killswitch_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    if (record.recordId !== expectedRecordId(record)) {
      return fail('killswitch_rewrite', `record ${index}'s id does not match its content — the record was edited after recording`, `records[${index}].recordId`);
    }
    if (record.tenant !== genesis.tenant || record.project !== genesis.project) {
      return fail('killswitch_rewrite', `record ${index} changes the log's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    if (index > 0) {
      const previous = log.records[index - 1] as KillSwitchRecord;
      if (previous.state === record.state) {
        return fail('killswitch_rewrite', `record ${index} repeats the previous state ("${record.state}") — the log records state changes only (the API cannot produce this shape)`, `records[${index}].state`);
      }
    }
    previousHead = record.chainHead;
  }
  return ok(log);
}

/**
 * Collect-all validation of an untrusted switch log: the structural
 * guard, then the full chain verification. On success the log is
 * returned narrowed, deeply frozen.
 */
export function validateKillSwitchLog(value: unknown, path = 'killSwitch'): ExecutionPolicyResult<KillSwitchLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];
  if (value.switchId === undefined) errors.push(missingField(`${path}.switchId`));
  if (value.records === undefined) errors.push(missingField(`${path}.records`));
  if (errors.length > 0) return { ok: false, errors };
  if (!isKillSwitchLog(value)) {
    return fail('invalid_type', `${path} fails the switch-log guard (a ksw: id, a non-empty record list, a standing sequence-1 genesis)`);
  }
  const verified = verifyKillSwitchChain(value);
  if (!verified.ok) return verified;
  return ok(deepFreeze(value));
}
