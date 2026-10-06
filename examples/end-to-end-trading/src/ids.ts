// @tradrl/example-e2e-trading — the identity spaces of the reference slice.
//
// STRUCTURAL MIRROR of the program's cross-lane prefix laws (D-003/D-004:
// this package imports nothing outside its tree; every prefix below is
// re-declared from its owning lane and the interop trip-wire tests assert
// the minting formulas are byte-identical to the real ones).
//
// Prefix catalog (owning lane in brackets):
//   dd-      director decision id         [T024 trading-director]  16-hex stableDigest
//   esc-     escalation record id         [T024/T025]              16-hex stableDigest
//   rr-      sentiment/regime report id   [T021/T022]              16-hex stableDigest
//   frr-     fundamental report id        [T023]                   16-hex stableDigest
//   cmrr-    cross-market report id       [T026]                   16-hex stableDigest
//   xd:      gate APPROVE decision id     [T019/T040]               8-hex fnv1a32Hex
//   si:      strategy intent id           [T018]                    8-hex fnv1a32Hex
//   strat:   strategy run id              [T018]                    8-hex fnv1a32Hex
//   ps:      portfolio state id           [T018]                    8-hex fnv1a32Hex
//   ol-      order lifecycle record id    [T025]                   16-hex stableDigest
//   rcn-     reconciliation record id     [T025]                   16-hex stableDigest
//   gwr-     gateway request ref          [T025]                   16-hex stableDigest
//   gor:     gateway order request id     [T040]                    8-hex fnv1a32Hex
//   xgs:     gateway submission id        [T040]                    8-hex fnv1a32Hex
//   xga:     gateway audit record id      [T040]                    8-hex fnv1a32Hex
//   xag:     authority grant id           [T040]                    8-hex fnv1a32Hex
//   rls:     risk limit evaluation id     [T020]                    8-hex fnv1a32Hex
//   xpol:    execution policy id          [T019]
//   rpol:    risk policy id               [T020]
//   ksw:     kill-switch id               [T019/T020]
//   grant:   authority scope ref          [T040]
//   cred:    credential ref               [T040] (a REF, never a value)
//   adapter: adapter descriptor ref       [T039/T040]
//   chan:    channel ref                  [T039/T040]
//   sws:     shadow session id            [T030]                    8-hex fnv1a32Hex
//   swf-     shadow fill id               [T030]     zero-padded 8-digit ordinal
//   swo:     shadow outcome record id     [T030]                    8-hex fnv1a32Hex
//   swr:     shadow refusal id            [T030]                    8-hex fnv1a32Hex
//   msg:     kernel message envelope id   [T006]   msg:opId:sender:sequence
//   xo-      exchange order id            [T010]     zero-padded 8-digit ordinal
//   xf-      exchange fill id             [T010]     zero-padded 8-digit ordinal
//   xsf-     simulated fill ref           [T019]     zero-padded 8-digit ordinal
//   confirm: cancel confirmation ref      [T025]
//   cur-     time-machine cursor id       [T029]     zero-padded 8-digit ordinal
//   e2e-     THIS SLICE's run id          [T048]                   16-hex stableDigest

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isDigest,
  isNonEmptyString,
  stableDigest,
  type JsonValue,
  type TimestampMs,
} from './primitives';

// ---------------------------------------------------------------------------
// Scope identities (L12 — tenant/project on EVERY record)
// ---------------------------------------------------------------------------

/** Owning tenant (the isolation root). */
export type TenantId = string;
/** Project continuity root (L15). */
export type ProjectId = string;

/** Guard: a tenant id. */
export const isTenantId = isNonEmptyString;
/** Guard: a project id. */
export const isProjectId = isNonEmptyString;

/** Throwing constructor: tenant. */
export function tenantId(value: string): TenantId {
  if (!isNonEmptyString(value)) throw new TypeError('tenantId: non-empty string required');
  return value;
}

/** Throwing constructor: project. */
export function projectId(value: string): ProjectId {
  if (!isNonEmptyString(value)) throw new TypeError('projectId: non-empty string required');
  return value;
}

// ---------------------------------------------------------------------------
// Versioned pointers (the control-plane mirror)
// ---------------------------------------------------------------------------

/** Versioned pointer to a goal statement. */
export interface GoalVersionRef {
  readonly goalId: string;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/** Versioned pointer to a constraint set. */
export interface ConstraintSetVersionRef {
  readonly id: string;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

/** Versioned pointer to a strategy spec. */
export interface StrategyVersionRef {
  readonly specId: string;
  readonly version: number;
}

/** Versioned pointer to a policy (execution or risk). */
export interface PolicyVersionRef {
  readonly policyId: string;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Prefix guards (the cross-lane reference laws, mirrored)
// ---------------------------------------------------------------------------

/** Guard: a director decision id (`dd-`-prefixed). */
export function isDirectorDecisionId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('dd-');
}

/** Guard: an escalation record id (`esc-`-prefixed). */
export function isEscalationRecordId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('esc-');
}

/** Guard: a sentiment/regime research report id (`rr-`-prefixed). */
export function isResearchReportId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('rr-');
}

/** Guard: a fundamental research report id (`frr-`-prefixed). */
export function isFundamentalReportId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('frr-');
}

/** Guard: a cross-market research report id (`cmrr-`-prefixed). */
export function isCrossMarketReportId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('cmrr-');
}

/** Guard: a gate decision id (`xd:`-prefixed — THE AUTHORITY). */
export function isDecisionId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('xd:');
}

/** Guard: a strategy intent ref (`si:`-prefixed). */
export function isIntentRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('si:');
}

/** Guard: an order lifecycle record id (`ol-`-prefixed). */
export function isOrderLifecycleId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('ol-');
}

/** Guard: a reconciliation record id (`rcn-`-prefixed). */
export function isReconciliationId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('rcn-');
}

/** Guard: a gateway request ref (`gwr-`-prefixed). */
export function isGatewayRequestRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('gwr-');
}

/** Guard: a gateway order request id (`gor:`-prefixed). */
export function isGatewayOrderRequestId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('gor:');
}

/** Guard: a gateway submission id (`xgs:`-prefixed). */
export function isGatewaySubmissionId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('xgs:');
}

/** Guard: a gateway audit record id (`xga:`-prefixed). */
export function isGatewayAuditRecordId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('xga:');
}

/** Guard: a risk limit evaluation id (`rls:`-prefixed). */
export function isLimitEvaluationId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('rls:');
}

/** Guard: an authority grant id (`xag:`-prefixed). */
export function isAuthorityGrantId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('xag:');
}

/** Guard: an authority scope ref (`grant:`-prefixed). */
export function isAuthorityScopeRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('grant:');
}

/** Guard: a kill-switch id (`ksw:`-prefixed). */
export function isKillSwitchId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('ksw:');
}

/** Guard: a credential ref (`cred:`-prefixed — a REF, never a value). */
export function isCredentialRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('cred:');
}

/** Guard: an adapter descriptor ref (`adapter:<id>@<version>`). */
export function isAdapterDescriptorRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('adapter:');
}

/** Guard: a channel ref (`chan:`-prefixed). */
export function isChannelRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('chan:');
}

/** Guard: a shadow session id (`sws:`-prefixed). */
export function isShadowSessionId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('sws:');
}

/** Guard: a shadow fill id (`swf-` zero-padded 8-digit ordinal). */
export function isShadowFillId(v: unknown): v is string {
  return typeof v === 'string' && /^swf-\d{8}$/.test(v);
}

/** Guard: a shadow outcome record id (`swo:`-prefixed). */
export function isShadowOutcomeRecordId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('swo:');
}

/** Guard: a shadow refusal id (`swr:`-prefixed). */
export function isShadowRefusalId(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('swr:');
}

/** Guard: an exchange order id (`xo-` zero-padded 8-digit ordinal). */
export function isExchangeOrderId(v: unknown): v is string {
  return typeof v === 'string' && /^xo-\d{8}$/.test(v) ? true : typeof v === 'string' && /^xo-seed-(bid|ask)-\d+$/.test(v);
}

/** Guard: an exchange fill id (`xf-` zero-padded 8-digit ordinal). */
export function isExchangeFillId(v: unknown): v is string {
  return typeof v === 'string' && /^xf-\d{8}$/.test(v);
}

/** Guard: a simulated-fill ref (`xsf-` zero-padded 8-digit ordinal). */
export function isFillRef(v: unknown): v is string {
  return typeof v === 'string' && /^xsf-\d{8}$/.test(v);
}

/** Guard: a cancel confirmation ref (`confirm:`-prefixed). */
export function isCancelConfirmationRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('confirm:');
}

/** Guard: a time-machine cursor id (`cur-` zero-padded 8-digit ordinal). */
export function isCursorId(v: unknown): v is string {
  return typeof v === 'string' && /^cur-\d{8}$/.test(v);
}

// ---------------------------------------------------------------------------
// Minters (the EXACT owning-lane formulas, mirrored byte-identically)
// ---------------------------------------------------------------------------

/** Mints a director decision id: `dd-` + 16-hex stableDigest of the content. */
export function mintDirectorDecisionId(content: Omit<Record<string, unknown>, 'decisionId'> & { readonly [k: string]: JsonValue | undefined }): string {
  const { decisionId: _dropped, ...rest } = content as Record<string, unknown>;
  return `dd-${stableDigest(canonicalJson(rest as JsonValue))}`;
}

/** Mints an escalation record id: `esc-` + 16-hex stableDigest of the content. */
export function mintEscalationRecordId(content: JsonValue): string {
  return `esc-${stableDigest(canonicalJson(content))}`;
}

/** Mints a research report id (`rr-`/`frr-`/`cmrr-` + 16-hex stableDigest). */
export function mintResearchReportId(prefix: 'rr-' | 'frr-' | 'cmrr-', content: JsonValue): string {
  return `${prefix}${stableDigest(canonicalJson(content))}`;
}

/**
 * Mints a gate APPROVE decision id: `xd:` + 8-hex fnv1a32Hex of the exact
 * approve content tree — MIRRORED byte-identically from
 * @tradrl/execution-authority's `mintApproveDecisionId` (the interop test
 * proves parity on the same content).
 */
export function mintApproveDecisionId(content: {
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly string[];
  readonly checks: readonly { readonly dimension: string; readonly ordinal: number; readonly outcome: 'pass' | 'fail' }[];
  readonly lineage: {
    readonly intentRef: string;
    readonly strategy: { readonly specId: string; readonly version: number };
    readonly goal: { readonly goalId: string; readonly version: number };
    readonly policy: { readonly policyId: string; readonly version: number };
    readonly venues: readonly string[];
    readonly seed: string;
    readonly tenant: string;
    readonly project: string;
  };
  readonly asOf: number;
}): string {
  const tree = {
    kind: 'approve' as const,
    intentRef: content.intentRef,
    policy: { policyId: content.policy.policyId, version: content.policy.version },
    checkOrder: [...content.checkOrder],
    checks: content.checks.map((check) => ({
      dimension: check.dimension,
      ordinal: check.ordinal,
      outcome: check.outcome,
    })),
    failure: null,
    lineage: {
      intentRef: content.lineage.intentRef,
      strategy: { specId: content.lineage.strategy.specId, version: content.lineage.strategy.version },
      goal: { goalId: content.lineage.goal.goalId, version: content.lineage.goal.version },
      policy: { policyId: content.lineage.policy.policyId, version: content.lineage.policy.version },
      venues: [...content.lineage.venues],
      seed: content.lineage.seed,
      tenant: content.lineage.tenant,
      project: content.lineage.project,
    },
    asOf: content.asOf,
  };
  return `xd:${fnv1a32Hex(canonicalJson(tree as never))}`;
}

/** Mints a refusal decision id: `xd:` + 8-hex fnv over the refusal tree. */
export function mintRefusalDecisionId(content: JsonValue): string {
  return `xd:${fnv1a32Hex(canonicalJson(content))}`;
}

/** Mints a strategy intent id: `si:` + 8-hex fnv of the intent content. */
export function mintIntentId(content: JsonValue): string {
  return `si:${fnv1a32Hex(canonicalJson(content))}`;
}

/** Mints a strategy run id: `strat:` + 8-hex fnv digest. */
export function mintStrategyRunId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintStrategyRunId: invalid digest ${JSON.stringify(digest)}`);
  return `strat:${digest}`;
}

/** Mints a portfolio-state id: `ps:` + 8-hex fnv digest. */
export function mintPortfolioStateId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintPortfolioStateId: invalid digest ${JSON.stringify(digest)}`);
  return `ps:${digest}`;
}

/** Mints an order lifecycle id: `ol-` + 16-hex stableDigest of {chainHead, content}. */
export function mintOrderLifecycleId(chainHead: string, content: JsonValue): string {
  return `ol-${stableDigest(canonicalJson({ chainHead, content } as unknown as JsonValue))}`;
}

/** Mints a reconciliation id: `rcn-` + 16-hex stableDigest. */
export function mintReconciliationId(content: JsonValue): string {
  return `rcn-${stableDigest(canonicalJson(content))}`;
}

/** Mints a gateway request ref: `gwr-` + 16-hex stableDigest. */
export function mintGatewayRequestRef(content: JsonValue): string {
  return `gwr-${stableDigest(canonicalJson(content))}`;
}

/** Mints a gateway order request id: `gor:` + 8-hex fnv. */
export function mintGatewayOrderRequestId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintGatewayOrderRequestId: invalid digest ${JSON.stringify(digest)}`);
  return `gor:${digest}`;
}

/** Mints a gateway submission id: `xgs:` + 8-hex fnv. */
export function mintGatewaySubmissionId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintGatewaySubmissionId: invalid digest ${JSON.stringify(digest)}`);
  return `xgs:${digest}`;
}

/** Mints a gateway audit record id: `xga:` + 8-hex fnv. */
export function mintGatewayAuditRecordId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintGatewayAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `xga:${digest}`;
}

/** Mints an authority grant id: `xag:` + 8-hex fnv. */
export function mintAuthorityGrantId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintAuthorityGrantId: invalid digest ${JSON.stringify(digest)}`);
  return `xag:${digest}`;
}

/** Mints a risk limit evaluation id: `rls:` + 8-hex fnv. */
export function mintLimitEvaluationId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintLimitEvaluationId: invalid digest ${JSON.stringify(digest)}`);
  return `rls:${digest}`;
}

/** Mints a shadow session id: `sws:` + 8-hex fnv. */
export function mintShadowSessionId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintShadowSessionId: invalid digest ${JSON.stringify(digest)}`);
  return `sws:${digest}`;
}

/** Mints a shadow outcome record id: `swo:` + 8-hex fnv. */
export function mintShadowOutcomeRecordId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintShadowOutcomeRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `swo:${digest}`;
}

/** Mints a shadow refusal id: `swr:` + 8-hex fnv. */
export function mintShadowRefusalId(digest: string): string {
  if (!/^[0-9a-f]{8}$/.test(digest)) throw new TypeError(`mintShadowRefusalId: invalid digest ${JSON.stringify(digest)}`);
  return `swr:${digest}`;
}

/** Mints an ordinal id with zero-padded 8 digits (`swf-`, `xsf-`, `xo-`, `xf-`). */
export function mintOrdinalId(prefix: string, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 99_999_999) {
    throw new TypeError(`mintOrdinalId: ordinal out of range (${String(ordinal)})`);
  }
  return `${prefix}${String(ordinal).padStart(8, '0')}`;
}

/** Mints the slice's run id: `e2e-` + 16-hex stableDigest. */
export function mintRunId(content: JsonValue): string {
  return `e2e-${stableDigest(canonicalJson(content))}`;
}

/** Mints an adapter descriptor ref: `adapter:<id>@<version>`. */
export function mintAdapterDescriptorRef(adapter: { readonly id: string; readonly version: string }): string {
  return `adapter:${adapter.id}@${adapter.version}`;
}

/** Mints a channel ref: `chan:<name>`. */
export function mintChannelRef(name: string): string {
  return `chan:${name}`;
}

/** Mints the kernel message envelope id: `msg:<opId>:<sender>:<sequence>`. */
export function mintMessageId(opId: string, sender: string, sequence: number): string {
  return `msg:${opId}:${sender}:${String(sequence)}`;
}

/** Canonical ISO rendering of an explicit epoch-ms instant (pure). */
export function isoTimestampOf(value: TimestampMs): string {
  return new Date(value).toISOString();
}

/** Freezes an id-bearing record (the L3 discipline). */
export function frozenRecord<T extends object>(record: T): T {
  return deepFreeze(record);
}

/** Re-export for mirror modules: assert a 16-hex digest where required. */
export function requireDigest16(value: string, what: string): string {
  if (!isDigest(value)) throw new TypeError(`${what}: expected 16-hex digest, got ${JSON.stringify(value)}`);
  return value;
}
