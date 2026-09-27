import { describe, expect, it } from 'vitest';
import { packageInfo } from './index';

describe('@tradrl/market-protocol skeleton', () => {
  it('declares its owning work order', () => {
    expect(packageInfo.owner).toBe('T004');
    expect(packageInfo.status).toBe('skeleton');
  });
});
