// @tradrl/example-e2e-trading — STRATEGY MIRRORS.
//
// Structural mirrors of the portfolio strategy lane
// (packages/trading-strategy — T018): the StrategySpec, the StrategyIntent
// the execution side consumes, the intent refusals, the run record and
// the backtest candidate trail. tests/end-to-end-trading/interop.test.ts
// feeds this slice's intents through the REAL `validateStrategyIntent`.

import type { TenantId, ProjectId, InstrumentId, VenueId, Seed } from '../ids';
import type {
  ConstraintSetVersionRefMirror,
  GoalVersionRefMirror,
  StrategyVersionRefMirror,
  ObservationWindowMirror,
  PortfolioStateMirror,
  GoalStatementMirror,
  ConstraintSetStatementMirror,
  ConstraintCheckMirror,
} from './control';
import type { OrderIntentRecordMirror } from './market';

// ---------------------------------------------------------------------------
// StrategySpec (packages/trading-strategy spec.ts)
// ---------------------------------------------------------------------------

export interface UniverseEntryMirror {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly lotSize: string;
  readonly tickSize: string;
}

export type AllocationPolicyMirror =
  | { readonly kind: 'equal_weight' }
  | { readonly kind: 'fixed_weights'; readonly weights: readonly { readonly instrumentId: InstrumentId; readonly weight: string }[] };

export type RebalanceTriggerMirror = 'drift_band' | 'scheduled';

export interface RebalancingPolicyMirror {
  readonly trigger: RebalanceTriggerMirror;
  readonly band?: string;
  readonly cadenceMs: number;
  readonly description?: string;
}

export type PriceAnchorMirror = 'last_trade' | 'mid_quote';

export type PriceDisciplineMirror =
  | { readonly kind: 'market' }
  | { readonly kind: 'limit'; readonly anchor: PriceAnchorMirror };

export interface OrganizationBindingMirror {
  readonly organizationId: string;
  readonly assignmentRefs: readonly string[];
}

export interface StrategySpecMirror {
  readonly specId: string;
  readonly version: number;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly goal: string;
  readonly name?: string;
  readonly universe: readonly UniverseEntryMirror[];
  readonly allocation: AllocationPolicyMirror;
  readonly rebalancing: RebalancingPolicyMirror;
  readonly priceDiscipline: PriceDisciplineMirror;
  readonly riskPolicyRefs: readonly string[];
  readonly generators: readonly { readonly name: string; readonly algorithm: 'mulberry32' }[];
  readonly decimalPrecision: number;
  readonly organization: OrganizationBindingMirror | null;
  readonly createdAt: number;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// StrategyIntent (packages/trading-strategy intent.ts — the T019/T040 input)
// ---------------------------------------------------------------------------

export interface SatisfiedPredicateProofMirror {
  readonly constraintId: string;
  readonly domain: 'observation' | 'state' | 'action' | 'outcome';
  readonly subject: string;
  readonly severity: 'advisory' | 'blocking';
  readonly predicate: {
    readonly kind: string;
    readonly bound?: number;
    readonly min?: number;
    readonly max?: number;
    readonly value?: number | string | boolean;
    readonly values?: readonly string[];
    readonly expected?: boolean;
  };
  readonly observed: string | number | boolean;
}

export interface ConstraintProofMirror {
  readonly constraintSet: ConstraintSetVersionRefMirror;
  readonly satisfied: readonly SatisfiedPredicateProofMirror[];
  readonly advisoryViolations: readonly ConstraintCheckMirror[];
}

export type IntentReasonKindMirror = 'rebalance_drift' | 'rebalance_scheduled' | 'initial_allocation';

export interface IntentRationaleMirror {
  readonly kind: IntentReasonKindMirror;
  readonly instrumentId: string;
  readonly targetWeight: string;
  readonly currentWeight: string;
  readonly drift: string;
}

export interface StrategyIntentMirror {
  readonly intentId: string;
  readonly sequence: number;
  readonly order: OrderIntentRecordMirror;
  readonly constraintProof: ConstraintProofMirror;
  readonly goal: GoalVersionRefMirror;
  readonly strategy: StrategyVersionRefMirror;
  readonly windowRefs: readonly string[];
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly riskPolicyRefs: readonly string[];
  readonly rationale: IntentRationaleMirror;
  readonly asOf: number;
}

export type RefusalCauseMirror = 'constraint_refused' | 'constraint_error' | 'universe_violation';

export interface ViolatedPredicateMirror {
  readonly constraintId: string;
  readonly domain: 'observation' | 'state' | 'action' | 'outcome';
  readonly subject: string;
  readonly severity: 'advisory' | 'blocking';
  readonly predicate: {
    readonly kind: string;
    readonly bound?: number;
    readonly min?: number;
    readonly max?: number;
    readonly value?: number | string | boolean;
    readonly values?: readonly string[];
    readonly expected?: boolean;
  };
  readonly observed?: string | number | boolean;
}

export interface IntentRefusalMirror {
  readonly sequence: number;
  readonly cause: RefusalCauseMirror;
  readonly violated: readonly ViolatedPredicateMirror[];
  readonly candidate: {
    readonly side: 'buy' | 'sell';
    readonly instrumentId: string;
    readonly venueId: string;
    readonly quantity: string;
  };
  readonly goal: GoalVersionRefMirror;
  readonly strategy: StrategyVersionRefMirror;
  readonly windowRefs: readonly string[];
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
}

// ---------------------------------------------------------------------------
// The run record (packages/trading-strategy run.ts)
// ---------------------------------------------------------------------------

export interface StrategyRunMirror {
  readonly runId: string;
  readonly strategy: StrategyVersionRefMirror;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSet: ConstraintSetVersionRefMirror;
  readonly windowId: string;
  readonly stateId: string;
  readonly seed: Seed;
  readonly tenant: string;
  readonly project: string;
  readonly asOf: number;
  readonly intents: readonly StrategyIntentMirror[];
  readonly refusals: readonly IntentRefusalMirror[];
  readonly inputDigest: string;
}

// ---------------------------------------------------------------------------
// The backtest trail (packages/trading-strategy backtest.ts)
// ---------------------------------------------------------------------------

export type CandidateDispositionKindMirror = 'proposed' | 'retained' | 'rejected';

export interface BacktestCandidateMirror {
  readonly candidateId: string;
  readonly sequence: number;
  readonly strategy: StrategyVersionRefMirror;
  readonly window: { readonly windowId: string; readonly startsAt: number; readonly endsAt: number };
  readonly attainment: readonly {
    readonly criterionId: string;
    readonly requiredSatisfaction: number;
    readonly gatingConstraintIds: readonly string[];
    readonly blockingConstraintIds: readonly string[];
    readonly evidenceRef: string;
  }[];
  readonly disposition: CandidateDispositionKindMirror;
  readonly reason:
    | { readonly kind: 'attained'; readonly attainedCriteria: number; readonly totalCriteria: number }
    | { readonly kind: 'not_attained'; readonly failedCriteria: readonly string[] }
    | { readonly kind: 'constraint_refused'; readonly violatedConstraintIds: readonly string[] };
  readonly goal: GoalVersionRefMirror;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly recordedAt: number;
}

export interface BacktestRecordMirror {
  readonly runId: string;
  readonly goal: GoalVersionRefMirror;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly candidates: readonly BacktestCandidateMirror[];
}

// ---------------------------------------------------------------------------
// The run compiler input bundle
// ---------------------------------------------------------------------------

export interface StrategyRunInputMirror {
  readonly spec: StrategySpecMirror;
  readonly state: PortfolioStateMirror;
  readonly window: ObservationWindowMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly goal: GoalStatementMirror;
  readonly seed: Seed;
  /** The director decision the run binds (L15/L16 strategic overlay). */
  readonly directorDecision: { readonly decisionId: string; readonly directive: unknown };
}
