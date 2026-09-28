/**
 * Contracts/evaluation documents are the authority downstream work orders
 * code against (T013 RL, T015 curriculum, T016 organization compiler, T031
 * search-integrity audits); this test keeps the evaluation documents
 * honest, mirroring the domain-core and learning-lane contract-docs
 * pattern: every ```json block is extracted, parsed and validated against
 * this package's guards.
 *
 * This package owns 01-metrics.md, 02-suites-and-splits.md,
 * 03-attainment-verdict.md and 04-search-integrity.md;
 * 05-verification-and-release-gate.md is owned and validated by
 * @tradrl/verification (same directory, different package).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isBlindHoldoutPolicy,
  isEvaluationConfig,
  isEvaluationSuite,
  isMetricDefinition,
  isSplitPolicy,
  isTrialStatistic,
} from './index';

const DOCS_DIR = fileURLToPath(new URL('../../../contracts/evaluation/', import.meta.url));

/** Guard registry: document -> validators applied to its json blocks in order. */
const DOC_VALIDATORS: Record<string, readonly ((v: unknown) => boolean)[]> = {
  '01-metrics.md': [isMetricDefinition, isMetricDefinition],
  '02-suites-and-splits.md': [isEvaluationSuite, isSplitPolicy],
  '03-attainment-verdict.md': [isEvaluationConfig],
  '04-search-integrity.md': [(v) => Array.isArray(v) && v.every((entry) => isTrialStatistic(entry))],
};

function extractJsonBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1] as string);
  }
  return blocks;
}

function readDoc(file: string): string {
  return readFileSync(DOCS_DIR + file, 'utf8');
}

describe('contracts/evaluation documents (evaluation package ownership)', () => {
  it('every concept document is covered by a validator registry (README carries no examples)', () => {
    const files = readdirSync(DOCS_DIR).filter((file) => file.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file === 'README.md') {
        expect(extractJsonBlocks(readDoc(file))).toHaveLength(0);
        continue;
      }
      // This package owns 01-04; 05 is owned and validated by
      // @tradrl/verification (same directory, different package).
      if (file === '05-verification-and-release-gate.md') continue;
      expect(DOC_VALIDATORS[file], `${file} is not covered by the doc test`).toBeDefined();
    }
    for (const file of Object.keys(DOC_VALIDATORS)) {
      expect(files, `${file} is registered but missing`).toContain(file);
    }
  });

  it('every owned document carries exactly its registered JSON examples', () => {
    for (const [file, validators] of Object.entries(DOC_VALIDATORS)) {
      const blocks = extractJsonBlocks(readDoc(file));
      expect(blocks.length, `${file} must contain at least one json example`).toBeGreaterThan(0);
      expect(blocks.length, `${file} has more blocks than registered validators`).toBe(validators.length);
    }
  });

  it('every documented JSON example passes its guard', () => {
    for (const [file, validators] of Object.entries(DOC_VALIDATORS)) {
      const blocks = extractJsonBlocks(readDoc(file));
      blocks.forEach((block, index) => {
        const parsed: unknown = JSON.parse(block);
        const valid = validators[index]?.(parsed) ?? false;
        expect(valid, `${file} json block #${index + 1} failed its guard`).toBe(true);
      });
    }
  });

  it('the documented split policy example is the blind-holdout kind (boundary doc law)', () => {
    const blocks = extractJsonBlocks(readDoc('02-suites-and-splits.md')).map((block) => JSON.parse(block) as unknown);
    const policy = blocks[1];
    expect(policy).toBeDefined();
    if (policy === undefined) throw new Error('documented example missing');
    expect(isBlindHoldoutPolicy(policy)).toBe(true);
  });

  it('the documented trial-statistics example covers a full log (failures carry null — L11)', () => {
    const blocks = extractJsonBlocks(readDoc('04-search-integrity.md')).map((block) => JSON.parse(block) as unknown);
    const statistics = blocks[0];
    expect(statistics).toBeDefined();
    if (!Array.isArray(statistics)) throw new Error('documented example must be an array');
    const ids = statistics.map((entry) => (entry as { trial_id: string }).trial_id);
    expect(new Set(ids).size).toBe(ids.length); // one entry per distinct trial
    expect(statistics.some((entry) => (entry as { statistic: number | null }).statistic === null)).toBe(true); // failures retained
  });
});
