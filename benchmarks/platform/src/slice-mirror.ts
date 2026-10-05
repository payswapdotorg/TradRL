/**
 * @tradrl/benchmarks-platform — the REFERENCE-SLICE REPORT MIRROR (Work
 * Order T049; canonical owner: examples/end-to-end-trading, T048).
 *
 * THE WORK ORDER'S OWN LAW: "the T048 reference slice as the natural live
 * input (its SliceReport/lineage records)" — the reference-slice benchmark
 * suites MEASURE the report T048's `runReferenceSlice()` folds. The
 * example lane OWNS the shape; this machinery CONSUMES it through a
 * STRUCTURAL MIRROR ONLY — never imports (D-003/D-004) — and the interop
 * trip-wire tests prove that the REAL report from the REAL example
 * verifies under this mirror field-for-field, while a tampered copy fails
 * typed.
 *
 * Mirrored shapes (canonical owner: examples/end-to-end-trading/src/run.ts,
 * T048):
 * - `SliceReportMirror` — every station's folded evidence: the market-data
 *   counts (with the embargo lift instant), the director decision, both
 *   strategy runs, the gateway chokepoint's outcome counts + the audit
 *   coherence verdict, the execution body's order-lane states, the shadow
 *   lane's session + fill count, the realized-outcome summary (exact
 *   decimal book), and the L15 lineage block.
 * - The station invariants the mirror's guard enforces (the platform
 *   self-benchmark's structural laws — `pipeline_incoherent` on breach):
 *   the embargo law (a non-zero lift instant when a news event exists),
 *   the audit law (a coherent gateway carries at least one audit record),
 *   the lineage laws (every outcome intent and every audit intent bind a
 *   goal; every order decision carries its two clocks) and the digest
 *   laws (the report digest AND the outcome digest are 8-hex — T048's own
 *   single-lane FNV-1a 32-bit anchors, `fnv1a32Hex` in the shadow-trading
 *   lane, NOT this lane's dual-lane 16-hex digest).
 */

import { isNonEmptyString, isNonNegativeInteger, isRecord } from './primitives';
import { isSignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The realized-outcome summary mirror (T048 shadow.ts)
// ---------------------------------------------------------------------------

/** The final paper book — MIRROR of T048's shadow book (exact decimals). */
export interface SliceBookMirror {
  readonly positions: readonly { readonly instrument: string; readonly quantity: string; readonly costBasis: string }[];
  readonly cash: string;
  readonly realizedPnl: string;
}

/** The realized-outcome summary — MIRROR of T048's `RealizedOutcomeSummary`. */
export interface RealizedOutcomeSummaryMirror {
  readonly outcomes: number;
  readonly fills: number;
  readonly refusals: number;
  readonly dispositions: readonly string[];
  readonly book: SliceBookMirror;
  readonly outcomeDigest: string;
}

// ---------------------------------------------------------------------------
// The lineage block mirror (T048 run.ts — the L15/L16 evidence)
// ---------------------------------------------------------------------------

/** One paper-lane outcome's lineage binding. MIRROR of T048. */
export interface PaperOutcomeIntentMirror {
  readonly outcomeId: string;
  readonly intentRef: string;
  readonly goalId: string;
}

/** One live-lane audit record's lineage binding. MIRROR of T048. */
export interface LiveAuditIntentMirror {
  readonly auditId: string;
  readonly intentRef: string;
  readonly goalId: string;
}

/** One order lifecycle's genesis lineage with the L16 clock pair. MIRROR of T048. */
export interface OrderDecisionMirror {
  readonly lifecycleId: string;
  readonly decisionRef: string;
  readonly directorDecisionRef: string | null;
  readonly intentRef: string;
  /** The order-level clock (L16 — DISTINCT from the strategic decision instant). */
  readonly orderClock: number;
  /** The cited decision's strategic instant (the L4/L16 boundary reference). */
  readonly decisionAsOf: number;
}

/** The L15 lineage chain — MIRROR of T048's `SliceReport['lineage']`. */
export interface SliceLineageMirror {
  readonly goalId: string;
  readonly directorGoalId: string;
  readonly directorDecisionId: string;
  readonly paperOutcomeIntents: readonly PaperOutcomeIntentMirror[];
  readonly liveAuditIntents: readonly LiveAuditIntentMirror[];
  readonly orderDecisions: readonly OrderDecisionMirror[];
}

// ---------------------------------------------------------------------------
// The report mirror
// ---------------------------------------------------------------------------

/**
 * The whole slice's folded evidence — STRUCTURAL MIRROR of T048's
 * `SliceReport` (DO NOT DIVERGE; the interop trip-wires prove the REAL
 * report verifies here). The canonical JSON of this shape is the
 * measurement input digest the subject binding pins.
 */
export interface SliceReportMirror {
  readonly marketData: {
    readonly binanceEvents: number;
    readonly newsEvents: number;
    readonly embargoAvailableAt: number;
    readonly binanceEventTypes: readonly string[];
    readonly framesSent: number;
  };
  readonly director: {
    readonly decisionId: string;
    readonly directiveKind: string;
    readonly lanesConsumed: number;
  };
  readonly strategy: {
    readonly runId: string;
    readonly intents: number;
    readonly refusals: number;
    readonly instruments: readonly string[];
    readonly step2RunId: string;
    readonly step2Intents: number;
    readonly step2Sides: readonly string[];
  };
  readonly gateway: {
    readonly routed: number;
    readonly refused: number;
    readonly refusalStages: readonly string[];
    readonly portCalls: number;
    readonly auditRecords: number;
    readonly auditCoherent: boolean;
  };
  readonly executionBody: {
    readonly btcBuyState: string;
    readonly ethState: string;
    readonly btcSellState: string;
    readonly gatewayRequests: number;
    readonly reconciliationStatus: string;
  };
  readonly shadow: {
    readonly sessionId: string;
    readonly dispositions: readonly string[];
    readonly worldFillCount: number;
  };
  readonly outcomes: RealizedOutcomeSummaryMirror;
  readonly lineage: SliceLineageMirror;
  readonly reportDigest: string;
}

/** Guard: the paper-lane lineage bindings. */
function isPaperOutcomeIntentMirror(v: unknown): v is PaperOutcomeIntentMirror {
  return isRecord(v) && isNonEmptyString(v.outcomeId) && isNonEmptyString(v.intentRef) && isNonEmptyString(v.goalId);
}

/** Guard: the live-lane lineage bindings. */
function isLiveAuditIntentMirror(v: unknown): v is LiveAuditIntentMirror {
  return isRecord(v) && isNonEmptyString(v.auditId) && isNonEmptyString(v.intentRef) && isNonEmptyString(v.goalId);
}

/** Guard: one order decision's lineage block. */
function isOrderDecisionMirror(v: unknown): v is OrderDecisionMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.lifecycleId) || !isNonEmptyString(v.decisionRef) || !isNonEmptyString(v.intentRef)) return false;
  if (v.directorDecisionRef !== null && !isNonEmptyString(v.directorDecisionRef)) return false;
  return typeof v.orderClock === 'number' && typeof v.decisionAsOf === 'number';
}

/** Guard: the outcome summary mirror (exact decimals in the book; the 8-hex fnv1a32Hex outcome digest). */
export function isRealizedOutcomeSummaryMirror(v: unknown): v is RealizedOutcomeSummaryMirror {
  if (!isRecord(v)) return false;
  if (!isNonNegativeInteger(v.outcomes) || !isNonNegativeInteger(v.fills) || !isNonNegativeInteger(v.refusals)) return false;
  if (!Array.isArray(v.dispositions) || !(v.dispositions as readonly unknown[]).every((d) => isNonEmptyString(d))) return false;
  if (!isRecord(v.book)) return false;
  if (!Array.isArray(v.book.positions)) return false;
  for (const position of v.book.positions as readonly unknown[]) {
    if (!isRecord(position)) return false;
    if (!isNonEmptyString(position.instrument) || !isSignedDecimal(position.quantity) || !isSignedDecimal(position.costBasis)) return false;
  }
  if (!isSignedDecimal(v.book.cash) || !isSignedDecimal(v.book.realizedPnl)) return false;
  // T048's outcomeDigest is fnv1a32Hex (the shadow-trading lane's single-lane
  // 32-bit fold) — EIGHT hex characters, exactly like the report digest.
  return typeof v.outcomeDigest === 'string' && /^[0-9a-f]{8}$/.test(v.outcomeDigest);
}

/** Guard: the L15 lineage block. */
export function isSliceLineageMirror(v: unknown): v is SliceLineageMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.goalId) || !isNonEmptyString(v.directorGoalId) || !isNonEmptyString(v.directorDecisionId)) return false;
  if (!Array.isArray(v.paperOutcomeIntents) || !(v.paperOutcomeIntents as readonly unknown[]).every((binding) => isPaperOutcomeIntentMirror(binding))) return false;
  if (!Array.isArray(v.liveAuditIntents) || !(v.liveAuditIntents as readonly unknown[]).every((binding) => isLiveAuditIntentMirror(binding))) return false;
  if (!Array.isArray(v.orderDecisions) || !(v.orderDecisions as readonly unknown[]).every((decision) => isOrderDecisionMirror(decision))) return false;
  return true;
}

/**
 * The station-invariant violations of a structurally valid report (the
 * coherent-pipeline laws). Empty = coherent. Pure; shared by the guard and
 * by the runner (which surfaces the violations as the typed
 * `pipeline_incoherent`).
 */
export function slicePipelineViolations(v: SliceReportMirror): readonly string[] {
  const violations: string[] = [];
  // The embargo law: a news-carrying slice lifts its embargo at a real instant.
  if (v.marketData.newsEvents > 0 && v.marketData.embargoAvailableAt <= 0) {
    violations.push('marketData.embargoAvailableAt: a news-carrying slice must lift its embargo at a real instant');
  }
  // The audit law: a coherent gateway session carries audit records.
  if (v.gateway.auditCoherent && v.gateway.auditRecords === 0) {
    violations.push('gateway.auditRecords: a coherent gateway session carries at least one audit record');
  }
  // The lineage laws: every binding cites its goal; every order cites its clocks.
  for (const binding of v.lineage.paperOutcomeIntents) {
    if (binding.goalId !== v.lineage.goalId) {
      violations.push(`lineage.paperOutcomeIntents: outcome "${binding.outcomeId}" binds goal "${binding.goalId}" — the run goal is "${v.lineage.goalId}" (L15)`);
    }
  }
  for (const binding of v.lineage.liveAuditIntents) {
    if (binding.goalId !== v.lineage.goalId) {
      violations.push(`lineage.liveAuditIntents: audit record "${binding.auditId}" binds goal "${binding.goalId}" — the run goal is "${v.lineage.goalId}" (L15)`);
    }
  }
  for (const decision of v.lineage.orderDecisions) {
    if (decision.orderClock < decision.decisionAsOf) {
      violations.push(`lineage.orderDecisions: lifecycle "${decision.lifecycleId}" order clock precedes its cited strategic instant (L16)`);
    }
    if (decision.directorDecisionRef !== null && decision.directorDecisionRef !== v.lineage.directorDecisionId) {
      violations.push(`lineage.orderDecisions: lifecycle "${decision.lifecycleId}" cites director decision "${decision.directorDecisionRef}" — the report's decision is "${v.lineage.directorDecisionId}" (L15)`);
    }
  }
  return violations;
}

/**
 * Guard: the report mirror's STRUCTURAL shape (every station's fields, the
 * exact-decimal book, the 8-hex digests) — WITHOUT the station invariants.
 * The runner uses this split so a structurally valid but STATION-INCOHERENT
 * report fails with the precise `pipeline_incoherent` (not the generic
 * `invalid_evidence`); {@link isSliceReportMirror} bundles both for
 * external callers that want the one-shot law.
 */
export function isSliceReportShape(v: unknown): v is SliceReportMirror {
  if (!isRecord(v)) return false;
  const md = v.marketData;
  if (!isRecord(md)) return false;
  if (!isNonNegativeInteger(md.binanceEvents) || !isNonNegativeInteger(md.newsEvents) || !isNonNegativeInteger(md.framesSent)) return false;
  if (typeof md.embargoAvailableAt !== 'number') return false;
  if (!Array.isArray(md.binanceEventTypes) || !(md.binanceEventTypes as readonly unknown[]).every((t) => isNonEmptyString(t))) return false;

  const director = v.director;
  if (!isRecord(director)) return false;
  if (!isNonEmptyString(director.decisionId) || !isNonEmptyString(director.directiveKind)) return false;
  if (!isNonNegativeInteger(director.lanesConsumed)) return false;

  const strategy = v.strategy;
  if (!isRecord(strategy)) return false;
  if (!isNonEmptyString(strategy.runId) || !isNonEmptyString(strategy.step2RunId)) return false;
  if (!isNonNegativeInteger(strategy.intents) || !isNonNegativeInteger(strategy.refusals) || !isNonNegativeInteger(strategy.step2Intents)) return false;
  if (!Array.isArray(strategy.instruments) || !(strategy.instruments as readonly unknown[]).every((i) => isNonEmptyString(i))) return false;
  if (!Array.isArray(strategy.step2Sides) || !(strategy.step2Sides as readonly unknown[]).every((s) => isNonEmptyString(s))) return false;

  const gateway = v.gateway;
  if (!isRecord(gateway)) return false;
  if (!isNonNegativeInteger(gateway.routed) || !isNonNegativeInteger(gateway.refused)) return false;
  if (!isNonNegativeInteger(gateway.portCalls) || !isNonNegativeInteger(gateway.auditRecords)) return false;
  if (typeof gateway.auditCoherent !== 'boolean') return false;
  if (!Array.isArray(gateway.refusalStages) || !(gateway.refusalStages as readonly unknown[]).every((s) => isNonEmptyString(s))) return false;

  const body = v.executionBody;
  if (!isRecord(body)) return false;
  if (!isNonEmptyString(body.btcBuyState) || !isNonEmptyString(body.ethState) || !isNonEmptyString(body.btcSellState)) return false;
  if (!isNonEmptyString(body.reconciliationStatus)) return false;
  if (!isNonNegativeInteger(body.gatewayRequests)) return false;

  const shadow = v.shadow;
  if (!isRecord(shadow)) return false;
  if (!isNonEmptyString(shadow.sessionId)) return false;
  if (!Array.isArray(shadow.dispositions) || !(shadow.dispositions as readonly unknown[]).every((d) => isNonEmptyString(d))) return false;
  if (!isNonNegativeInteger(shadow.worldFillCount)) return false;

  if (!isRealizedOutcomeSummaryMirror(v.outcomes)) return false;
  if (!isSliceLineageMirror(v.lineage)) return false;
  return typeof v.reportDigest === 'string' && /^[0-9a-f]{8}$/.test(v.reportDigest);
}

/**
 * Guard: the whole report mirror — the structural law PLUS the station
 * invariants (the platform self-benchmark's coherence laws, fail-closed).
 * The guard deliberately does NOT recompute T048's own digest fold (a
 * DIFFERENT, simpler FNV fold owned by the shadow-trading lane); it pins
 * the digest's SHAPE and records its value as the determinism axis.
 */
export function isSliceReportMirror(v: unknown): v is SliceReportMirror {
  if (!isSliceReportShape(v)) return false;
  // --- The station invariants (the coherent-pipeline laws) -------------------
  return slicePipelineViolations(v).length === 0;
}

