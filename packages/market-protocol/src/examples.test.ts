/**
 * Machine-verification of contracts/market/05-json-examples.md.
 *
 * Every fenced JSON block tagged with an `__example__` marker is parsed and
 * validated against the real implementation. Blocks whose marker starts with
 * `rejected-` must FAIL with the documented code; all other marked blocks
 * must PASS. The contract document therefore cannot drift from the code.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateMarketEvent, type MarketEvent } from './index';

const DOC_PATH = resolve(__dirname, '../../../contracts/market/05-json-examples.md');

interface Example {
  readonly marker: string;
  readonly candidate: Record<string, unknown>;
}

function extractExamples(doc: string): Example[] {
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  const examples: Example[] = [];
  for (const block of blocks) {
    const parsed = JSON.parse(block) as Record<string, unknown>;
    const marker = parsed['__example__'];
    if (typeof marker !== 'string') continue; // fragments (derived artifacts, trajectories) are not envelope events
    delete parsed['__example__'];
    examples.push({ marker, candidate: parsed });
  }
  return examples;
}

/** Documented rejection codes per rejected example marker. */
const EXPECTED_REJECTIONS: Record<string, string> = {
  'rejected-available-before-event': 'timestamp_order',
  'rejected-historical-without-adapter': 'provenance_adapter_required',
};

describe('contracts/market/05-json-examples.md is machine-verified', () => {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const examples = extractExamples(doc);

  it('the document contains the full set of marked examples', () => {
    const markers = examples.map((example) => example.marker).sort();
    expect(markers).toEqual(
      [
        'book-delta-simulated',
        'macro-embargoed',
        'news-equity',
        'option-chain-mark',
        'other-funding-rate',
        'rejected-available-before-event',
        'rejected-historical-without-adapter',
        'trade-historical',
      ].sort(),
    );
  });

  for (const example of examples) {
    const isRejection = example.marker.startsWith('rejected-');
    it(`${isRejection ? 'rejects' : 'accepts'} example "${example.marker}" exactly as documented`, () => {
      const result = validateMarketEvent(example.candidate);
      expect(result.ok).toBe(!isRejection);
      if (isRejection) {
        const expectedCode = EXPECTED_REJECTIONS[example.marker];
        expect(expectedCode, `missing documented rejection code for ${example.marker}`).toBeDefined();
        if (!result.ok) {
          expect(result.errors.some((error) => error.code === expectedCode)).toBe(true);
        }
      } else if (result.ok) {
        const event: MarketEvent = result.value;
        expect(typeof event.event_id).toBe('string');
      }
    });
  }

  it('the embargoed macro example really is embargoed (ingestion before availability)', () => {
    const embargoed = examples.find((example) => example.marker === 'macro-embargoed');
    expect(embargoed).toBeDefined();
    if (embargoed) {
      expect(embargoed.candidate.ingestion_time as number).toBeLessThan(embargoed.candidate.available_time as number);
    }
  });

  it('the simulated book delta is synthetic and carries lineage', () => {
    const simulated = examples.find((example) => example.marker === 'book-delta-simulated');
    expect(simulated).toBeDefined();
    if (simulated) {
      const provenance = simulated.candidate.provenance as Record<string, unknown>;
      expect(provenance.origin).toBe('simulated');
      expect(provenance.transform).toBe('reactive-participant-orderflow');
      expect((provenance.derived_from as unknown[]).length).toBe(2);
    }
  });
});
