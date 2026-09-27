import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/domain-core skeleton', () => {
  it('declares its owning work order', () => {
    expect(packageInfo.owner).toBe('T002');
    expect(packageInfo.status).toBe('skeleton');
  });
});
