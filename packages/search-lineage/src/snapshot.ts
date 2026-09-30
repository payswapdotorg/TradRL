/**
 * @tradrl/search-lineage — content-addressed config snapshots (Work Order T031).
 *
 * Spec anchors: ARCHITECTURE-LOCK L9 (reproducible lineage — "results bind
 * data, code, body, substrate, environment, runtime, evaluator and config";
 * the CONFIG is bound here, by content), L11 (search integrity — every
 * optimization trial carries its config so the search is reconstructible).
 *
 * THE CONTENT-ADDRESSING LAW: a {@link ConfigSnapshot} is an immutable
 * (snapshot id, config) pair where the id is `snap:<digest>` and the digest
 * is over the CANONICAL JSON of the config. Identical configs address to
 * the SAME id (dedupe — the search DAG's repeated hyperparameter blocks
 * collapse to one snapshot); ANY content change addresses to a different
 * id. A snapshot whose stored config does not address to its own id fails
 * `snapshot_mismatch` — content and address cannot disagree.
 *
 * The discipline mirrors the T028 generative lane's `configHash`
 * (content-bound deterministic digest of a canonical config — there the
 * config IS the data declaration; here the config is the optimization
 * point being searched over) and the T012 evaluation lane's
 * `stableDigestJson` (the digest function itself — same dual-lane FNV-1a,
 * see primitives.ts).
 */

import { canonicalJson, deepFreeze, isDigest, isJsonObject, isRecord, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { isConfigSnapshotId } from './ids';
import type { ConfigSnapshotId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type SearchError, type SearchResult } from './errors';

/** The derivation prefix of every config snapshot id. */
export const SNAPSHOT_ID_PREFIX = 'snap:' as const;

/** Compute the content address of a JSON config object: `snap:<digest-of-canonical-json>`. */
export function configSnapshotId(config: JsonObject): ConfigSnapshotId {
  return `snap:${stableDigestJson(config)}` as ConfigSnapshotId;
}

/** One content-addressed config snapshot: the immutable (id, config) pair. */
export interface ConfigSnapshot {
  /** Content address: `snap:<digest>` over the canonical JSON of `config`. */
  readonly snapshot_id: ConfigSnapshotId;
  /** The stored config (opaque JSON object — semantics owned by the search driver). */
  readonly config: JsonObject;
}

/** Guard: `ConfigSnapshot` (the content-addressing law included). */
export function isConfigSnapshot(v: unknown): v is ConfigSnapshot {
  if (!isRecord(v)) return false;
  if (!isConfigSnapshotId(v.snapshot_id)) return false;
  if (!isJsonObject(v.config)) return false;
  return v.snapshot_id === configSnapshotId(v.config);
}

/**
 * Collect-all validation of an untrusted config snapshot. Enforces the id
 * form (`snap:<16-hex>`), the JSON-object config, and the CONTENT-ADDRESS
 * law: the stored config must digest to the declared id. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateConfigSnapshot(value: unknown, path = 'snapshot'): SearchResult<ConfigSnapshot> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SearchError[] = [];
  if (value.snapshot_id === undefined) {
    errors.push(missingField(`${path}.snapshot_id`));
  } else if (typeof value.snapshot_id !== 'string' || !value.snapshot_id.startsWith(SNAPSHOT_ID_PREFIX)) {
    errors.push(invalidField(`${path}.snapshot_id`, `must be a snapshot id of the form "${SNAPSHOT_ID_PREFIX}<digest>"`));
  } else if (!isDigest(value.snapshot_id.slice(SNAPSHOT_ID_PREFIX.length))) {
    errors.push(invalidField(`${path}.snapshot_id`, 'must carry a 16-hex digest'));
  }
  if (value.config === undefined) {
    errors.push(missingField(`${path}.config`));
  } else if (!isJsonObject(value.config)) {
    errors.push(invalidField(`${path}.config`, 'must be a JSON object (the opaque optimization config)'));
  }
  if (errors.length > 0) return { ok: false, errors };

  if (value.snapshot_id !== configSnapshotId(value.config as JsonObject)) {
    return fail(
      'snapshot_mismatch',
      `snapshot "${value.snapshot_id}" stores content addressing to "${configSnapshotId(value.config as JsonObject)}" — content and address cannot disagree (L9)`,
      `${path}.snapshot_id`,
    );
  }
  return ok(
    deepFreeze({
      snapshot_id: value.snapshot_id as ConfigSnapshotId,
      config: value.config as JsonObject,
    } satisfies ConfigSnapshot),
  );
}

/**
 * Build a config snapshot from an untrusted config object: the id is
 * DERIVED (never caller-supplied), so content and address agree by
 * construction. This is the only minting path for snapshot ids.
 */
export function mintConfigSnapshot(config: unknown): SearchResult<ConfigSnapshot> {
  if (!isJsonObject(config)) {
    return { ok: false, errors: [invalidField('config', 'must be a JSON object (the opaque optimization config)')] };
  }
  return ok(deepFreeze({ snapshot_id: configSnapshotId(config), config } satisfies ConfigSnapshot));
}

/**
 * Project a snapshot to its canonical bytes (the address input). Determinism
 * anchor: identical configs project to identical canonical bytes, which is
 * exactly why they address identically.
 */
export function snapshotCanonicalBytes(snapshot: ConfigSnapshot): string {
  return canonicalJson(snapshot.config);
}

/** Verify a snapshot list as a dedupe-coherent store: unique ids, every snapshot valid. */
export function validateSnapshotStore(snapshots: readonly unknown[], path = 'snapshots'): SearchResult<readonly ConfigSnapshot[]> {
  const errors: SearchError[] = [];
  const byId = new Map<string, ConfigSnapshot>();
  snapshots.forEach((candidate, index) => {
    const result = validateConfigSnapshot(candidate, `${path}[${index}]`);
    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }
    const existing = byId.get(result.value.snapshot_id);
    if (existing !== undefined) {
      // Content addressing already guarantees byte-equal configs for equal
      // ids, so this arm only fires on a hand-minted duplicate entry.
      errors.push({
        code: 'duplicate_snapshot',
        path: `${path}[${index}].snapshot_id`,
        message: `duplicate snapshot "${result.value.snapshot_id}" — a content-addressed store lists each address once`,
      });
      return;
    }
    byId.set(result.value.snapshot_id, result.value);
  });
  if (errors.length > 0) return { ok: false, errors };
  return ok(snapshots as readonly ConfigSnapshot[]);
}
