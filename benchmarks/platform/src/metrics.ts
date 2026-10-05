/**
 * @tradrl/benchmarks-platform — the MEASURABLE vocabulary + the structured
 * metric vocabulary (Work Order T049).
 *
 * TWO closed vocabularies live here:
 *
 * 1. `MEASUREMENT_METRICS_MIRROR` — the STRUCTURED metric vocabulary of
 *    the platform's measured-evidence language (MIRROR of the skills
 *    lane's `MEASUREMENT_METRICS`, T017, re-declared by T045): a
 *    capability claim is MEASURED evidence, never a profession label
 *    (L16a).
 *
 * 2. The MEASURABLES — the closed set of facts a suite's axes may extract
 *    from a measured subject's evidence artifact. The reference-slice
 *    subject kind's measurables are the T048 SliceReport's own folded
 *    facts: the station counts, the exact-decimal book values, the
 *    determinism digests, and the DERIVED coherence flags (the L8
 *    zero-cost-refusal law, the L15 goal-binding laws, the L16 clock
 *    separation). A suite axis names a measurable; the runner extracts it
 *    from the evidence; the suite's attainment criterion judges it. The
 *    vocabulary is CLOSED so a suite definition is DATA, not code — a
 *    suite can only measure what the machinery knows how to extract
 *    honestly (an unknown measurable is the typed `unknown_measurable`,
 *    never a silent coercion).
 *
 * Kinds (the axis/value model):
 * - `count` — a non-negative integer (station counts).
 * - `decimal` — an exact decimal string at the axis's declared scale
 *   (book values; the exact-decimal law).
 * - `digest` — a hex digest string (the determinism anchors).
 * - `flag` — a boolean (the derived coherence laws).
 */

import type { SliceReportMirror } from './slice-mirror';

// ---------------------------------------------------------------------------
// The structured metric vocabulary (the L16a measured-evidence mirror)
// ---------------------------------------------------------------------------

/**
 * The closed structured-metric vocabulary — MIRROR of the skills lane's
 * `MEASUREMENT_METRICS` (T017; the same four metrics T045 re-declares).
 */
export const MEASUREMENT_METRICS_MIRROR = [
  'benchmark-score',
  'p50-latency-ms',
  'p95-latency-ms',
  'compute-units',
] as const;

// ---------------------------------------------------------------------------
// The axis kinds
// ---------------------------------------------------------------------------

/** The measurable/axis kinds. */
export const AXIS_KINDS = ['count', 'decimal', 'digest', 'flag'] as const;

/** One axis kind. */
export type AxisKind = (typeof AXIS_KINDS)[number];

/** Guard: an axis kind. */
export function isAxisKind(v: unknown): v is AxisKind {
  return typeof v === 'string' && (AXIS_KINDS as readonly string[]).includes(v);
}

/** The runtime value of one measured axis, by kind. */
export type AxisValue =
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'decimal'; readonly value: string }
  | { readonly kind: 'digest'; readonly value: string }
  | { readonly kind: 'flag'; readonly value: boolean };

// ---------------------------------------------------------------------------
// The reference-slice measurables (the T048 SliceReport's closed vocabulary)
// ---------------------------------------------------------------------------

/** One reference-slice measurable: its dotted path, its kind, and what it measures. */
export interface Measurable {
  /** The measurable's identity (the suite axis's `measurable` field). */
  readonly path: string;
  readonly kind: AxisKind;
  /**
   * For decimal measurables: the value's exact scale when the value's
   * scale is a LAW of the measured artifact, or null when the scale is
   * the artifact's own arithmetic (the SUITE's axis then declares the
   * exact scale it expects; the runner enforces the value is exactly at
   * it). Non-decimal measurables carry null (their axes must too).
   */
  readonly scale: number | null;
  readonly description: string;
}

/**
 * The closed measurable vocabulary of the reference-slice subject kind —
 * every fact the platform's benchmark machinery can honestly extract from
 * a T048 SliceReport. The coherence measurables are DERIVED (the flags):
 * they fold the report's own evidence into the platform's structural laws.
 *
 * THE BOOK-MONEY SCALES ARE THE REPORT'S OWN: T048's shadow book
 * (services/shadow-trading, the exact-decimal lane) renders cash and
 * realized PnL at whatever scale its fee/quantity arithmetic produces —
 * the REAL reference report carries realizedPnl "0" (scale 0) and cash
 * "54905.491" (scale 3, the 1bp taker fee) — so the book measurables are
 * FLEXIBLE-SCALE (`scale: null`): each suite's axes declare the exact
 * scale they expect, and the runner refuses any value off it
 * (`scale_mismatch`). A suite pinning a scale the report does not carry
 * fails closed — it never silently rescales money.
 */
export const SLICE_MEASURABLES: readonly Measurable[] = [
  // --- counts (the station evidence) ---------------------------------------
  { path: 'marketData.binanceEvents', kind: 'count', scale: null, description: 'the canonical crypto events the adapter sessions emitted' },
  { path: 'marketData.newsEvents', kind: 'count', scale: null, description: 'the canonical news events (the embargoed item + the public headline)' },
  { path: 'marketData.framesSent', kind: 'count', scale: null, description: 'the SUBSCRIBE frames sent to the venues (the neutrality contract)' },
  { path: 'director.lanesConsumed', kind: 'count', scale: null, description: 'the research lanes the director decision consumed' },
  { path: 'strategy.intents', kind: 'count', scale: null, description: 'the step-1 strategy run intents' },
  { path: 'strategy.refusals', kind: 'count', scale: null, description: 'the step-1 constraint-gate refusals' },
  { path: 'strategy.step2Intents', kind: 'count', scale: null, description: 'the step-2 (drift correction) strategy run intents' },
  { path: 'gateway.routed', kind: 'count', scale: null, description: 'the submissions the chokepoint routed to the venue seam' },
  { path: 'gateway.refused', kind: 'count', scale: null, description: 'the typed refusals (main gateway + kill-switch + expired-grant gateways)' },
  { path: 'gateway.portCalls', kind: 'count', scale: null, description: 'the venue seam calls (the routed count — refusals cost zero)' },
  { path: 'gateway.auditRecords', kind: 'count', scale: null, description: 'the main gateway audit records (1:1 with its submissions)' },
  { path: 'executionBody.gatewayRequests', kind: 'count', scale: null, description: 'the execution body requests to the gateway' },
  { path: 'shadow.worldFillCount', kind: 'count', scale: null, description: 'the reactive world fills in the paper lane' },
  { path: 'outcomes.outcomes', kind: 'count', scale: null, description: 'the chain-verified outcome-log records' },
  { path: 'outcomes.fills', kind: 'count', scale: null, description: 'the fills accounted into the shadow book' },
  { path: 'outcomes.refusals', kind: 'count', scale: null, description: 'the typed refusals in the paper lane' },
  // --- decimals (the exact-decimal book — FLEXIBLE-SCALE: the report's own arithmetic decides) ---
  { path: 'outcomes.realizedPnl', kind: 'decimal', scale: null, description: 'the final paper book realized PnL (exact decimal; the scale is the report\'s own)' },
  { path: 'outcomes.cash', kind: 'decimal', scale: null, description: 'the final paper book cash (exact decimal; the scale is the report\'s own)' },
  // --- digests (the determinism anchors) -------------------------------------
  { path: 'report.digest', kind: 'digest', scale: null, description: "the whole report's byte-stable digest (T048's own anchor)" },
  { path: 'outcomes.outcomeDigest', kind: 'digest', scale: null, description: 'the chain-verified outcome log digest' },
  // --- flags (the derived coherence laws) -------------------------------------
  { path: 'gateway.auditCoherent', kind: 'flag', scale: null, description: 'the gateway session coherence verdict (the chain + the 1:1 law)' },
  { path: 'gateway.refusalsCostZero', kind: 'flag', scale: null, description: 'the L8 law: portCalls === routed — a refusal never reaches the seam' },
  { path: 'lineage.paperOutcomeGoalsBound', kind: 'flag', scale: null, description: 'every paper outcome binds the run goal (L15)' },
  { path: 'lineage.liveAuditGoalsBound', kind: 'flag', scale: null, description: 'every live audit record binds the run goal (L15)' },
  { path: 'lineage.orderClocksSeparated', kind: 'flag', scale: null, description: 'every order clock is at-or-after its cited strategic instant (L16)' },
];

/** The measurable paths, as a set (the closed-vocabulary lookup). */
export const SLICE_MEASURABLE_PATHS: readonly string[] = SLICE_MEASURABLES.map((measurable) => measurable.path);

/** Guard: a reference-slice measurable path. */
export function isSliceMeasurable(v: unknown): v is string {
  return typeof v === 'string' && (SLICE_MEASURABLE_PATHS as readonly string[]).includes(v);
}

/** The measurable descriptor of a path (undefined when outside the vocabulary). */
export function sliceMeasurableOf(path: string): Measurable | undefined {
  return SLICE_MEASURABLES.find((measurable) => measurable.path === path);
}

// ---------------------------------------------------------------------------
// The extraction (pure, total over the closed vocabulary)
// ---------------------------------------------------------------------------

/** Extract the L8 zero-cost-refusal law from the report. */
function refusalsCostZero(report: SliceReportMirror): boolean {
  return report.gateway.portCalls === report.gateway.routed;
}

/** Extract the L15 goal-binding law for the paper lane. */
function paperOutcomeGoalsBound(report: SliceReportMirror): boolean {
  return report.lineage.paperOutcomeIntents.every((binding) => binding.goalId === report.lineage.goalId);
}

/** Extract the L15 goal-binding law for the live lane. */
function liveAuditGoalsBound(report: SliceReportMirror): boolean {
  return report.lineage.liveAuditIntents.every((binding) => binding.goalId === report.lineage.goalId);
}

/** Extract the L16 clock-separation law. */
function orderClocksSeparated(report: SliceReportMirror): boolean {
  return report.lineage.orderDecisions.every((decision) => decision.orderClock >= decision.decisionAsOf);
}

/**
 * EXTRACT one measurable from a reference-slice report — the pure, total
 * function over the closed vocabulary. Every path in
 * {@link SLICE_MEASURABLES} extracts; anything else returns undefined (the
 * runner reports `unknown_measurable`, never a silent coercion).
 */
export function extractSliceMeasurable(report: SliceReportMirror, path: string): AxisValue | undefined {
  switch (path) {
    case 'marketData.binanceEvents':
      return { kind: 'count', value: report.marketData.binanceEvents };
    case 'marketData.newsEvents':
      return { kind: 'count', value: report.marketData.newsEvents };
    case 'marketData.framesSent':
      return { kind: 'count', value: report.marketData.framesSent };
    case 'director.lanesConsumed':
      return { kind: 'count', value: report.director.lanesConsumed };
    case 'strategy.intents':
      return { kind: 'count', value: report.strategy.intents };
    case 'strategy.refusals':
      return { kind: 'count', value: report.strategy.refusals };
    case 'strategy.step2Intents':
      return { kind: 'count', value: report.strategy.step2Intents };
    case 'gateway.routed':
      return { kind: 'count', value: report.gateway.routed };
    case 'gateway.refused':
      return { kind: 'count', value: report.gateway.refused };
    case 'gateway.portCalls':
      return { kind: 'count', value: report.gateway.portCalls };
    case 'gateway.auditRecords':
      return { kind: 'count', value: report.gateway.auditRecords };
    case 'executionBody.gatewayRequests':
      return { kind: 'count', value: report.executionBody.gatewayRequests };
    case 'shadow.worldFillCount':
      return { kind: 'count', value: report.shadow.worldFillCount };
    case 'outcomes.outcomes':
      return { kind: 'count', value: report.outcomes.outcomes };
    case 'outcomes.fills':
      return { kind: 'count', value: report.outcomes.fills };
    case 'outcomes.refusals':
      return { kind: 'count', value: report.outcomes.refusals };
    case 'outcomes.realizedPnl':
      return { kind: 'decimal', value: report.outcomes.book.realizedPnl };
    case 'outcomes.cash':
      return { kind: 'decimal', value: report.outcomes.book.cash };
    case 'report.digest':
      return { kind: 'digest', value: report.reportDigest };
    case 'outcomes.outcomeDigest':
      return { kind: 'digest', value: report.outcomes.outcomeDigest };
    case 'gateway.auditCoherent':
      return { kind: 'flag', value: report.gateway.auditCoherent };
    case 'gateway.refusalsCostZero':
      return { kind: 'flag', value: refusalsCostZero(report) };
    case 'lineage.paperOutcomeGoalsBound':
      return { kind: 'flag', value: paperOutcomeGoalsBound(report) };
    case 'lineage.liveAuditGoalsBound':
      return { kind: 'flag', value: liveAuditGoalsBound(report) };
    case 'lineage.orderClocksSeparated':
      return { kind: 'flag', value: orderClocksSeparated(report) };
    default:
      return undefined;
  }
}
