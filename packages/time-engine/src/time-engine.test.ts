import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/time-engine skeleton', () => {
  it('declares its owning work order', () => {
    expect(packageInfo.owner).toBe('T004');
    expect(packageInfo.status).toBe('skeleton');
  });
});
