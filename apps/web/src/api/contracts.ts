// @tradrl/web-console — the SDK mirror: the request/response contracts.
//
// THE LAW (Work Order T042): "each section fed by the T041 API read
// routes through structural mirrors of the SDK client (the console
// NEVER imports workspace packages; it mirrors @tradrl/sdk's client/
// error/pagination shapes and drives them through an injected
// transport adapter)". This module is the STRUCTURAL MIRROR of
// packages/sdk/src/contracts.ts — same names, same shapes, never
// imported (D-003/D-004 law); src/api/interop.test.ts is the drift
// trip wire (type-level witnesses against the REAL SDK types +
// end-to-end drives against the REAL API service through this
// console's mirrored client).
//
// Spec anchors: R36 (project-centric UX), R43 (the composed API/SDK
// surface), L12 (tenant context rides every record), L20 (the
// console renders; enforcement lives behind the API).

// ---------------------------------------------------------------------------
// Version + envelope
// ---------------------------------------------------------------------------

/** The served API versions (the mirror of the SDK's API_VERSIONS). */
export const API_VERSIONS = ['v1'] as const;

/** One served API version. */
export type ApiVersion = (typeof API_VERSIONS)[number];

/** The current (newest) served version. */
export const CURRENT_API_VERSION: ApiVersion = 'v1';

/** The success envelope of every 2xx response. */
export interface ApiSuccessBody<T> {
  readonly requestId: string;
  readonly data: T;
}

/** The error envelope of every non-2xx response. */
export interface ApiErrorBody {
  readonly requestId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    readonly problems?: readonly { readonly path: string; readonly message: string }[];
    readonly retryAfterMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** One page of a listing. */
export interface Page<T> {
  readonly items: readonly T[];
  /** The next page's cursor; absent on the last page. */
  readonly nextCursor?: string;
}

/** The pagination parameters of a listing call. */
export interface PaginationParams {
  readonly cursor?: string;
  /** Page size, 1..100 (default 50). */
  readonly limit?: number;
}

/** The page-size law (the mirror of the boundary's MAX_PAGE_SIZE). */
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// The T007 record mirrors (as the boundary serves them — identical field-for-field)
// ---------------------------------------------------------------------------

/** The project's execution mode. */
export type ExecutionMode = 'simulation' | 'shadow' | 'live';

/** Executable predicate over a criterion metric. */
export type CriterionPredicate =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: number | string | boolean }
  | { readonly kind: 'notEquals'; readonly value: number | string | boolean }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

/** One structured success criterion. */
export interface SuccessCriterion {
  readonly id: string;
  readonly metric: string;
  readonly predicate: CriterionPredicate;
  readonly description?: string;
}

/** The goal statement (the T007 shape behind the boundary). */
export interface GoalStatement {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly objective: string;
  readonly horizon: { readonly startsAt: number; readonly endsAt: number; readonly label?: string };
  readonly successCriteria: { readonly criteria: readonly SuccessCriterion[]; readonly requiredSatisfaction: number };
  readonly evaluation: { readonly blindRef: string; readonly walkForwardRef: string; readonly regimeRef: string; readonly adversarialRequired: boolean };
  readonly createdAt: number;
  readonly description?: string;
}

/** One executable constraint. */
export interface ConstraintStatement {
  readonly id: string;
  readonly domain: 'observation' | 'state' | 'action' | 'outcome';
  readonly subject: string;
  readonly predicate: CriterionPredicate;
  readonly severity: 'advisory' | 'blocking';
  readonly description?: string;
}

/** The constraint-set statement (the T007 shape behind the boundary). */
export interface ConstraintSetStatement {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatement[];
  readonly createdAt: number;
}

/** The project record (the T007 shape — the boundary's served form). */
export interface ProjectRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly executionMode: ExecutionMode;
  readonly lifecycle: {
    readonly projectId: string;
    readonly status: 'draft' | 'active' | 'paused' | 'archived' | 'completed' | 'abandoned';
    readonly acceptanceCriteriaId: string | null;
    readonly organizationRef: string | null;
  };
  readonly lineage: {
    readonly projectId: string;
    readonly goal: { readonly goalId: string; readonly version: number };
    readonly constraintSet: { readonly id: string; readonly version: number };
  };
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The lifecycle events. */
export type ProjectLifecycleEvent = 'activate' | 'pause' | 'resume' | 'complete' | 'abandon' | 'archive';

// ---------------------------------------------------------------------------
// The knowledge mirror (the firm-memory shape the /v1 route serves)
// ---------------------------------------------------------------------------

/** One knowledge entry as served at an instant. */
export interface ServedKnowledge {
  readonly record: {
    readonly knowledgeId: string;
    readonly ordinal: number;
    readonly tenant: string;
    readonly project: string;
    readonly claim: { readonly kind: string; readonly polarity: string; readonly dimension: string | null; readonly lagBand: string | null };
    readonly confidence: string;
    readonly evidenceCount: number;
    readonly provenance: {
      readonly postMortemRefs: readonly string[];
      readonly outcomeRefs: readonly string[];
      readonly experimentRefs: readonly string[];
      readonly trialRefs: readonly string[];
      readonly trajectoryRefs: readonly string[];
      readonly sessionRefs: readonly string[];
    };
    readonly validity: { readonly from: number; readonly to: number };
    readonly asOf: number;
    readonly priorChainHead: string;
  };
  readonly status: 'active' | 'superseded' | 'decayed';
  readonly supersededBy: string | null;
}

/** The knowledge-query request body. */
export interface KnowledgeQueryRequest {
  readonly project: string;
  /** The query instant (epoch ms — L4: ask only what was knowable at T). */
  readonly at: number;
  readonly activeOnly?: boolean;
  readonly kinds?: readonly string[];
  readonly polarity?: string;
  readonly dimension?: string;
  readonly lagBand?: string;
  readonly minEvidenceCount?: number;
  readonly minConfidence?: string;
  readonly knowledgeId?: string;
}

/** The knowledge-query response page. */
export interface KnowledgeQueryResponse extends Page<ServedKnowledge> {
  readonly at: number;
}

// ---------------------------------------------------------------------------
// The outcome/evidence mirrors (as the /v1 routes serve them — opaque-carried)
// ---------------------------------------------------------------------------

/** The outcome-record query request body. */
export interface OutcomeQueryRequest {
  readonly project: string;
  readonly at: number;
  readonly decisionRef?: string;
  readonly intentRef?: string;
  readonly outcomeClass?: string;
  readonly sessionRef?: string;
  readonly outcomeRecordRef?: string;
}

/** The post-mortem query request body. */
export interface PostMortemQueryRequest {
  readonly project: string;
  readonly at: number;
  readonly latestPerOutcome?: boolean;
  readonly decisionRef?: string;
  readonly outcomeRecordRef?: string;
  readonly attributionClass?: string;
}

/** One learned outcome — the outcome record as the boundary serves it (field for field). */
export interface OutcomeRecord {
  readonly outcomeId: string;
  readonly ordinal: number;
  readonly tenant: string;
  readonly project: string;
  readonly decision: { readonly decisionRef: string; readonly intentRef: string; readonly disposition: 'filled' | 'refused' | 'partial' | 'expired' };
  readonly outcomeClass: string;
  readonly expectation: { readonly expectedQuantity: string | null; readonly expectedRealized: string | null; readonly tolerance: string; readonly declaredBy: string | null };
  readonly realization: { readonly filledQuantity: string | null; readonly realizedOutcome: string; readonly feeTotal: string; readonly notionalTotal: string; readonly unrealizedAtDecision: string };
  readonly deviation: { readonly quantityShortfall: string | null; readonly realizedGap: string | null; readonly withinTolerance: boolean | null };
  readonly evidence: readonly { readonly kind: string; readonly ref: string }[];
  /** THE W-8 DECISION-SUBSTANCE FIELDS (served additively since the W-8 wave — R3's deciding body, audit rationale and risk checks on the outcome's own decision record). Optional: the frozen SDK surface does not declare them (the boundary passes the served record through opaquely), so the parity witness keeps compiling. */
  readonly decisionBody?: string;
  /** The decision's audit rationale (published audit prose — an audit field, never hidden chain-of-thought). */
  readonly decisionRationale?: string;
  /** The decision's risk checks (dimension + outcome, verbatim — L20). */
  readonly riskChecks?: readonly SubmissionRiskCheck[];
  readonly lineage: {
    readonly shadow: {
      readonly sessionId: string;
      readonly fidelity: { readonly mode: 'shadow'; readonly fill_origin: 'simulated' };
      readonly executionPolicy: { readonly policyId: string; readonly version: number };
      readonly riskPolicy: { readonly policyId: string; readonly version: number };
      readonly configDigests: { readonly worldConfigHash: string; readonly engineConfigHash: string; readonly dataset: string };
      readonly run: { readonly runId: string; readonly episodeId: string };
      readonly cursor: { readonly cursorId: string; readonly position: number };
      readonly seed: string;
      readonly tenant: string;
      readonly project: string;
    };
    readonly shadowOutcomeRef: string;
    readonly shadowOutcomeOrdinal: number;
    readonly shadowAsOf: number;
    readonly decisionStreamPosition: number | null;
    readonly trajectoryRef: string | null;
    readonly experiment: { readonly experimentRef: string; readonly trialRef: string } | null;
  };
  readonly asOf: number;
  readonly priorChainHead: string;
}

/** One structured post-mortem as the boundary serves it (field for field). */
export interface PostMortemRecord {
  readonly postMortemId: string;
  readonly ordinal: number;
  readonly subject: { readonly outcomeRecordRef: string; readonly decisionRef: string; readonly intentRef: string; readonly outcomeClass: string };
  readonly expected: { readonly expectedQuantity: string | null; readonly expectedRealized: string | null; readonly tolerance: string };
  readonly happened: { readonly disposition: 'filled' | 'refused' | 'partial' | 'expired'; readonly filledQuantity: string | null; readonly realizedOutcome: string; readonly feeTotal: string; readonly notionalTotal: string };
  readonly gap: { readonly quantityShortfall: string | null; readonly realizedGap: string | null; readonly withinTolerance: boolean | null };
  readonly hypotheses: readonly { readonly class: string; readonly confidence: string; readonly detail: unknown; readonly evidence: readonly { readonly kind: string; readonly ref: string }[]; readonly note: string | null }[];
  readonly evidence: readonly { readonly kind: string; readonly ref: string }[];
  readonly lineage: { readonly tenant: string; readonly project: string; readonly shadowSessionRef: string; readonly shadowOutcomeRef: string; readonly trajectoryRef: string | null; readonly experiment: { readonly experimentRef: string; readonly trialRef: string } | null };
  readonly asOf: number;
  readonly priorChainHead: string;
}

// ---------------------------------------------------------------------------
// The jobs mirror (the async submitted/running/complete pattern)
// ---------------------------------------------------------------------------

/** The job kinds. */
export type JobKind = 'research' | 'learning';

/** The job statuses (the async pattern's states). */
export type JobStatus = 'submitted' | 'running' | 'complete' | 'failed';

/** The job record as the boundary serves it. */
export interface JobRecord {
  readonly jobId: string;
  readonly kind: JobKind;
  readonly tenant: string;
  readonly project: string;
  readonly status: JobStatus;
  readonly submittedAt: number;
  readonly result?: unknown;
  readonly completedAt?: number;
}

// ---------------------------------------------------------------------------
// The job-machinery RESULT payload mirrors (W-19, the R1 fix — additive
// documentation types; JobRecord.result stays `unknown` at rest and the
// render treats it structurally, exactly like core/notices.ts's
// release-candidate marker). These mirror the shapes the demo job
// machinery completes jobs with (deploy/vercel/runtime/demo.ts): a
// research job completes with a release-candidate record, a learning
// job with a training summary. Every field is optional at the wire —
// the console renders what the payload actually carries, verbatim,
// and never fabricates a field a payload did not serve (L20).
// ---------------------------------------------------------------------------

/** The research job's completion payload: the release-candidate deliverable marker. */
export interface ReleaseCandidateResult {
  readonly kind: 'release-candidate';
  readonly specId?: string;
  readonly version?: number;
  readonly project?: string;
  readonly title?: string;
  readonly summary?: string;
}

/** The learning job's completion payload: the training summary marker. */
export interface TrainingSummaryResult {
  readonly kind: 'training-summary';
  readonly epochs?: number;
  readonly project?: string;
}

/** The job-submission request body. */
export interface SubmitJobRequest {
  readonly kind: JobKind;
  readonly projectId: string;
  /** The job specification (the job machinery owns its semantics). */
  readonly spec: unknown;
}

// ---------------------------------------------------------------------------
// The execution mirror (the intent + the gateway's record)
// ---------------------------------------------------------------------------

/** The order form (the order-intent shape the gate decides over). */
export interface OrderIntent {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: string;
  readonly quantity: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly timeInForce: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly notes?: string;
}

/** The execution request body: { intent } — ONLY an intent (authority is the gateway's output, never an input). */
export interface ExecutionRequest {
  readonly intent: StrategyIntent;
}

/** The strategy intent (the shape the gate decides over — L8: the console REQUESTS, never decides). */
export interface StrategyIntent {
  readonly intentId: string;
  readonly sequence: number;
  readonly order: OrderIntent;
  readonly constraintProof: unknown;
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly windowRefs: readonly string[];
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
  readonly riskPolicyRefs: readonly string[];
  readonly rationale: unknown;
  readonly asOf: number;
}

/** The gateway's typed refusal (the stage union, opaque-carried per stage). */
export interface GatewayRefusal {
  readonly stage: string;
  readonly [key: string]: unknown;
}

/** One risk check as the gateway's record carries it (the dimension + the gateway's own outcome — L20: rendered verbatim, never re-decided). */
export interface SubmissionRiskCheck {
  readonly dimension: string;
  readonly outcome: string;
}

/** The order leg the gateway's submission record carries (the request the gate decided over — the served blotter's W-8 additive shape). */
export interface SubmissionOrderLeg {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: string;
  readonly quantity: string;
  readonly price?: string;
  readonly timeInForce: string;
  readonly createdAt: string;
}

/** The fill economics the gateway's routed record carries (state, quantity, price, notional, fee). */
export interface SubmissionFill {
  readonly state: string;
  readonly quantity: string;
  readonly price: string;
  readonly notional: string;
  readonly fee: string;
  readonly filledAt: number;
}

/**
 * THE W-8 DEMO-SUBSTANCE ADDITIVE FIELDS (served by the host-owned
 * `GET /v1/execution/submissions` route since the W-8 wave — the
 * execution blotter's own shape: the order leg, the fill economics,
 * the named deciding body, the decision rationale and the risk
 * checks). All OPTIONAL: the frozen SDK surface (packages/sdk) and
 * the POST /v1/execution/requests response do not carry them, so the
 * structural-parity witnesses keep compiling while the blotter read
 * projects the richer served shape (the interop trip-wire documents
 * the amendment).
 */
export interface SubmissionEnrichment {
  /** The order leg the gate decided over (client order id, instrument, side, quantity, price). */
  readonly order?: SubmissionOrderLeg;
  /** The fill economics (routed rows; state/quantity/price/notional/fee). */
  readonly fill?: SubmissionFill;
  /** The named deciding body (e.g. 'desk:…' / 'gate:pre-trade-risk'). */
  readonly decisionBody?: string;
  /** The decision's audit rationale (the deciding record's own published prose — an audit field, never hidden chain-of-thought). */
  readonly decisionRationale?: string;
  /** The gateway's risk checks (dimension + outcome, verbatim — L20). */
  readonly riskChecks?: readonly SubmissionRiskCheck[];
  /** The record's resolvable evidence refs (kind + ref). */
  readonly evidence?: readonly { readonly kind: string; readonly ref: string }[];
}

/** One submission's outcome as the boundary serves it (routed or refused — both are successful requests). */
export type GatewaySubmissionRecord = SubmissionEnrichment &
  (
    | {
        readonly kind: 'routed';
        readonly submissionId: string;
        readonly decisionId: string;
        readonly auditId: string;
        readonly requestRef: string;
        readonly venue: string;
        readonly adapterRef: string;
        readonly channelRef: string;
        readonly routedAt: number;
      }
    | {
        readonly kind: 'refused';
        readonly submissionId: string;
        readonly decisionId: string | null;
        readonly auditId: string;
        readonly refusal: GatewayRefusal;
        readonly refusedAt: number;
      }
  );

// ---------------------------------------------------------------------------
// The organization status mirror (the watch surface)
// ---------------------------------------------------------------------------

/** The organization's operating status. */
export type OrganizationStatus = 'forming' | 'active' | 'suspended' | 'terminated';

/** One organization status snapshot (the watch surface's served shape). */
export interface OrgStatusSnapshot {
  readonly organizationRef: string;
  readonly tenant: string;
  readonly project: string;
  readonly status: OrganizationStatus;
  readonly at: number;
  readonly instanceRefs: readonly string[];
}

// ---------------------------------------------------------------------------
// The meta surface (version negotiation)
// ---------------------------------------------------------------------------

/** `GET /v1/meta` — the version-negotiation + capability surface. */
export interface ApiMeta {
  readonly apiVersion: ApiVersion;
  readonly supportedVersions: readonly ApiVersion[];
  readonly routeFamilies: readonly string[];
}

// ---------------------------------------------------------------------------
// The route-family permission vocabulary (what a credential may carry)
// ---------------------------------------------------------------------------

/** The public route families (the mirror of the boundary's vocabulary). */
export const PUBLIC_ROUTE_FAMILIES = [
  'meta:read',
  'projects:read',
  'projects:write',
  'knowledge:read',
  'outcomes:read',
  'jobs:read',
  'jobs:write',
  'execution:write',
  'organizations:read',
] as const;

/** One public route family. */
export type PublicRouteFamily = (typeof PUBLIC_ROUTE_FAMILIES)[number];

/** The replay marker header (the mirror of the boundary's idempotent-replay marker). */
export const IDEMPOTENT_REPLAY_HEADER = 'x-idempotent-replay';
