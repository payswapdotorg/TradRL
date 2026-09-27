import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ConstraintSet,
  ConstraintEvaluationContext,
  evaluateConstraintSet,
  isConstraintEvaluationContext,
  isConstraintSet,
  isDecision,
  isGoal,
  isInstrument,
  isLesson,
  isOrder,
  isOrganization,
  isOutcome,
  isPortfolio,
  isPosition,
  isProject,
  isVenue,
} from './index';
import { Timestamp } from './primitives';
import { isRecord } from './primitives';

// Contracts/domain documents are the authority downstream work orders code
// against; this test keeps them honest: every ```json block in every concept
// document is extracted, parsed and validated against the package guards.
// constraint-set.md additionally regenerates its documented evaluation
// report from its documented set + context, so the documented evaluator
// semantics can never drift from the code.

const DOCS_DIR = fileURLToPath(new URL('../../../contracts/domain/', import.meta.url));

/** Structural check for the documented evaluation report (third block of constraint-set.md). */
function looksLikeEvaluationReport(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.pass !== 'boolean') return false;
  if (typeof v.satisfiedRatio !== 'number') return false;
  if (!Array.isArray(v.checks)) return false;
  return v.checks.every((c) => isRecord(c) && typeof c.status === 'string');
}

/** Guard registry: document -> validators applied to its json blocks in order. */
const DOC_VALIDATORS: Record<string, readonly ((v: unknown) => boolean)[]> = {
  'goal.md': [isGoal],
  'constraint-set.md': [isConstraintSet, isConstraintEvaluationContext, looksLikeEvaluationReport],
  'project.md': [isProject],
  'market-reference.md': [isVenue, isInstrument],
  'order.md': [isOrder],
  'portfolio.md': [isPosition, isPortfolio],
  'organization.md': [isOrganization],
  'decision.md': [isDecision],
  'outcome.md': [isOutcome],
  'lesson.md': [isLesson],
};

function extractJsonBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function readDoc(file: string): string {
  return readFileSync(DOCS_DIR + file, 'utf8');
}

describe('contracts/domain documents', () => {
  it('every document in the directory is covered by the validator registry', () => {
    const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // README carries conventions only and must stay free of examples;
      // adding an example means adding validation here in the same change.
      if (file === 'README.md') {
        expect(extractJsonBlocks(readDoc(file))).toHaveLength(0);
        continue;
      }
      expect(DOC_VALIDATORS[file], `${file} is not covered by the doc test`).toBeDefined();
    }
    for (const file of Object.keys(DOC_VALIDATORS)) {
      expect(files, `${file} is registered but missing`).toContain(file);
    }
  });

  it('every concept document carries at least one JSON example', () => {
    for (const file of Object.keys(DOC_VALIDATORS)) {
      const blocks = extractJsonBlocks(readDoc(file));
      expect(blocks.length, `${file} must contain at least one json example`).toBeGreaterThan(0);
      expect(blocks.length, `${file} has more blocks than registered validators`).toBe(
        DOC_VALIDATORS[file].length,
      );
    }
  });

  it('every documented JSON example passes its concept guard', () => {
    for (const [file, validators] of Object.entries(DOC_VALIDATORS)) {
      const blocks = extractJsonBlocks(readDoc(file));
      blocks.forEach((block, index) => {
        const parsed: unknown = JSON.parse(block);
        const valid = validators[index](parsed);
        expect(valid, `${file} json block #${index + 1} failed its guard`).toBe(true);
      });
    }
  });

  it('the documented constraint evaluation report is exactly what the evaluator produces', () => {
    const blocks = extractJsonBlocks(readDoc('constraint-set.md')).map(
      (block) => JSON.parse(block) as unknown,
    );
    const set = blocks[0] as ConstraintSet;
    const context = blocks[1] as ConstraintEvaluationContext;
    const documentedReport = blocks[2];

    const evaluatedAt = '2027-02-01T12:00:00Z' as Timestamp;
    const actual = evaluateConstraintSet(set, context, evaluatedAt);

    expect(JSON.parse(JSON.stringify(actual))).toEqual(documentedReport);
    expect(actual.pass).toBe(false); // one blocking violation
    expect(actual.blockingViolations).toBe(1);
    expect(actual.advisoryViolations).toBe(1);
    expect(actual.satisfiedRatio).toBeCloseTo(1 / 3, 12);
  });
});
