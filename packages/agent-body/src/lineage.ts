// @tradrl/agent-body — BodyVersion lineage contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L3 (immutable versioned capability
// — version lineage is first-class), L9 (reproducible lineage);
// spec/LEARNING-LOOP.md (Body Versions are produced by learning: "training ->
// trajectory -> evaluation -> ... -> Body Version -> compatibility -> shadow");
// spec/REQUIREMENTS.md R27 (new Body Versions from validated learning).
//
// Lineage law: every BodyVersion points at its parent (or is a root); the
// parent chain of a body's versions forms a DAG — specifically a tree — with
// strictly increasing semver precedence from parent to child. Certified
// versions never mutate, so history is append-only by construction.

import {
  type BodyId,
  type BodyVersionId,
  compareSemVer,
  isRecord,
  parseBodyVersionIdString,
} from './primitives';
import {
  type BodyVersion,
  isBodyVersion,
} from './body';

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

/** Why a set of BodyVersions is not a valid lineage. */
export const LINEAGE_VIOLATION_CODES = [
  'duplicate-version-id',
  'unresolved-parent',
  'cycle',
  'version-regression',
  'body-mismatch',
] as const;

/** Lineage violation code. */
export type LineageViolationCode = (typeof LINEAGE_VIOLATION_CODES)[number];

/** Guard: `LineageViolationCode`. */
function isLineageViolationCodeLike(v: unknown): v is LineageViolationCode {
  return (
    typeof v === 'string' &&
    (LINEAGE_VIOLATION_CODES as readonly string[]).includes(v)
  );
}
export { isLineageViolationCodeLike as isLineageViolationCode };

/** One lineage violation. */
export interface LineageViolation {
  /** Violation code. */
  readonly code: LineageViolationCode;
  /** Human-readable explanation. */
  readonly message: string;
  /** The offending version, when identifiable. */
  readonly versionId: BodyVersionId | null;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * Runtime index over a validated set of versions. Not serialized — build it
 * with `buildLineageIndex` whenever you need to walk chains.
 */
export interface LineageIndex {
  /** All indexed versions by id. */
  readonly versions: ReadonlyMap<BodyVersionId, BodyVersion>;
}

/** Result of `buildLineageIndex`. */
export type LineageResult =
  | { readonly ok: true; readonly index: LineageIndex }
  | { readonly ok: false; readonly violations: readonly LineageViolation[] };

/**
 * Builds a `LineageIndex` from a batch of versions and validates the lineage
 * laws across the WHOLE set:
 *
 * 1. `duplicate-version-id` — no two versions share an id.
 * 2. `unresolved-parent` — every non-null `parentId` resolves within the set.
 * 3. `cycle` — no parent chain may revisit a version (lineage is a DAG/tree).
 * 4. `version-regression` — a child's semver precedence must be strictly
 *    greater than its parent's (version lineage is monotonic).
 * 5. `body-mismatch` — a parent must belong to the same body as the child.
 *
 * Certified and uncertified versions can be mixed; `CertifiedBodyVersion` is
 * assignable to `BodyVersion`.
 */
export function buildLineageIndex(versions: readonly BodyVersion[]): LineageResult {
  const violations: LineageViolation[] = [];
  const byId = new Map<BodyVersionId, BodyVersion>();

  for (const version of versions) {
    if (!isBodyVersion(version)) {
      violations.push({
        code: 'duplicate-version-id',
        message: `entry is not a valid BodyVersion: ${safeDescribe(version)}`,
        versionId: null,
      });
      continue;
    }
    if (byId.has(version.id)) {
      violations.push({
        code: 'duplicate-version-id',
        message: `version id ${version.id} appears more than once`,
        versionId: version.id,
      });
      continue;
    }
    byId.set(version.id, version);
  }

  // Unresolved parents and body mismatches.
  for (const version of byId.values()) {
    if (version.parentId === null) continue;
    const parent: BodyVersion | undefined = byId.get(version.parentId);
    if (parent === undefined) {
      violations.push({
        code: 'unresolved-parent',
        message: `version ${version.id} references parent ${version.parentId} which is not in the set`,
        versionId: version.id,
      });
      continue;
    }
    const parentBody = parseBodyVersionIdString(version.parentId);
    if (parentBody !== null && parentBody.bodyId !== version.bodyId) {
      violations.push({
        code: 'body-mismatch',
        message: `version ${version.id} (body ${version.bodyId}) references parent from body ${parentBody.bodyId}`,
        versionId: version.id,
      });
    }
  }

  // Cycles, with memoization of already-verified heads.
  const verified = new Set<BodyVersionId>();
  for (const start of byId.values()) {
    const onPath = new Set<BodyVersionId>();
    const path: BodyVersionId[] = [];
    let current: BodyVersion | undefined = start;
    while (current !== undefined && current.parentId !== null) {
      if (verified.has(current.id)) break;
      if (onPath.has(current.id)) {
        const from = path.indexOf(current.id);
        violations.push({
          code: 'cycle',
          message: `parent chain cycles: ${[...path.slice(from), current.id].join(' -> ')}`,
          versionId: current.id,
        });
        break;
      }
      onPath.add(current.id);
      path.push(current.id);
      current = byId.get(current.parentId);
    }
    for (const id of path) verified.add(id);
  }

  // Version monotonicity (child precedence strictly greater than parent).
  for (const version of byId.values()) {
    if (version.parentId === null) continue;
    const parent: BodyVersion | undefined = byId.get(version.parentId);
    if (parent === undefined) continue;
    if (compareSemVer(version.version, parent.version) <= 0) {
      violations.push({
        code: 'version-regression',
        message: `version ${version.id} does not strictly succeed its parent ${parent.id} (semver precedence must increase along lineage)`,
        versionId: version.id,
      });
    }
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, index: { versions: byId } };
}

function safeDescribe(v: unknown): string {
  if (isRecord(v) && typeof v.id === 'string') return `id=${v.id}`;
  return JSON.stringify(v) ?? 'unserializable entry';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The parent chain of `versionId`, starting at the version itself and ending
 * at its root ancestor. Returns `null` for an unknown id. Cycle-free by
 * construction when the index came from `buildLineageIndex`.
 */
export function lineageChain(
  index: LineageIndex,
  versionId: BodyVersionId,
): readonly BodyVersion[] | null {
  const chain: BodyVersion[] = [];
  const seen = new Set<BodyVersionId>();
  let current: BodyVersion | undefined = index.versions.get(versionId);
  while (current !== undefined) {
    if (seen.has(current.id)) return null; // defensive: cyclic input
    seen.add(current.id);
    chain.push(current);
    current =
      current.parentId === null ? undefined : index.versions.get(current.parentId);
  }
  if (chain.length === 0) return null;
  return chain;
}

/**
 * `true` when `ancestorId` is an ancestor of (or equal to) `descendantId`
 * along the parent chain.
 */
export function isAncestorOf(
  index: LineageIndex,
  ancestorId: BodyVersionId,
  descendantId: BodyVersionId,
): boolean {
  const chain = lineageChain(index, descendantId);
  if (chain === null) return false;
  return chain.some((version) => version.id === ancestorId);
}

/**
 * The lowest common ancestor of two versions: the deepest version that is an
 * ancestor of both. Returns `null` when either id is unknown or they share
 * no ancestor (different bodies).
 */
export function lowestCommonAncestor(
  index: LineageIndex,
  a: BodyVersionId,
  b: BodyVersionId,
): BodyVersionId | null {
  const chainA = lineageChain(index, a);
  const chainB = lineageChain(index, b);
  if (chainA === null || chainB === null) return null;
  const idsB = new Set(chainB.map((version) => version.id));
  for (const version of chainA) {
    if (idsB.has(version.id)) return version.id;
  }
  return null;
}

/** All indexed versions belonging to `bodyId`, ordered by semver precedence (ascending). */
export function versionsOfBody(
  index: LineageIndex,
  bodyId: BodyId,
): readonly BodyVersion[] {
  const versions = [...index.versions.values()].filter((version) => version.bodyId === bodyId);
  return versions.sort((x, y) => compareSemVer(x.version, y.version));
}

/**
 * Asserts (throws `Error`) that `versions` forms a valid acyclic lineage.
 * Convenience wrapper over `buildLineageIndex` for fail-fast call sites.
 */
export function assertAcyclicLineage(versions: readonly BodyVersion[]): LineageIndex {
  const result = buildLineageIndex(versions);
  if (!result.ok) {
    throw new Error(
      `lineage is not valid: ${result.violations.map((v) => `${v.code} (${v.message})`).join('; ')}`,
    );
  }
  return result.index;
}
