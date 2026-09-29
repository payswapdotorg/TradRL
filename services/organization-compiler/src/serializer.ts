/**
 * @tradrl/organization-compiler — the reproducibility serializer.
 *
 * Work Order T016, section 5: "Reproducibility serializer: candidate log
 * -> canonical JSON bytes -> parse -> deep-equal; snapshot digest binding
 * (registry digest in every candidate's lineage)."
 *
 * Laws honored:
 * - Byte-determinism: the serialization is the program-wide canonical
 *   JSON (recursively sorted keys — the law declared by
 *   @tradrl/trajectory and mirrored across every lane), so equal logs
 *   serialize byte-identically (L9).
 * - Round-trip: `parseCandidateLog(serializeCandidateLog(log))` is
 *   deep-equal to the log AND revalidates against the full search-log
 *   law — a serialization that loses information is a typed failure.
 * - Snapshot digest binding: every candidate's lineage cites the
 *   registry snapshot digest, and the serializer asserts the binding
 *   (`registryDigestBinds`) — the log alone proves which evidence base
 *   it was compiled against.
 */

import {
  type JsonValue,
  type SearchLog,
  canonicalJson,
  isSearchLog,
  stableDigest,
  validateSearchLog,
} from '../../../packages/organization/src/index';

/**
 * Serializes a candidate log to its canonical JSON bytes (a UTF-8 string;
 * recursively sorted object keys, arrays in order). Pure and
 * deterministic: equal logs always serialize byte-identically.
 */
export function serializeCandidateLog(log: SearchLog): string {
  return canonicalJson(log as unknown as JsonValue);
}

/** The stable digest of a serialized candidate log (16 lowercase hex). */
export function digestOfSerializedLog(serialized: string): string {
  return stableDigest(serialized);
}

/**
 * Parses canonical JSON bytes back into a validated search log. Typed
 * failure when the bytes are not a log that satisfies the FULL law —
 * a serialization that cannot round-trip is a bug, not data.
 */
export function parseCandidateLog(serialized: string): { readonly ok: true; readonly value: SearchLog } | { readonly ok: false; readonly message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    return { ok: false, message: `candidate log bytes are not JSON: ${(error as Error).message}` };
  }
  if (!isSearchLog(parsed)) {
    return { ok: false, message: 'parsed bytes failed the structural SearchLog guard' };
  }
  const validated = validateSearchLog(parsed);
  if (!validated.ok) {
    const problems = validated.errors.map((e) => `(${e.code}) ${e.path}: ${e.message}`).join('; ');
    return { ok: false, message: `parsed log failed the full search-log law: ${problems}` };
  }
  return { ok: true, value: validated.value };
}

/**
 * `true` when every candidate's lineage cites the log's registry snapshot
 * digest — the L9 binding that makes the log alone prove which evidence
 * base it was compiled against. (The full law checks this too; this
 * helper is the serializer's dedicated assertion.)
 */
export function registryDigestBinds(log: SearchLog): boolean {
  return log.candidates.every(
    (candidate) => candidate.lineage.registrySnapshotDigest === log.registrySnapshot.digest,
  );
}
