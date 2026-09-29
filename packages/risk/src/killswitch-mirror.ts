// @tradrl/risk — the kill-switch structural mirror: the standing switch
// log whose records the risk engine HONORS.
//
// STRUCTURAL MIRROR of @tradrl/execution-policy/src/kill-switch.ts (T019)
// — re-declared by STRUCTURE, never imported (D-003/D-004): the record
// shape, the chain-head fold (`fnv(prevHead + canonical(content))`), the
// record-id derivation (`ksr:` + digest over chainHead + content), the
// switch-id derivation (`ksw:` + digest of the genesis content) and the
// transition laws are IDENTICAL — so a REAL execution-policy
// `KillSwitchLog` IS a {@link KillSwitchLogMirror} (mutually assignable,
// zero casts; the interop test proves a REAL log produced by the REAL
// package's `startKillSwitch` / `throwKillSwitch` verifies under THIS
// module's chain verification and BLOCKS every limit state in the risk
// engine — the interop trip wire).
//
// THE INTEROP LAW (the Work Order: "Kill-switch INTEROP: the engine
// HONORS T019's kill-switch records — a thrown switch means every limit
// evaluates to blocked"): while the mirrored log's CURRENT state is
// `thrown`, {@link evaluateLimits} produces the `blocked` state for
// EVERY declared limit, each carrying the kill-switch structured reason
// (switch id, thrown-at). The risk engine never throws or restores a
// switch itself — T019 owns the switch; THIS lane only reads and honors
// it (L8: the authority is outside the model, and outside the risk
// engine too).
//
// Spec anchors: spec/ARCHITECTURE.md (Execution: "kill switch"),
// spec/ARCHITECTURE-LOCK.md L8, L9, L12, L20 ("Safety outside prompts:
// security, risk and authorization are implemented in
// code/infrastructure").

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import type { KillSwitchId, KillSwitchRecordId, ProjectId, TenantId } from './ids';
import { isKillSwitchId, isProjectId, isTenantId } from './ids';
import {
  type RiskResult,
  fail,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The switch record (mirror)
// ---------------------------------------------------------------------------

/** The switch state vocabulary: standing (armed, checks proceed) or thrown (refuse everything). Mirror. */
export type KillSwitchStateMirror = 'standing' | 'thrown';

export const KILL_SWITCH_STATES_MIRROR: readonly KillSwitchStateMirror[] = ['standing', 'thrown'] as const;

/** Guard: a switch state. Mirror. */
export function isKillSwitchStateMirror(value: unknown): value is KillSwitchStateMirror {
  return value === 'standing' || value === 'thrown';
}

/**
 * One append-only switch record. Mirror of execution-policy's
 * `KillSwitchRecord`: a `standing` record is the genesis or a RESTORE
 * (a new record after a thrown episode; the thrown record stays in the
 * log forever); a `thrown` record carries the non-empty reason and the
 * throw instant.
 */
export interface KillSwitchRecordMirror {
  /** Content-addressed identity: `ksr:` + digest of the record's canonical content. */
  readonly recordId: KillSwitchRecordId;
  /** 1-based position in the log (contiguous — append-only). */
  readonly sequence: number;
  readonly state: KillSwitchStateMirror;
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

/** Guard: `KillSwitchRecordMirror` (structural; the status invariants included). */
export function isKillSwitchRecordMirror(value: unknown): value is KillSwitchRecordMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.recordId) || !value.recordId.startsWith('ksr:')) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isKillSwitchStateMirror(value.state)) return false;
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
function recordContentTree(record: Omit<KillSwitchRecordMirror, 'recordId' | 'chainHead'>): JsonValue {
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

/** The expected chain head of a record: `fnv(prevHead + canonical(content))` (the execution-policy fold, mirrored exactly). */
function expectedChainHead(previousHead: string, record: Omit<KillSwitchRecordMirror, 'recordId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(recordContentTree(record))}`);
}

/** The expected record id of a record: `ksr:` + digest over (chainHead + content) (the execution-policy derivation, mirrored exactly). */
function expectedRecordId(record: KillSwitchRecordMirror): string {
  const content = canonicalJson(recordContentTree(record));
  return `ksr:${fnv1a32Hex(`${record.chainHead}${content}`)}`;
}

// ---------------------------------------------------------------------------
// The switch log (mirror)
// ---------------------------------------------------------------------------

/**
 * The append-only switch log. Mirror of execution-policy's
 * `KillSwitchLog`: the FIRST record is the genesis standing record;
 * later records are state transitions (throw / restore). The current
 * state is the LAST record's state. There is no removal, update or
 * reordering entry point — THIS lane never mutates a switch log; it
 * only verifies and honors one.
 */
export interface KillSwitchLogMirror {
  /** The log's identity (`ksw:` + digest of the genesis content). */
  readonly switchId: KillSwitchId;
  readonly records: readonly KillSwitchRecordMirror[];
}

/** Guard: `KillSwitchLogMirror` (structural). */
export function isKillSwitchLogMirror(value: unknown): value is KillSwitchLogMirror {
  if (!isRecord(value)) return false;
  if (typeof value.switchId !== 'string' || !value.switchId.startsWith('ksw:')) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isKillSwitchRecordMirror(record))) return false;
  if (value.records.length === 0) return false; // a log always carries its genesis
  const first = value.records[0] as KillSwitchRecordMirror;
  return first.sequence === 1 && first.state === 'standing';
}

/** The log's CURRENT state: the last record's state ('thrown' blocks every risk limit). */
export function killSwitchStateMirror(log: KillSwitchLogMirror): KillSwitchStateMirror {
  const last = log.records[log.records.length - 1] as KillSwitchRecordMirror;
  return last.state;
}

/**
 * Verify the mirrored switch log's chain — law-for-law execution-policy's
 * `verifyKillSwitchChain`: recompute every record's chain head from the
 * records themselves and check the sequence, the id derivation, the
 * genesis standing state, the switch-id derivation, the transition
 * legality (standing->thrown / thrown->standing only) and the
 * tenant/project continuity. A log whose history was SPLICED, EDITED or
 * TRUNCATED fails with the typed `killswitch_rewrite` — the risk engine
 * refuses to honor a switch log it cannot trust.
 */
export function verifyKillSwitchChainMirror(log: KillSwitchLogMirror): RiskResult<KillSwitchLogMirror> {
  if (!isKillSwitchLogMirror(log)) {
    return fail('killswitch_rewrite', 'verifyKillSwitchChainMirror requires a structurally valid switch log');
  }
  const genesis = log.records[0] as KillSwitchRecordMirror;
  if (genesis.state !== 'standing') {
    return fail('killswitch_rewrite', 'the log does not begin with a standing genesis record', 'records[0]');
  }
  // The switch id must be the genesis content's derivation (the execution-policy minting law, mirrored).
  const expectedSwitchId = `ksw:${fnv1a32Hex(canonicalJson(recordContentTree(genesis)))}`;
  if (log.switchId !== expectedSwitchId) {
    return fail('killswitch_rewrite', `the switch id does not match the genesis content (expected "${expectedSwitchId}") — the log was forged`, 'switchId');
  }
  let previousHead = 'ksw-genesis';
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index] as KillSwitchRecordMirror;
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
      const previous = log.records[index - 1] as KillSwitchRecordMirror;
      if (previous.state === record.state) {
        return fail('killswitch_rewrite', `record ${index} repeats the previous state ("${record.state}") — the log records state changes only`, `records[${index}].state`);
      }
    }
    previousHead = record.chainHead;
  }
  return ok(log);
}
