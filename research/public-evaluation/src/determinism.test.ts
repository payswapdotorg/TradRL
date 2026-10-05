/**
 * T049 — determinism: byte-identical outputs for identical inputs (L9 —
 * the publication layer's re-verification law stands on exactly this), and
 * the source-level no-ambient-anything + import-discipline laws.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLISHED_AT,
  canonicalMeasurement,
  canonicalPublication,
  compilePublishedRecord,
  createMeasurementLog,
  appendMeasurement,
  createPublicationLog,
  publishRecord,
  fixtureHoldoutMeasurement,
  fixtureMeasurement,
  fixturePolicy,
  reverifyPublishedRecord,
  runSuiteMeasurement,
  stableDigest,
  stableDigestJson,
} from './index';
import {
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureSearchRecord,
  fixtureSliceReport,
  fixtureSplitPlan,
  fixtureSubject,
} from './fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));
const MACHINERY_SRC = join(HERE, '..', '..', '..', 'benchmarks', 'platform', 'src');
const PUBLICATION_SRC = HERE;

// ---------------------------------------------------------------------------
// Byte-identical outputs (the determinism law the re-verification stands on)
// ---------------------------------------------------------------------------

describe('T049 determinism — identical inputs, identical bytes', () => {
  it('the measurement runner is pure: two runs, one measurement id, byte-identical records', () => {
    const first = fixtureMeasurement();
    const second = fixtureMeasurement();
    expect(second.measurement_id).toBe(first.measurement_id);
    expect(canonicalMeasurement(second)).toBe(canonicalMeasurement(first));
  });

  it('the holdout measurement is pure (the phase laws do not disturb determinism)', () => {
    const first = fixtureHoldoutMeasurement();
    const second = fixtureHoldoutMeasurement();
    expect(second.measurement_id).toBe(first.measurement_id);
    expect(canonicalMeasurement(second)).toBe(canonicalMeasurement(first));
  });

  it('the publication compiler is pure: two compilations, one record id, byte-identical publications', () => {
    const compile = () => compilePublishedRecord({ measurement: fixtureMeasurement(), policy: fixturePolicy(), publishedAt: PUBLISHED_AT });
    const first = compile();
    const second = compile();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.record_id).toBe(first.value.record_id);
    expect(canonicalPublication(second.value)).toBe(canonicalPublication(first.value));
  });

  it('the measurement log chain is a pure fold: two grown logs, one head', () => {
    const grow = () => {
      const open = createMeasurementLog({ tenant: fixtureMeasurement().tenant, project: fixtureMeasurement().project });
      if (!open.ok) throw new Error('unreachable');
      const withInSearch = appendMeasurement(open.value, { measurement: fixtureMeasurement() });
      if (!withInSearch.ok) throw new Error('unreachable');
      return appendMeasurement(withInSearch.value, { measurement: fixtureHoldoutMeasurement() });
    };
    const first = grow();
    const second = grow();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.chain_head).toBe(first.value.chain_head);
    expect(JSON.stringify(second.value.entries)).toBe(JSON.stringify(first.value.entries));
  });

  it('the publication log chain is a pure fold: two grown logs, one head', () => {
    const compile = (instant: number) =>
      compilePublishedRecord({
        measurement: instant === PUBLISHED_AT ? fixtureMeasurement() : fixtureHoldoutMeasurement(),
        policy: fixturePolicy(),
        publishedAt: instant,
      });
    const first = compile(PUBLISHED_AT);
    const second = compile(PUBLISHED_AT);
    const holdoutFirst = compile(PUBLISHED_AT + 1_000);
    const holdoutSecond = compile(PUBLISHED_AT + 1_000);
    if (!first.ok || !second.ok || !holdoutFirst.ok || !holdoutSecond.ok) throw new Error('unreachable');
    const grow = (a: typeof first.value, b: typeof holdoutFirst.value) => {
      const open = createPublicationLog({ tenant: a.tenant, project: a.project });
      if (!open.ok) throw new Error('unreachable');
      const one = publishRecord(open.value, { record: a });
      if (!one.ok) throw new Error(one.errors.map((error) => error.message).join('; '));
      return publishRecord(one.value.log, { record: b });
    };
    const logA = grow(first.value, holdoutFirst.value);
    const logB = grow(second.value, holdoutSecond.value);
    expect(logA.ok).toBe(true);
    expect(logB.ok).toBe(true);
    if (!logA.ok || !logB.ok) throw new Error('unreachable');
    expect(logB.value.log.chain_head).toBe(logA.value.log.chain_head);
  });

  it('re-verification itself is deterministic: two re-runs, the same verdict and bytes', () => {
    const compiled = compilePublishedRecord({ measurement: fixtureMeasurement(), policy: fixturePolicy(), publishedAt: PUBLISHED_AT });
    if (!compiled.ok) throw new Error('unreachable');
    const sources = {
      suite: fixturePlatformSuiteRecord(),
      evidence: fixtureSliceReport(),
      material: fixtureReplaySource(),
      plan: fixtureSplitPlan(),
      search: null,
      policy: fixturePolicy(),
    };
    const first = reverifyPublishedRecord(compiled.value, sources);
    const second = reverifyPublishedRecord(compiled.value, sources);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.bytes).toBe(first.value.bytes);
    expect(second.value.remeasurement.measurement_id).toBe(first.value.remeasurement.measurement_id);
  });

  it('the fixtures are pure: every fixture re-derives its own content addresses', () => {
    expect(fixtureReplaySource().source_id).toBe(fixtureReplaySource().source_id);
    expect(fixtureSearchRecord().chain_head).toBe(fixtureSearchRecord().chain_head);
    expect(fixtureSplitPlan().plan_id).toBe(fixtureSplitPlan().plan_id);
    expect(fixturePlatformSuiteRecord().suite_id).toBe(fixturePlatformSuiteRecord().suite_id);
    // The subject binding's artifact digest re-derives from the fixture report's
    // canonical content (the L9 content-address law, end to end).
    expect(fixtureSubject().artifacts[0]?.digest).toBe(stableDigestJson(fixtureSliceReport() as never));
  });

  it('re-running the runner through the OWN-LANE import surface yields the same id as the package fixtures', () => {
    const result = runSuiteMeasurement({
      suite: fixturePlatformSuiteRecord(),
      subject: fixtureSubject(),
      evidence: fixtureSliceReport(),
      material: fixtureReplaySource(),
      phase: 'in-search',
      search: null,
      plan: fixtureSplitPlan(),
      measured_at: fixtureMeasurement().recorded_at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.measurement_id).toBe(fixtureMeasurement().measurement_id);
  });
});

// ---------------------------------------------------------------------------
// The source-level laws (no ambient anything; the import discipline)
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('T049 determinism — the source-level laws', () => {
  it('no ambient clock or randomness anywhere in the lane\'s non-test src', () => {
    const banned = [/Date\.now/, /new Date\(/, /Math\.random/, /performance\.now/, /randomUUID/, /process\.hrtime/];
    for (const root of [MACHINERY_SRC, PUBLICATION_SRC]) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of banned) {
          expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });

  it('benchmarks/platform src imports NOTHING outside its own package (mirrors only — D-003/D-004)', () => {
    for (const file of walk(MACHINERY_SRC)) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(specifier.startsWith('./'), `${file} imports ${specifier} — only intra-package relative imports are lawful`).toBe(true);
      }
    }
  });

  it('research/public-evaluation src: imports.ts + fixtures.ts are the ONLY own-lane import carriers', () => {
    for (const file of walk(PUBLICATION_SRC)) {
      const name = file.slice(PUBLICATION_SRC.length + 1);
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
      const outOfPackage = imports.filter((specifier) => specifier.startsWith('../..'));
      if (name === 'imports.ts' || name === 'fixtures.ts') {
        expect(outOfPackage.length, `${name} is the documented own-lane import surface`).toBeGreaterThan(0);
      } else {
        expect(outOfPackage, `${name} must not import outside the package`).toHaveLength(0);
      }
    }
  });

  it('no workspace-package imports anywhere in the lane (never @tradrl/* specifiers)', () => {
    for (const root of [MACHINERY_SRC, PUBLICATION_SRC]) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${file} must not import workspace packages`).not.toMatch(/from '@tradrl\//);
      }
    }
  });
});
