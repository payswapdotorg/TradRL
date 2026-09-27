import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/domain-core package', () => {
  it('declares its owning work order and implementation status', () => {
    expect(packageInfo.owner).toBe('T002');
    expect(packageInfo.status).toBe('implemented');
  });
});
