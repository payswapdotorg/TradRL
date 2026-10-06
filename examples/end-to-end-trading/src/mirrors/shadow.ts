// @tradrl/example-e2e-trading — SHADOW/PAPER EXECUTION + OUTCOME MIRRORS.
//
// Structural mirrors of the shadow-trading outcome lane
// (services/shadow-trading — T030) and the domain outcome record
// (packages/domain-core outcome.ts): SimulatedFill (T019 simulation.ts),
// ShadowFill/ShadowOutcomeRecord/ShadowOutcomeLog (T030 outcomes.ts) and
// the constraint-aware Outcome verdict (domain-core). The chain seeds
// and fold laws are byte-identical to the real lane's —
// tests/end-to-end-trading/interop.test.ts verifies this slice's
// outcome log under the REAL `verifyShadowOutcomeChain`.

import type { TenantId, ProjectId } from '../ids';
import type { ExecutionLineageMirror } from './execution';

// ---------------------------------------------------------------------------
// SimulatedFill (packages/execution-policy simulation.ts)
// ---------------------------------------------------------------------------

export type SimulationFidelityMirror = 'paper_venue' | 'simulated_matching';

export interface SimulatedFillVenueLineageMirror {
  readonly configDigest: string;
  readonly engineOrderRef: string;
  readonly engineFillRef: string;
  readonly feesRef: string;
  readonly latencyRef: string;
  readonly slippageRef: string;
  readonly impactRef: string;
}

export interface SimulatedFillMirror {
  readonly fillId: string;
  readonly sequence: number;
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  readonly price: string;
  readonly aggressorPrice: string;
  readonly quantity: string;
  readonly fee: string;
  readonly latencyMs: number;
  readonly decisionId: string;
  readonly intentRef: string;
  readonly fidelity: SimulationFidelityMirror;
  readonly venueLineage: SimulatedFillVenueLineageMirror;
  readonly lineage: ExecutionLineageMirror;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
}

// ---------------------------------------------------------------------------
// Shadow outcome records (services/shadow-trading outcomes.ts)
// ---------------------------------------------------------------------------

export type ShadowDispositionMirror = 'filled' | 'refused' | 'partial' | 'expired';

export interface ShadowLineageMirror {
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
}

export interface ShadowCostsMirror {
  readonly feeTotal: string;
  readonly notionalTotal: string;
}

export interface ShadowOutcomeRecordMirror {
  readonly outcomeId: string;
  readonly ordinal: number;
  readonly intentRef: string;
  readonly decisionRef: string;
  readonly refusalRef: string | null;
  readonly disposition: ShadowDispositionMirror;
  readonly fills: readonly string[];
  readonly costs: ShadowCostsMirror;
  readonly realizedOutcome: string;
  readonly unrealizedAtDecision: string;
  readonly priorChainHead: string;
  readonly lineage: ShadowLineageMirror;
  readonly asOf: number;
}

export const OUTCOME_CHAIN_SEED_MIRROR = '00000000';

export interface ShadowOutcomeLogMirror {
  readonly records: readonly ShadowOutcomeRecordMirror[];
  readonly head: string;
}

// ---------------------------------------------------------------------------
// Domain outcome (packages/domain-core outcome.ts) — the L15 closure
// ---------------------------------------------------------------------------

export type OutcomeVerdictMirror = 'met' | 'partially-met' | 'missed' | 'inconclusive';

export interface DomainOutcomeMirror {
  readonly id: string;
  readonly projectId: string;
  readonly decisionId: string;
  readonly executionId?: string;
  readonly realizedAt: number;
  readonly verdict: OutcomeVerdictMirror;
  readonly realizedPnl?: string;
  readonly metrics: Readonly<Record<string, number | string>>;
  readonly summary?: string;
}

// ---------------------------------------------------------------------------
// The goal-progress record — the slice's L15 root binding
// ---------------------------------------------------------------------------

export interface GoalProgressRecordMirror {
  readonly goalRef: { readonly goalId: string; readonly version: number };
  readonly tenant: string;
  readonly project: string;
  readonly horizon: { readonly startsAt: number; readonly endsAt: number };
  readonly finalEquity: string;
  readonly realizedPnl: string;
  readonly maxDrawdownObserved: string;
  readonly verdict: OutcomeVerdictMirror;
  readonly attainment: {
    readonly criteria: readonly { readonly criterionId: string; readonly metric: string; readonly satisfied: boolean; readonly observed: number | string }[];
    readonly satisfiedCount: number;
    readonly totalCount: number;
    readonly satisfactionShare: number;
    readonly attained: boolean;
  };
  readonly outcomeIds: readonly string[];
  readonly asOf: number;
}
