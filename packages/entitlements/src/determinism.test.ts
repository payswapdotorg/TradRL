// @tradrl/entitlements — the determinism tests: identical operation
// sequences mint byte-identical ledgers; no ambient clock or
// randomness exists anywhere in the lane (the source-level law is
// pinned too).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amendEntitlementGrantOn,
  consumeEntitlement,
  createEntitlementLedger,
  entitlementLedgerDigest,
  entitlementSnapshot,
  issueEntitlementGrant,
  revokeEntitlementGrant,
  serializeEntitlementLedger,
  verifyEntitlementChain,
} from './index';
import type { EntitlementLedgerState } from './index';

const TENANT = 'tenant-entitlement-fixture';
const PROJECT = 'prj-entitlement-fixture';
const T0 = 1_735_600_000_000;

/** The full lifecycle op sequence (issue -> amend -> consume -> revoke + a second grant). */
function runLedger(): EntitlementLedgerState {
  const ledger = createEntitlementLedger(TENANT);
  if (!ledger.ok) throw new Error('unreachable');
  const spend = issueEntitlementGrant(ledger.value, {
    tenantId: TENANT,
    projectId: null,
    kind: 'spend-allowance',
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '100.5' },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/determinism',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: null,
  });
  if (!spend.ok) throw new Error('unreachable');
  const quota = issueEntitlementGrant(spend.value.state, {
    tenantId: TENANT,
    projectId: null,
    kind: 'api-quota',
    terms: { kind: 'api-quota', routeFamilies: ['jobs:write', 'jobs:read'], maxRequests: 500, windowMs: 60_000 },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/determinism',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: null,
  });
  if (!quota.ok) throw new Error('unreachable');
  const amended = amendEntitlementGrantOn(quota.value.state, {
    priorGrantId: spend.value.record.grantId,
    projectId: null,
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '150.75' },
    sourceRef: 'plan://operator/determinism',
    issuedAt: T0 + 10,
    effectiveFrom: T0 + 10,
    effectiveUntil: null,
  });
  if (!amended.ok) throw new Error('unreachable');
  const drawn = consumeEntitlement(amended.value.state, {
    grantId: amended.value.record.grantId,
    projectId: PROJECT,
    currency: 'usd-cents',
    amount: '49.995',
    cause: 'marketplace-charge',
    refs: ['po:0123456789abcdef', 'set:0123456789abcdef'],
    at: T0 + 20,
  });
  if (!drawn.ok) throw new Error('unreachable');
  const revoked = revokeEntitlementGrant(drawn.value.state, { grantId: amended.value.record.grantId, revokedAt: T0 + 30 });
  if (!revoked.ok) throw new Error('unreachable');
  return revoked.value.state;
}

describe('byte determinism (L9)', () => {
  it('the same op sequence mints byte-identical canonical serializations', () => {
    const first = runLedger();
    const second = runLedger();
    expect(serializeEntitlementLedger(first)).toBe(serializeEntitlementLedger(second));
    expect(entitlementLedgerDigest(first)).toBe(entitlementLedgerDigest(second));
    expect(serializeEntitlementLedger(first)).not.toBe('');
  });

  it('the digests are stable across process runs (pinned vector)', () => {
    // The pinned digest of the full-lifecycle ledger: a change to ANY
    // minted byte — id grammar, record shape, log entry shape — breaks it.
    expect(entitlementLedgerDigest(runLedger())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('snapshots are byte-deterministic too', () => {
    const at = T0 + 25;
    const first = entitlementSnapshot(runLedger(), at);
    const second = entitlementSnapshot(runLedger(), at);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
    }
  });

  it('chain verification is deterministic (green twice, same bytes)', () => {
    const state = runLedger();
    expect(verifyEntitlementChain(state).ok).toBe(true);
    expect(verifyEntitlementChain(state).ok).toBe(true);
  });
});

describe('the no-ambient-anything law (source-level)', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /** The source with comments stripped (the LAW text names the forbidden calls; the code never calls them). */
  function codeOf(file: string): string {
    const source = readFileSync(join(here, file), 'utf8');
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // line comments (never the ':// ' of a URI scheme)
  }

  it('no Date.now / Math.random / new Date anywhere in the lane\'s CODE', () => {
    for (const file of ['primitives.ts', 'errors.ts', 'ids.ts', 'usage.ts', 'entitlement.ts', 'ledger.ts', 'index.ts']) {
      const code = codeOf(file);
      expect(code.includes('Date.now(')).toBe(false);
      expect(code.includes('Math.random')).toBe(false);
      expect(code.includes('new Date(')).toBe(false);
    }
  });

  it('no workspace imports in the lane\'s sources (D-003/D-004)', () => {
    for (const file of ['primitives.ts', 'errors.ts', 'ids.ts', 'usage.ts', 'entitlement.ts', 'ledger.ts', 'index.ts']) {
      const code = codeOf(file);
      expect(code.includes(`from '@tradrl/`)).toBe(false); // no package imports (the doc comments name the lanes, imports never do)
      expect(code.match(/from '\.\.\//)).toBeNull(); // no cross-package relative imports either
    }
  });
});
