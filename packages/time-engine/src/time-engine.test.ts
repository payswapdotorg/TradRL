import { describe, expect, it } from 'vitest';

import { packageInfo } from './index';

describe('@tradrl/time-engine package', () => {
  it('declares its owning work order and implemented status', () => {
    expect(packageInfo.name).toBe('@tradrl/time-engine');
    expect(packageInfo.owner).toBe('T004');
    expect(packageInfo.status).toBe('implemented');
  });
});
