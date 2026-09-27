// Canonical-example validation: every example must pass its guard, survive a
// JSON round-trip, and stay internally consistent. The JSON examples embedded
// in contracts/agent/*.md are renderings of these exact records.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  adoptCertifiedBodyVersion,
  buildLineageIndex,
  isAgentBody,
  isAgentInstance,
  isBodyVersion,
  isCertifiedBodyVersion,
  isCognitiveSubstrate,
  isPossession,
  isSubstrateCompatibilityManifest,
  validateAgentInstance,
  validatePossession,
} from './index';
import {
  exampleAgentInstance,
  exampleBody,
  exampleBodyVersion,
  exampleCertificationEvidence,
  exampleCertifiedBodyVersion,
  exampleCompatibilityManifest,
  exampleIncompatibleSubstrate,
  exampleLineage,
  examplePossession,
  exampleSubstituteSubstrate,
  exampleSubstrate,
} from './examples';

describe('canonical examples pass their guards', () => {
  it('substrates', () => {
    expect(isCognitiveSubstrate(exampleSubstrate)).toBe(true);
    expect(isCognitiveSubstrate(exampleSubstituteSubstrate)).toBe(true);
    expect(isCognitiveSubstrate(exampleIncompatibleSubstrate)).toBe(true);
  });

  it('body identity, manifest, versions', () => {
    expect(isAgentBody(exampleBody)).toBe(true);
    expect(isSubstrateCompatibilityManifest(exampleCompatibilityManifest)).toBe(true);
    expect(isBodyVersion(exampleBodyVersion)).toBe(true);
    expect(isCertifiedBodyVersion(exampleCertifiedBodyVersion)).toBe(true);
  });

  it('possession and instance', () => {
    expect(isPossession(examplePossession)).toBe(true);
    expect(isAgentInstance(exampleAgentInstance)).toBe(true);
  });
});

describe('canonical examples survive JSON round-trips', () => {
  it('every example can be serialized and re-validated', () => {
    const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
    expect(isCognitiveSubstrate(roundTrip(exampleSubstrate))).toBe(true);
    expect(isAgentBody(roundTrip(exampleBody))).toBe(true);
    expect(isSubstrateCompatibilityManifest(roundTrip(exampleCompatibilityManifest))).toBe(true);
    expect(isBodyVersion(roundTrip(exampleBodyVersion))).toBe(true);
    expect(isBodyVersion(roundTrip(exampleCertifiedBodyVersion))).toBe(true);
    expect(isPossession(roundTrip(examplePossession))).toBe(true);
    expect(isAgentInstance(roundTrip(exampleAgentInstance))).toBe(true);
  });

  it('the certified version round-trips through adoptCertifiedBodyVersion unchanged', () => {
    const parsed = JSON.parse(JSON.stringify(exampleCertifiedBodyVersion)) as unknown;
    const adopted = adoptCertifiedBodyVersion(parsed);
    expect(adopted).toEqual(exampleCertifiedBodyVersion);
  });
});

describe('canonical examples form a coherent end-to-end story', () => {
  it('the example possession is valid for the certified version and substrate', () => {
    const result = validatePossession(examplePossession, exampleCertifiedBodyVersion, exampleSubstrate);
    expect(result.valid).toBe(true);
  });

  it('the example instance is valid for its possession and body version', () => {
    const result = validateAgentInstance(exampleAgentInstance, examplePossession, exampleCertifiedBodyVersion);
    expect(result.valid).toBe(true);
  });

  it('the example lineage is a valid acyclic lineage', () => {
    const result = buildLineageIndex(exampleLineage);
    expect(result.ok).toBe(true);
  });

  it('the incompatible substrate really is incompatible', () => {
    const result = validatePossession(
      { ...examplePossession, substrateId: exampleIncompatibleSubstrate.id },
      exampleCertifiedBodyVersion,
      exampleIncompatibleSubstrate,
    );
    expect(result.valid).toBe(false);
  });

  it('certification evidence is embedded in the certified version', () => {
    expect(exampleCertifiedBodyVersion.certificationEvidence).toEqual(exampleCertificationEvidence);
    expect(exampleCertifiedBodyVersion.certified).toBe(true);
  });
});

describe('core law mapping (spec/ARCHITECTURE-LOCK.md L2)', () => {
  it('the five components of Agent Instance = Body Version + Substrate + Possession + Environment + Runtime State are resolvable', () => {
    // Body Version + Cognitive Substrate + Possession configuration:
    expect(examplePossession.bodyVersionId).toBe(exampleCertifiedBodyVersion.id);
    expect(examplePossession.substrateId).toBe(exampleSubstrate.id);
    // Environment (through the possession):
    expect(examplePossession.environmentProfile.fidelityMode).toBe('exact-replay');
    // Runtime State (opaque handle — the state itself lives in T006's lane):
    expect(typeof exampleAgentInstance.runtimeStateRef).toBe('string');
    // And the instance ties it together:
    expect(exampleAgentInstance.possessionId).toBe(examplePossession.id);
  });
});

describe('contract documentation integrity (contracts/agent/)', () => {
  const docsDir = fileURLToPath(new URL('../../../contracts/agent/', import.meta.url));

  it('every ```json block in every contract doc parses as JSON', () => {
    const docs = readdirSync(docsDir).filter((name) => name.endsWith('.md'));
    expect(docs.length).toBeGreaterThanOrEqual(6);
    let blocksChecked = 0;
    for (const doc of docs) {
      const markdown = readFileSync(path.join(docsDir, doc), 'utf8');
      const matches = markdown.matchAll(/```json\n([\s\S]*?)```/g);
      for (const match of matches) {
        expect(() => JSON.parse(match[1] as string), `${doc}: invalid JSON block`).not.toThrow();
        blocksChecked += 1;
      }
    }
    expect(blocksChecked).toBeGreaterThanOrEqual(6); // at least one per concept doc
  });
});
