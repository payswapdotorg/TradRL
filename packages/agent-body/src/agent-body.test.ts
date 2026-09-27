import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/agent-body skeleton', () => {
  it('declares its owning work order', () => {
    expect(packageInfo.owner).toBe('T003');
    expect(packageInfo.status).toBe('skeleton');
  });
});
