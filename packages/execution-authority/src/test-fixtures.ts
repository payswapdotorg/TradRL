// @tradrl/execution-authority — shared test fixtures (internal test
// support; NOT exported from the package index — the contract surface
// stays clean).
//
// The fixtures mirror the discipline of the sibling packages' test
// suites: hand-assembled records that are VALID by construction (the
// unwrap helper fails loudly if a fixture drifts from the contract),
// with override-based variants for the negative paths. Every value is
// SYNTHETIC (opaque TEST-* identifiers, synthetic decimals) — no
// account-specific data, no credentials, no licensed content.

import { deepFreeze } from './primitives';
import { mintAuthorityGrant, type AuthorityGrantRecord } from './grant';
import { mintApproveDecisionId } from './decision-mirror';
import { type ExecutionAuthorityResult } from './errors';

/** The fixture clock base (explicit literals — no ambient clock). */
export const T0 = 1_717_459_200_000;

/** The fixture scope. */
export const TENANT = 'tenant-gateway';
export const PROJECT = 'project-gateway';

/** The fixture principal (the acting strategy version). */
export const PRINCIPAL = { specId: 'spec-gateway-director', version: 1 } as const;

/** The fixture venues. */
export const VENUE_BROKER = 'BROKER-FIX';
export const VENUE_OMS = 'OMS-EMS';

/** The fixture grant scope refs (the T019 policy-declaration join keys). */
export const SCOPE_LIMIT = 'grant:gateway-execute-limit@1';
export const SCOPE_MARKET = 'grant:gateway-execute-market@1';

/** The fixture opaque credential refs. */
export const CRED_BROKER = 'cred:gw-broker-main@1';
export const CRED_OMS = 'cred:gw-oms-main@1';

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: ExecutionAuthorityResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** A valid fixture authority grant, overridable per test. */
export function fixtureGrant(overrides: {
  readonly scopeRef?: string;
  readonly tenant?: string;
  readonly project?: string;
  readonly orderKinds?: readonly string[];
  readonly venues?: readonly string[];
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly revocations?: readonly { revokedAt: number; reason: string; revokedBy: string }[];
  readonly rateBudgets?: readonly { venue: string; windowMs: number; maxOrders: number }[];
  readonly credentials?: readonly { venue: string; credentialRef: string }[];
} = {}): AuthorityGrantRecord {
  return unwrap(
    mintAuthorityGrant({
      version: 1,
      supersedes: null,
      tenant: (overrides.tenant ?? TENANT) as never,
      project: (overrides.project ?? PROJECT) as never,
      principal: { specId: PRINCIPAL.specId as never, version: PRINCIPAL.version },
      scopeRef: (overrides.scopeRef ?? SCOPE_LIMIT) as never,
      orderKinds: overrides.orderKinds ?? ['limit', 'market'],
      venues: (overrides.venues ?? [VENUE_BROKER, VENUE_OMS]) as never,
      rateBudgets: (overrides.rateBudgets ?? [
        { venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 10 },
        { venue: VENUE_OMS, windowMs: 60_000, maxOrders: 10 },
      ]) as never,
      credentials: (overrides.credentials ?? [
        { venue: VENUE_BROKER, credentialRef: CRED_BROKER },
        { venue: VENUE_OMS, credentialRef: CRED_OMS },
      ]) as never,
      validity: {
        issuedAt: (overrides.issuedAt ?? T0 - 60_000) as never,
        expiresAt: (overrides.expiresAt ?? T0 + 3_600_000) as never,
      },
      revocations: (overrides.revocations ?? []) as never,
      asOf: (T0 - 60_000) as never,
    }),
  );
}

/** A valid fixture APPROVE decision (the T019 output-record mirror), overridable per test. */
export function fixtureApproveDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = {
    kind: 'approve',
    intentRef: 'si:t040fx0001',
    policy: { policyId: 'xpol:t040fx01', version: 1 },
    checkOrder: [
      'kill_switch',
      'identity',
      'authorization',
      'limits',
      'venue_permissions',
      'rate_limits',
      'credentials',
    ],
    checks: [
      { dimension: 'kill_switch', ordinal: 1, outcome: 'pass' },
      { dimension: 'identity', ordinal: 2, outcome: 'pass' },
      { dimension: 'authorization', ordinal: 3, outcome: 'pass' },
      { dimension: 'limits', ordinal: 4, outcome: 'pass' },
      { dimension: 'venue_permissions', ordinal: 5, outcome: 'pass' },
      { dimension: 'rate_limits', ordinal: 6, outcome: 'pass' },
      { dimension: 'credentials', ordinal: 7, outcome: 'pass' },
    ],
    lineage: {
      intentRef: 'si:t040fx0001',
      strategy: { specId: 'spec-gateway-director', version: 1 },
      goal: { goalId: 'goal-gateway-1', version: 1 },
      policy: { policyId: 'xpol:t040fx01', version: 1 },
      venues: ['BROKER-FIX'],
      seed: 't040-fixture-seed',
      tenant: TENANT,
      project: PROJECT,
    },
    asOf: T0,
  };
  // The id is DERIVED from the content (the T019 content-addressing law) —
  // an override that changes content without changing the id yields a
  // (deliberately) forged fixture.
  const derived = { ...content, decisionId: mintApproveDecisionId(content as never) };
  return deepFreeze({ ...derived, ...overrides });
}

/** A valid fixture routed order form (the T019/T039 OrderIntent mirror), overridable per test. */
export function fixtureOrderForm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    clientOrderId: 't040-fx-1',
    instrumentId: 'BTC-USDT',
    venueId: 'BROKER-FIX',
    side: 'buy',
    kind: 'limit',
    quantity: '0.5',
    price: '50000.00',
    timeInForce: 'gtc',
    createdAt: '2024-06-04T00:00:00.000Z',
  };
  return deepFreeze({ ...base, ...overrides });
}
