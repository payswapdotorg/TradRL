import { describe, expect, it } from 'vitest';
import {
  type LineageViolation,
  assertAcyclicLineage,
  buildLineageIndex,
  isAncestorOf,
  lineageChain,
  lowestCommonAncestor,
  versionsOfBody,
} from './lineage';
import {
  type BodyVersion,
  type BodyVersionDraft,
  createBodyVersion,
} from './body';
import { bodyId, bodyVersionId, iso8601, makeBodyVersionId, parseSemVer } from './primitives';
import { exampleBody, exampleBodyVersion, exampleCertifiedBodyVersion, exampleLineage } from './examples';

const REGIME = bodyVersionId('regime-researcher@1.0.0');
const V110 = bodyVersionId('regime-researcher@1.1.0');
const V200 = bodyVersionId('regime-researcher@2.0.0');

function draft(version: string, parentId: string | null, bodyIdArg = exampleBody.id): BodyVersionDraft {
  const parsed = parseSemVer(version);
  if (parsed === null) throw new Error(`bad version ${version}`);
  const composition = JSON.parse(JSON.stringify(exampleBodyVersion.composition));
  return {
    bodyId: bodyIdArg,
    version: parsed,
    parentId: parentId === null ? null : makeBodyVersionId(bodyIdArg, parseSemVer(parentId)!),
    composition,
    createdAt: iso8601('2026-06-01T00:00:00Z'),
  };
}

function version(v: string, parentId: string | null, bodyIdArg = exampleBody.id): BodyVersion {
  return createBodyVersion(draft(v, parentId, bodyIdArg));
}

describe('buildLineageIndex — valid lineages', () => {
  it('indexes the canonical example lineage (certified root included)', () => {
    const result = buildLineageIndex(exampleLineage);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.index.versions.size).toBe(3);
    expect(result.index.versions.get(REGIME)).toBe(exampleCertifiedBodyVersion);
  });

  it('accepts a fork: two children of the same parent', () => {
    const root = version('1.0.0', null);
    const forkA = version('1.1.0', '1.0.0');
    const forkB = version('2.0.0', '1.0.0');
    const result = buildLineageIndex([root, forkA, forkB]);
    expect(result.ok).toBe(true);
  });
});

describe('buildLineageIndex — violations', () => {
  it('flags duplicate version ids', () => {
    const a = version('1.0.0', null);
    const b = version('1.0.0', null);
    const result = buildLineageIndex([a, b]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toContain('duplicate-version-id');
  });

  it('flags unresolved parents', () => {
    const orphan = version('1.1.0', '1.0.0');
    const result = buildLineageIndex([orphan]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toEqual(['unresolved-parent']);
    expect(result.violations[0]?.message).toContain('regime-researcher@1.0.0');
  });

  it('flags parent chains that cycle (lineage acyclicity)', () => {
    // Hand-assemble a 3-cycle: 1.1.0 -> 1.0.0 -> 2.0.0 -> 1.1.0.
    // createBodyVersion accepts each link (all references are well-formed and
    // same-body); the INDEX must catch the cycle.
    const a = version('1.1.0', '1.0.0');
    const b = version('2.0.0', '1.1.0');
    const loopedRoot = { ...version('1.0.0', null), parentId: b.id } as BodyVersion;
    const result = buildLineageIndex([a, b, loopedRoot]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const cycles = result.violations.filter((v) => v.code === 'cycle');
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toMatch(/-> /);
  });

  it('flags version regression (child must strictly succeed parent)', () => {
    const parent = version('2.0.0', null);
    const regressedChild = version('1.0.0', '2.0.0');
    const result = buildLineageIndex([parent, regressedChild]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toContain('version-regression');
  });

  it('flags a child that merely ties its parent (build metadata is ignored by precedence)', () => {
    const parent = version('2.0.0', null);
    const tiedChild = { ...version('2.0.0+build.1', null), parentId: parent.id } as BodyVersion;
    const result = buildLineageIndex([parent, tiedChild]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toEqual(['version-regression']);
  });

  it('flags prerelease children that do not succeed their release parent', () => {
    const parent = version('2.0.0', null);
    const child = version('2.0.0-rc.1', '2.0.0'); // 2.0.0-rc.1 < 2.0.0
    const result = buildLineageIndex([parent, child]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toEqual(['version-regression']);
  });

  it('flags parents from a different body', () => {
    // Only possible via a hand-crafted link: createBodyVersion rejects
    // cross-body parents at construction, the index must catch them anyway.
    const foreignParent = version('1.0.0', null, bodyId('other-body'));
    const child = version('1.1.0', null);
    const adopted = { ...child, parentId: foreignParent.id } as BodyVersion;
    const result = buildLineageIndex([foreignParent, adopted]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toEqual(['body-mismatch']);
  });
});

describe('lineage queries', () => {
  it('lineageChain walks from a version to its root', () => {
    const result = buildLineageIndex(exampleLineage);
    if (!result.ok) throw new Error('unreachable');
    const chain = lineageChain(result.index, V200);
    expect(chain?.map((v) => v.id)).toEqual([V200, V110, REGIME]);
    expect(lineageChain(result.index, REGIME)?.map((v) => v.id)).toEqual([REGIME]);
    expect(lineageChain(result.index, bodyVersionId('unknown@9.9.9'))).toBeNull();
  });

  it('isAncestorOf resolves ancestry', () => {
    const result = buildLineageIndex(exampleLineage);
    if (!result.ok) throw new Error('unreachable');
    expect(isAncestorOf(result.index, REGIME, V200)).toBe(true);
    expect(isAncestorOf(result.index, V200, REGIME)).toBe(false);
    expect(isAncestorOf(result.index, V110, V200)).toBe(true);
    expect(isAncestorOf(result.index, V200, V200)).toBe(true);
  });

  it('lowestCommonAncestor finds the deepest shared ancestor', () => {
    const root = version('1.0.0', null);
    const a = version('1.1.0', '1.0.0');
    const b = version('2.0.0', '1.0.0');
    const aChild = version('1.2.0', '1.1.0');
    const result = buildLineageIndex([root, a, b, aChild]);
    if (!result.ok) throw new Error('unreachable');
    expect(lowestCommonAncestor(result.index, aChild.id, b.id)).toBe(root.id);
    expect(lowestCommonAncestor(result.index, aChild.id, a.id)).toBe(a.id);
    expect(lowestCommonAncestor(result.index, aChild.id, bodyVersionId('unknown@9.9.9'))).toBeNull();
  });

  it('versionsOfBody lists one body’s versions in ascending semver order', () => {
    const root = version('1.0.0', null);
    const other = version('1.0.0', null, bodyId('other-body'));
    const mid = version('1.10.0', '1.0.0');
    const early = version('1.2.0', '1.0.0');
    const pre = version('2.0.0-rc.1', '1.10.0');
    const result = buildLineageIndex([root, other, mid, early, pre]);
    if (!result.ok) throw new Error('unreachable');
    expect(versionsOfBody(result.index, exampleBody.id).map((v) => v.id)).toEqual([
      REGIME,
      bodyVersionId('regime-researcher@1.2.0'),
      bodyVersionId('regime-researcher@1.10.0'),
      bodyVersionId('regime-researcher@2.0.0-rc.1'),
    ]);
    expect(versionsOfBody(result.index, bodyId('other-body'))).toHaveLength(1);
  });
});

describe('assertAcyclicLineage', () => {
  it('returns the index for a valid lineage', () => {
    const index = assertAcyclicLineage(exampleLineage);
    expect(index.versions.size).toBe(3);
  });

  it('throws for an invalid lineage', () => {
    const orphan = version('1.1.0', '1.0.0');
    expect(() => assertAcyclicLineage([orphan])).toThrow(/unresolved-parent/);
  });
});

describe('certified versions participate in lineage (L3 + L9)', () => {
  it('a certified parent can be extended by uncertified children', () => {
    const child = version('1.1.0', '1.0.0');
    const result = buildLineageIndex([exampleCertifiedBodyVersion, child]);
    expect(result.ok).toBe(true);
  });

  it('the certified record keeps its certification inside the index', () => {
    const result = buildLineageIndex(exampleLineage);
    if (!result.ok) throw new Error('unreachable');
    const root = result.index.versions.get(REGIME);
    expect(root?.certified).toBe(true);
    expect(root?.certificationEvidence?.certifiedBy).toBe('tradrl-verification-service');
  });

  it('violations carry the offending version id when identifiable', () => {
    const orphan = version('1.1.0', '1.0.0');
    const result = buildLineageIndex([orphan]);
    if (result.ok) throw new Error('unreachable');
    const violation: LineageViolation | undefined = result.violations[0];
    expect(violation?.versionId).toBe(V110);
  });
});
