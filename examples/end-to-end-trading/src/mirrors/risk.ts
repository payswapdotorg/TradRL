// @tradrl/example-e2e-trading — RISK MIRRORS.
//
// Structural mirrors of the risk lane (packages/risk — T020): the
// RiskPolicy compiled from the user's risk constraints, the class-limit
// records, the exposure/limit-evaluation records the gateway's stage 6
// consumes, and the kill-switch log. tests/end-to-end-trading/interop.test.ts
// verifies this slice's kill-switch chains under the REAL verifier.

import type { TenantId, ProjectId, Seed, VenueId, InstrumentId } from '../ids';
import type {
  ConstraintSetVersionRefMirror,
  GoalVersionRefMirror,
} from './control';
import type { AssetClassMirror } from './market';

// ---------------------------------------------------------------------------
// RiskPolicy (packages/risk policy.ts)
// ---------------------------------------------------------------------------

export interface ClassLimitRecordMirror {
  readonly instrumentClass: string;
  readonly maxOrderSize: string;
  readonly maxOrderNotional: string;
  readonly maxPositionSize: string;
  readonly maxPositionNotional: string;
}

export interface ConcentrationLimitMirror {
  readonly maxConcentrationRatio: string;
  readonly ratioPrecision: number;
}

export interface DrawdownLimitMirror {
  readonly maxDrawdown: string;
}

export interface LeverageLimitMirror {
  readonly maxLeverageRatio: string;
  readonly ratioPrecision: number;
}

export interface RiskPolicyVersionRefMirror {
  readonly policyId: string;
  readonly version: number;
}

export interface RiskPolicyMirror {
  readonly policyId: string;
  readonly version: number;
  readonly supersedes: RiskPolicyVersionRefMirror | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSet: ConstraintSetVersionRefMirror;
  readonly classLimits: readonly ClassLimitRecordMirror[];
  readonly concentration: ConcentrationLimitMirror | null;
  readonly drawdown: DrawdownLimitMirror | null;
  readonly leverage: LeverageLimitMirror | null;
  readonly compiledFrom: readonly string[];
  readonly asOf: number;
}

// ---------------------------------------------------------------------------
// Exposure + limit evaluation (packages/risk exposure.ts / limits.ts)
// ---------------------------------------------------------------------------

export interface OrderMeasureMirror {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly assetClass: AssetClassMirror;
  readonly referencePrice: string;
  readonly quantity: string;
  readonly notional: string;
  readonly fillRef: string;
}

export interface PositionMeasureMirror {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly assetClass: AssetClassMirror;
  readonly referencePrice: string;
  readonly quantity: string;
  readonly notional: string;
}

export interface ExposureLineageMirror {
  readonly portfolioState: string;
  readonly marketState: string;
  readonly priorPeakEquity: string | null;
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

export interface ExposureRecordMirror {
  readonly exposureId: string;
  readonly asOf: number;
  readonly cash: string;
  readonly orders: readonly OrderMeasureMirror[];
  readonly positions: readonly PositionMeasureMirror[];
  readonly grossNotional: string;
  readonly netNotional: string;
  readonly equity: string;
  readonly peakEquity: string;
  readonly drawdown: string;
  readonly fillRefs: readonly string[];
  readonly lineage: ExposureLineageMirror;
}

export type RiskLimitKindMirror =
  | 'order_size' | 'order_notional' | 'position_size' | 'position_notional'
  | 'concentration' | 'drawdown' | 'leverage';

export type LimitStateValueMirror = 'within' | 'breaching' | 'blocked';

export type LimitScopeMirror =
  | { readonly kind: 'instrument'; readonly venue: VenueId; readonly instrument: InstrumentId; readonly instrumentClass: string }
  | { readonly kind: 'portfolio' };

export type LimitReasonMirror =
  | { readonly cause: 'breach'; readonly bound: string; readonly observed: string; readonly excess: string }
  | { readonly cause: 'kill_switch'; readonly switchId: string; readonly thrownAt: number }
  | { readonly cause: 'no_declared_limit'; readonly instrumentClass: string };

export interface LimitStateMirror {
  readonly kind: RiskLimitKindMirror;
  readonly scope: LimitScopeMirror;
  readonly state: LimitStateValueMirror;
  readonly reason: LimitReasonMirror | null;
}

export interface RiskLineageMirror {
  readonly policy: RiskPolicyVersionRefMirror;
  readonly constraintSet: ConstraintSetVersionRefMirror;
  readonly goal: GoalVersionRefMirror;
  readonly portfolioState: string;
  readonly marketState: string;
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

export interface LimitEvaluationRecordMirror {
  readonly evaluationId: string;
  readonly policy: RiskPolicyVersionRefMirror;
  readonly exposureRef: string;
  readonly killSwitchState: 'standing' | 'thrown';
  readonly states: readonly LimitStateMirror[];
  readonly lineage: RiskLineageMirror;
  readonly asOf: number;
}

/** The execution-policy limits-refusal mirror (T019's 'limits' reason shape). */
export interface ExecutionLimitRefusalMirror {
  readonly dimension: 'limits';
  readonly limit: 'order_size' | 'order_notional' | 'position_size' | 'position_notional';
  readonly instrumentClass: string;
  readonly cap: string;
  readonly observed: string;
  readonly excess: string;
}

// ---------------------------------------------------------------------------
// Kill switch (packages/execution-policy kill-switch.ts)
// ---------------------------------------------------------------------------

export type KillSwitchStateMirror = 'standing' | 'thrown';

export interface KillSwitchRecordMirror {
  readonly recordId: string;
  readonly sequence: number;
  readonly state: KillSwitchStateMirror;
  readonly reason: string | null;
  readonly thrownAt: number | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
  readonly chainHead: string;
}

export interface KillSwitchLogMirror {
  readonly switchId: string;
  readonly records: readonly KillSwitchRecordMirror[];
}

export const KSW_CHAIN_SEED_MIRROR = 'ksw-genesis';
