/**
 * Contracts/evaluation document 05 (verification and the release gate) is
 * owned by THIS package; this test keeps that document honest, mirroring
 * the learning-lane contract-docs pattern: every ```json block is
 * extracted, parsed and validated against this package's guards.
 *
 * Documents 01-04 are owned and validated by @tradrl/evaluation (same
 * directory, different package).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLineageHashCase, isQuartetMonotoneCase, verifyEvidenceChain } from './index';

const DOCS_DIR = fileURLToPath(new URL('../../../contracts/evaluation/', import.meta.url));

/** Guard registry: document -> validators applied to its json blocks in order. */
const DOC_VALIDATORS: Record<string, readonly ((v: unknown) => boolean)[]> = {
  '05-verification-and-release-gate.md': [isLineageHashCase, isQuartetMonotoneCase],
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

describe('contracts/evaluation documents (verification package ownership)', () => {
  it('this package owns exactly 05; every other concept document is covered by the evaluation package', () => {
    const files = readdirSync(DOCS_DIR).filter((file) => file.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file === 'README.md') {
        expect(extractJsonBlocks(readDoc(file))).toHaveLength(0);
        continue;
      }
      // 01-04 are owned by @tradrl/evaluation; 05 is ours.
      const owned = file === '05-verification-and-release-gate.md';
      expect(DOC_VALIDATORS[file] !== undefined, `${file} ownership mismatch`).toBe(owned);
    }
    for (const file of Object.keys(DOC_VALIDATORS)) {
      expect(files, `${file} is registered but missing`).toContain(file);
    }
  });

  it('the owned document carries exactly its registered JSON examples', () => {
    const blocks = extractJsonBlocks(readDoc('05-verification-and-release-gate.md'));
    expect(blocks.length, '05 must contain at least one json example').toBeGreaterThan(0);
    expect(blocks.length).toBe(DOC_VALIDATORS['05-verification-and-release-gate.md']?.length);
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

  it('the documented quartet case verifies clean against the real verifier (end-to-end doc law)', () => {
    const blocks = extractJsonBlocks(readDoc('05-verification-and-release-gate.md')).map((block) => JSON.parse(block) as unknown);
    const quartetCase = blocks[1];
    expect(quartetCase).toBeDefined();
    if (quartetCase === undefined) throw new Error('documented example missing');
    const result = verifyEvidenceChain([quartetCase]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(true);
    expect(result.value.failures).toEqual([]);
  });
});
