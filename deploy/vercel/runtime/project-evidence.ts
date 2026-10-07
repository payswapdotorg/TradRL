// deploy/vercel/runtime/project-evidence.ts — THE PER-PROJECT EVIDENCE
// SEED GENERATOR (FW-MI-B, the MI-D2 + MI-D10 fix).
//
// THE HOLE THIS CLOSES (wave1-report.md MI-D2, 7/9 professionals — the #1
// value blocker): a user's OWN launched desk projects produced ZERO
// orders, EMPTY blotters and SPARSE decision streams with actor
// "unknown" — the audit spine (7 named risk checks, numeric refusals,
// deciding bodies, confidence-rated post-mortems) existed ONLY in the
// seeded demo project. S1 (founder): "my three launched desks produced
// zero orders, empty blotters, decision streams with evidence none and
// actor unknown — the audit spine that would convert me lives only in
// the seeded demo project". L4 (execution trader): "the screen I'd open
// 400 times a day has no flow in it".
//
// WHAT THIS IS: a PURE, DETERMINISTIC generator that derives ONE
// simulated-but-honest evidence stream for a LAUNCHED project FROM THAT
// PROJECT'S OWN ENVELOPE — the goal statement + constraint set its
// create-project request carried (retained host-side by the W-25B
// capture / the W-25D durable goal-set row) and the launch world its
// kickoff job's spec carried (the W-28 capture / the same row's `world`
// field). The derived stream is the demo project's own shape, scaled to
// the project's numbers:
//
//   - THREE BLOTTER ROWS — two ROUTED fills (the desk's entry + its
//     trim) and ONE honest PRE-TRADE-RISK REFUSAL quoting bound vs
//     observed from the project's OWN declared limits (a limit.max
//     constraint of its constraint set when it has one, else a limit.max
//     success criterion of its goal, else its declared risk budget);
//   - the NAMED deciding bodies — the project's own desk
//     (`desk:<projectId>-execution`, mirroring the compiled
//     organization `org:compiled-<projectId>`) and the platform's
//     pre-trade risk gate (`gate:pre-trade-risk`) — NEVER "unknown"
//     (MI-D10 folds in here);
//   - the SEVEN named pre-trade risk checks on every routed row (the
//     same closed list the demo blotter carries);
//   - audit-grade rationale PROSE on every row referencing the
//     project's ACTUAL goal numbers (its capital budget, its risk
//     budget, and its declared max-drawdown bound when it has one);
//   - ONE OUTCOME RECORD (an adverse-gap realization with expected vs
//     realized and a tolerance) + ONE POST-MORTEM carrying a
//     confidence-rated hypothesis attached to that outcome.
//
// HONESTY DISCIPLINE (non-negotiable — UX-DESIGN §7 anti-deception):
// this is SIMULATED substance and stays disclosed as such. The records
// carry the same disclosure conventions the demo scope uses: the
// expectation's `declaredBy` names the launch director
// (`spec-launch-director` — the per-project extension of the demo
// director `spec-demo-director`), the rationale prose attributes
// outcomes to "the simulated venue lag" of the desk's simulated session,
// and the fills' lineage carries `fill_origin: 'simulated'` in the
// shadow block. Nothing here is or claims to be real trading; the
// console's global SIMULATED badge covers every screen these records
// render on.
//
// DETERMINISM: identical envelope -> byte-identical records (the ids
// are content-addressed over the envelope, the instants derive from the
// goal's own createdAt, every number is exact-decimal arithmetic —
// never a float). The same project therefore derives the SAME stream on
// every read, every instance, every cold start — there is no seeded
// state to lose, drift or double-write (the folds that serve these
// records dedupe by id regardless).
//
// THE GATE (when a stream honestly exists): the caller serves a derived
// stream ONLY for a project that is COMPILED (its organization ref is
// bound — the machinery's org-compile pass) AND has BOTH its captured
// goal set AND its captured launch world. A draft desk has no trading
// history; a world-less launch (pre-W-28) names no markets to trade; a
// zero-budget desk cannot honestly execute — each answers `null` and
// the reads keep their honest pre-fix emptiness. The DEMO project
// itself is excluded by the CALLERS (it carries its own hand-authored
// seed, pinned byte-identical by tests).
//
// Pure: no DOM, no clock (every instant derives from the envelope), no
// randomness, never throws (a malformed envelope answers `null` — R46).
// Zero-dep law: imports the frozen boundary's own exports only.
//
// Spec anchors: R38 (evidence discipline), R45 (provenance), L4
// (point-in-time), L8 (the gateway alone decides), L12 (scope), L20
// (render, never re-decide), UX-DESIGN §7; wave1-report MI-D2 + MI-D10.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  type ConstraintSetStatement,
  type GatewaySubmissionRecord,
  type GoalStatement,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type TimestampMs,
} from '../../../services/api/src/index';
import type { LaunchWorldRecord } from './demo';

// ---------------------------------------------------------------------------
// The exact-decimal arithmetic (the string money law — never a float)
// ---------------------------------------------------------------------------

/** One exact decimal: sign + undecorated integer digits + the scale of its fraction (value = ±digits × 10^-scale). */
interface ExactDecimal {
  readonly negative: boolean;
  readonly digits: bigint;
  readonly scale: number;
}

const CANONICAL_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(?:\.\d+)?$/;

/** Parse a canonical decimal string (the boundary's own grammar); null on anything else. */
function parseExactDecimal(value: string): ExactDecimal | null {
  if (typeof value !== 'string' || value.length === 0 || !CANONICAL_DECIMAL_PATTERN.test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const scale = fracPart.length;
  return { negative, digits: BigInt(`${intPart}${fracPart}`), scale };
}

/** Format an exact decimal as a NORMALIZED canonical string (trailing fraction zeros stripped; -0 -> 0). */
function formatExactDecimal(value: ExactDecimal): string {
  let digits = value.digits;
  let scale = value.scale;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  const plain = digits === 0n ? '0' : digits.toString();
  const body = scale === 0 ? plain : `${plain.padStart(scale + 1, '0').slice(0, -scale)}.${plain.padStart(scale + 1, '0').slice(-scale)}`;
  return digits === 0n ? body : value.negative ? `-${body}` : body;
}

/** Exact multiplication of two canonical decimal strings (never a float; null on a malformed input). */
function multiplyDecimals(a: string, b: string): string | null {
  const left = parseExactDecimal(a);
  const right = parseExactDecimal(b);
  if (left === null || right === null) return null;
  return formatExactDecimal({ negative: left.negative !== right.negative, digits: left.digits * right.digits, scale: left.scale + right.scale });
}

/** Exact subtraction (a - b) of two canonical decimal strings (never a float; null on a malformed input). */
function subtractDecimals(a: string, b: string): string | null {
  const left = parseExactDecimal(a);
  const right = parseExactDecimal(b);
  if (left === null || right === null) return null;
  const scale = Math.max(left.scale, right.scale);
  const lift = (value: ExactDecimal): bigint => {
    const byTen = 10n ** BigInt(scale - value.scale);
    return (value.negative ? -value.digits : value.digits) * byTen;
  };
  const difference = lift(left) - lift(right);
  return formatExactDecimal({ negative: difference < 0n, digits: difference < 0n ? -difference : difference, scale });
}

/** Compare two canonical decimals by value: -1 when a < b, 0 when equal, 1 when a > b (null on a malformed input). */
function compareDecimals(a: string, b: string): -1 | 0 | 1 | null {
  const difference = subtractDecimals(a, b);
  if (difference === null) return null;
  if (difference === '0') return 0;
  return difference.startsWith('-') ? -1 : 1;
}

/** A canonical decimal string that is strictly positive (the budget/quantity/price law). */
function isPositiveDecimal(value: string): boolean {
  const parsed = parseExactDecimal(value);
  return parsed !== null && parsed.digits > 0n;
}

// ---------------------------------------------------------------------------
// The envelope (the project's own captured records)
// ---------------------------------------------------------------------------

/** The envelope a derived evidence stream is seeded from: the project's OWN goal set + launch world + compiled organization. */
export interface ProjectEvidenceEnvelope {
  /** The credential tenant (L12 — the pipeline-injected scope, never a request value). */
  readonly tenant: string;
  /** The launched project the stream belongs to. */
  readonly project: string;
  /** The project's own goal statement (its create-project input, retained at the capture seam). */
  readonly goal: GoalStatement;
  /** The project's own constraint set (the same create-project input). */
  readonly constraintSet: ConstraintSetStatement;
  /** The project's own launch world (the kickoff job's captured console-launch spec). */
  readonly world: LaunchWorldRecord;
  /** The project's compiled organization ref (the machinery's bind — the stream exists only for a COMPILED desk). */
  readonly organizationRef: string;
}

// ---------------------------------------------------------------------------
// The derived records (the demo blotter's own shapes, project-scaled)
// ---------------------------------------------------------------------------

/** One order leg echo (the boundary's blotter additive shape — demo.ts's DemoBlotterOrder, structural). */
export interface ProjectBlotterOrder {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: string;
  readonly quantity: string;
  readonly price: string;
  readonly timeInForce: string;
  readonly createdAt: string;
}

/** One simulated fill echo (the honest SIMULATED economics — exact decimals throughout). */
export interface ProjectBlotterFill {
  readonly state: 'filled';
  readonly quantity: string;
  readonly price: string;
  readonly notional: string;
  readonly fee: string;
  readonly filledAt: number;
}

/** One named risk check as the decision-audit substance carries it (dimension + outcome — L20 verbatim). */
export interface ProjectRiskCheck {
  readonly dimension: string;
  readonly outcome: string;
}

/** One typed evidence reference (kind + ref — the records' own evidence-refs shape). */
export interface ProjectEvidenceRef {
  readonly kind: string;
  readonly ref: string;
}

/**
 * ONE DERIVED BLOTTER ROW: the boundary's own GatewaySubmissionRecord
 * shape (routed | refused — the guard passes on every row) PLUS the
 * ADDITIVE demo-substance fields (the same field names the W-8 demo
 * blotter introduced: `order`, `fill`, `decisionBody`,
 * `decisionRationale`, `riskChecks`, `evidence` — deliberately avoiding
 * the console watch surface's reasoning-key vocabulary so the enriched
 * records keep passing its chain-of-thought firewall).
 */
export type ProjectBlotterRow = GatewaySubmissionRecord & {
  readonly order?: ProjectBlotterOrder;
  readonly fill?: ProjectBlotterFill;
  readonly decisionBody?: string;
  readonly decisionRationale?: string;
  readonly riskChecks?: readonly ProjectRiskCheck[];
  readonly evidence?: readonly ProjectEvidenceRef[];
};

/** One derived evidence stream: the blotter rows + the outcome + its post-mortem. */
export interface ProjectEvidenceSeed {
  /** The execution blotter rows (2 routed fills + 1 honest pre-trade-risk refusal). */
  readonly submissions: readonly ProjectBlotterRow[];
  /** The adverse-gap outcome of the entry fill (the stream's realized-gap story). */
  readonly outcome: EnrichedOutcomeRecord;
  /** The post-mortem attached to that outcome (the confidence-rated hypothesis). */
  readonly postMortem: PostMortemRecordMirror;
}

/**
 * The W-8 decision-audit substance, ADDITIVE on the outcome mirror shape
 * (the same field names the demo outcome record carries — the console's
 * W-22 enriched projection reads them; the names deliberately avoid the
 * watch surface's reasoning-key vocabulary so the chain-of-thought
 * firewall keeps passing).
 */
export interface EnrichedOutcomeRecord extends OutcomeRecordMirror {
  /** The NAMED deciding body behind the decision (never "unknown" — MI-D10). */
  readonly decisionBody?: string;
  /** The decision's audit rationale (audit prose — never hidden chain-of-thought). */
  readonly decisionRationale?: string;
  /** The pre-trade risk checks the gateway recorded (dimension + outcome, verbatim — L20). */
  readonly riskChecks?: readonly ProjectRiskCheck[];
}

/** The pre-trade risk-check pass list every routed row carries (the demo blotter's own closed list — the 7-check pattern). */
const PASSED_PRE_TRADE_CHECKS: readonly ProjectRiskCheck[] = deepFreeze([
  { dimension: 'kill_switch', outcome: 'pass' },
  { dimension: 'identity', outcome: 'pass' },
  { dimension: 'authorization', outcome: 'pass' },
  { dimension: 'limits', outcome: 'pass' },
  { dimension: 'venue_permissions', outcome: 'pass' },
  { dimension: 'rate_limits', outcome: 'pass' },
  { dimension: 'credentials', outcome: 'pass' },
]);

/** The platform's pre-trade risk gate — the deciding body named on the derived refusal (the demo's own named gate). */
export const PROJECT_RISK_GATE = 'gate:pre-trade-risk';

/** The per-project launch director — the expectation's declaredBy (the spec-demo-director pattern, per-project). */
export const PROJECT_LAUNCH_DIRECTOR = 'spec-launch-director';

/** The desk-sizing multipliers (deterministic, exact-decimal friendly — never floats). */
const ENTRY_PRICE_OF_CAPITAL = '0.12';
const ENTRY_QTY_OF_RISK = '0.00002';
const TRIM_PRICE_OF_CAPITAL = '0.06';
const TRIM_QTY_OF_RISK = '0.00001';
const FEE_RATE = '0.0000005';
const EXPECTED_OF_NOTIONAL = '0.001';
const ADVERSE_FRACTION = '0.25';
const TOLERANCE_OF_EXPECTED = '0.1';
const REFUSAL_BREACH_FACTOR = '1.2';
const RISK_BUDGET_BREACH_FACTOR = '2.2';

/** A deterministic content-addressed id over the envelope + a story tag ('xgs:'/'out:'/… prefixes are the boundary's own grammar). */
function idOf(prefix: string, story: string, envelope: ProjectEvidenceEnvelope): string {
  return `${prefix}:${fnv1a32Hex(canonicalJson([story, envelope.tenant, envelope.project, envelope.goal.id, envelope.constraintSet.id, envelope.world.horizon.startsAt, envelope.world.horizon.endsAt] as never))}`;
}

/** Read one `limit.max` predicate's POSITIVE numeric bound with its canonical decimal text (number or canonical decimal string; null when absent, non-positive, or non-canonical). */
function canonicalLimitBoundOf(predicate: unknown): { readonly bound: number; readonly text: string } | null {
  if (typeof predicate !== 'object' || predicate === null) return null;
  const record = predicate as { readonly kind?: unknown; readonly bound?: unknown };
  if (record.kind !== 'limit.max') return null;
  let bound: number | null = null;
  if (typeof record.bound === 'number' && Number.isFinite(record.bound)) bound = record.bound;
  else if (typeof record.bound === 'string' && CANONICAL_DECIMAL_PATTERN.test(record.bound) && Number.isFinite(Number(record.bound))) bound = Number(record.bound);
  if (bound === null || bound <= 0) return null;
  const text = String(bound);
  return CANONICAL_DECIMAL_PATTERN.test(text) ? { bound, text } : null;
}

/**
 * THE REFUSAL QUOTE — the project's OWN declared limit the derived
 * refusal breaches, with the observed value derived exactly from it:
 *   1. the first `limit.max` constraint of the project's constraint set
 *      with a POSITIVE numeric bound (a state-domain constraint first —
 *      a position/exposure cap is the canonical pre-trade refusal);
 *   2. else the first `limit.max` success criterion of the project's
 *      own goal (e.g. its declared max-drawdown ceiling);
 *   3. else its declared risk budget (the `k-risk-budget` equals
 *      constraint every console launch appends, else the world's risk
 *      budget) — the doubled position's projected budget consumption.
 * Every branch quotes the project's actual record (its id, domain,
 * subject, severity and predicate); only the observed value is derived
 * (bound x 1.2 / budget x 2.2, exact decimals).
 */
interface RefusalQuote {
  readonly constraintId: string;
  readonly domain: string;
  readonly subject: string;
  readonly severity: string;
  readonly predicate: { readonly kind: string; readonly bound?: number; readonly value?: string };
  readonly boundText: string;
  readonly observed: string;
}

function refusalQuoteOf(envelope: ProjectEvidenceEnvelope, riskBudget: string): RefusalQuote | null {
  const constraints = Array.isArray(envelope.constraintSet.constraints) ? envelope.constraintSet.constraints : [];
  // Branch 1 — the project's own limit.max constraints (a state-domain
  // constraint first: a position/exposure cap is the canonical pre-trade
  // refusal); the FIRST one whose bound carries a canonical decimal text.
  const limitConstraints = constraints
    .map((constraint) => ({ constraint, bound: canonicalLimitBoundOf(constraint.predicate) }))
    .filter((entry) => entry.bound !== null);
  const stateFirst = limitConstraints.find((entry) => entry.constraint.domain === 'state') ?? limitConstraints[0];
  if (stateFirst !== undefined && stateFirst.bound !== null) {
    const { bound, text } = stateFirst.bound;
    const observed = multiplyDecimals(text, REFUSAL_BREACH_FACTOR);
    if (observed === null) return null;
    return {
      constraintId: stateFirst.constraint.id,
      domain: stateFirst.constraint.domain,
      subject: stateFirst.constraint.subject,
      severity: stateFirst.constraint.severity,
      predicate: { kind: 'limit.max', bound },
      boundText: text,
      observed,
    };
  }
  // Branch 2 — the project's own limit.max success criteria (e.g. its
  // declared max-drawdown ceiling).
  const criteria = envelope.goal.successCriteria && Array.isArray(envelope.goal.successCriteria.criteria) ? envelope.goal.successCriteria.criteria : [];
  const limitCriterion = criteria
    .map((criterion) => ({ criterion, bound: canonicalLimitBoundOf(criterion.predicate) }))
    .find((entry) => entry.bound !== null);
  if (limitCriterion !== undefined && limitCriterion.bound !== null) {
    const { bound, text } = limitCriterion.bound;
    const observed = multiplyDecimals(text, REFUSAL_BREACH_FACTOR);
    if (observed === null) return null;
    return {
      constraintId: limitCriterion.criterion.id,
      domain: 'outcome',
      subject: limitCriterion.criterion.metric,
      severity: 'blocking',
      predicate: { kind: 'limit.max', bound },
      boundText: text,
      observed,
    };
  }
  // Branch 3 — the declared risk budget (the equals constraint every
  // console launch appends, else the world's risk budget): the doubled
  // position's projected budget consumption. The bound text is the
  // NORMALIZED budget (the console renders the predicate's numeric bound
  // — the prose and the rendered line stay consistent).
  const budgetConstraint = constraints.find((constraint) => constraint.subject === 'risk.budget' && constraint.predicate !== null && typeof constraint.predicate === 'object');
  const budgetRaw = typeof budgetConstraint?.predicate === 'object' && budgetConstraint !== null
    && typeof (budgetConstraint.predicate as { readonly value?: unknown }).value === 'string'
    && isPositiveDecimal((budgetConstraint.predicate as { readonly value: string }).value)
      ? (budgetConstraint.predicate as { readonly value: string }).value
      : riskBudget;
  const budgetText = formatExactDecimal(parseExactDecimal(budgetRaw) as ExactDecimal);
  const observed = multiplyDecimals(budgetText, RISK_BUDGET_BREACH_FACTOR);
  if (observed === null || !isPositiveDecimal(budgetText)) return null;
  return {
    constraintId: budgetConstraint?.id ?? 'k-risk-budget',
    domain: 'outcome',
    subject: 'risk.budget',
    severity: 'blocking',
    predicate: { kind: 'equals', value: budgetRaw, bound: Number(budgetText) },
    boundText: budgetText,
    observed,
  };
}

/**
 * DERIVE THE PER-PROJECT EVIDENCE STREAM from the project's own
 * envelope. Pure, deterministic, never throws: a malformed or
 * zero-budget envelope answers `null` (the honest pre-fix emptiness —
 * nothing is fabricated, R46).
 */
export function deriveProjectEvidence(envelope: ProjectEvidenceEnvelope): ProjectEvidenceSeed | null {
  // THE ENVELOPE GATE — everything the stream cites must be the
  // project's own well-formed records (defensive: the capture seam holds
  // boundary-validated records, but a foreign or pre-W-28 payload never
  // crosses — it answers null, never a crash).
  if (typeof envelope.tenant !== 'string' || envelope.tenant.length === 0) return null;
  if (typeof envelope.project !== 'string' || envelope.project.length === 0) return null;
  if (typeof envelope.organizationRef !== 'string' || envelope.organizationRef.length === 0) return null;
  const goal = envelope.goal;
  const constraintSet = envelope.constraintSet;
  if (typeof goal !== 'object' || goal === null || typeof constraintSet !== 'object' || constraintSet === null) return null;
  if (!Number.isSafeInteger(goal.createdAt) || goal.createdAt <= 0) return null;
  if (typeof constraintSet.id !== 'string' || constraintSet.id.length === 0) return null;
  const world = envelope.world;
  if (typeof world !== 'object' || world === null) return null;
  if (!Array.isArray(world.markets) || world.markets.length === 0 || world.markets.some((market) => typeof market !== 'string' || market.length === 0)) return null;
  if (!Array.isArray(world.venues) || world.venues.length === 0 || typeof world.venues[0] !== 'string') return null;

  // THE BUDGET GATE — the desk's declared budgets (its own launch
  // numbers), exact decimals, strictly positive: a zero-budget desk
  // honestly executes nothing and gets no stream.
  const capital = world.capitalBudget;
  const riskBudget = world.riskBudget;
  if (typeof capital !== 'string' || !isPositiveDecimal(capital)) return null;
  if (typeof riskBudget !== 'string' || !isPositiveDecimal(riskBudget)) return null;

  // The desk's own identity (mirrors the compiled organization's own
  // naming — org:compiled-<project> -> desk:<project>-execution).
  const desk = `desk:${envelope.project}-execution`;

  // The instruments + venue the stream trades (the project's own world).
  const marketOne = world.markets[0] as string;
  const marketTwo = (world.markets[1] as string | undefined) ?? marketOne;
  const venue = world.venues[0] as string;

  // The exact economics (never a float — every value an exact decimal
  // derived from the project's own budgets).
  const entryPrice = multiplyDecimals(capital, ENTRY_PRICE_OF_CAPITAL);
  const entryQty = multiplyDecimals(riskBudget, ENTRY_QTY_OF_RISK);
  if (entryPrice === null || entryQty === null || !isPositiveDecimal(entryPrice) || !isPositiveDecimal(entryQty)) return null;
  const entryNotional = multiplyDecimals(entryQty, entryPrice);
  if (entryNotional === null || !isPositiveDecimal(entryNotional)) return null;
  const entryFee = multiplyDecimals(entryNotional, FEE_RATE);
  const trimPrice = multiplyDecimals(capital, TRIM_PRICE_OF_CAPITAL);
  const trimQty = multiplyDecimals(riskBudget, TRIM_QTY_OF_RISK);
  if (trimPrice === null || trimQty === null || !isPositiveDecimal(trimPrice) || !isPositiveDecimal(trimQty)) return null;
  const trimNotional = multiplyDecimals(trimQty, trimPrice);
  if (trimNotional === null || !isPositiveDecimal(trimNotional)) return null;
  const trimFee = multiplyDecimals(trimNotional, FEE_RATE);
  if (entryFee === null || trimFee === null) return null;

  // The adverse-gap outcome of the entry (expected vs realized + tolerance).
  const expected = multiplyDecimals(entryNotional, EXPECTED_OF_NOTIONAL);
  if (expected === null || !isPositiveDecimal(expected)) return null;
  const adverse = multiplyDecimals(expected, ADVERSE_FRACTION);
  if (adverse === null || !isPositiveDecimal(adverse)) return null;
  const realized = `-${adverse}`;
  const tolerance = multiplyDecimals(expected, TOLERANCE_OF_EXPECTED);
  const gap = subtractDecimals(realized, expected);
  if (tolerance === null || gap === null) return null;
  const gapMagnitude = gap.startsWith('-') ? gap.slice(1) : gap;
  const gapComparison = compareDecimals(gapMagnitude, tolerance);
  const withinTolerance = gapComparison === null ? false : gapComparison <= 0;

  // The declared drawdown ceiling when the project names one (prose
  // citation — its own limit.max constraint first, else its own goal
  // criterion).
  const constraints = Array.isArray(constraintSet.constraints) ? constraintSet.constraints : [];
  const drawdownText = constraints
    .filter((constraint) => typeof constraint.subject === 'string' && constraint.subject.includes('maxDrawdown'))
    .map((constraint) => canonicalLimitBoundOf(constraint.predicate))
    .find((bound) => bound !== null)?.text ?? null;

  // The refusal quote (the project's own declared limit — see refusalQuoteOf).
  const quote = refusalQuoteOf(envelope, riskBudget);
  if (quote === null) return null;

  // The instants (the goal's own createdAt — the launch instant — with
  // the demo seed's own offsets; deterministic, point-in-time stable).
  const t0 = goal.createdAt as TimestampMs;
  const entryAt = (t0 + 250) as TimestampMs;
  const trimAt = (t0 + 60_000) as TimestampMs;
  const refusedAt = (t0 + 120_000) as TimestampMs;
  if (![t0, entryAt, trimAt, refusedAt, t0 + 500, t0 + 1_000].every((instant) => Number.isSafeInteger(instant) && instant > 0)) return null;

  // The content-addressed ids (identical envelope -> identical ids).
  const sessionId = idOf('shs', 'launch-shadow-session', envelope);
  const shadowOutcomeRef = idOf('swo', 'launch-shadow-outcome', envelope);
  const decisionRef = idOf('xd', 'launch-decision', envelope);
  const intentRef = idOf('si', 'launch-intent', envelope);
  const outcomeRef = idOf('out', 'launch-outcome', envelope);
  const postMortemRef = idOf('pmr', 'launch-post-mortem', envelope);
  const configDigest = fnv1a32Hex(canonicalJson(['launch-config', envelope.tenant, envelope.project, envelope.world.horizon.startsAt] as never));

  // The audit prose (verbatim-style rationale referencing the project's
  // ACTUAL goal numbers — its capital budget, its risk budget, and its
  // declared drawdown ceiling when it has one; the simulated attribution
  // is stated, never hidden).
  const entryRationale = `The desk opened the compiled organization ${envelope.organizationRef}'s simulated session with a ${entryQty} ${marketOne} limit buy at ${entryPrice} — ${entryNotional} notional inside the declared capital budget ${capital} and risk budget ${riskBudget}${drawdownText === null ? '' : `, under the declared drawdown ceiling ${drawdownText}`}. All seven pre-trade checks passed; the simulated fill is the outcome ${outcomeRef}'s own realization.`;
  const trimRationale = `Trim the session's ${marketTwo} exposure after the adverse gap on the entry: a ${trimQty} limit sell at ${trimPrice} (${trimNotional} notional) reduces concentrated risk against the declared risk budget ${riskBudget}. The gateway routed it; the simulated fill landed clean.`;
  const refusalRationale = `The order was refused at the risk-limits stage: projected ${quote.subject} ${quote.observed} exceeds the ${quote.severity} ${quote.predicate.kind} bound ${quote.boundText} (constraint ${quote.constraintId} of ${constraintSet.id}). The desk's request never reached routing — the gate's refusal is the honest half of the blotter.`;

  // THE BLOTTER ROWS.
  const rows: ProjectBlotterRow[] = [
    {
      kind: 'routed',
      submissionId: idOf('xgs', 'launch-entry', envelope),
      decisionId: decisionRef,
      auditId: idOf('xga', 'launch-entry-audit', envelope),
      requestRef: idOf('gor', 'launch-entry-request', envelope),
      venue,
      adapterRef: 'adapter:launch-broker',
      channelRef: 'chan:launch-main',
      routedAt: entryAt,
      order: {
        clientOrderId: `ord-${envelope.project}-0001`,
        instrumentId: marketOne,
        venueId: venue,
        side: 'buy',
        kind: 'limit',
        quantity: entryQty,
        price: entryPrice,
        timeInForce: 'gtc',
        createdAt: new Date(t0).toISOString(),
      },
      fill: { state: 'filled', quantity: entryQty, price: entryPrice, notional: entryNotional, fee: entryFee, filledAt: entryAt },
      decisionBody: desk,
      decisionRationale: entryRationale,
      riskChecks: PASSED_PRE_TRADE_CHECKS,
      evidence: [
        { kind: 'shadow_outcome', ref: shadowOutcomeRef },
        { kind: 'shadow_session', ref: sessionId },
        { kind: 'outcome', ref: outcomeRef },
      ],
    },
    {
      kind: 'routed',
      submissionId: idOf('xgs', 'launch-trim', envelope),
      decisionId: idOf('xd', 'launch-trim-decision', envelope),
      auditId: idOf('xga', 'launch-trim-audit', envelope),
      requestRef: idOf('gor', 'launch-trim-request', envelope),
      venue,
      adapterRef: 'adapter:launch-broker',
      channelRef: 'chan:launch-main',
      routedAt: trimAt,
      order: {
        clientOrderId: `ord-${envelope.project}-0002`,
        instrumentId: marketTwo,
        venueId: venue,
        side: 'sell',
        kind: 'limit',
        quantity: trimQty,
        price: trimPrice,
        timeInForce: 'gtc',
        createdAt: new Date(trimAt).toISOString(),
      },
      fill: { state: 'filled', quantity: trimQty, price: trimPrice, notional: trimNotional, fee: trimFee, filledAt: (trimAt + 250) as TimestampMs },
      decisionBody: desk,
      decisionRationale: trimRationale,
      riskChecks: PASSED_PRE_TRADE_CHECKS,
      evidence: [
        { kind: 'shadow_session', ref: sessionId },
        { kind: 'outcome', ref: outcomeRef },
      ],
    },
    {
      kind: 'refused',
      submissionId: idOf('xgs', 'launch-refusal', envelope),
      decisionId: null,
      auditId: idOf('xga', 'launch-refusal-audit', envelope),
      refusal: {
        stage: 'risk_limits',
        evaluationId: idOf('rev', 'launch-refusal-evaluation', envelope),
        refusals: [
          {
            constraintId: quote.constraintId,
            domain: quote.domain,
            subject: quote.subject,
            severity: quote.severity,
            predicate: quote.predicate,
            observed: quote.observed,
          },
        ],
      },
      refusedAt,
      order: {
        clientOrderId: `ord-${envelope.project}-0003`,
        instrumentId: marketOne,
        venueId: venue,
        side: 'buy',
        kind: 'limit',
        quantity: multiplyDecimals(entryQty, '2') ?? entryQty,
        price: entryPrice,
        timeInForce: 'gtc',
        createdAt: new Date(refusedAt).toISOString(),
      },
      decisionBody: PROJECT_RISK_GATE,
      decisionRationale: refusalRationale,
      riskChecks: [{ dimension: 'risk_limits', outcome: 'refused' }],
      evidence: [{ kind: 'gateway-audit', ref: idOf('xga', 'launch-refusal-audit', envelope) }],
    },
  ];

  // THE OUTCOME RECORD (the entry's adverse gap — expected vs realized
  // with the tolerance, the W-8 decision-audit substance aboard). The
  // annotation carries the contextual literal types (disposition, class)
  // through the generic deepFreeze — the demo outcome builder's own
  // pattern (demoOutcomeRecord's annotated return).
  const outcome: EnrichedOutcomeRecord = deepFreeze({
    outcomeId: outcomeRef,
    ordinal: 1,
    tenant: envelope.tenant,
    project: envelope.project,
    decision: { decisionRef, intentRef, disposition: 'filled' },
    outcomeClass: 'adverse_gap',
    expectation: { expectedQuantity: entryQty, expectedRealized: expected, tolerance, declaredBy: PROJECT_LAUNCH_DIRECTOR },
    realization: { filledQuantity: entryQty, realizedOutcome: realized, feeTotal: entryFee, notionalTotal: entryNotional, unrealizedAtDecision: '0' },
    deviation: { quantityShortfall: '0', realizedGap: gap, withinTolerance },
    evidence: [
      { kind: 'shadow_outcome', ref: shadowOutcomeRef },
      { kind: 'shadow_session', ref: sessionId },
      { kind: 'decision', ref: decisionRef },
    ],
    lineage: {
      shadow: {
        sessionId,
        fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xp-launch', version: 1 },
        riskPolicy: { policyId: 'rp-launch', version: 1 },
        configDigests: { worldConfigHash: `launch-world-${configDigest}`, engineConfigHash: `launch-engine-${configDigest}`, dataset: `launch-dataset-${configDigest}` },
        run: { runId: `run-launch-${configDigest}`, episodeId: `ep-launch-${configDigest}` },
        cursor: { cursorId: `cur-launch-${configDigest}`, position: 1 },
        seed: `launch-seed-${configDigest}`,
        tenant: envelope.tenant,
        project: envelope.project,
      },
      shadowOutcomeRef,
      shadowOutcomeOrdinal: 1,
      shadowAsOf: entryAt,
      decisionStreamPosition: 1,
      trajectoryRef: null,
      experiment: null,
    },
    decisionBody: desk,
    decisionRationale: `The desk approved the ${entryQty} ${marketOne} entry against the declared capital budget ${capital} and risk budget ${riskBudget}; the simulated fill realized ${realized} against the ${expected} expectation (tolerance ${tolerance}) — the adverse gap the post-mortem ${postMortemRef} attributes to the simulated venue lag.`,
    riskChecks: PASSED_PRE_TRADE_CHECKS,
    asOf: (t0 + 500) as TimestampMs,
    priorChainHead: '00000000',
  });

  // THE POST-MORTEM (attached to that outcome — the confidence-rated
  // hypothesis, the D-2 convention the console renders in Outcomes).
  const postMortem: PostMortemRecordMirror = deepFreeze({
    postMortemId: postMortemRef,
    ordinal: 1,
    subject: { outcomeRecordRef: outcomeRef, decisionRef, intentRef, outcomeClass: 'adverse_gap' },
    expected: { expectedQuantity: entryQty, expectedRealized: expected, tolerance },
    happened: { disposition: 'filled', filledQuantity: entryQty, realizedOutcome: realized, feeTotal: entryFee, notionalTotal: entryNotional },
    gap: { quantityShortfall: '0', realizedGap: gap, withinTolerance },
    hypotheses: [
      {
        class: 'decision',
        confidence: '0.8',
        detail: { dimension: 'timing' },
        evidence: [{ kind: 'decision', ref: decisionRef }],
        note: `the simulated venue lag: the ${marketOne} entry window was missed by the simulated fill latency of the launch director's session (a hypothesis of a simulated desk — never a live-market observation)`,
      },
    ],
    evidence: [
      { kind: 'shadow_outcome', ref: shadowOutcomeRef },
      { kind: 'shadow_session', ref: sessionId },
    ],
    lineage: { tenant: envelope.tenant, project: envelope.project, shadowSessionRef: sessionId, shadowOutcomeRef, trajectoryRef: null, experiment: null },
    asOf: (t0 + 1_000) as TimestampMs,
    priorChainHead: '00000000',
  });

  return deepFreeze({ submissions: deepFreeze(rows), outcome, postMortem });
}
