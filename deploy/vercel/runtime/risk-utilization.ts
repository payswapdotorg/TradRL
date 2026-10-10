// deploy/vercel/runtime/risk-utilization.ts — THE STANDING RISK-UTILIZATION
// READ (FW-31-A, Round A blocker 1 — risk_tooling, the ONLY dimension the
// Phase-2 EXTENSION Round A report scored a LOSS: TradRL 3.44 vs incumbents
// 3.56).
//
// THE HOLE THIS CLOSES (ROUND-A-REPORT §4 blocker 1 — L1, L3, M5, S1 + the
// scorecard): the Risk section was DECLARATION-ONLY. The constraint cards
// showed the declared bounds (W-25B's goal read) but no standing
// utilization and no active-breach aggregation — while the SAME personas
// watched a declared constraint REFUSE a live breach with a full audit ref
// (M5: grossExposure 1.8 vs limit 1.5, refused with an audit ref + a
// safety notice). The enforcement is real; the aggregate visibility
// wasn't. M5: "my core 'where am I right now' question is unanswered in
// one glance."
//
// WHAT THIS IS: ONE additive host-owned read route —
//
//   GET /v1/risk/utilization?project=<projectId>
//
// — served BEFORE the boundary wrap with developer-credential authn
// (verifyDeveloperAuthorization — the EXACT W-8 demo-substance law; the
// path is declared NOWHERE in the frozen T041 route table, so without the
// host-route dispatch it answers the typed not_found, and every other
// backing keeps the pre-FW-31-A behavior byte-identical). The response is
// the risk manager's one glance:
//
//   - `bounds` — ONE ROW PER CONSTRAINT in the project's own goal set:
//     the declared bound (boundMax, the predicate's own numeric text),
//     the severity, the STANDING CURRENT UTILIZATION (a number when the
//     data on file can produce a defensible one), the `source` (exactly
//     which records the number was computed from — every sum names its
//     rows, every observation names its record and instant), and the
//     `status` (ok | breach | unknown).
//   - `activeBreaches` — the refusal/safety-intervention records on file
//     for the project (bound-vs-observed, audit refs, at-instants): every
//     refused gateway submission, each carrying its typed per-constraint
//     violations. A refusal stands until a later observation of the same
//     metric supersedes it — nothing on file ever does (there is no
//     resolution event class), so every refusal on file is standing.
//   - `disclosure` — the honesty surface: what each class of `current`
//     number is computed from, and the law that where the data cannot
//     produce a defensible number the row serves `current: null` with
//     `status: "unknown"` — NEVER a fabricated or placeholder value.
//
// THE HONESTY LAW (the wave's core invariant): `current` is null with
// status unknown when the underlying data cannot produce a defensible
// number. Concretely, per metric class:
//
//   - A RISK-LIMITS REFUSAL OBSERVATION (the strongest evidence on
//     file): the most recent refusal whose violation cites THIS
//     constraint id — `current` is the refusal's own observed value (a
//     point-in-time gate observation, never re-computed, never
//     extrapolated), `status` is breach when the observation violates the
//     CURRENT bound (the standing breach), else ok.
//   - TURNOVER-CLASS METRICS (subject contains "turnover"): the sum of
//     filled notional over the routed blotter rows carrying fill
//     economics, restricted to the latest UTC trading day on record.
//   - CAPITAL-BUDGET-CLASS METRICS (subject contains both "capital" and
//     "budget"): the cumulative GROSS filled notional of every routed
//     fill on record (both sides — there is no position store on any
//     backing, so an open-position value cannot be computed without
//     fabricating a book; the traded-through figure is the defensible
//     one and is disclosed as exactly that).
//   - RISK-BUDGET-CLASS METRICS (subject contains both "risk" and
//     "budget"): cumulative realized losses — the negative part of the
//     sum of realization.realizedOutcome over the outcome records
//     readable by this fold (gains do not replenish a consumed budget;
//     an empty sum is honestly 0, and the source names the record
//     count). Null/unknown when the outcome fold is not readable on the
//     backing.
//   - DRAWDOWN-CLASS METRICS (subject contains "drawdown"): unknown, by
//     construction — no equity curve exists on any backing, and a
//     drawdown cannot be computed from fills or outcome records without
//     fabricating a mark-to-market series. This row is the honesty law's
//     own showcase: the bound is declared, the enforcement is real, and
//     the standing value is honestly unknown.
//   - EXPOSURE/POSITION-CLASS METRICS (subject contains "exposure" or
//     "position"): no standing value without a refusal observation —
//     there is no position store; a live exposure cannot be derived from
//     per-trade fills.
//   - EVERY OTHER METRIC: unknown unless a refusal observation exists
//     (the constraint is enforced at the pre-trade gate; only a
//     refusal's observed value would surface a standing number).
//
// Rows without fill economics (live recorded submissions carry no fill
// echo — the recording gateway's records are the boundary's own routed
// shape) are excluded from every sum, and the source string says so.
//
// DATA SOURCES (both backings, the same shape — the W-26C two-arm law):
//   - the project's OWN goal set (the constraint bounds): under DEMO the
//     W-25B capture (demoGoalSetOf — the create-project records the
//     control-plane port seam retained; the demo project's own seeded
//     records), under DURABLE the W-25D seam's hydrated goal set
//     (durable.goalOf — the create-project input's persisted records,
//     rehydrated at every cold start; the FW-MI-B durableEvidenceSource
//     pattern).
//   - the project's execution blotter (the refusals + the fills): the
//     SAME demoSubmissionsOf fold the W-8 blotter route serves (seeded
//     demo rows + the FW-MI-B per-project derived stream + the live
//     recorded submissions).
//   - the outcome records (the risk-budget consumption): under DEMO the
//     backing's own outcome-learning port (the FW-MI-B wrapped fold —
//     the demo seed + every launched desk's derived stream); under
//     DURABLE the seam's hydrated outcome port (the boot-written
//     fixture substance — the derived launched-desk outcomes ride the
//     composed service's wrapped port and are NOT persisted into the
//     seam, a disclosed limitation of that arm).
//
// L12 by construction on every axis: every fold keys on the AUTHORIZED
// tenant (the credential tenant — a foreign tenant's records never exist
// in this composition's stores to begin with), and a project with no
// goal set on record answers the typed not-found (unknown and
// cross-tenant stay indistinguishable — the boundary's own law).
//
// DOCUMENTED LIMITATIONS (honest): host-owned routes run outside the
// T041 pipeline's metering/audit tail — this is a READ only; every
// consequential route stays behind the frozen boundary (the W-8 law).
// Under port overrides (the injection seam owns its own world) the route
// falls through to the boundary exactly like the jobs + submissions
// routes (the pre-W-8 law). The DEMO arm's captures are per-instance
// (a serverless cold start resets them — honest under the SIMULATED
// badge; durability is the DURABLE backing's own surface).
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans the runtime tree too).
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive),
// R46 (every failure path typed; never a crash), L12, L20, UX-DESIGN §7
// (the anti-deception law — the honesty rule's own spec anchor),
// ROUND-A-REPORT §4 blocker 1 + §6 (FW-31-A).
//
// THE NO-CYCLE LAW: this module is imported BY runtime/routes.ts (the
// dispatcher), so it imports ONLY types from './routes' (type-only
// imports are erased — no runtime cycle) and builds its own envelope
// helpers from the frozen service's own primitives — the EXACT precedent
// the W-28 runbook routes set inside routes.ts itself (runbookSuccess/
// runbookError duplicate the demo-substance envelope the same way).

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isProjectId,
  isRecord,
  mintRequestId,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type ConstraintSetStatement,
  type GatewaySubmissionRecord,
  type GoalStatement,
  type OutcomeRecordMirror,
  type RequestId,
  type TimestampMs,
} from '../../../services/api/src/index';
import type { DemoSubstanceRequest, VerifyDeveloperAuthorization } from './routes';

/** The standing risk-utilization read's path (additive — declared nowhere in the frozen route table). */
export const RISK_UTILIZATION_ROUTE_PATH = '/v1/risk/utilization';

// ---------------------------------------------------------------------------
// The exact-decimal arithmetic (every sum is exact — never a float)
// ---------------------------------------------------------------------------

/** The canonical decimal grammar the seeded/derived records' exact decimals all satisfy. */
const CANONICAL_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(?:\.\d+)?$/;

/** One exact decimal: a sign (-1 | 0 | 1), an unscaled magnitude, and a scale (digits after the point). */
interface ExactDecimal {
  readonly sign: -1 | 0 | 1;
  readonly unscaled: bigint;
  readonly scale: number;
}

/** Parse a canonical decimal string exactly (null for anything else — never a float round-trip, never a throw). */
function parseExactDecimal(text: string): ExactDecimal | null {
  if (!CANONICAL_DECIMAL_PATTERN.test(text)) return null;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const digits = `${intPart}${fracPart}`;
  const unscaled = BigInt(digits.length === 0 ? '0' : digits);
  if (unscaled === 0n) return { sign: 0, unscaled: 0n, scale: fracPart.length };
  return { sign: negative ? -1 : 1, unscaled, scale: fracPart.length };
}

/** Render one exact decimal back to its canonical text ('-0' normalizes to '0'). */
function formatExactDecimal(value: ExactDecimal): string {
  if (value.sign === 0 || value.unscaled === 0n) return '0';
  const digits = value.unscaled.toString().padStart(value.scale + 1, '0');
  const intPart = value.scale === 0 ? digits : digits.slice(0, digits.length - value.scale);
  const fracRaw = value.scale === 0 ? '' : digits.slice(digits.length - value.scale);
  const fracPart = fracRaw.replace(/0+$/, '');
  const magnitude = fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
  return value.sign < 0 ? `-${magnitude}` : magnitude;
}

/** Align two decimals to a common scale (the wider one). */
function alignScale(value: ExactDecimal, scale: number): ExactDecimal {
  if (value.scale >= scale) return value;
  return { sign: value.sign, unscaled: value.unscaled * 10n ** BigInt(scale - value.scale), scale };
}

/** Add two exact decimals. */
function addExact(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  const left = alignScale(a, scale);
  const right = alignScale(b, scale);
  const leftSigned = left.sign < 0 ? -left.unscaled : left.unscaled;
  const rightSigned = right.sign < 0 ? -right.unscaled : right.unscaled;
  const sum = leftSigned + rightSigned;
  if (sum === 0n) return { sign: 0, unscaled: 0n, scale };
  return { sign: sum < 0n ? -1 : 1, unscaled: sum < 0n ? -sum : sum, scale };
}

/** Compare two exact decimals (-1 | 0 | 1; null when either failed to parse — the caller degrades honestly). */
function compareExact(a: ExactDecimal, b: ExactDecimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const left = alignScale(a, scale);
  const right = alignScale(b, scale);
  const leftSigned = left.sign < 0 ? -left.unscaled : left.unscaled;
  const rightSigned = right.sign < 0 ? -right.unscaled : right.unscaled;
  return leftSigned < rightSigned ? -1 : leftSigned === rightSigned ? 0 : 1;
}

/** A numeric exact-decimal text (number or canonical decimal string), or null when the value is not numeric. */
function exactTextOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && CANONICAL_DECIMAL_PATTERN.test(value)) return value;
  return null;
}

// ---------------------------------------------------------------------------
// The route's data payload (the one-glance contract)
// ---------------------------------------------------------------------------

/** ONE BOUND ROW: the declared constraint + its standing utilization (the honesty law governs `current`). */
export interface RiskUtilizationBound {
  /** The constraint's own id (its constraint set's vocabulary — never renamed). */
  readonly constraintId: string;
  /** The constraint's own subject (the metric's declared name, e.g. 'position.grossExposure'). */
  readonly metric: string;
  /** The declared max-side bound's own numeric text (limit.max → bound; limit.range → max; numeric equals → value). Null for predicates with no max-side numeric bound (limit.min, oneOf, flag, non-numeric equals). */
  readonly boundMax: string | null;
  /** The constraint's declared severity (advisory | blocking — the constraint set's own value). */
  readonly severity: string;
  /** The standing current utilization — an exact-decimal number computed ONLY from the records named in `source`; null when no defensible number exists (status unknown — never fabricated). */
  readonly current: number | null;
  /** Exactly where the number came from (or why none can exist) — every sum names its rows, every observation names its record + instant. */
  readonly source: string;
  /** ok | breach | unknown — the honest standing verdict against the current bound. */
  readonly status: 'ok' | 'breach' | 'unknown';
}

/** ONE ACTIVE BREACH: a refusal/safety-intervention record on file, with its bound-vs-observed violations. */
export interface RiskUtilizationBreach {
  /** The record class: a risk-limits refusal (bound-vs-observed per constraint) or another gateway refusal stage (the typed record, no fabricated bound-vs-observed). */
  readonly kind: 'risk_limits_refusal' | 'gateway_refusal';
  /** The refused submission's id (the blotter row's own — resolvable at GET /v1/execution/submissions). */
  readonly submissionId: string;
  /** The gateway audit ref (the refusal's own audit chain link). */
  readonly auditId: string;
  /** The refusal's pipeline stage (the typed GatewayRefusal's own discriminator). */
  readonly stage: string;
  /** The refusal instant (ISO-8601). */
  readonly at: string;
  /** The named deciding body behind the refusal (the decision-audit substance, when the row carries it). */
  readonly decisionBody?: string;
  /** The per-constraint violations (risk_limits only): the bound-vs-observed quote, verbatim from the record. */
  readonly violations?: readonly {
    readonly constraintId: string;
    readonly domain: string;
    readonly subject: string;
    readonly severity: string;
    readonly predicate: unknown;
    readonly observed: string;
  }[];
  /** The refusal's audit rationale (the decision-audit substance, when the row carries it). */
  readonly rationale?: string;
}

/** The standing risk-utilization read's data payload (the response body's `data`). */
export interface RiskUtilizationRead {
  /** The project the read is scoped to (the query parameter's own value). */
  readonly projectId: string;
  /** The serve instant (ISO-8601) — the read reflects the records on file AT this serve; each row's source names the instants its numbers come from. */
  readonly asOf: string;
  /** ONE ROW PER CONSTRAINT in the project's own goal set (the constraint set's own order). */
  readonly bounds: readonly RiskUtilizationBound[];
  /** Every refusal/safety-intervention record on file for the project (ascending by instant) — a refusal stands until a later observation of the same metric supersedes it; nothing on file ever does. */
  readonly activeBreaches: readonly RiskUtilizationBreach[];
  /**
   * FW-38-A (Round G register G-8 — the dead-desk silence, L2 + M3): the
   * desk-level ENTRY-BLOCKED status — the FIRST explanation surface for a
   * desk that never enters. A blocking constraint of an entry-decidable
   * class (position.concentration; the position/gross-exposure count)
   * whose ENTRY projection is a construction constant (the first candidate
   * is 100% of the projected book — fraction 1; the sole position is count
   * 1) refuses EVERY candidate before the desk can ever enter, so the
   * desk produces 0 fills / 0 refusals / 0 decisions with no surface saying
   * why (L2: a blocking concentration 0.25 killed the desk at entry for
   * 38+ minutes; M3's D2: 18+ minutes of 0/0/0). The field names the
   * blocking constraint (id, domain, subject, class, predicate kind,
   * bound, severity) and carries the teaching `reason` — the UI contract
   * for the apps/web half (the parallel wave's G-3 status-pill work
   * consumes it): render "this desk cannot enter: <reason>" LOUDLY on the
   * desk's surfaces. null = no declared blocking constraint blocks entry
   * by construction (a silent desk with entryBlocked null has NO STRUCTURAL
   * cause on record — its silence is the desk's own, honestly unexplained
   * by this read, never fabricated here).
   */
  readonly entryBlocked: RiskUtilizationEntryBlocked | null;
  /** The honesty surface: what each class of current number is computed from, and the null/unknown law. */
  readonly disclosure: string;
}

// ---------------------------------------------------------------------------
// THE DESK-LEVEL ENTRY-BLOCKED STATUS (FW-38-A, Round G register G-8 — the
// dead-desk silence, L2 + M3)
// ---------------------------------------------------------------------------

/**
 * ONE ENTRY-BLOCKED DESK: the named blocking constraint whose class makes
 * every entry candidate inadmissible BY CONSTRUCTION (FW-38-A, G-8). The
 * teaching payload the UI renders loudly: "this desk cannot enter: <reason>".
 */
export interface RiskUtilizationEntryBlocked {
  /** The literal discriminator (the read's own status vocabulary). */
  readonly status: 'entry-blocked';
  /** The blocking constraint's own id (its constraint set's vocabulary — never renamed). */
  readonly constraintId: string;
  /** The constraint's declared domain (verbatim). */
  readonly domain: string;
  /** The constraint's declared subject (verbatim, e.g. 'position.concentration'). */
  readonly subject: string;
  /** The gate subject class the constraint binds as (the FW-37-A gate vocabulary). */
  readonly gateClass: 'position_concentration' | 'position_gross_exposure';
  /** The predicate's own kind (limit.max | limit.min). */
  readonly predicateKind: string;
  /** The bound's own numeric text (verbatim — never re-rounded). */
  readonly bound: string;
  /** The constraint's declared severity ('blocking' — an advisory bound never blocks entry). */
  readonly severity: string;
  /** The teaching reason (the entry arithmetic, named): why NO candidate can ever be admissible. */
  readonly reason: string;
}

/** The exact decimal 1 (the entry projection's construction constant: fraction 1, count 1). */
const ENTRY_CONSTANT: ExactDecimal = { sign: 1, unscaled: 1n, scale: 0 };

/**
 * Compute the desk-level ENTRY-BLOCKED status from the constraint set ALONE
 * (FW-38-A, G-8 — pure, structural, never a throw). The law, exactly the
 * gate's own arithmetic (runtime/project-evidence.ts's
 * evaluateConstraintAtGate) evaluated at the ENTRY candidate (an empty book,
 * a sole first position):
 *
 *   - position.concentration (limit.max): the first candidate is 100% of the
 *     projected book (candidate / (0 + candidate) = 1, whatever its size), so
 *     a bound < 1 refuses EVERY first candidate — entry is impossible by
 *     construction (L2's D1: a blocking 0.25 produced 0 fills / 0 refusals /
 *     0 decisions for 38+ minutes with no surface explaining why).
 *   - position.concentration (limit.min): the fraction is 1 at entry and
 *     refusals never grow the book, so a bound > 1 is a DEADLOCK — the
 *     fraction can never rise to the floor, no candidate can ever pass.
 *   - position/grossExposure (limit.max, the count class): the first
 *     candidate makes the projected count 1, so a bound < 1 refuses every
 *     candidate (a cap of zero positions).
 *   - position/grossExposure (limit.min, the count class): the count is 1 at
 *     entry and refusals never create positions, so a bound > 1 is a
 *     DEADLOCK — the count can never rise to the floor.
 *
 * An ADVISORY bound NEVER blocks entry (the FW-37-A law: the entry routes
 * with the computed advisory_breach stamp). Classes whose entry projection
 * depends on the candidate's own SIZE (notional/budget/turnover) are not
 * entry-decidable from the bound alone and are NEVER claimed here (the
 * honesty law — no fabricated blocking cause). The FIRST blocking
 * entry-blocker in the constraint set's own order is named (one is enough to
 * kill the desk; the UI teaches the first named cause).
 */
function entryBlockedOf(goalSet: RiskUtilizationGoalSet): RiskUtilizationEntryBlocked | null {
  const constraints = Array.isArray(goalSet.constraintSet.constraints) ? goalSet.constraintSet.constraints : [];
  for (const constraint of constraints) {
    if (!isRecord(constraint)) continue; // a malformed row is skipped, never a crash (R46)
    const constraintId = typeof constraint.id === 'string' ? constraint.id : '';
    const domain = typeof constraint.domain === 'string' ? constraint.domain : '';
    const subject = typeof constraint.subject === 'string' ? constraint.subject : '';
    const severity = typeof constraint.severity === 'string' ? constraint.severity : '';
    const predicate = (constraint as { readonly predicate?: unknown }).predicate;
    if (constraintId.length === 0 || subject.length === 0) continue;
    // ONLY a BLOCKING declaration blocks entry — an advisory bound routes the
    // entry with the computed advisory stamp (the FW-37-A pinned law).
    if (severity !== 'blocking') continue;
    if (!isRecord(predicate)) continue;
    const predicateKind = typeof predicate.kind === 'string' ? predicate.kind : '';
    const bound = declaredBoundOf(predicate);
    const needle = subject.toLowerCase();
    // The concentration class FIRST (a 'position.concentration' subject also
    // contains 'position' — the bound-row matcher's own precedence).
    if (needle.includes('concentration')) {
      const boundText = bound.boundMaxText ?? (bound.floor === null ? null : formatExactDecimal(bound.floor));
      const ceiling = bound.ceiling;
      const floor = bound.floor;
      if (predicateKind === 'limit.max' && ceiling !== null && compareExact(ceiling, ENTRY_CONSTANT) < 0 && boundText !== null) {
        return {
          status: 'entry-blocked',
          constraintId,
          domain,
          subject,
          gateClass: 'position_concentration',
          predicateKind,
          bound: boundText,
          severity,
          reason: `the blocking constraint ${constraintId} (${domain || 'undeclared domain'}, ${subject}, ${predicateKind}, bound ${boundText}) refuses every candidate at entry: the first candidate is 100% of the projected book (a sole position's concentration fraction is 1 by construction, whatever its size), and 1 > ${boundText}, so no candidate can ever be admissible until the constraint is revised`,
        };
      }
      if (predicateKind === 'limit.min' && floor !== null && compareExact(floor, ENTRY_CONSTANT) > 0 && boundText !== null) {
        return {
          status: 'entry-blocked',
          constraintId,
          domain,
          subject,
          gateClass: 'position_concentration',
          predicateKind,
          bound: boundText,
          severity,
          reason: `the blocking constraint ${constraintId} (${domain || 'undeclared domain'}, ${subject}, ${predicateKind}, bound ${boundText}) refuses every candidate at entry: the first candidate's concentration fraction is 1 by construction and 1 < ${boundText}, and a refusal never grows the book, so the fraction can never rise to the floor — no candidate can ever be admissible until the constraint is revised`,
        };
      }
      continue;
    }
    if (needle.includes('exposure') || needle.includes('position')) {
      const boundText = bound.boundMaxText ?? (bound.floor === null ? null : formatExactDecimal(bound.floor));
      const ceiling = bound.ceiling;
      const floor = bound.floor;
      if (predicateKind === 'limit.max' && ceiling !== null && compareExact(ceiling, ENTRY_CONSTANT) < 0 && boundText !== null) {
        return {
          status: 'entry-blocked',
          constraintId,
          domain,
          subject,
          gateClass: 'position_gross_exposure',
          predicateKind,
          bound: boundText,
          severity,
          reason: `the blocking constraint ${constraintId} (${domain || 'undeclared domain'}, ${subject}, ${predicateKind}, bound ${boundText}) refuses every candidate at entry: the first candidate makes the projected open-position count 1 by construction, and 1 > ${boundText} (a cap below one position), so no candidate can ever be admissible until the constraint is revised`,
        };
      }
      if (predicateKind === 'limit.min' && floor !== null && compareExact(floor, ENTRY_CONSTANT) > 0 && boundText !== null) {
        return {
          status: 'entry-blocked',
          constraintId,
          domain,
          subject,
          gateClass: 'position_gross_exposure',
          predicateKind,
          bound: boundText,
          severity,
          reason: `the blocking constraint ${constraintId} (${domain || 'undeclared domain'}, ${subject}, ${predicateKind}, bound ${boundText}) refuses every candidate at entry: the first candidate makes the projected open-position count 1, and 1 < ${boundText}, and a refusal never creates a position, so the count can never rise to the floor — no candidate can ever be admissible until the constraint is revised`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The structural input (both backings build it — the W-26C two-arm law)
// ---------------------------------------------------------------------------

/** The project's own goal set (the constraint bounds' source — the W-25B capture / the W-25D hydrated row). */
export interface RiskUtilizationGoalSet {
  readonly goal: GoalStatement;
  readonly constraintSet: ConstraintSetStatement;
}

/**
 * The backing's typed goal-set read: ok + the records (null when NO goal
 * set is on record for the project — the typed not-found), or the typed
 * degraded state (the durable projection's own failure — the typed 503).
 */
export type RiskUtilizationGoalSetRead =
  | { readonly ok: true; readonly value: RiskUtilizationGoalSet | null }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** The standing risk-utilization route's structural input (the demo + durable arms both build it). */
export interface RiskUtilizationRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /** The project's own goal set (the constraint bounds). */
  readonly goalSetOf: (tenant: string, project: string) => RiskUtilizationGoalSetRead;
  /** The project's execution blotter (the refusals + the fills — the SAME demoSubmissionsOf fold the W-8 blotter route serves). */
  readonly submissionsOf: (tenant: string, project: string) => readonly GatewaySubmissionRecord[];
  /**
   * The project's outcome records (the risk-budget consumption's source),
   * or null when the backing cannot read them on this route. Null (not
   * empty) means NOT READABLE — an empty array is an honest zero-record
   * read (the empty sum is 0, disclosed with its count).
   */
  readonly outcomesOf: ((tenant: string, project: string) => readonly OutcomeRecordMirror[] | null) | null;
  /** The backing the read serves from (named in the disclosure). */
  readonly backing: 'demo' | 'durable';
}

// ---------------------------------------------------------------------------
// The envelope discipline (the runbook precedent: built from the frozen
// service's own primitives — no runtime dependency on './routes')
// ---------------------------------------------------------------------------

function riskRouteRequestId(request: DemoSubstanceRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['risk-utilization-route', request.method, request.path, serial] as never)));
}

function riskRouteSuccess(requestId: RequestId, data: unknown, status = 200): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function riskRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// The blotter's structural readers (the additive demo-substance fields —
// guarded, never trusted: a malformed field is skipped, never a crash)
// ---------------------------------------------------------------------------

/** One routed row's fill echo (the additive demo-substance field). */
interface RoutedFill {
  readonly notional: string;
  readonly filledAt: number;
}

/** Read one routed row's fill economics (null when the row carries no structurally valid fill — live recorded rows never do). */
function fillOf(row: GatewaySubmissionRecord): RoutedFill | null {
  if (row.kind !== 'routed') return null;
  const fill = (row as { readonly fill?: unknown }).fill;
  if (!isRecord(fill)) return null;
  const notional = exactTextOf(fill.notional);
  if (notional === null) return null; // no canonical notional → no economics this read can sum
  const filledAt = fill.filledAt;
  if (typeof filledAt !== 'number' || !Number.isSafeInteger(filledAt) || filledAt <= 0) return null;
  return { notional, filledAt };
}

/** The additive decision-audit fields (the R3/W-8 substance). */
function decisionBodyOf(row: GatewaySubmissionRecord): string | null {
  const body = (row as { readonly decisionBody?: unknown }).decisionBody;
  return typeof body === 'string' && body.length > 0 ? body : null;
}

function rationaleOf(row: GatewaySubmissionRecord): string | null {
  const rationale = (row as { readonly decisionRationale?: unknown }).decisionRationale;
  return typeof rationale === 'string' && rationale.length > 0 ? rationale : null;
}

/** One risk-limits violation as the typed record carries it (verbatim — never re-typed, never re-computed). */
interface RiskLimitViolation {
  readonly constraintId: string;
  readonly domain: string;
  readonly subject: string;
  readonly severity: string;
  readonly predicate: unknown;
  readonly observed: string;
}

/** Read one refusal's per-constraint violations (risk_limits stage only; else null). */
function violationsOf(refusal: unknown): readonly RiskLimitViolation[] | null {
  if (!isRecord(refusal) || refusal.stage !== 'risk_limits' || !Array.isArray(refusal.refusals)) return null;
  const violations: RiskLimitViolation[] = [];
  for (const entry of refusal.refusals) {
    if (!isRecord(entry)) continue;
    if (typeof entry.constraintId !== 'string' || entry.constraintId.length === 0) continue;
    if (typeof entry.subject !== 'string' || entry.subject.length === 0) continue;
    const observed = typeof entry.observed === 'boolean' || typeof entry.observed === 'number' ? String(entry.observed) : typeof entry.observed === 'string' && entry.observed.length > 0 ? entry.observed : null;
    if (observed === null) continue;
    violations.push({
      constraintId: entry.constraintId,
      domain: typeof entry.domain === 'string' ? entry.domain : '',
      subject: entry.subject,
      severity: typeof entry.severity === 'string' ? entry.severity : '',
      predicate: entry.predicate,
      observed,
    });
  }
  return violations.length === 0 ? null : violations;
}

// ---------------------------------------------------------------------------
// The standing observations (the strongest evidence first)
// ---------------------------------------------------------------------------

/** ONE RISK-LIMITS OBSERVATION on file: a refusal row's violation of one constraint (the gate's own observed value). */
interface RefusalObservation {
  readonly submissionId: string;
  readonly auditId: string;
  readonly evaluationId: string | null;
  readonly at: TimestampMs;
  readonly constraintId: string;
  readonly observedText: string;
}

/**
 * The MOST RECENT risk-limits observation on file for one constraint id
 * (null when no refusal on file cites it). Recency is the refusal instant
 * (ties resolve to the later row — the blotter's own order is stable).
 */
function latestRefusalObservation(submissions: readonly GatewaySubmissionRecord[], constraintId: string): RefusalObservation | null {
  let latest: RefusalObservation | null = null;
  for (const row of submissions) {
    if (row.kind !== 'refused') continue;
    const violations = violationsOf(row.refusal);
    if (violations === null) continue;
    for (const violation of violations) {
      if (violation.constraintId !== constraintId) continue;
      const candidate: RefusalObservation = {
        submissionId: row.submissionId,
        auditId: row.auditId,
        evaluationId: typeof (row.refusal as { readonly evaluationId?: unknown }).evaluationId === 'string' ? (row.refusal as { readonly evaluationId: string }).evaluationId : null,
        at: row.refusedAt,
        constraintId,
        observedText: violation.observed,
      };
      if (latest === null || candidate.at >= latest.at) latest = candidate;
    }
  }
  return latest;
}

/** The UTC calendar day (ISO date) of one instant — the turnover window's own granularity. */
function utcDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The bound-row builder (the honesty law's own surface)
// ---------------------------------------------------------------------------

/** The declared predicate's max-side numeric bound text + the status-comparison basis. */
interface DeclaredBound {
  /** The max-side bound's own numeric text (the response's boundMax), or null when the predicate has none. */
  readonly boundMaxText: string | null;
  /** The utilization ceiling (limit.max → bound; limit.range → max; numeric equals/notEquals → value), or null when the predicate declares no numeric side. */
  readonly ceiling: ExactDecimal | null;
  /** The utilization floor (limit.min → bound; limit.range → min), or null when the predicate declares none. */
  readonly floor: ExactDecimal | null;
}

/** Read one constraint's declared bound (its predicate's own numeric text — never re-rounded). */
function declaredBoundOf(predicate: unknown): DeclaredBound {
  if (!isRecord(predicate)) return { boundMaxText: null, ceiling: null, floor: null };
  if (predicate.kind === 'limit.max') {
    const text = exactTextOf(predicate.bound);
    return text === null ? { boundMaxText: null, ceiling: null, floor: null } : { boundMaxText: text, ceiling: parseExactDecimal(text), floor: null };
  }
  if (predicate.kind === 'limit.min') {
    const text = exactTextOf(predicate.bound);
    return { boundMaxText: null, ceiling: null, floor: text === null ? null : parseExactDecimal(text) };
  }
  if (predicate.kind === 'limit.range') {
    const maxText = exactTextOf(predicate.max);
    const minText = exactTextOf(predicate.min);
    return {
      boundMaxText: maxText,
      ceiling: maxText === null ? null : parseExactDecimal(maxText),
      floor: minText === null ? null : parseExactDecimal(minText),
    };
  }
  if (predicate.kind === 'equals' || predicate.kind === 'notEquals') {
    const text = exactTextOf(predicate.value);
    return text === null ? { boundMaxText: null, ceiling: null, floor: null } : { boundMaxText: text, ceiling: parseExactDecimal(text), floor: null };
  }
  return { boundMaxText: null, ceiling: null, floor: null };
}

/** The honest standing verdict of one utilization against the declared bounds (unknown when no comparison is possible). */
function statusOf(current: ExactDecimal | null, bound: DeclaredBound): 'ok' | 'breach' | 'unknown' {
  if (current === null) return 'unknown';
  if (bound.ceiling !== null && compareExact(current, bound.ceiling) > 0) return 'breach';
  if (bound.floor !== null && compareExact(current, bound.floor) < 0) return 'breach';
  if (bound.ceiling === null && bound.floor === null) return 'unknown'; // no numeric side to compare against
  return 'ok';
}

/** Build ONE bound row (the honesty law's every branch, in precedence order). */
function boundRowOf(
  constraint: { readonly id: string; readonly domain: string; readonly subject: string; readonly predicate: unknown; readonly severity: string },
  submissions: readonly GatewaySubmissionRecord[],
  outcomes: readonly OutcomeRecordMirror[] | null,
  outcomesReadable: boolean,
): RiskUtilizationBound {
  const bound = declaredBoundOf(constraint.predicate);
  // PRECEDENCE 1 — THE RISK-LIMITS OBSERVATION (the strongest evidence on
  // file: the gate's own observed value for THIS constraint). A
  // point-in-time observation, never re-computed, never extrapolated.
  const observation = latestRefusalObservation(submissions, constraint.id);
  if (observation !== null) {
    const observed = parseExactDecimal(observation.observedText);
    if (observed !== null) {
      return {
        constraintId: constraint.id,
        metric: constraint.subject,
        boundMax: bound.boundMaxText,
        severity: constraint.severity,
        current: Number(formatExactDecimal(observed)),
        source: `the risk-limits refusal ${observation.submissionId} (audit ${observation.auditId}${observation.evaluationId === null ? '' : `, evaluation ${observation.evaluationId}`}) observed at ${new Date(observation.at).toISOString()} — the most recent observed value on record for ${constraint.subject}; a point-in-time gate observation, not a live re-computation`,
        status: statusOf(observed, bound),
      };
    }
    // A non-numeric observed value (the typed record allows string |
    // number | boolean): the breach is the record's own fact, but no
    // numeric current exists — current stays null, never fabricated.
    return {
      constraintId: constraint.id,
      metric: constraint.subject,
      boundMax: bound.boundMaxText,
      severity: constraint.severity,
      current: null,
      source: `the risk-limits refusal ${observation.submissionId} (audit ${observation.auditId}) observed at ${new Date(observation.at).toISOString()} cites this constraint with a non-numeric observed value (${JSON.stringify(observation.observedText)}) — the refusal is the standing breach record; no numeric utilization is derivable from it`,
      status: 'breach',
    };
  }
  // PRECEDENCE 2 — THE FILL/OUTCOME-DERIVED UTILIZATIONS (the honest
  // computations the records on file support, each disclosed exactly).
  const fills = submissions.map(fillOf).filter((fill): fill is RoutedFill => fill !== null);
  const fillsWithoutEconomics = submissions.filter((row) => row.kind === 'routed' && fillOf(row) === null).length;
  const excludedNote = fillsWithoutEconomics === 0 ? '' : ` (${fillsWithoutEconomics} routed row(s) without fill economics are excluded — live recorded submissions carry no fill echo)`;
  // The metric-class matching is CASE-INSENSITIVE over the constraint's own
  // subject (the vocabulary in the wild is camelCase — 'dailyTurnover',
  // 'maxDrawdown', 'grossExposure' — and the honest matcher must not miss a
  // bound because of a capital letter).
  const subject = constraint.subject;
  const needle = constraint.subject.toLowerCase();
  if (needle.includes('turnover')) {
    if (fills.length === 0) {
      return unknownRow(constraint, bound, `no routed fill on record carries fill economics — a turnover cannot be summed from rows that do not exist (the blotter is empty of fills for this project)`);
    }
    const latestDay = utcDayOf(fills.reduce((latest, fill) => (fill.filledAt > latest ? fill.filledAt : latest), fills[0]!.filledAt));
    const dayFills = fills.filter((fill) => utcDayOf(fill.filledAt) === latestDay);
    const sum = dayFills.reduce((total, fill) => addExact(total, parseExactDecimal(fill.notional) ?? { sign: 0, unscaled: 0n, scale: 0 }), { sign: 0, unscaled: 0n, scale: 0 } as ExactDecimal);
    const sumText = formatExactDecimal(sum);
    return {
      constraintId: constraint.id,
      metric: subject,
      boundMax: bound.boundMaxText,
      severity: constraint.severity,
      current: Number(sumText),
      source: `the sum of filled notional over the ${dayFills.length} routed fill(s) on record for the latest trading day (${latestDay}, UTC)${excludedNote} — traded value, both sides, exact decimals`,
      status: statusOf(sum, bound),
    };
  }
  if (needle.includes('capital') && needle.includes('budget')) {
    const sum = fills.reduce((total, fill) => addExact(total, parseExactDecimal(fill.notional) ?? { sign: 0, unscaled: 0n, scale: 0 }), { sign: 0, unscaled: 0n, scale: 0 } as ExactDecimal);
    const sumText = formatExactDecimal(sum);
    return {
      constraintId: constraint.id,
      metric: subject,
      boundMax: bound.boundMaxText,
      severity: constraint.severity,
      current: Number(sumText),
      source: `the cumulative gross filled notional of the ${fills.length} routed fill(s) on record${excludedNote} — traded-through notional, both sides; there is no position store on any backing, so an open-position value is not computable without fabricating a book`,
      status: statusOf(sum, bound),
    };
  }
  if (needle.includes('risk') && needle.includes('budget')) {
    if (!outcomesReadable || outcomes === null) {
      return unknownRow(constraint, bound, 'the outcome records are not readable by this read on this backing — a realized-loss sum cannot be computed (the risk budget\'s consumption is honestly unknown here, never assumed zero)');
    }
    const realizedTexts = outcomes
      .map((record) => (isRecord(record.realization) ? exactTextOf(record.realization.realizedOutcome) : null))
      .filter((text): text is string => text !== null);
    const net = realizedTexts.reduce((total, text) => addExact(total, parseExactDecimal(text) ?? { sign: 0, unscaled: 0n, scale: 0 }), { sign: 0, unscaled: 0n, scale: 0 } as ExactDecimal);
    // Losses consume the budget; gains do not replenish it: the
    // consumption is the negative part of the net realized sum.
    const consumption: ExactDecimal = net.sign < 0 ? { sign: 1, unscaled: net.unscaled, scale: net.scale } : { sign: 0, unscaled: 0n, scale: 0 };
    const consumptionText = formatExactDecimal(consumption);
    const excludedRecords = outcomes.length - realizedTexts.length;
    const exclusionNote = excludedRecords === 0 ? '' : `; ${excludedRecords} record(s) without a numeric realization are excluded`;
    return {
      constraintId: constraint.id,
      metric: subject,
      boundMax: bound.boundMaxText,
      severity: constraint.severity,
      current: Number(consumptionText),
      source: `cumulative realized losses — the negative part of the net realized outcome over the ${outcomes.length} outcome record(s) readable by this fold (net ${formatExactDecimal(net)}; gains do not replenish a consumed budget${exclusionNote}) — the outcome records' own realization figures`,
      status: statusOf(consumption, bound),
    };
  }
  if (needle.includes('drawdown')) {
    return unknownRow(constraint, bound, 'no equity curve exists on any backing — a drawdown cannot be computed from fills or outcome records without fabricating a mark-to-market series (the bound is declared and enforced at the pre-trade gate; the standing value is honestly unknown)');
  }
  if (needle.includes('exposure') || needle.includes('position')) {
    return unknownRow(constraint, bound, 'no position or equity store exists on any backing — a standing exposure cannot be derived from per-trade fills without fabricating a book (the constraint is enforced at the pre-trade gate; only a refusal observation would surface a standing value, and none is on record)');
  }
  return unknownRow(constraint, bound, 'no computation for this metric class exists in the data on file (the constraint is enforced at the pre-trade gate; only a refusal observation would surface a standing value, and none is on record)');
}

/** The unknown row (the honesty law's own shape: current null, status unknown, the source saying exactly why). */
function unknownRow(
  constraint: { readonly id: string; readonly subject: string; readonly predicate: unknown; readonly severity: string },
  bound: DeclaredBound,
  why: string,
): RiskUtilizationBound {
  return {
    constraintId: constraint.id,
    metric: constraint.subject,
    boundMax: bound.boundMaxText,
    severity: constraint.severity,
    current: null,
    source: why,
    status: 'unknown',
  };
}

// ---------------------------------------------------------------------------
// The active-breach aggregation
// ---------------------------------------------------------------------------

/** Every refusal on file as one breach record (ascending by instant; the additive audit substance aboard when the row carries it). */
function activeBreachesOf(submissions: readonly GatewaySubmissionRecord[]): readonly RiskUtilizationBreach[] {
  const breaches: RiskUtilizationBreach[] = [];
  for (const row of submissions) {
    if (row.kind !== 'refused') continue;
    const violations = violationsOf(row.refusal);
    const body = decisionBodyOf(row);
    const rationale = rationaleOf(row);
    breaches.push({
      kind: violations === null ? 'gateway_refusal' : 'risk_limits_refusal',
      submissionId: row.submissionId,
      auditId: row.auditId,
      stage: isRecord(row.refusal) && typeof row.refusal.stage === 'string' ? row.refusal.stage : 'unknown',
      at: new Date(row.refusedAt).toISOString(),
      ...(body === null ? {} : { decisionBody: body }),
      ...(violations === null ? {} : { violations }),
      ...(rationale === null ? {} : { rationale }),
    });
  }
  return breaches.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The read itself (pure — the tests drive it directly)
// ---------------------------------------------------------------------------

/** The disclosure's backing clause (what this read serves from, per arm). */
function backingClause(backing: 'demo' | 'durable'): string {
  return backing === 'demo'
    ? 'served from the DEMO backing\'s per-instance records (the W-25B goal-set capture, the demoSubmissionsOf blotter fold, and the backing\'s own outcome-learning port — a serverless cold start resets the captures, honest under the SIMULATED badge)'
    : 'served from the DURABLE seam\'s hydrated surfaces (the W-25D hydrated goal set, the demoSubmissionsOf blotter fold over the composition\'s own stores, and the SAME wrapped outcome-learning chain POST /v1/outcomes/query serves — the seam\'s hydrated rows plus every launched desk\'s derived evidence stream and the promoted-decision registry — so the risk-budget fold\'s outcome count is exactly the outcome read\'s own, never a divergent zero)';
}

/** Build the standing risk-utilization read (pure, deterministic, never throws). */
export function buildRiskUtilizationRead(input: {
  readonly projectId: string;
  readonly goalSet: RiskUtilizationGoalSet;
  readonly submissions: readonly GatewaySubmissionRecord[];
  readonly outcomes: readonly OutcomeRecordMirror[] | null;
  readonly outcomesReadable: boolean;
  readonly asOf: string;
  readonly backing: 'demo' | 'durable';
}): RiskUtilizationRead {
  const constraints = Array.isArray(input.goalSet.constraintSet.constraints) ? input.goalSet.constraintSet.constraints : [];
  const bounds = constraints.map((constraint) =>
    boundRowOf(
      {
        id: typeof constraint.id === 'string' ? constraint.id : '',
        domain: typeof constraint.domain === 'string' ? constraint.domain : '',
        subject: typeof constraint.subject === 'string' ? constraint.subject : '',
        predicate: constraint.predicate,
        severity: typeof constraint.severity === 'string' ? constraint.severity : '',
      },
      input.submissions,
      input.outcomes,
      input.outcomesReadable,
    ),
  );
  const disclosure = [
    'THE HONESTY LAW: every bounds[].current is computed ONLY from the records named in its source; where the data on file cannot produce a defensible number the row serves current null with status "unknown" — never a fabricated or placeholder value.',
    'current values come from, in precedence order: (1) the most recent risk-limits refusal observation citing the constraint (a point-in-time gate observation, not a live re-computation); (2) for turnover-class metrics, the sum of filled notional over the routed fills of the latest UTC trading day on record; (3) for capital-budget-class metrics, the cumulative gross filled notional of every routed fill on record (traded-through, both sides — no position store exists); (4) for risk-budget-class metrics, the negative part of the net realized outcome over the outcome records readable by this fold. Drawdown-class metrics are unknown by construction (no equity curve exists on any backing); exposure/position-class metrics are unknown without a refusal observation (no position store exists).',
    'rows without fill economics (live recorded submissions carry no fill echo) are excluded from every sum.',
    'activeBreaches are every refused gateway submission on file for this project (the typed record: stage, bound-vs-observed per constraint, the audit ref, the instant); a refusal stands until a later observation of the same metric supersedes it — no resolution event class exists, so every refusal on file is standing.',
    'entryBlocked (FW-38-A, G-8) is computed from the constraint set ALONE — the desk-level entry analysis, exactly the pre-trade gate\'s own arithmetic evaluated at the entry candidate (an empty book, a sole first position): a BLOCKING constraint of an entry-decidable class (position.concentration; the position/gross-exposure count) whose entry projection is a construction constant (the first candidate is 100% of the projected book — fraction 1; the sole position is count 1) refuses every candidate before the desk can ever enter (limit.max bound < 1; a limit.min bound > 1 is a deadlock — refusals never grow the book or the count). An ADVISORY bound never blocks entry (the entry routes with the computed advisory stamp); classes whose entry projection depends on the candidate\'s own size (notional/budget/turnover) are not entry-decidable and are never claimed here. entryBlocked null means NO declared blocking constraint blocks entry by construction — a silent desk with entryBlocked null has no structural cause on record, and this read never fabricates one.',
    `bounds come from the project's own goal set on record (its create-project records). This read is ${backingClause(input.backing)}.`,
  ].join(' ');
  return deepFreeze({
    projectId: input.projectId,
    asOf: input.asOf,
    bounds: deepFreeze([...bounds]),
    activeBreaches: deepFreeze([...activeBreachesOf(input.submissions)]),
    // FW-38-A (G-8): the desk-level ENTRY-BLOCKED status — the named blocking
    // constraint + the teaching reason, additive on the read (the UI contract
    // the apps/web wave renders: "this desk cannot enter: <reason>").
    entryBlocked: deepFreeze(entryBlockedOf(input.goalSet)),
    disclosure,
  });
}

// ---------------------------------------------------------------------------
// The route (authn first, the param law, the typed errors — the W-8 law)
// ---------------------------------------------------------------------------

/**
 * Serve ONE GET /v1/risk/utilization?project=<id> request. The caller
 * (runtime/routes.ts's demo/durable dispatchers) invokes this only for the
 * exact path + GET method; every other shape falls through to the frozen
 * boundary (the typed not-found / method-not-allowed — the pre-FW-31-A
 * behavior, byte-identical).
 */
export function serveRiskUtilizationRoute(input: RiskUtilizationRouteInput, request: DemoSubstanceRequest, serial: number): ApiResponse {
  const requestId = riskRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 demo-substance routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return riskRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  const project = request.query?.project;
  if (project === undefined || !isProjectId(project)) {
    return riskRouteError(requestId, apiError('validation_failed', 'the project query parameter is required (the risk-utilization read is project-scoped)'));
  }
  // The project's own goal set — the constraint bounds' source. A degraded
  // projection answers the typed 503 (R46 — the goal read's own law); a
  // project with no goal set on record answers the typed not-found
  // (unknown and cross-tenant stay indistinguishable, the boundary's own law).
  const goalRead = input.goalSetOf(authorization.tenant, project);
  if (!goalRead.ok) {
    return riskRouteError(requestId, apiError('unavailable', `the durable projection is degraded (${goalRead.code}): ${goalRead.message} — the risk-utilization read answers the typed degraded state (R46)`));
  }
  if (goalRead.value === null) {
    return riskRouteError(requestId, apiError('not_found', `no goal statement exists for ${JSON.stringify(project)} at this host (the risk-utilization read serves the project's own create-project records; nothing is on record for this one)`));
  }
  // L12 by construction: both folds key on the AUTHORIZED tenant (the
  // credential tenant — a foreign tenant's records never exist in this
  // composition's stores to begin with).
  const submissions = input.submissionsOf(authorization.tenant, project);
  const outcomes = input.outcomesOf === null ? null : input.outcomesOf(authorization.tenant, project);
  const read = buildRiskUtilizationRead({
    projectId: project,
    goalSet: goalRead.value,
    submissions,
    outcomes,
    outcomesReadable: input.outcomesOf !== null,
    asOf: new Date().toISOString(),
    backing: input.backing,
  });
  return riskRouteSuccess(requestId, read);
}
