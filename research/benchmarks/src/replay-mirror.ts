/**
 * @tradrl/research-benchmarks — the T009 REPLAY DATA SOURCE MIRROR (Work
 * Order T032).
 *
 * STRUCTURAL MIRROR of the replay lane's lineage surface (T009,
 * packages/market-world + services/market-world replay): a replay world is
 * fully determined by its CONFIG (whose deterministic digest the replay
 * service binds into every run record — `configHash`) and the RECORDED
 * EVENT STREAM it loads (opaque stream refs pulled from a pure
 * ReplayEventSource). This mirror re-declares the data face of that
 * surface — the recorded-stream refs plus the replay config digest plus
 * the stream's coverage window — so a benchmark over replay data binds the
 * SAME identity material a T009 run record binds (L9: the replay config
 * hash and stream refs are the replay lane's content identity). The
 * origin is 'historical' (the market-protocol/T028 provenance vocabulary
 * mirror): replay worlds are L5's first fidelity class — recorded reality
 * re-emitted point-in-time.
 *
 * Per D-003/D-004 this is a mirror, not an import: the interop trip-wire
 * tests prove the origin vocabulary and the timestamp/digest disciplines
 * against the real packages in this tree.
 */

import { deepFreeze, isDigest, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';

/** The derivation prefix of every replay source id. */
export const REPLAY_SOURCE_ID_PREFIX = 'rsrc:' as const;

/** The origin vocabulary (mirror of market-protocol's EventOrigin / T028 provenance). */
export type DataOrigin = 'historical' | 'simulated' | 'generated';

/**
 * The replay data source: the recorded event stream refs plus the replay
 * world config digest (T009's content identity) plus the stream's coverage
 * window. The id is content-addressed (`rsrc:<digest>`), so identical
 * replay sources address identically (L9).
 */
export interface ReplayDataSource {
  readonly source_id: string;
  readonly kind: 'replay-dataset';
  readonly origin: 'historical';
  /** Opaque refs of the recorded event stream batches (non-empty, unique). */
  readonly stream_refs: readonly string[];
  /** The deterministic digest of the replay world config (T009 `configHash` mirror). */
  readonly config_digest: string;
  /** The stream's coverage window [start, end). */
  readonly coverage: { readonly start: TimestampMs; readonly end: TimestampMs };
}

/** Guard: `ReplayDataSource` (structural). */
export function isReplayDataSource(value: unknown): value is ReplayDataSource {
  if (!isRecord(value)) return false;
  if (typeof value.source_id !== 'string' || !value.source_id.startsWith(REPLAY_SOURCE_ID_PREFIX)) return false;
  if (value.kind !== 'replay-dataset') return false;
  if (value.origin !== 'historical') return false;
  if (!Array.isArray(value.stream_refs) || value.stream_refs.length === 0) return false;
  if (!(value.stream_refs as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  if (new Set(value.stream_refs as readonly string[]).size !== (value.stream_refs as readonly unknown[]).length) return false;
  if (!isDigest(value.config_digest)) return false;
  const coverage = value.coverage;
  if (!isRecord(coverage)) return false;
  if (!isTimestampMs(coverage.start) || !isTimestampMs(coverage.end)) return false;
  return coverage.end > coverage.start;
}

/** The canonical source JSON (the content-addressing input; no `source_id`). */
export function replaySourceJson(content: Omit<ReplayDataSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    stream_refs: content.stream_refs,
    config_digest: content.config_digest,
    coverage: content.coverage as unknown as JsonObject,
  };
}

/** Compute the content address of a replay source: `rsrc:<digest>`. */
export function replaySourceId(content: Omit<ReplayDataSource, 'source_id'>): string {
  return `${REPLAY_SOURCE_ID_PREFIX}${stableDigestJson(replaySourceJson(content))}`;
}

/** The content digest of a validated source (manifest lineage binding). */
export function replaySourceDigest(source: ReplayDataSource): string {
  return stableDigestJson(replaySourceJson(source));
}

/**
 * Collect-all validation of an untrusted replay data source. On success the
 * source is returned narrowed, deeply frozen, with the DERIVED content
 * address (`rsrc:<digest>`) — a supplied id that disagrees with the content
 * fails `invalid_field` (content and address cannot disagree, L9).
 */
export function validateReplayDataSource(value: unknown, path = 'data_source'): BenchmarkResult<ReplayDataSource> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (value.kind !== 'replay-dataset') errors.push(invalidField(`${path}.kind`, "must be 'replay-dataset'"));

  if (value.origin === undefined) errors.push(missingField(`${path}.origin`));
  else if (value.origin !== 'historical') errors.push(invalidField(`${path}.origin`, "a replay dataset's origin must be 'historical' (the recorded-stream fidelity class)"));

  if (value.stream_refs === undefined) {
    errors.push(missingField(`${path}.stream_refs`));
  } else if (!Array.isArray(value.stream_refs) || value.stream_refs.length === 0) {
    errors.push(invalidField(`${path}.stream_refs`, 'must be a non-empty array of recorded stream refs'));
  } else if (new Set(value.stream_refs as readonly string[]).size !== (value.stream_refs as readonly unknown[]).length) {
    errors.push(invalidField(`${path}.stream_refs`, 'must not repeat a stream ref'));
  }

  if (value.config_digest === undefined) {
    errors.push(missingField(`${path}.config_digest`));
  } else if (!isDigest(value.config_digest)) {
    errors.push(invalidField(`${path}.config_digest`, 'must be the deterministic digest of the replay world config (the T009 config hash)'));
  }

  let coverage: { readonly start: TimestampMs; readonly end: TimestampMs } | undefined;
  if (value.coverage === undefined) {
    errors.push(missingField(`${path}.coverage`));
  } else if (!isRecord(value.coverage)) {
    errors.push(invalidField(`${path}.coverage`, 'must be { start, end }'));
  } else if (!isTimestampMs(value.coverage.start) || !isTimestampMs(value.coverage.end) || value.coverage.end <= value.coverage.start) {
    errors.push(invalidField(`${path}.coverage`, 'must be { start, end } with end > start (TimestampMs)'));
  } else {
    coverage = { start: value.coverage.start, end: value.coverage.end };
  }

  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<ReplayDataSource, 'source_id'> = {
    kind: 'replay-dataset',
    origin: 'historical',
    stream_refs: value.stream_refs as readonly string[],
    config_digest: value.config_digest as string,
    coverage: coverage as { readonly start: TimestampMs; readonly end: TimestampMs },
  };
  const derivedId = replaySourceId(content);
  if (value.source_id !== undefined && value.source_id !== derivedId) {
    return fail('invalid_field', `source id "${value.source_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.source_id`);
  }
  return ok(deepFreeze({ source_id: derivedId, ...content } satisfies ReplayDataSource));
}
