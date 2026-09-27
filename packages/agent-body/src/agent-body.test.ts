import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/agent-body package', () => {
  it('declares its owning work order and implemented status', () => {
    expect(packageInfo.owner).toBe('T003');
    expect(packageInfo.status).toBe('implemented');
  });

  it('covers the core-law concepts (L2/L3)', () => {
    expect(packageInfo.concepts).toContain('CognitiveSubstrate');
    expect(packageInfo.concepts).toContain('BodyVersion');
    expect(packageInfo.concepts).toContain('CertifiedBodyVersion');
    expect(packageInfo.concepts).toContain('Possession');
    expect(packageInfo.concepts).toContain('AgentInstance');
  });
});
