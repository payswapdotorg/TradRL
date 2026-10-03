/**
 * @tradrl/research-benchmarks — the LIVE SESSION source + the EVIDENCE
 * CLASS law (Work Order T032).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md layer 8 ("Shadow/live
 * evidence") and the acceptance law "Simulation evidence and live evidence
 * are never conflated"; ARCHITECTURE-LOCK L5 (replay/reactive/generative
 * are DISTINCT fidelity classes — all simulation), L6, L12.
 *
 * THE EVIDENCE CLASS LAW: every benchmark definition and every result
 * record carries its evidence class — 'simulation' (replay datasets and
 * generative populations: exploration instruments) or 'live' (recorded
 * live-session execution: the layer-8 evidence class). The classes are
 * NEVER conflated, at three levels, each a typed error:
 * 1. DEFINITION level — a live definition must bind a live-session source
 *    and a simulation definition must bind a replay or generative source
 *    (`evidence_conflated`); a live definition over a GENERATED origin is
 *    the sharper sin and fails `live_claim_on_simulation` (a synthetic
 *    world claiming to be live evidence — the L5/L6 honesty law).
 * 2. RESULT level — result records carry the class of their benchmark.
 * 3. MANIFEST level — a manifest declares its class and every bound
 *    definition and result must agree (`evidence_conflated`); a live
 *    manifest binding simulation-origin results fails
 *    `live_claim_on_simulation`.
 */

import { deepFreeze, isDigest, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';
import type { DataOrigin } from './replay-mirror';

/** The derivation prefix of every live-session source id. */
export const LIVE_SOURCE_ID_PREFIX = 'lsrc:' as const;

/** The evidence classes — never conflated (spec/EVALUATION-PROTOCOL.md). */
export const EVIDENCE_CLASSES = ['simulation', 'live'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Runtime guard for an evidence class. */
export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return typeof value === 'string' && (EVIDENCE_CLASSES as readonly string[]).includes(value);
}

/**
 * The live-session data source: recorded LIVE execution evidence (a venue
 * session's stream refs plus the capture window). The origin is
 * 'historical' (recorded reality, the provenance vocabulary mirror) — the
 * EVIDENCE CLASS 'live' is what distinguishes it from a replay benchmark:
 * this material was produced by real execution, not by an exploration
 * instrument.
 */
export interface LiveSessionSource {
  readonly source_id: string;
  readonly kind: 'live-session';
  readonly origin: 'historical';
  /** The venue the session executed on (non-empty). */
  readonly venue: string;
  /** Opaque refs of the recorded live-session streams (non-empty, unique). */
  readonly session_refs: readonly string[];
  /** The digest of the capture configuration. */
  readonly config_digest: string;
  /** The session's captured window [start, end). */
  readonly captured: { readonly start: TimestampMs; readonly end: TimestampMs };
}

/** Guard: `LiveSessionSource` (structural). */
export function isLiveSessionSource(value: unknown): value is LiveSessionSource {
  if (!isRecord(value)) return false;
  if (typeof value.source_id !== 'string' || !value.source_id.startsWith(LIVE_SOURCE_ID_PREFIX)) return false;
  if (value.kind !== 'live-session') return false;
  if (value.origin !== 'historical') return false;
  if (!isNonEmptyString(value.venue)) return false;
  if (!Array.isArray(value.session_refs) || value.session_refs.length === 0) return false;
  if (!(value.session_refs as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  if (new Set(value.session_refs as readonly string[]).size !== (value.session_refs as readonly unknown[]).length) return false;
  if (!isDigest(value.config_digest)) return false;
  const captured = value.captured;
  if (!isRecord(captured)) return false;
  if (!isTimestampMs(captured.start) || !isTimestampMs(captured.end)) return false;
  return captured.end > captured.start;
}

/** The canonical source JSON (the content-addressing input; no `source_id`). */
export function liveSourceJson(content: Omit<LiveSessionSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    venue: content.venue,
    session_refs: content.session_refs,
    config_digest: content.config_digest,
    captured: content.captured as unknown as JsonObject,
  };
}

/** Compute the content address of a live-session source: `lsrc:<digest>`. */
export function liveSourceId(content: Omit<LiveSessionSource, 'source_id'>): string {
  return `${LIVE_SOURCE_ID_PREFIX}${stableDigestJson(liveSourceJson(content))}`;
}

/** The content digest of a validated source (manifest lineage binding). */
export function liveSourceDigest(source: LiveSessionSource): string {
  return stableDigestJson(liveSourceJson(source));
}

/**
 * Collect-all validation of an untrusted live-session source. On success
 * the source is returned narrowed, deeply frozen, with the DERIVED content
 * address (`lsrc:<digest>`) — a supplied id that disagrees with the
 * content fails `invalid_field` (L9).
 */
export function validateLiveSessionSource(value: unknown, path = 'data_source'): BenchmarkResult<LiveSessionSource> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (value.kind !== 'live-session') errors.push(invalidField(`${path}.kind`, "must be 'live-session'"));

  if (value.origin === undefined) errors.push(missingField(`${path}.origin`));
  else if (value.origin !== 'historical') errors.push(invalidField(`${path}.origin`, "a live session's origin must be 'historical' (recorded live execution)"));

  if (value.venue === undefined) errors.push(missingField(`${path}.venue`));
  else if (!isNonEmptyString(value.venue)) errors.push(invalidField(`${path}.venue`, 'must be a non-empty venue id'));

  if (value.session_refs === undefined) {
    errors.push(missingField(`${path}.session_refs`));
  } else if (!Array.isArray(value.session_refs) || value.session_refs.length === 0) {
    errors.push(invalidField(`${path}.session_refs`, 'must be a non-empty array of recorded session refs'));
  } else if (new Set(value.session_refs as readonly string[]).size !== (value.session_refs as readonly unknown[]).length) {
    errors.push(invalidField(`${path}.session_refs`, 'must not repeat a session ref'));
  }

  if (value.config_digest === undefined) {
    errors.push(missingField(`${path}.config_digest`));
  } else if (!isDigest(value.config_digest)) {
    errors.push(invalidField(`${path}.config_digest`, 'must be a 16-hex digest of the capture configuration'));
  }

  let captured: { readonly start: TimestampMs; readonly end: TimestampMs } | undefined;
  if (value.captured === undefined) {
    errors.push(missingField(`${path}.captured`));
  } else if (!isRecord(value.captured)) {
    errors.push(invalidField(`${path}.captured`, 'must be { start, end }'));
  } else if (!isTimestampMs(value.captured.start) || !isTimestampMs(value.captured.end) || value.captured.end <= value.captured.start) {
    errors.push(invalidField(`${path}.captured`, 'must be { start, end } with end > start (TimestampMs)'));
  } else {
    captured = { start: value.captured.start, end: value.captured.end };
  }

  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<LiveSessionSource, 'source_id'> = {
    kind: 'live-session',
    origin: 'historical',
    venue: value.venue as string,
    session_refs: value.session_refs as readonly string[],
    config_digest: value.config_digest as string,
    captured: captured as { readonly start: TimestampMs; readonly end: TimestampMs },
  };
  const derivedId = liveSourceId(content);
  if (value.source_id !== undefined && value.source_id !== derivedId) {
    return fail('invalid_field', `source id "${value.source_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.source_id`);
  }
  return ok(deepFreeze({ source_id: derivedId, ...content } satisfies LiveSessionSource));
}

// ---------------------------------------------------------------------------
// The evidence class law (definition level)
// ---------------------------------------------------------------------------

/** The source kind names (the closed vocabulary of benchmark data sources). */
export const SOURCE_KINDS = ['replay-dataset', 'generative-population', 'live-session'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Guard: a source kind. */
export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * THE EVIDENCE CLASS LAW (definition level): a definition's evidence class
 * must agree with its source kind — simulation binds replay datasets and
 * generative populations; live binds live sessions. A live definition over
 * a GENERATED origin fails `live_claim_on_simulation`; every other
 * disagreement fails `evidence_conflated`.
 */
export function checkEvidenceClass(evidenceClass: EvidenceClass, sourceKind: SourceKind, sourceOrigin: DataOrigin, path = 'evidence_class'): BenchmarkResult<true> {
  if (evidenceClass === 'live') {
    if (sourceOrigin === 'generated') {
      return fail(
        'live_claim_on_simulation',
        `live evidence class declared over a GENERATIVE population (origin 'generated') — synthetic worlds are exploration instruments, never live execution evidence (L5/L6; "Simulation evidence and live evidence are never conflated")`,
        path,
      );
    }
    if (sourceKind !== 'live-session') {
      return fail(
        'evidence_conflated',
        `live evidence class declared over a '${sourceKind}' source — live evidence binds recorded live-session material only (spec/EVALUATION-PROTOCOL.md: simulation and live evidence are never conflated)`,
        path,
      );
    }
    return ok(true);
  }
  if (sourceKind === 'live-session') {
    return fail(
      'evidence_conflated',
      `simulation evidence class declared over a live-session source — live execution material is the live evidence class, never simulation (spec/EVALUATION-PROTOCOL.md: simulation and live evidence are never conflated)`,
      path,
    );
  }
  return ok(true);
}
