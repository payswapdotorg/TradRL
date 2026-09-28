/**
 * Contract-docs trip wire (acceptance criterion 8): every exported symbol
 * of this package is documented in contracts/environment/.
 *
 * The manifest is derived FROM THE SOURCE: the test parses src/index.ts's
 * export statements, so a new export that escapes the docs fails here in
 * the same change. It also asserts that every RUNTIME key of the public
 * namespace is covered by the parsed manifest (types are erased at runtime,
 * so they are checked textually only), and that the documented JSON example
 * round-trips the spec validator (the domain-core contract-docs discipline).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as api from './index';
import { validateEnvironmentSpec } from './index';

const PACKAGE_DIR = fileURLToPath(new URL('./', import.meta.url));
const DOCS_DIR = fileURLToPath(new URL('../../../contracts/environment/', import.meta.url));

/** Parse every exported name (type and value) out of src/index.ts. */
function exportedNames(): string[] {
  const source = readFileSync(`${PACKAGE_DIR}index.ts`, 'utf8');
  const names: string[] = [];
  const pattern = /export\s+(?:type\s+)?\{([^}]+)\}\s+from/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim();
      if (name.length > 0) names.push(name);
    }
  }
  // The packageInfo const is exported directly (not via a re-export).
  if (/export const packageInfo/.test(source)) names.push('packageInfo');
  return names;
}

function concatenatedDocs(): string {
  const files = readdirSync(DOCS_DIR).filter((file) => file.endsWith('.md'));
  expect(files.length).toBeGreaterThan(0);
  return files.map((file) => readFileSync(`${DOCS_DIR}${file}`, 'utf8')).join('\n');
}

function extractJsonBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe('contracts/environment documents cover the protocol surface', () => {
  it('every exported symbol appears in the docs (word-boundary match)', () => {
    const docs = concatenatedDocs();
    const missing = exportedNames().filter((name) => !new RegExp(`\\b${name}\\b`).test(docs));
    expect(missing, `symbols missing from contracts/environment/: ${missing.join(', ')}`).toEqual([]);
  });

  it('the export manifest is honest: every runtime key of the namespace is listed', () => {
    const manifest = new Set(exportedNames());
    const runtimeKeys = Object.keys(api);
    const unlisted = runtimeKeys.filter((key) => !manifest.has(key));
    expect(unlisted, `runtime exports missing from the manifest: ${unlisted.join(', ')}`).toEqual([]);
    expect(manifest.has('validateEnvironmentSpec')).toBe(true);
  });

  it('the documented spec example passes the spec validator', () => {
    const docs = concatenatedDocs();
    const blocks = extractJsonBlocks(docs);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const parsed: unknown = JSON.parse(blocks[0]);
    const result = validateEnvironmentSpec(parsed);
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });

  it('the manifest is non-trivial (guards, constructors and types are all present)', () => {
    const names = exportedNames();
    for (const expected of [
      'TimestampMs',
      'EnvironmentProfile',
      'EnvironmentSpec',
      'Observation',
      'Action',
      'RewardSignal',
      'EpisodeState',
      'EpisodeResult',
      'EpisodeStore',
      'Environment',
      'startEpisode',
      'observeEpisode',
      'submitAction',
      'advanceEpisode',
      'finishEpisode',
      'emitObservations',
      'emitRewardSignals',
      'createEpisodeStore',
      'isEnvironmentSpec',
      'deepFreeze',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
