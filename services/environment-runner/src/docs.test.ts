/**
 * Contract-docs trip wire for the runner service: every exported symbol of
 * services/environment-runner is documented in
 * contracts/environment/02-episode-runner.md (the README and doc 01 carry
 * the shared protocol surface).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as api from './index';

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
  if (/export const packageInfo/.test(source)) names.push('packageInfo');
  return names;
}

describe('contracts/environment/02-episode-runner.md covers the runner surface', () => {
  it('every exported symbol appears in the contract docs', () => {
    const docs =
      readFileSync(`${DOCS_DIR}02-episode-runner.md`, 'utf8') + '\n' + readFileSync(`${DOCS_DIR}README.md`, 'utf8');
    const missing = exportedNames().filter((name) => !new RegExp(`\\b${name}\\b`).test(docs));
    expect(missing, `symbols missing from the runner contract: ${missing.join(', ')}`).toEqual([]);
  });

  it('the manifest is honest: every runtime key of the namespace is listed', () => {
    const manifest = new Set(exportedNames());
    const unlisted = Object.keys(api).filter((key) => !manifest.has(key));
    expect(unlisted).toEqual([]);
  });

  it('the manifest is non-trivial (the acceptance-critical surface is present)', () => {
    const names = exportedNames();
    for (const expected of [
      'runEpisode',
      'Policy',
      'PolicyInput',
      'PolicyProposal',
      'RunOptions',
      'EpisodeTrace',
      'StepRecord',
      'Rejection',
      'createStubEnvironment',
      'seededDraw',
      'createSeededRandom',
      'serializeTrace',
      'isEpisodeTrace',
      'isRunOptions',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
