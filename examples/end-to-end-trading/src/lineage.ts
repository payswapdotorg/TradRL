// @tradrl/example-e2e-trading — THE LINEAGE STREAM (L9/L15).
//
// Every stage of the pipeline appends ONE record per artifact it emits.
// The stream is APPEND-ONLY and CHAIN-VERIFIED: each record's chainHead
// folds the previous head with the canonical JSON of the record's
// content, so any edit, splice or truncation of history is a typed
// `chain_mismatch`. The serialized stream is the determinism witness —
// two runs over the same scenario must produce byte-identical streams.

import {
  canonicalJson, deepFreeze, fnv1a32Hex, isRecord, isNonEmptyString,
  stableDigest16Json, type JsonValue,
} from './primitives';
import { fail, ok, type ExampleResult, type ExampleError } from './errors';

/** The pipeline stages, in ARCHITECTURE.md core-flow order. */
export const LINEAGE_STAGES = [
  'goal', 'constraints', 'risk-policy', 'organization', 'bodies', 'possessions',
  'kernel', 'world', 'research', 'director', 'strategy', 'gate',
  'execution', 'outcome', 'goal-progress',
] as const;

export type LineageStage = (typeof LINEAGE_STAGES)[number];

/** The append-only lineage record. */
export interface LineageRecord {
  readonly recordId: string;
  readonly sequence: number;
  readonly stage: LineageStage;
  /** The artifact's own id (report id, decision id, intent id, ...). */
  readonly artifactId: string;
  /** The artifact's canonical digest (16-hex) — content binding. */
  readonly artifactDigest: string;
  readonly tenant: string;
  readonly project: string;
  readonly asOf: number;
  /** Ids of the artifacts this record consumed (the L15 chain edges). */
  readonly consumedIds: readonly string[];
  readonly chainHead: string;
}

export const LINEAGE_CHAIN_SEED = 'lineage-genesis';

/** Folds a content tree into the next chain head (the program-wide fold law). */
export function lineageChainHead(previousHead: string, content: JsonValue): string {
  return fnv1a32Hex(previousHead + canonicalJson(content));
}

/** The append-only stream. */
export interface LineageStream {
  readonly records: readonly LineageRecord[];
  readonly head: string;
}

/** The empty stream (seed state). */
export function startLineageStream(): LineageStream {
  return { records: [], head: LINEAGE_CHAIN_SEED };
}

/** Draft form accepted by the appender. */
export type LineageRecordDraft = Omit<LineageRecord, 'recordId' | 'sequence' | 'chainHead'>;

/** Appends one record (copy-on-write; typed `chain_mismatch` on tampering). */
export function appendLineageRecord(
  stream: LineageStream,
  draft: LineageRecordDraft,
): ExampleResult<LineageStream> {
  const errors: ExampleError[] = [];
  if (!isRecord(draft)) errors.push({ code: 'invalid_type', path: 'record', message: 'draft must be an object' });
  if (!isNonEmptyString(draft.artifactId)) errors.push({ code: 'missing_field', path: 'artifactId', message: 'artifact id required' });
  if (!(LINEAGE_STAGES as readonly string[]).includes(draft.stage)) {
    errors.push({ code: 'invalid_field', path: 'stage', message: `unknown stage "${String(draft.stage)}"` });
  }
  if (!isNonEmptyString(draft.tenant) || !isNonEmptyString(draft.project)) {
    errors.push({ code: 'tenant_missing', path: 'tenant', message: 'every lineage record is tenant/project scoped (L12)' });
  }
  if (errors.length > 0) return { ok: false, errors };
  const sequence = stream.records.length + 1;
  const record: LineageRecord = deepFreeze({
    ...draft,
    recordId: `rec:${sequence.toString().padStart(6, '0')}`,
    sequence,
    chainHead: lineageChainHead(stream.head, draftContent(draft)),
  });
  return ok({ records: [...stream.records, record], head: record.chainHead });
}

function draftContent(draft: LineageRecordDraft): JsonValue {
  return {
    stage: draft.stage,
    artifactId: draft.artifactId,
    artifactDigest: draft.artifactDigest,
    tenant: draft.tenant,
    project: draft.project,
    asOf: draft.asOf,
    consumedIds: [...draft.consumedIds],
  };
}

/** Re-verifies the whole chain — the tamper trip-wire. */
export function verifyLineageStream(stream: unknown): ExampleResult<LineageStream> {
  if (!isRecord(stream) || !Array.isArray((stream as { records?: unknown }).records)) {
    return fail('invalid_type', 'stream must carry a records array', 'stream');
  }
  const s = stream as unknown as LineageStream;
  let head = LINEAGE_CHAIN_SEED;
  for (let index = 0; index < s.records.length; index++) {
    const record = s.records[index]!;
    if (record.sequence !== index + 1) {
      return fail('chain_mismatch', `record ${index + 1} carries sequence ${record.sequence} — spliced history`, `records[${index}]`);
    }
    const expected = lineageChainHead(head, draftContent(record));
    if (record.chainHead !== expected) {
      return fail('chain_mismatch', `record ${index + 1} chain head ${record.chainHead} != expected ${expected} — edited or spliced history`, `records[${index}]`);
    }
    head = expected;
  }
  if (s.records.length > 0 && s.head !== head) {
    return fail('chain_mismatch', `stream head ${s.head} != folded ${head}`, 'head');
  }
  return ok(s);
}

/** The 16-hex content digest of an artifact (canonical form). */
export function artifactDigestOf(artifact: unknown): string {
  return stableDigest16Json(artifact as JsonValue);
}

/** The byte-stable serialization of the whole stream (determinism witness). */
export function serializeLineageStream(stream: LineageStream): string {
  return canonicalJson({
    records: stream.records.map((record) => ({
      recordId: record.recordId,
      sequence: record.sequence,
      stage: record.stage,
      artifactId: record.artifactId,
      artifactDigest: record.artifactDigest,
      tenant: record.tenant,
      project: record.project,
      asOf: record.asOf,
      consumedIds: [...record.consumedIds],
      chainHead: record.chainHead,
    })),
    head: stream.head,
  } as JsonValue);
}

/** The stream digest (8-hex over the serialized bytes). */
export function lineageStreamDigest(stream: LineageStream): string {
  return fnv1a32Hex(serializeLineageStream(stream));
}
