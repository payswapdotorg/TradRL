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
//     early trim) and ONE honest PRE-TRADE-RISK REFUSAL. Since FW-36-A
//     (Round E register E-2) the refusal is DERIVED FROM THE USER'S OWN
//     DECLARED CONSTRAINTS with reconcilable cumulative arithmetic — see
//     THE HONEST GATE below;
//   - the NAMED deciding bodies — the project's own desk
//     (`desk:<projectId>-execution`, mirroring the compiled
//     organization `org:compiled-<projectId>`) and the platform's
//     pre-trade risk gate (`gate:pre-trade-risk`) — NEVER "unknown"
//     (MI-D10 folds in here);
//   - the SEVEN named pre-trade risk checks on every routed row (the
//     same closed list the demo blotter carries) — with the `limits`
//     check COMPUTED since FW-36-A (never a fixed stamp);
//   - audit-grade rationale PROSE on every row referencing the
//     project's ACTUAL goal numbers (its capital budget, its risk
//     budget, and its declared max-drawdown bound when it has one) —
//     with every budget relation COMPUTED before it is asserted
//     (FW-36-A: the "inside the declared capital budget" sentence is
//     emitted only when the projected book is inside the bound);
//   - ONE OUTCOME RECORD (an adverse-gap realization with expected vs
//     realized and a tolerance) + ONE POST-MORTEM carrying a
//     confidence-rated hypothesis attached to that outcome.
//
// THE HONEST GATE (FW-36-A, Round E register E-2 — the "manufactured
// evidence" class): before FW-36-A the derived stream STAMPED
// `limits: pass` on every fill regardless of the mandate's declared
// caps (Round E watched fills land at 1.92x..180x the declared bound
// with the pass stamp), and the one refusal quoted an OBSERVED value
// fabricated from the bound itself (bound x 1.2 — reconciling to
// neither the order line nor the cumulative book: M2's "observed
// 300000000" over an order line of 3B and a book of 1.875B). The gate
// now evaluates EVERY declared constraint of the project's own
// constraint set at EACH candidate order, WHERE DERIVABLE from data the
// composition itself holds:
//   - notional/budget subjects (book.notional, capital.budget, generic
//     notional) — the PROJECTED BOOK: prior cumulative notional + the
//     candidate's own notional (exact decimals, itemized on the record
//     so the arithmetic reconciles by inspection);
//   - per-order notional subjects (order.notional, trade.notional) —
//     the candidate order's OWN notional;
//   - realized-cumulative subjects (risk.budget, risk.maxDrawdown) —
//     the session outcome chain's realized cumulative, WHERE THE
//     CHAIN PROVIDES ONE at the gate instant (L4: before the session's
//     outcome realizes, these are honestly NOT GATE-EVALUABLE — never
//     silently passed);
//   - every other subject (position/exposure/turnover/returns/costs —
//     no such store exists on any backing) — honestly NOT
//     GATE-EVALUABLE, reported on the record's `limitsEvaluation`
//     surface with the teaching note (what IS gate-evaluable today, and
//     the accepted constraint domains).
// `limits` is stamped `pass` ONLY on true passes; a blocking breach
// REFUSES the row with the TRUE observed value (itemized: prior
// cumulative + candidate = projected); the desk SIZES ITS OWN ORDERS
// inside the mandate's declared caps (the entry at <= 50% of the
// tightest declared notional/budget bound, the entry+trim book at
// <= 75%), and its concentration attempt — an order for the mandate's
// FULL declared capacity — is the honest demonstration of the gate
// binding against the project's OWN declared constraint. A mandate so
// tight that no positive order fits inside it honestly executes
// NOTHING: the envelope gate answers `null` (the same law as the
// zero-budget desk).
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
// (render, never re-decide), UX-DESIGN §7; wave1-report MI-D2 + MI-D10;
// phase2-roundE-report §3 E-2 + §6.2 (FW-36-A).

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

/** Exact addition (a + b) of two canonical decimal strings (never a float; null on a malformed input). */
function addDecimals(a: string, b: string): string | null {
  const left = parseExactDecimal(a);
  const right = parseExactDecimal(b);
  if (left === null || right === null) return null;
  const scale = Math.max(left.scale, right.scale);
  const lift = (value: ExactDecimal): bigint => {
    const byTen = 10n ** BigInt(scale - value.scale);
    return (value.negative ? -value.digits : value.digits) * byTen;
  };
  const sum = lift(left) + lift(right);
  return formatExactDecimal({ negative: sum < 0n, digits: sum < 0n ? -sum : sum, scale });
}

/** The SIZING DIVISION (FW-36-A): the largest canonical decimal with AT MOST 6 fraction digits that is <= a / b, for a >= 0 and b > 0 (never a float, never a non-terminating decimal; null when malformed or the inputs are not both non-negative/positive as required). */
function divideDecimalsFloor(a: string, b: string): string | null {
  const left = parseExactDecimal(a);
  const right = parseExactDecimal(b);
  if (left === null || right === null) return null;
  if (left.negative || right.negative) return null;
  if (right.digits === 0n) return null;
  const scale = Math.max(left.scale, right.scale);
  const leftLifted = left.digits * 10n ** BigInt(scale - left.scale);
  const rightLifted = right.digits * 10n ** BigInt(scale - right.scale);
  const quotient = (leftLifted * 1_000_000n) / rightLifted;
  return formatExactDecimal({ negative: false, digits: quotient, scale: 6 });
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
 * ONE DECLARED CONSTRAINT'S GATE EVALUATION at one candidate order
 * (FW-36-A, Round E register E-2 — the truth surface). Every verdict
 * carries its own arithmetic (`arithmetic`) so bound-vs-observed
 * reconciles BY INSPECTION; a constraint the gate cannot evaluate is
 * reported `not_gate_evaluable` with the teaching note — NEVER silently
 * passed.
 */
export interface LimitsCheckEvaluation {
  /** The declared constraint's own id (traceable to the mandate's constraint set). */
  readonly constraintId: string;
  /** The declared domain (observation | state | action | outcome — cited verbatim). */
  readonly domain: string;
  /** The declared subject (cited verbatim). */
  readonly subject: string;
  /** The declared severity (cited verbatim). */
  readonly severity: string;
  /** The declared predicate (cited verbatim — kind + bound/value). */
  readonly predicate: { readonly kind: string; readonly bound?: number; readonly value?: string };
  /** The observation class the gate derived the verdict from (none when not derivable). */
  readonly basis: 'projected_book_notional' | 'order_notional' | 'realized_cumulative' | 'none';
  /** True when the gate derived a verdict; false when the constraint is honestly not gate-evaluable. */
  readonly derivable: boolean;
  /** The TRUE observed value the verdict compared (null when not derivable — never a fabricated number). */
  readonly observed: string | null;
  /** The itemized arithmetic behind the observed value (reconciles by inspection). */
  readonly arithmetic: string | null;
  /** The verdict: pass only on a true pass; breach on a true breach; not_gate_evaluable when the gate cannot derive one. */
  readonly verdict: 'pass' | 'breach' | 'not_gate_evaluable';
  /** The honest teaching: WHY a verdict is not derivable, and what IS gate-evaluable today. */
  readonly note: string;
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
  /** THE GATE'S OWN EVALUATION of every declared constraint at THIS candidate order (FW-36-A — the truth surface; additive). */
  readonly limitsEvaluation?: readonly LimitsCheckEvaluation[];
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
  /** The gate's own evaluation of every declared constraint at the decision's order (FW-36-A — additive). */
  readonly limitsEvaluation?: readonly LimitsCheckEvaluation[];
}

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
/**
 * FW-36-A (E-2): the desk's SIZING SPACES inside the mandate's own
 * declared caps — the entry at <= ENTRY_SPACE_OF_BOUND of the tightest
 * declared notional/budget bound, the entry+trim book at <=
 * BOOK_SPACE_OF_BOUND, so every routed fill's `limits: pass` stamp is
 * TRUE (the pre-fix stream stamped pass over fills at up to 180x the
 * declared bound).
 */
const ENTRY_SPACE_OF_BOUND = '0.5';
const BOOK_SPACE_OF_BOUND = '0.75';

/** A deterministic content-addressed id over the envelope + a story tag ('xgs:'/'out:'/… prefixes are the boundary's own grammar). */
function idOf(prefix: string, story: string, envelope: ProjectEvidenceEnvelope): string {
  return `${prefix}:${fnv1a32Hex(canonicalJson([story, envelope.tenant, envelope.project, envelope.goal.id, envelope.constraintSet.id, envelope.world.horizon.startsAt, envelope.world.horizon.endsAt] as never))}`;
}

/**
 * One declared predicate's canonical bound citation (the limit.max prose
 * law, unchanged since W-8): the POSITIVE numeric bound as the canonical
 * decimal text. Null when the predicate is not a limit.max with a
 * positive numeric bound (never a fabricated citation).
 */
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

// ---------------------------------------------------------------------------
// THE HONEST GATE (FW-36-A, Round E register E-2) — the declared
// constraints evaluated at each candidate order, WHERE DERIVABLE
// ---------------------------------------------------------------------------

/** The gate-evaluable observation classes (mirroring risk-utilization's own metric classification — one law, two surfaces). */
export type GateSubjectClass = 'book_notional' | 'order_notional' | 'risk_consumption' | 'drawdown' | 'not_gate_evaluable';

/** Classify one declared subject by what the gate can observe for it at fill time (case-insensitive — the grammar's own subjects are camelCase, e.g. risk.maxDrawdown). */
export function gateSubjectClassOf(subject: string): GateSubjectClass {
  const normalized = subject.toLowerCase();
  if (normalized.includes('notional')) {
    return normalized.includes('order') || normalized.includes('trade') ? 'order_notional' : 'book_notional';
  }
  if (normalized.includes('capital') && normalized.includes('budget')) return 'book_notional';
  if (normalized.includes('risk') && normalized.includes('budget')) return 'risk_consumption';
  if (normalized.includes('drawdown')) return 'drawdown';
  return 'not_gate_evaluable';
}

/** One declared constraint as the gate reads it (the record's own fields + its POSITIVE numeric bound). */
export interface GateConstraint {
  readonly constraintId: string;
  readonly domain: string;
  readonly subject: string;
  readonly severity: string;
  readonly predicate: { readonly kind: string; readonly bound?: number; readonly value?: string };
  /** The bound's canonical decimal text (already the equals value for budget declarations); null when the predicate carries no positive numeric bound. */
  readonly boundText: string | null;
}

/** Read the constraint set's declared constraints as gate inputs (a malformed row is skipped, never a crash — R46). */
export function gateConstraintsOf(constraintSet: ConstraintSetStatement): readonly GateConstraint[] {
  const constraints = Array.isArray(constraintSet.constraints) ? constraintSet.constraints : [];
  const gateConstraints: GateConstraint[] = [];
  for (const constraint of constraints) {
    if (typeof constraint !== 'object' || constraint === null) continue;
    const record = constraint as { readonly id?: unknown; readonly domain?: unknown; readonly subject?: unknown; readonly severity?: unknown; readonly predicate?: unknown };
    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (typeof record.subject !== 'string' || record.subject.length === 0) continue;
    if (typeof record.severity !== 'string' || record.severity.length === 0) continue;
    const predicate = record.predicate;
    if (typeof predicate !== 'object' || predicate === null) continue;
    const predicateRecord = predicate as { readonly kind?: unknown; readonly bound?: unknown; readonly value?: unknown };
    if (typeof predicateRecord.kind !== 'string' || predicateRecord.kind.length === 0) continue;
    let bound: number | null = null;
    if (typeof predicateRecord.bound === 'number' && Number.isFinite(predicateRecord.bound)) bound = predicateRecord.bound;
    else if (typeof predicateRecord.bound === 'string' && CANONICAL_DECIMAL_PATTERN.test(predicateRecord.bound) && Number.isFinite(Number(predicateRecord.bound))) bound = Number(predicateRecord.bound);
    else if (typeof predicateRecord.value === 'number' && Number.isFinite(predicateRecord.value)) bound = predicateRecord.value;
    else if (typeof predicateRecord.value === 'string' && CANONICAL_DECIMAL_PATTERN.test(predicateRecord.value) && Number.isFinite(Number(predicateRecord.value))) bound = Number(predicateRecord.value);
    const positive = bound !== null && bound > 0 ? bound : null;
    const predicateEcho: { readonly kind: string; readonly bound?: number; readonly value?: string } = typeof predicateRecord.value === 'string'
      ? { kind: predicateRecord.kind, value: predicateRecord.value, ...(positive === null ? {} : { bound: positive }) }
      : { kind: predicateRecord.kind, ...(positive === null ? {} : { bound: positive }) };
    gateConstraints.push({
      constraintId: record.id,
      domain: typeof record.domain === 'string' && record.domain.length > 0 ? record.domain : 'outcome',
      subject: record.subject,
      severity: record.severity,
      predicate: predicateEcho,
      boundText: positive === null ? null : formatExactDecimal(parseExactDecimal(String(positive)) as ExactDecimal),
    });
  }
  return Object.freeze(gateConstraints);
}

/** The candidate-order context the gate evaluates against (exact decimals throughout). */
export interface GateCandidateContext {
  /** The cumulative notional of the book BEFORE this candidate (the fills already on the blotter). */
  readonly priorBookNotional: string;
  /** The candidate order's own notional (quantity x price, exact). */
  readonly candidateNotional: string;
  /** The session outcome chain's realized cumulative at the gate instant, when the chain provides one (null = the chain provides nothing yet — L4 point-in-time). */
  readonly realizedCumulative: string | null;
}

/**
 * THE TEACHING NOTE for a subject the gate cannot evaluate — E-2.4's runtime-surface half: the LOUD, teaching rejection. It names the gate-evaluable subjects, names the grammar's ACCEPTED domains, states plainly that EXECUTION/TRADE/RISK SCOPING IS NOT YET DECLARABLE (the DSL's vocabulary is closed — a constraint declared under any other domain is rejected as malformed at the boundary, never silently ignored), and points at the outcome-scoped form the gate reads.
 */
const NOT_EVALUABLE_SUBJECT_NOTE = 'not gate-evaluable at fill time: the gateway holds no observation for this subject on any backing (no position, turnover, returns or cost store exists — the standing risk-utilization read reports the same honestly-unknown class). Gate-evaluable subjects today are the notional/budget subjects (book.notional, capital.budget, order.notional — the projected cumulative book including the candidate order, or the order\'s own notional) and the realized-cumulative subjects (risk.budget, risk.maxDrawdown — the session outcome chain\'s realized cumulative, where the chain provides one). The constraint grammar\'s accepted domains are observation | state | action | outcome — EXECUTION/TRADE/RISK SCOPING IS NOT YET DECLARABLE: the DSL\'s vocabulary is closed, and a constraint declared under any other domain is rejected as malformed at the boundary instead of being quietly accepted; scope the SAME bound at the OUTCOME domain instead (the outcome-scoped form, e.g. a book.notional or risk.budget subject) and the gate reads it here';

/** THE TEACHING NOTE for a realized-cumulative subject before the outcome chain provides a record (L4 point-in-time). */
const NOT_EVALUABLE_YET_NOTE = 'not gate-evaluable at this instant: the session outcome chain provides no realized record yet (L4 point-in-time — the desk\'s outcome realizes after the entry fills); the constraint becomes gate-evaluable once a realized record exists, and the gate never silently passes it before then';

/**
 * Evaluate ONE declared constraint at ONE candidate order (pure, exact,
 * never a throw — the verdict carries its own arithmetic). The bound is
 * the constraint's own declared number (the `equals` value for budget
 * declarations — a budget bound); the observed value is derived from the
 * gate's own data (the projected book, the order's notional, or the
 * outcome chain's realized cumulative) — NEVER fabricated from the bound
 * (the pre-FW-36-A defect: observed = bound x 1.2).
 */
export function evaluateConstraintAtGate(constraint: GateConstraint, context: GateCandidateContext): LimitsCheckEvaluation {
  const subjectClass = gateSubjectClassOf(constraint.subject);
  const base = { constraintId: constraint.constraintId, domain: constraint.domain, subject: constraint.subject, severity: constraint.severity, predicate: constraint.predicate };
  if (constraint.boundText === null) {
    // The declaration carries no positive numeric bound — a limit without
    // a number is not a limit the gate can compare (R5's own law),
    // honestly reported.
    return deepFreeze({
      ...base,
      basis: 'none',
      derivable: false,
      observed: null,
      arithmetic: null,
      verdict: 'not_gate_evaluable',
      note: 'not gate-evaluable at fill time: the declared predicate carries no positive numeric bound (a limit without a number is not a limit the gate can compare)',
    });
  }
  const bound = constraint.boundText;
  if (subjectClass === 'book_notional') {
    const projected = addDecimals(context.priorBookNotional, context.candidateNotional);
    if (projected === null) {
      return deepFreeze({ ...base, basis: 'none', derivable: false, observed: null, arithmetic: null, verdict: 'not_gate_evaluable', note: 'not gate-evaluable: the projected book could not be derived (malformed notional inputs — never a fabricated comparison)' });
    }
    const comparison = compareDecimals(projected, bound);
    const breach = comparison === null ? false : constraint.predicate.kind === 'limit.min' ? comparison === -1 : comparison === 1;
    return deepFreeze({
      ...base,
      basis: 'projected_book_notional',
      derivable: true,
      observed: projected,
      arithmetic: `prior cumulative book ${context.priorBookNotional} + candidate order ${context.candidateNotional} = projected book ${projected} (exact decimals)`,
      verdict: breach ? 'breach' : 'pass',
      note: breach
        ? `the projected cumulative book ${projected} stands past the declared ${constraint.predicate.kind} bound ${bound} — the gate refuses the candidate rather than stamp pass over a breach`
        : `the projected cumulative book ${projected} is inside the declared ${constraint.predicate.kind} bound ${bound}`,
    });
  }
  if (subjectClass === 'order_notional') {
    const comparison = compareDecimals(context.candidateNotional, bound);
    const breach = comparison === null ? false : constraint.predicate.kind === 'limit.min' ? comparison === -1 : comparison === 1;
    return deepFreeze({
      ...base,
      basis: 'order_notional',
      derivable: true,
      observed: context.candidateNotional,
      arithmetic: `the candidate order's own notional ${context.candidateNotional} (quantity x price)`,
      verdict: breach ? 'breach' : 'pass',
      note: breach
        ? `the candidate order's own notional ${context.candidateNotional} stands past the declared ${constraint.predicate.kind} bound ${bound} — the gate refuses the candidate`
        : `the candidate order's own notional ${context.candidateNotional} is inside the declared ${constraint.predicate.kind} bound ${bound}`,
    });
  }
  if (subjectClass === 'risk_consumption' || subjectClass === 'drawdown') {
    if (context.realizedCumulative === null) {
      return deepFreeze({ ...base, basis: 'none', derivable: false, observed: null, arithmetic: null, verdict: 'not_gate_evaluable', note: NOT_EVALUABLE_YET_NOTE });
    }
    // The consumption/drawdown observation: the realized cumulative's
    // LOSS MAGNITUDE (the negative part — gains do not consume a budget).
    const realized = parseExactDecimal(context.realizedCumulative);
    if (realized === null) {
      return deepFreeze({ ...base, basis: 'none', derivable: false, observed: null, arithmetic: null, verdict: 'not_gate_evaluable', note: 'not gate-evaluable: the realized cumulative is not a canonical decimal (never a fabricated comparison)' });
    }
    const consumption = realized.negative ? formatExactDecimal({ negative: false, digits: realized.digits, scale: realized.scale }) : '0';
    const comparison = compareDecimals(consumption, bound);
    const breach = comparison === null ? false : constraint.predicate.kind === 'limit.min' ? comparison === -1 : comparison === 1;
    return deepFreeze({
      ...base,
      basis: 'realized_cumulative',
      derivable: true,
      observed: consumption,
      arithmetic: `the session outcome chain's realized cumulative ${context.realizedCumulative} (loss magnitude ${consumption})`,
      verdict: breach ? 'breach' : 'pass',
      note: breach
        ? `the realized cumulative's loss magnitude ${consumption} stands past the declared ${constraint.predicate.kind} bound ${bound} — the gate refuses the candidate (the units are the declaration's own: the observed is the outcome chain's realized amount, the bound is the declared number, and the itemization shows both)`
        : `the realized cumulative's loss magnitude ${consumption} is inside the declared ${constraint.predicate.kind} bound ${bound}`,
    });
  }
  return deepFreeze({ ...base, basis: 'none', derivable: false, observed: null, arithmetic: null, verdict: 'not_gate_evaluable', note: NOT_EVALUABLE_SUBJECT_NOTE });
}

/** The pre-trade check list with the COMPUTED limits verdict (the same closed 7-dimension list — the limits dimension never a fixed stamp again). */
function preTradeChecksOf(limitsOutcome: 'pass' | 'advisory_breach' | 'refused'): readonly ProjectRiskCheck[] {
  return deepFreeze([
    { dimension: 'kill_switch', outcome: 'pass' },
    { dimension: 'identity', outcome: 'pass' },
    { dimension: 'authorization', outcome: 'pass' },
    { dimension: 'limits', outcome: limitsOutcome },
    { dimension: 'venue_permissions', outcome: 'pass' },
    { dimension: 'rate_limits', outcome: 'pass' },
    { dimension: 'credentials', outcome: 'pass' },
  ]);
}

/** The limits dimension's honest outcome over a full evaluation list: pass only when every derivable check passed; advisory_breach when only advisory ones breached; refused when a blocking one did. */
function limitsOutcomeOf(evaluations: readonly LimitsCheckEvaluation[]): 'pass' | 'advisory_breach' | 'refused' {
  if (evaluations.some((evaluation) => evaluation.verdict === 'breach' && evaluation.severity === 'blocking')) return 'refused';
  if (evaluations.some((evaluation) => evaluation.verdict === 'breach')) return 'advisory_breach';
  return 'pass';
}

// ---------------------------------------------------------------------------
// THE CONCENTRATION REFUSAL QUOTE (FW-36-A, Round E register E-2.1/E-2.2 —
// the honest demonstration of the gate binding against the project's OWN
// declared constraint)
// ---------------------------------------------------------------------------

/** The derived refusal's quote: the constraint cited + the TRUE projected book at the concentration attempt. */
export interface ProjectRefusalQuote {
  readonly constraintId: string;
  readonly domain: string;
  readonly subject: string;
  readonly severity: string;
  readonly predicate: { readonly kind: string; readonly bound?: number; readonly value?: string };
  /** The TRUE observed value at the refused candidate: the projected cumulative book (prior fills + the candidate), itemized on the record so the arithmetic reconciles by inspection. */
  readonly observed: string;
  /** The bound's canonical decimal text (the citation the prose and the rendered line share). */
  readonly boundText: string;
  /** The concentration attempt's own notional (the mandate's FULL declared capacity — the refused order's actual size). */
  readonly candidateNotional: string;
  /** The cumulative book BEFORE the candidate (the entry + trim fills already on the blotter). */
  readonly priorBookNotional: string;
  /** The candidate's exact-decimal quantity at the entry price (what the refused row's own order echoes). */
  readonly candidateQuantity: string;
}

/**
 * Derive the honest refusal quote for the stream's ONE demonstration
 * refusal (FW-36-A, E-2): the concentration attempt is the largest order
 * at the entry price that fits the mandate's FULL declared capacity, and
 * the gate refuses it against the project's OWN declared constraint with
 * the TRUE projected book — `prior cumulative + candidate = projected`,
 * itemized — never a value fabricated from the bound (the pre-fix defect:
 * observed = bound x 1.2, which reconciled to NEITHER the order line NOR
 * the cumulative book).
 *
 * The PRIOR BOOK is passed in by the caller — the ACTUAL fills the stream
 * carries at the refusal instant (the entry + the trim, when the trim
 * routed), so the quote's arithmetic reconciles with the rows themselves.
 *
 * The bound's source, in honesty order:
 *   1. the TIGHTEST declared blocking `limit.max` over a gate-observable
 *      book-notional subject (the user's own constraint — the whole point);
 *   2. else the mandate's own declared budget bound (the constraint set's
 *      capital/risk budget `equals` declaration when one exists — cited
 *      verbatim, its own id/domain/severity);
 *   3. else the launch world's own declared capital budget (the console
 *      launch spec's own field — a real user-declared record, never an
 *      invented constraint);
 *   4. else `null` — a mandate with no gate-observable bound cannot
 *      honestly demonstrate the gate (the stream answers the honest
 *      emptiness, the envelope gate's own law).
 */
function refusalQuoteOf(envelope: ProjectEvidenceEnvelope, priorBookNotional: string, entryPrice: string): ProjectRefusalQuote | null {
  // The prior book + the entry price are the caller's own ACTUAL economics
  // (defensive: a malformed input answers the honest emptiness, R46).
  if (!isPositiveDecimal(priorBookNotional) || !isPositiveDecimal(entryPrice)) return null;

  // The bound's source (the honesty order above).
  const gate = gateConstraintsOf(envelope.constraintSet);
  let pick: GateConstraint | null = null;
  let pickBound: string | null = null;
  for (const constraint of gate) {
    if (constraint.boundText === null) continue;
    if (constraint.severity !== 'blocking') continue; // only a blocking bound refuses a candidate
    if (constraint.predicate.kind !== 'limit.max') continue; // only a max bound refuses a too-large book
    if (gateSubjectClassOf(constraint.subject) !== 'book_notional') continue; // only a gate-OBSERVABLE subject (E-2.1's own law)
    const bound = constraint.boundText;
    if (pickBound === null || (compareDecimals(bound, pickBound) ?? 1) === -1) {
      pick = constraint;
      pickBound = bound;
    }
  }
  if (pick === null) {
    // Branch 2 — the mandate's own declared budget bound (the constraint
    // set's capital/risk budget `equals` declaration, cited verbatim).
    const budgetConstraint = gate.find((constraint) => (constraint.subject.includes('capital') || constraint.subject.includes('risk')) && constraint.subject.includes('budget') && constraint.boundText !== null) ?? null;
    if (budgetConstraint !== null && budgetConstraint.boundText !== null) {
      pick = budgetConstraint;
      pickBound = budgetConstraint.boundText;
    }
  }
  if (pick === null) {
    // Branch 3 — the launch world's own declared capital budget (a real
    // user-declared record; the citation names the constraint set it
    // belongs to, never an invented constraint id).
    const worldBudget = parseExactDecimal(envelope.world.capitalBudget);
    if (worldBudget === null || !isPositiveDecimal(envelope.world.capitalBudget)) return null;
    pick = {
      constraintId: `${envelope.constraintSet.id}:capital-budget`,
      domain: 'outcome',
      subject: 'capital.budget',
      severity: 'blocking',
      predicate: { kind: 'limit.max', bound: Number(formatExactDecimal(worldBudget)) },
      boundText: formatExactDecimal(worldBudget),
    };
    pickBound = pick.boundText;
  }
  if (pick === null || pickBound === null) return null; // Branch 4 — no gate-observable bound: the honest emptiness

  // The concentration attempt: the largest order at the entry price that
  // fits the mandate's FULL declared capacity (<= 6 fraction digits — the
  // boundary's own decimal grammar). Its notional IS the order line, so the
  // row echo, the itemized arithmetic and the refusal's observed value all
  // reconcile EXACTLY by inspection (the TRUE projected book: prior
  // cumulative + candidate — never a function of the bound alone).
  const candidateQuantity = divideDecimalsFloor(pickBound, entryPrice);
  if (candidateQuantity === null || !isPositiveDecimal(candidateQuantity)) return null; // a mandate so tight no positive order fits — the envelope gate's own law
  const candidateNotional = multiplyDecimals(candidateQuantity, entryPrice);
  if (candidateNotional === null || !isPositiveDecimal(candidateNotional)) return null;
  const projected = addDecimals(priorBookNotional, candidateNotional);
  if (projected === null || !isPositiveDecimal(projected)) return null;
  return {
    constraintId: pick.constraintId,
    domain: pick.domain,
    subject: pick.subject,
    severity: pick.severity,
    predicate: pick.predicate,
    observed: projected,
    boundText: pickBound,
    candidateNotional,
    priorBookNotional,
    candidateQuantity,
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
  // derived from the project's own budgets). FW-36-A (E-2): the desk
  // SIZES ITS OWN ORDERS inside the mandate's declared caps — the entry
  // at <= ENTRY_SPACE_OF_BOUND of the tightest gate-observable
  // book-notional/budget bound (the constraint set's own bounds + the
  // launch world's declared capital budget), the entry+trim book at <=
  // BOOK_SPACE_OF_BOUND — so every routed fill's `limits` stamp is TRUE
  // (the pre-fix stream stamped pass over fills at up to 180x a declared
  // bound). A mandate so tight that no positive order fits inside it
  // honestly executes NOTHING (null — the zero-budget desk's own law).
  const entryPrice = multiplyDecimals(capital, ENTRY_PRICE_OF_CAPITAL);
  const trimPrice = multiplyDecimals(capital, TRIM_PRICE_OF_CAPITAL);
  if (entryPrice === null || trimPrice === null || !isPositiveDecimal(entryPrice) || !isPositiveDecimal(trimPrice)) return null;

  // The sizing bound: the TIGHTEST gate-observable book bound the mandate
  // declares (every severity — sizing inside an advisory bound is still
  // more honest), plus the launch world's own declared capital budget.
  const gateConstraints = gateConstraintsOf(constraintSet);
  const bookBoundTexts = gateConstraints
    .filter((constraint) => constraint.boundText !== null && gateSubjectClassOf(constraint.subject) === 'book_notional')
    .map((constraint) => constraint.boundText as string);
  bookBoundTexts.push(capital); // the launch spec's own declared capital budget — a real user-declared bound
  const sizingBound = bookBoundTexts.reduce<string | null>(
    (tightest, bound) => tightest === null || (compareDecimals(bound, tightest) ?? 1) === -1 ? bound : tightest,
    null,
  );
  if (sizingBound === null) return null; // no observable book bound — nothing can be sized honestly (R46)

  // The entry: the project's own budget multiplier, capped at the sizing
  // space (<= 50% of the tightest bound at the entry price).
  const entryQtyBase = multiplyDecimals(riskBudget, ENTRY_QTY_OF_RISK);
  const entryCapQty = divideDecimalsFloor(multiplyDecimals(sizingBound, ENTRY_SPACE_OF_BOUND) ?? '0', entryPrice);
  if (entryQtyBase === null || entryCapQty === null) return null;
  const entryQty = (compareDecimals(entryQtyBase, entryCapQty) ?? 1) === 1 ? entryCapQty : entryQtyBase;
  if (!isPositiveDecimal(entryQty)) return null; // too tight to trade honestly — the desk executes nothing
  const entryNotional = multiplyDecimals(entryQty, entryPrice);
  if (entryNotional === null || !isPositiveDecimal(entryNotional)) return null;
  const entryFee = multiplyDecimals(entryNotional, FEE_RATE);

  // The trim: the project's own multiplier, capped so the entry+trim book
  // stays <= 75% of the tightest bound; a cap of nothing positive honestly
  // OMITS the trim (the desk adds nothing it cannot fit inside the mandate).
  const trimQtyBase = multiplyDecimals(riskBudget, TRIM_QTY_OF_RISK);
  const bookRoom = subtractDecimals(multiplyDecimals(sizingBound, BOOK_SPACE_OF_BOUND) ?? '0', entryNotional);
  const trimCapQty = bookRoom === null ? null : divideDecimalsFloor(bookRoom, trimPrice);
  const trimQty = trimQtyBase === null || trimCapQty === null
    ? null
    : (compareDecimals(trimQtyBase, trimCapQty) ?? 1) === 1 ? trimCapQty : trimQtyBase;
  const trimOmitted = trimQty === null || !isPositiveDecimal(trimQty);
  const trimNotional = trimOmitted ? null : multiplyDecimals(trimQty as string, trimPrice);
  if (!trimOmitted && (trimNotional === null || !isPositiveDecimal(trimNotional))) return null;
  const trimFee = trimOmitted ? null : multiplyDecimals(trimNotional as string, FEE_RATE);
  if (entryFee === null || (!trimOmitted && trimFee === null)) return null;

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

  // THE HONEST GATE AT EVERY CANDIDATE ORDER (FW-36-A, E-2.1/E-2.2):
  // each declared constraint evaluated WHERE DERIVABLE — the TRUE
  // observed value itemized (prior cumulative + candidate = projected) so
  // bound-vs-observed reconciles BY INSPECTION; not-derivable constraints
  // honestly reported on the limitsEvaluation surface, never silently
  // passed. The outcome chain provides its realized record only AFTER the
  // entry fills (L4 point-in-time): the realized-cumulative subjects are
  // honestly not-gate-evaluable AT the entry, and evaluated from the
  // chain's realized cumulative at the later gates.
  const entryEvaluations: readonly LimitsCheckEvaluation[] = gateConstraints.map(
    (constraint) => evaluateConstraintAtGate(constraint, { priorBookNotional: '0', candidateNotional: entryNotional, realizedCumulative: null }),
  );
  const entryLimits = limitsOutcomeOf(entryEvaluations);
  if (entryLimits === 'refused') return null; // the gate refuses the very first order — the desk honestly executes nothing (the zero-budget law)
  const trimEvaluations: readonly LimitsCheckEvaluation[] | null = trimOmitted
    ? null
    : gateConstraints.map((constraint) => evaluateConstraintAtGate(constraint, { priorBookNotional: entryNotional, candidateNotional: trimNotional as string, realizedCumulative: realized }));
  const trimLimits = trimEvaluations === null ? null : limitsOutcomeOf(trimEvaluations);
  const trimRefused = trimLimits === 'refused';
  const trimBlockingBreach = trimEvaluations?.find((evaluation) => evaluation.verdict === 'breach' && evaluation.severity === 'blocking') ?? null;

  // The ACTUAL fills the concentration attempt is projected against — the
  // trim counts only when it routed (a refused trim never fills).
  const actualBookNotional = trimOmitted || trimRefused ? entryNotional : addDecimals(entryNotional, trimNotional as string);
  if (actualBookNotional === null || !isPositiveDecimal(actualBookNotional)) return null;

  // The refusal quote (the project's own declared limit — see refusalQuoteOf):
  // the prior book is the ACTUAL fills the stream carries, so the quote's
  // itemized arithmetic reconciles with the rows themselves by inspection.
  const quote = refusalQuoteOf(envelope, actualBookNotional, entryPrice);
  if (quote === null) return null;
  const concentrationEvaluations: readonly LimitsCheckEvaluation[] = gateConstraints.map(
    (constraint) => evaluateConstraintAtGate(constraint, { priorBookNotional: actualBookNotional, candidateNotional: quote.candidateNotional, realizedCumulative: realized }),
  );

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

  // THE AUDIT PROSE (FW-36-A, E-2.3: every budget relation COMPUTED
  // before it is asserted — the "inside the declared capital budget"
  // sentence is emitted only when the projected book is inside the bound,
  // and the risk-budget relation is NEVER asserted before the outcome
  // chain realizes it; the checks sentence reflects the COMPUTED stamp).
  const entryBookVsCapital = compareDecimals(entryNotional, capital);
  const capitalRelationSentence = entryBookVsCapital === 1
    ? `stands past the declared capital budget ${capital} — the honest breach statement (the projected book ${entryNotional} exceeds it, computed)`
    : `is inside the declared capital budget ${capital} (computed: the projected book ${entryNotional} vs the declared budget — never an uncomputed assertion)`;
  const riskBudgetSentence = `the declared risk budget ${riskBudget} binds the session's realized consumption after the fill (the chain realizes ${realized} — the bound is evaluated there, never asserted before it realizes)`;
  const entryChecksSentence = entryLimits === 'pass'
    ? 'all seven pre-trade checks passed (the limits verdict computed from the declared constraints at this candidate — never a fixed stamp)'
    : `the pre-trade checks returned limits: ${entryLimits} (the computed verdict — never a fixed stamp)`;
  const entryRationale = `The desk opened the compiled organization ${envelope.organizationRef}'s simulated session with a ${entryQty} ${marketOne} limit buy at ${entryPrice} — the projected book ${entryNotional} ${capitalRelationSentence}; ${riskBudgetSentence}${drawdownText === null ? '' : `, under the declared drawdown ceiling ${drawdownText}`}. ${entryChecksSentence}; the simulated fill is the outcome ${outcomeRef}'s own realization.`;
  const trimRationale = `Trim the session's ${marketTwo} exposure after the adverse gap on the entry: a ${trimQty} limit sell at ${trimPrice} (${trimNotional} notional) cites the declared risk budget ${riskBudget} verbatim. The gateway routed it; the simulated fill landed clean.`;
  const refusalRationale = `The order was refused at the risk-limits stage: the projected ${quote.subject} ${quote.observed} exceeds the ${quote.severity} ${quote.predicate.kind} bound ${quote.boundText} (constraint ${quote.constraintId} of ${constraintSet.id}) — itemized, the prior cumulative book ${quote.priorBookNotional} + this candidate's own notional ${quote.candidateNotional} = ${quote.observed}, so the arithmetic reconciles by inspection. The desk's request never reached routing — the gate's refusal is the honest half of the blotter.`;
  const outcomeRationale = `The desk approved the ${entryQty} ${marketOne} entry with the projected book ${entryNotional} ${capitalRelationSentence}; ${riskBudgetSentence}. The simulated fill realized ${realized} against the ${expected} expectation (tolerance ${tolerance}) — the adverse gap the post-mortem ${postMortemRef} attributes to the simulated venue lag.`;
  const trimRefusalRationale = trimBlockingBreach === null
    ? 'The trim was refused at the risk-limits stage (the gate\'s computed verdict).'
    : `The trim was refused at the risk-limits stage: ${trimBlockingBreach.note} — itemized, ${trimBlockingBreach.arithmetic}. The desk's request never reached routing (the gate\'s refusal is the honest half of the blotter).`;

  // THE BLOTTER ROWS. The entry carries the gate's own evaluations of
  // EVERY declared constraint at its candidate (the limitsEvaluation
  // surface) and the COMPUTED limits stamp; the trim is the routed row
  // when the gate passed it, the honest refused row when it did not,
  // omitted entirely when the mandate leaves no room for it.
  const trimOrder = {
    clientOrderId: `ord-${envelope.project}-0002`,
    instrumentId: marketTwo,
    venueId: venue,
    side: 'sell',
    kind: 'limit',
    quantity: trimQty as string,
    price: trimPrice,
    timeInForce: 'gtc',
    createdAt: new Date(trimAt).toISOString(),
  };
  const trimRow: ProjectBlotterRow | null = trimOmitted ? null : trimRefused ? {
    kind: 'refused',
    submissionId: idOf('xgs', 'launch-trim', envelope),
    decisionId: null,
    auditId: idOf('xga', 'launch-trim-audit', envelope),
    refusal: {
      stage: 'risk_limits',
      evaluationId: idOf('rev', 'launch-trim-evaluation', envelope),
      refusals: [
        {
          constraintId: trimBlockingBreach?.constraintId ?? '',
          domain: trimBlockingBreach?.domain ?? '',
          subject: trimBlockingBreach?.subject ?? '',
          severity: trimBlockingBreach?.severity ?? '',
          predicate: trimBlockingBreach?.predicate ?? { kind: '' },
          observed: trimBlockingBreach?.observed ?? '',
        },
      ],
    },
    refusedAt: trimAt,
    order: trimOrder,
    decisionBody: PROJECT_RISK_GATE,
    decisionRationale: trimRefusalRationale,
    riskChecks: [{ dimension: 'risk_limits', outcome: 'refused' }],
    evidence: [{ kind: 'gateway-audit', ref: idOf('xga', 'launch-trim-audit', envelope) }],
    limitsEvaluation: trimEvaluations ?? undefined,
  } : {
    kind: 'routed',
    submissionId: idOf('xgs', 'launch-trim', envelope),
    decisionId: idOf('xd', 'launch-trim-decision', envelope),
    auditId: idOf('xga', 'launch-trim-audit', envelope),
    requestRef: idOf('gor', 'launch-trim-request', envelope),
    venue,
    adapterRef: 'adapter:launch-broker',
    channelRef: 'chan:launch-main',
    routedAt: trimAt,
    order: trimOrder,
    fill: { state: 'filled', quantity: trimQty as string, price: trimPrice, notional: trimNotional as string, fee: trimFee as string, filledAt: (trimAt + 250) as TimestampMs },
    decisionBody: desk,
    decisionRationale: trimRationale,
    riskChecks: preTradeChecksOf(trimLimits === null ? 'pass' : trimLimits),
    evidence: [
      { kind: 'shadow_session', ref: sessionId },
      { kind: 'outcome', ref: outcomeRef },
    ],
    limitsEvaluation: trimEvaluations ?? undefined,
  };

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
      riskChecks: preTradeChecksOf(entryLimits),
      evidence: [
        { kind: 'shadow_outcome', ref: shadowOutcomeRef },
        { kind: 'shadow_session', ref: sessionId },
        { kind: 'outcome', ref: outcomeRef },
      ],
      limitsEvaluation: entryEvaluations,
    },
    ...(trimRow === null ? [] : [trimRow]),
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
        // FW-36-A (E-2): the concentration attempt's OWN size — the
        // mandate's full declared capacity at the entry price. The row's
        // order echo therefore reconciles with the refusal's itemized
        // arithmetic (prior cumulative + this candidate = projected book).
        quantity: quote.candidateQuantity,
        price: entryPrice,
        timeInForce: 'gtc',
        createdAt: new Date(refusedAt).toISOString(),
      },
      decisionBody: PROJECT_RISK_GATE,
      decisionRationale: refusalRationale,
      riskChecks: [{ dimension: 'risk_limits', outcome: 'refused' }],
      evidence: [{ kind: 'gateway-audit', ref: idOf('xga', 'launch-refusal-audit', envelope) }],
      limitsEvaluation: concentrationEvaluations,
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
    decisionRationale: outcomeRationale,
    riskChecks: preTradeChecksOf(entryLimits),
    limitsEvaluation: entryEvaluations,
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
