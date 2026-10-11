// deploy/vercel/runtime/deliverable.ts — THE RESEARCH DELIVERABLE COMPOSER
// (FW-36-A, Round E register E-1 — the #1 Round E blocker, 9/9 personas).
//
// THE HOLE THIS CLOSES (phase2-roundE-report.md §3 E-1): every research
// job's completion payload was the FIXED stub
//   { kind: 'release-candidate', specId: 'spec-demo-director', version: 1,
//     project: <id> }
// — zero goal numbers ever rendered. The console's RESULT section projects
// the payload's own fields (apps/web jobResultSectionOf), so the stub could
// only ever render the one generic notice sentence. M3's maximally
// numbers-dense goal (2418 round trips, 63% hit rate, 8bps cost budget,
// z-scores, half-life) produced the IDENTICAL bytes to everyone else's —
// the deliverable proved nothing about the mandate it served.
//
// THE HONESTY LAW (this wave's core — THE WORK ORDER'S OWN WORDS): the fix
// is NOT to invent backtest statistics. A fabricated "63% hit rate" would
// be a WORSE defect than the stub. The deliverable is COMPOSED from the
// project's ACTUAL records — the goal statement + constraint set its
// create-project request carried (the W-25B/W-25D captures), the launch
// world its kickoff job's spec carried (the W-28 capture), and the
// promoted-decision lineage the promotion registry holds at composition
// time — every number verbatim-traceable to a record the system actually
// holds. Two launches with different mandates produce observably different
// deliverable text (pinned by test); NO fixed sentence remains.
//
// THE COMPOSITION (pure, deterministic — never a wall clock, never a
// random, never a throw; a malformed input degrades to its honest
// statements, R46):
//   - `summary`  — the composed sentence: the markets/venues the world
//                  actually served, the declared budgets (verbatim), the
//                  goal's horizon, EVERY declared constraint (id + domain
//                  + subject + kind + bound), the honest lineage
//                  statement, and the SIMULATED disclosure;
//   - `markets` / `venues` — the observed world state (a launched desk's
//                  captured world; the demo project's SEEDED blotTER's own
//                  instruments — never a fabricated world record);
//   - `capitalBudget` / `riskBudget` — the mandate's declared budget texts
//                  (the budget constraints' own `equals` values, verbatim);
//   - `horizon` / `objective` — the goal's own records, verbatim;
//   - `constraints` — every declared constraint as a structured row
//                  (id + domain + subject + predicate) — traceable;
//   - `lineage`   — the promoted decision this deliverable led to (by
//                  outcome id) when one exists AT COMPOSITION TIME, else
//                  the honest "pending promotion" statement (the job
//                  record is composed once, at the completion transition —
//                  the frozen truth of that instant);
//   - `statistics` (FW-43-B, F-12) — the DERIVED-STATISTICS BLOCK folded
//                  from the session's own records (the fills: count,
//                  exact-decimal total booked notional, per-market
//                  distribution; the refusals: count + every bound they
//                  cite; the fees: exact-decimal total; the decisions:
//                  count + refs) — the SAME submission + decision records
//                  the execution blotter route and the workspace export
//                  carry (THE STANDING-BOOK LAW: one source of truth);
//                  an absent read composes the honest absence statement,
//                  never a fabricated figure;
//   - `disclosure` — the SIMULATED framing, stated (the research machinery
//                  is simulated substance under the console's badge).
//
// The payload is ADDITIVE on the pre-FW-36-A stub shape: `kind`, `specId`,
// `version` and `project` are preserved verbatim (the promotion route's
// releaseCandidateOf reads them; the frozen transitions route carries the
// result opaquely). The demo scope keeps its own director id
// (`spec-demo-director`); a launched desk's deliverable names the
// per-project launch director (`spec-launch-director` — the
// project-evidence convention).
//
// Zero-dep law: imports the frozen boundary's own types + primitives only.
// Spec anchors: R38 (evidence discipline), R45 (provenance), R46 (typed
// degradation), L4 (the lineage is the composition instant's own truth),
// L15 (project continuity), L20 (records, never re-decisions), UX-DESIGN
// §7 (anti-deception); phase2-roundE-report §3 E-1 + §6.1.

import {
  deepFreeze,
  type ConstraintSetStatement,
  type GatewaySubmissionRecord,
  type GoalStatement,
} from '../../../services/api/src/index';
import { horizonSpanLabel, type LaunchWorldRecord } from './demo';
/** The exact-decimal grammar (the boundary's wire grammar — apps/web core/decimals.ts's own pattern, mirrored verbatim). */
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** `true` when a string is an exact decimal literal (the wire grammar). */
function isExactDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/**
 * FW-43-B (F-12): THE BLOTTER'S OWN EXACT-DECIMAL SUM, mirrored verbatim
 * from apps/web/src/core/decimals.ts sumExactDecimals — the SAME law the
 * execution blotter's aggregate totals render (scale every operand to the
 * widest fraction length, add the scaled BigInts, un-scale; NEVER strip a
 * served trailing zero — '20472.60' stays '20472.60'), so the deliverable's
 * statistics reconcile STRING-FOR-STRING with the blotter the persona
 * audits (THE ONE-SOURCE-OF-TRUTH LAW: same rows, same figures). An empty
 * input sums to '0'; a malformed operand is the CALLER's skip (validated
 * per row before it ever reaches here — never a coerced operand).
 */
function sumBlotterDecimals(values: readonly string[]): string {
  if (values.length === 0) return '0';
  let widest = 0;
  for (const value of values) {
    const dot = value.indexOf('.');
    widest = Math.max(widest, dot === -1 ? 0 : value.length - dot - 1);
  }
  let sum = 0n;
  for (const value of values) {
    const negative = value.startsWith('-');
    const magnitude = negative ? value.slice(1) : value;
    const dot = magnitude.indexOf('.');
    const padded = dot === -1 ? magnitude + '0'.repeat(widest) : magnitude.slice(0, dot) + magnitude.slice(dot + 1).padEnd(widest, '0');
    sum += (negative ? -1n : 1n) * BigInt(padded);
  }
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(widest + 1, '0');
  const whole = widest === 0 ? digits : digits.slice(0, digits.length - widest);
  const fraction = widest === 0 ? '' : `.${digits.slice(digits.length - widest)}`;
  const combined = `${whole}${fraction}`;
  return negative ? `-${combined}` : combined;
}

// ---------------------------------------------------------------------------
// The composer's inputs (all explicit — never ambient, never a request value)
// ---------------------------------------------------------------------------

/** The project's mandate records on file: its captured goal + constraint set + launch world. */
export interface DeliverableMandate {
  /** The create-project input's goal statement, verbatim. */
  readonly goal: GoalStatement;
  /** The create-project input's constraint set, verbatim. */
  readonly constraintSet: ConstraintSetStatement;
  /** The kickoff job's captured launch world (null for the demo scope + pre-W-28/world-less launches). */
  readonly world: LaunchWorldRecord | null;
}

/** The observed world state the deliverable cites (what the world actually served for THIS project). */
export interface DeliverableObservedState {
  /** The market/instrument ids the world served (a launched desk's world; the demo project's seeded blotter). */
  readonly markets: readonly string[];
  /** The venue ids the world served. */
  readonly venues: readonly string[];
}

/** The promoted decision a deliverable led to, as the composition-time lineage holds it. */
export interface DeliverablePromotion {
  /** The promoted decision record's own outcome id (the decision→job backlink's other half). */
  readonly outcomeId: string;
}

// ---------------------------------------------------------------------------
// FW-43-B (F-12 — the derived-statistics block): the session's own records
// ---------------------------------------------------------------------------

/**
 * FW-43-B (F-12): THE SESSION'S OWN RECORDS the derived statistics fold —
 * the SAME records the execution blotter route and the workspace export
 * carry (THE STANDING-BOOK LAW: one source of truth, never a second).
 * `submissions` are the project's execution submission rows exactly as
 * the blotter fold serves them (seeded + derived + live, per backing);
 * `decisions` are the project's decision-stream records on file (the
 * outcome records — the seeded/derived/promoted cohort the outcomes fold
 * serves), as refs (the count + the traceable ids).
 */
export interface DeliverableSessionRecords {
  /** The project's execution submission rows (the blotter fold's own rows — routed fills, refused rows). */
  readonly submissions: readonly GatewaySubmissionRecord[];
  /** The project's decision-stream records on file, as refs (the outcome records the outcomes fold serves). */
  readonly decisions: readonly { readonly outcomeId: string }[];
}

/** One per-market slice of the fills distribution (first-appearance order over the fills). */
export interface SessionMarketFillSlice {
  readonly market: string;
  readonly fills: number;
  readonly notional: string;
}

/** THE DERIVED-STATISTICS BLOCK (F-12): every figure an exact-decimal fold of the session's own records. */
export interface DerivedSessionStatistics {
  /** The fills: count, total booked notional (exact decimal), the routed-without-fill count, the per-market distribution. */
  readonly fills: {
    readonly count: number;
    readonly notionalTotal: string;
    readonly routedWithoutFill: number;
    readonly markets: readonly SessionMarketFillSlice[];
  };
  /** The refusals: count + every bound they cite (one citation per refusal entry, verbatim-traceable). */
  readonly refusals: {
    readonly count: number;
    readonly boundsCited: readonly string[];
  };
  /** The fees: the exact-decimal total across the fills. */
  readonly fees: { readonly total: string };
  /** The decisions: the count + the refs of the decision records on file. */
  readonly decisions: { readonly count: number; readonly refs: readonly string[] };
  /** The source disclosure: what these figures fold, stated (the anti-deception law's own surface). */
  readonly derivedFrom: string;
}

/** The one refusal citation as the block renders it (constraintId + domain + subject + predicate + observed — traceable). */
function refusalCitationOf(entry: { readonly constraintId?: unknown; readonly domain?: unknown; readonly subject?: unknown; readonly predicate?: unknown; readonly observed?: unknown }): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  if (typeof entry.constraintId !== 'string' || entry.constraintId.length === 0) return null;
  const domain = typeof entry.domain === 'string' && entry.domain.length > 0 ? entry.domain : 'unknown-domain';
  const subject = typeof entry.subject === 'string' && entry.subject.length > 0 ? entry.subject : 'unknown-subject';
  const predicate = entry.predicate as { readonly kind?: unknown; readonly bound?: unknown } | null | undefined;
  const kind = typeof predicate === 'object' && predicate !== null && typeof predicate.kind === 'string' && predicate.kind.length > 0 ? predicate.kind : 'unknown-predicate';
  const bound = typeof predicate === 'object' && predicate !== null && typeof predicate.bound === 'string' && predicate.bound.length > 0
    ? predicate.bound
    : typeof predicate === 'object' && predicate !== null && typeof predicate.bound === 'number' && Number.isFinite(predicate.bound) ? String(predicate.bound) : 'unspecified';
  const observed = typeof entry.observed === 'string' && entry.observed.length > 0 ? entry.observed : typeof entry.observed === 'number' && Number.isFinite(entry.observed) ? String(entry.observed) : 'unobserved';
  return `${entry.constraintId} ${domain} ${subject} ${kind} bound ${bound} (observed ${observed})`;
}

/**
 * FW-43-B (F-12): THE DERIVED-STATISTICS FOLD (pure, deterministic, never
 * a throw). Fills are the routed rows that carry honest fill economics
 * (a `fill` with decimal notional + fee); the notional/fee totals are
 * EXACT-DECIMAL SUMS of the served strings (sumExactDecimalStrings —
 * never float arithmetic); the per-market distribution groups the fills
 * by their order echo's instrument (first-appearance order). Refusals
 * count their own row and cite every bound the record carries (L20 —
 * the gateway's verdict rendered, never re-decided). A malformed figure
 * is SKIPPED honestly (a fill without decimal economics counts
 * routed-without-fill; a malformed notional keeps its row out of the
 * totals) — never a fabricated number, never a crash (R46).
 */
export function deriveSessionStatistics(records: DeliverableSessionRecords): DerivedSessionStatistics {
  let fills = 0;
  let routedWithoutFill = 0;
  const notionals: string[] = [];
  const fees: string[] = [];
  const marketOrder: string[] = [];
  const marketFills = new Map<string, number>();
  const marketNotionals = new Map<string, string[]>();
  for (const submission of records.submissions) {
    if (typeof submission !== 'object' || submission === null) continue;
    if (submission.kind === 'refused') continue; // counted below (the refusals' own fold)
    const row = submission as { readonly fill?: { readonly notional?: unknown; readonly fee?: unknown }; readonly order?: { readonly instrumentId?: unknown } };
    const notional = row.fill !== undefined && typeof row.fill === 'object' && row.fill !== null && typeof (row.fill as { readonly notional?: unknown }).notional === 'string' ? (row.fill as { readonly notional: string }).notional : null;
    const fee = row.fill !== undefined && typeof row.fill === 'object' && row.fill !== null && typeof (row.fill as { readonly fee?: unknown }).fee === 'string' ? (row.fill as { readonly fee: string }).fee : null;
    if (notional === null || fee === null || !isExactDecimal(notional) || !isExactDecimal(fee)) {
      routedWithoutFill += 1; // routed, no honest fill economics (absent OR malformed) — never a fabricated fill
      continue;
    }
    fills += 1;
    notionals.push(notional);
    fees.push(fee);
    const market = row.order !== undefined && typeof row.order === 'object' && row.order !== null && typeof (row.order as { readonly instrumentId?: unknown }).instrumentId === 'string' && ((row.order as { readonly instrumentId: string }).instrumentId as string).length > 0
      ? (row.order as { readonly instrumentId: string }).instrumentId
      : 'unlabeled-market';
    if (!marketOrder.includes(market)) marketOrder.push(market);
    marketFills.set(market, (marketFills.get(market) ?? 0) + 1);
    const marketNotionalList = marketNotionals.get(market) ?? [];
    marketNotionalList.push(notional);
    marketNotionals.set(market, marketNotionalList);
  }
  let refusals = 0;
  const boundsCited: string[] = [];
  for (const submission of records.submissions) {
    if (typeof submission !== 'object' || submission === null) continue;
    if (submission.kind !== 'refused') continue;
    refusals += 1;
    const refusal = (submission as { readonly refusal?: { readonly refusals?: unknown } }).refusal;
    const entries = typeof refusal === 'object' && refusal !== null && Array.isArray((refusal as { readonly refusals?: unknown }).refusals) ? (refusal as { readonly refusals: readonly unknown[] }).refusals : [];
    for (const entry of entries) {
      const citation = refusalCitationOf(entry as Parameters<typeof refusalCitationOf>[0]);
      if (citation !== null) boundsCited.push(citation);
    }
  }
  const notionalTotal = sumBlotterDecimals(notionals);
  const feeTotal = sumBlotterDecimals(fees);
  const markets: SessionMarketFillSlice[] = marketOrder.map((market) => ({
    market,
    fills: marketFills.get(market) ?? 0,
    notional: sumBlotterDecimals(marketNotionals.get(market) ?? []),
  }));
  const decisions = records.decisions.filter((decision) => typeof decision === 'object' && decision !== null && typeof decision.outcomeId === 'string' && decision.outcomeId.length > 0);
  return deepFreeze({
    fills: deepFreeze({ count: fills, notionalTotal, routedWithoutFill, markets: Object.freeze(markets) }),
    refusals: deepFreeze({ count: refusals, boundsCited: Object.freeze([...boundsCited]) }),
    fees: deepFreeze({ total: feeTotal }),
    decisions: deepFreeze({ count: decisions.length, refs: Object.freeze(decisions.map((decision) => decision.outcomeId)) }),
    derivedFrom: "every figure is an exact-decimal fold of the session's own execution submission records and decision records on file at composition time — the same rows the execution blotter and the workspace export carry (one source of truth); never a fabricated research statistic",
  });
}

/**
 * The derived-statistics SENTENCE (the summary's own rendering — the same
 * figures as the structured block, word for word, so text and fields can
 * never disagree). Null when no session records are on file (the honest
 * absence statement is composed by the caller).
 */
function statisticsSentenceOf(statistics: DerivedSessionStatistics): string {
  // The honestly-empty session: one plain sentence, never a zero-stacked list.
  if (statistics.fills.count === 0 && statistics.refusals.count === 0 && statistics.decisions.count === 0) {
    return `The session's own records derive the statistics: no fills, no refusals and no decisions on record — every figure an exact-decimal fold of the session's own records, never a fabricated research statistic.`;
  }
  const routedNote = statistics.fills.routedWithoutFill > 0 ? `, ${statistics.fills.routedWithoutFill} routed without a fill record yet` : '';
  const fillsSentence = statistics.fills.count === 0
    ? `no fills on record (fees ${statistics.fees.total} total)${routedNote}`
    : `${statistics.fills.count} fill${statistics.fills.count === 1 ? '' : 's'} booked for a total notional of ${statistics.fills.notionalTotal} (fees ${statistics.fees.total} total), distributed ${statistics.fills.markets.map((slice) => `${slice.fills} on ${slice.market} (notional ${slice.notional})`).join(', ')}${routedNote}`;
  const refusalsSentence = `${statistics.refusals.count} refusal${statistics.refusals.count === 1 ? '' : 's'} the gateway stopped${statistics.refusals.boundsCited.length === 0 ? '' : `, citing the bound ${statistics.refusals.boundsCited.join(' and ')}`}`;
  const decisionsSentence = `${statistics.decisions.count} decision${statistics.decisions.count === 1 ? '' : 's'} on record`;
  return `The session's own records derive the statistics: ${fillsSentence}; ${refusalsSentence}; ${decisionsSentence}. Every figure is an exact-decimal fold of the session's own records — the same rows the execution blotter and the workspace export carry — SIMULATED substance, never a fabricated research statistic.`;
}

/** One attached research note as the deliverable cites it (the record's own identity + title — verbatim-traceable, never re-quoted). */
export interface DeliverableNoteRef {
  readonly noteId: string;
  readonly title: string;
}

/** The composed deliverable's notes block: the count, the refs, and — when notes are on record — the provenance statement (text and fields can never disagree). */
export interface DeliverableNotesBlock {
  readonly count: number;
  readonly refs: readonly DeliverableNoteRef[];
  /** Present exactly when `count > 0` (the statement names the refs + where their verbatim text lives); the honest-absence block carries no statement. */
  readonly statement?: string;
}

/** One composed release-candidate result payload's construction inputs. */
export interface ResearchDeliverableInput {
  /** The launched project the research job belongs to. */
  readonly project: string;
  /** The composing machinery's director id (the demo director for the demo scope; the per-project launch director otherwise). */
  readonly director: string;
  /** The project's mandate records on file (null when nothing is on record for the project at this host). */
  readonly mandate: DeliverableMandate | null;
  /** The markets/venues the world actually served (null when nothing is on record). */
  readonly observed: DeliverableObservedState | null;
  /** The promoted decision this deliverable led to, when one exists at composition time (else null). */
  readonly promotion: DeliverablePromotion | null;
  /**
   * FW-43-B (F-12): the project's own session records (the execution
   * submissions + the decision-stream refs), null when nothing is on
   * record. The composed payload carries the DERIVED-STATISTICS BLOCK
   * (fills/refusals/fees/decisions — exact-decimal folds of exactly
   * these records); an absent read composes the honest absence
   * statement, never a fabricated figure (THE HONESTY LAW).
   */
  readonly records?: DeliverableSessionRecords | null;
  /**
   * FW-45 (the E-6 research-world MVP): the project's attached research
   * notes as citable refs, null when none are on record. The composed
   * payload NAMES them in its provenance (count + titles — where the
   * verbatim text lives is named honestly: the goal-set row + the export
   * chain's note-attached events); an absent read composes the honest
   * absence, never a fabricated reference, and NOTHING computes over
   * the notes' text (the disclosed next step, never a claimed
   * capability).
   */
  readonly notes?: readonly DeliverableNoteRef[] | null;
}

// ---------------------------------------------------------------------------
// The mandate readers (structural, never a throw — R46)
// ---------------------------------------------------------------------------

/** One declared constraint as the deliverable cites it (id + domain + subject + predicate, traceable). */
export interface DeclaredConstraintFact {
  readonly id: string;
  readonly domain: string;
  readonly subject: string;
  readonly kind: string;
  readonly bound: string;
}

/** Read the mandate's declared constraints as citable facts (a malformed row is skipped, never a crash — R46). */
export function declaredConstraintFacts(constraintSet: ConstraintSetStatement): readonly DeclaredConstraintFact[] {
  const constraints = Array.isArray(constraintSet.constraints) ? constraintSet.constraints : [];
  const facts: DeclaredConstraintFact[] = [];
  for (const constraint of constraints) {
    if (typeof constraint !== 'object' || constraint === null) continue;
    const record = constraint as { readonly id?: unknown; readonly domain?: unknown; readonly subject?: unknown; readonly predicate?: unknown };
    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (typeof record.domain !== 'string' || record.domain.length === 0) continue;
    if (typeof record.subject !== 'string' || record.subject.length === 0) continue;
    const predicate = record.predicate;
    if (typeof predicate !== 'object' || predicate === null) continue;
    const predicateRecord = predicate as { readonly kind?: unknown; readonly bound?: unknown; readonly value?: unknown };
    if (typeof predicateRecord.kind !== 'string' || predicateRecord.kind.length === 0) continue;
    let bound = 'unspecified';
    if (typeof predicateRecord.bound === 'number' && Number.isFinite(predicateRecord.bound)) bound = String(predicateRecord.bound);
    else if (typeof predicateRecord.value === 'number' && Number.isFinite(predicateRecord.value)) bound = String(predicateRecord.value);
    else if (typeof predicateRecord.bound === 'string' && predicateRecord.bound.length > 0) bound = predicateRecord.bound;
    else if (typeof predicateRecord.value === 'string' && predicateRecord.value.length > 0) bound = predicateRecord.value;
    facts.push({ id: record.id, domain: record.domain, subject: record.subject, kind: predicateRecord.kind, bound });
  }
  return Object.freeze(facts);
}

/** Read the mandate's declared budget of one subject family ('capital'+'budget' or 'risk'+'budget'), verbatim ('not declared' when absent). */
function declaredBudgetOf(facts: readonly DeclaredConstraintFact[], ...words: readonly string[]): string {
  const match = facts.find((fact) => words.every((word) => fact.subject.includes(word)) && fact.bound !== 'unspecified');
  return match === undefined ? 'not declared' : match.bound;
}

/**
 * The goal's horizon as a readable, deterministic string (UTC ISO bounds +
 * the SPAN-DERIVED label — FW-37-A, Round F register F-4: the label is
 * COMPUTED from the bounds via horizonSpanLabel, never the record's own
 * free-text annotation trusted off the wire. The pre-fix defect, 8/9
 * personas: the console's launch draft stamps its 'one day' default and
 * never updates it, so 30/45/60/90-day horizons rendered "(one day)" here
 * while the dates stayed correct — the composed label can never contradict
 * the span it annotates).
 */
function horizonTextOf(goal: GoalStatement): string {
  const horizon = goal.horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown; readonly label?: unknown } | null;
  if (horizon === null || typeof horizon !== 'object') return 'no horizon on record';
  if (typeof horizon.startsAt !== 'number' || !Number.isFinite(horizon.startsAt) || typeof horizon.endsAt !== 'number' || !Number.isFinite(horizon.endsAt)) return 'no horizon on record';
  return `${new Date(horizon.startsAt).toISOString()} to ${new Date(horizon.endsAt).toISOString()} (span ${horizonSpanLabel(horizon.startsAt, horizon.endsAt)})`;
}

/**
 * The goal's horizon with the SPAN-DERIVED label (FW-37-A, F-4): the bounds
 * verbatim (the goal's own record) + the label COMPUTED from them — the
 * deliverable's structured horizon field and its summary text can never
 * disagree, and neither can carry a stale annotation off the launch draft.
 */
function horizonWithDerivedLabel(goal: GoalStatement): { readonly startsAt: number; readonly endsAt: number; readonly label: string } {
  const horizon = goal.horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown } | null;
  const startsAt = horizon !== null && typeof horizon === 'object' && typeof horizon.startsAt === 'number' && Number.isFinite(horizon.startsAt) ? horizon.startsAt : null;
  const endsAt = horizon !== null && typeof horizon === 'object' && typeof horizon.endsAt === 'number' && Number.isFinite(horizon.endsAt) ? horizon.endsAt : null;
  if (startsAt === null || endsAt === null) return { startsAt: 0, endsAt: 0, label: 'no horizon on record' };
  return { startsAt, endsAt, label: horizonSpanLabel(startsAt, endsAt) };
}

/**
 * THE COMPOSITION'S DELIVERABLE SOURCE (structural — both backings implement
 * it over their own captured surfaces, the demoProjectEvidenceOf /
 * durableProjectEvidenceOf precedent): the demo arm reads the W-25B goal-set
 * capture + the W-28 world capture; the durable arm reads the seam's hydrated
 * goal set (the same surfaces DurableEvidenceSource serves). Structural so a
 * backing may pass lighter readers in tests, and NULLABLE on every read — a
 * project with nothing on record composes its HONEST degraded statements
 * (never a fabricated number).
 */
export interface DeliverableSource {
  /** The project's captured mandate (goal + constraint set + launch world), null when nothing is on record at this host. */
  readonly mandateOf: (project: string) => DeliverableMandate | null;
  /**
   * FW-38-A (Round G register G-6 — the switch-path composition miss): the
   * mandate read's DEGRADED state, distinct from ABSENT. A backing whose
   * goal read is currently degraded (the durable projection in flight or
   * dirty) answers `true` here, and the machinery tick then NEVER completes
   * a research job in that state — the composition must read the CURRENT
   * project's goal record, never fall back to the honest-absence text ("a
   * capital budget of not declared ... across the horizon no goal on
   * record") while a goal exists behind a degraded read. ABSENT (the field
   * absent, or `false`) is the honest nothing-on-record case and composes
   * exactly as before (THE HONESTY LAW); the skipped job stays non-terminal
   * and the next tick — after the projection lands — composes the real
   * mandate.
   */
  readonly mandateDegradedOf?: (project: string) => boolean;
  /**
   * FW-42-A (Round J register I-4 — THE lying record, the write-then-read
   * law): true when the launch DECLARED a world (the backing's job port
   * sighted the console-launch spec for the project) but the goal read
   * currently carries NO world — the read is STALE relative to the write
   * the launch submitted, and the machinery tick must NOT complete the
   * research job in that state (the G-6 mandateDegradedOf precedent,
   * extended to the world). The composition must observe the launch world
   * a declared-world launch wrote — a deliverable that says "no launch
   * world on record" while the launch was accepted with a declared world
   * is a LYING RECORD, never acceptable. The job stays non-terminal and
   * the next tick — after the read catches up — composes the real world.
   * Optional + additive: a backing that never sights specs (the demo
   * arm's per-instance capture) omits it, and an absent world with NO
   * declaration composes the honest no-launch-world sentence exactly as
   * before (THE HONESTY LAW).
   */
  readonly worldReadStaleOf?: (project: string) => boolean;
  /** The markets/venues the world actually served, null when nothing is on record. */
  readonly observedOf: (project: string) => DeliverableObservedState | null;
  /** The promoted decision a job's deliverable led to, when one exists at composition time (else null — the honest pending statement). */
  readonly promotionOf: (jobId: string) => DeliverablePromotion | null;
  /**
   * FW-43-B (F-12 — the derived-statistics block): the project's own
   * session records (the execution submissions + the decision-stream
   * refs — the SAME records the blotter route and the workspace export
   * carry, THE STANDING-BOOK LAW). Optional + additive: a source that
   * serves no session records (the pre-FW-43-B callers, a lighter test
   * source) omits it, and the composer renders its honest absence
   * statement — never a fabricated figure. Null = nothing on record for
   * the project at this host (the honest absence, L12).
   */
  readonly sessionRecordsOf?: (project: string) => DeliverableSessionRecords | null;
  /**
   * FW-45 (the E-6 research-world MVP): the project's ATTACHED RESEARCH
   * NOTES as citable refs (noteId + title — count + titles is exactly
   * what the deliverable's provenance names; the notes' verbatim text
   * lives on the goal-set row and in the workspace export's
   * note-attached events, never re-quoted here). Optional + additive: a
   * source that serves no notes (the pre-FW-45 callers, a lighter test
   * source) omits it, and the composer renders its honest absence
   * statement — never a fabricated reference. Null = none on record for
   * the project at this host.
   */
  readonly notesOf?: (project: string) => readonly DeliverableNoteRef[] | null;
}

/** The honest degraded source (nothing on record anywhere) — every composition degrades to its honest statements, never a crash (R46). */
export const emptyDeliverableSource: DeliverableSource = deepFreeze({
  mandateOf: () => null,
  observedOf: () => null,
  promotionOf: () => null,
});

// ---------------------------------------------------------------------------
// THE COMPOSER (pure, deterministic, never a throw)
// ---------------------------------------------------------------------------

/**
 * Compose ONE research job's release-candidate result payload from the
 * project's own records. Every rendered number is a VERBATIM citation of a
 * record the input carries — the composer fabricates nothing (THE HONESTY
 * LAW). A missing record degrades to its honest statement ("not declared",
 * "no launch world on record", "pending promotion"), never a placeholder
 * number.
 */
export function composeResearchDeliverableResult(input: ResearchDeliverableInput): Record<string, unknown> {
  const { project, director, mandate, observed, promotion } = input;
  // FW-43-B (F-12 — the derived-statistics block): the session's own
  // records fold into the statistics (exact-decimal, traceable, SIMULATED
  // — the same rows the blotter/export carry); an ABSENT read composes the
  // honest absence sentence, never a fabricated figure (THE HONESTY LAW).
  const statistics = input.records !== undefined && input.records !== null ? deriveSessionStatistics(input.records) : null;
  const statisticsStatement = statistics === null
    ? 'no session records on file for this project at this host, so this deliverable composes no derived statistics (never a fabricated figure)'
    : statisticsSentenceOf(statistics);
  const facts = mandate === null ? [] : declaredConstraintFacts(mandate.constraintSet);
  const markets = observed !== null && observed.markets.length > 0 ? [...observed.markets] : [];
  const venues = observed !== null && observed.venues.length > 0 ? [...observed.venues] : [];
  const capitalBudget = declaredBudgetOf(facts, 'capital', 'budget');
  const riskBudget = declaredBudgetOf(facts, 'risk', 'budget');

  // THE WORLD-STATE SENTENCE — what the world actually served for THIS
  // project (a captured launch world, or the demo scope's own seeded
  // blotter — never a fabricated world record; the honest statement when
  // nothing is on record).
  const worldSentence = markets.length > 0
    ? `Simulated research session over ${markets.join(' and ')} on ${venues.join(' and ')}${mandate !== null && mandate.world !== null ? ' (the world the launch actually served)' : ' (the seeded session\'s own instruments)'}`
    : `Simulated research session with no launch world on record for ${project}`;

  // THE MANDATE'S DECLARED ACTUALS — verbatim-traceable (the budgets, the
  // horizon, EVERY declared constraint with id + domain + subject + kind +
  // bound). These are CITATIONS of the project's own records, never
  // computed relations and never invented statistics.
  const constraintList = facts.map((fact) => `${fact.id} (${fact.domain}, ${fact.subject}, ${fact.kind}, bound ${fact.bound})`).join('; ');
  const mandateSentence = `The mandate declares a capital budget of ${capitalBudget} and a risk budget of ${riskBudget}, across the horizon ${mandate === null ? 'no goal on record' : horizonTextOf(mandate.goal)}, under ${facts.length === 0 ? 'no declared constraints on record' : `${facts.length} declared constraint${facts.length === 1 ? '' : 's'}: ${constraintList}`}`;

  // THE HONEST LINEAGE STATEMENT — what the deliverable produced
  // downstream, by id, at composition time (the frozen truth of the
  // completion instant; a promotion minted later carries its own
  // decision→job backlink, the other half of the lineage).
  const lineageStatement = promotion !== null
    ? `promoted as the decision record ${promotion.outcomeId} (the promotion cites this deliverable through its own job backlink)`
    : 'pending promotion — no decision record cites this deliverable yet at composition time (the deliverable awaits the desk\'s promote action)';

  // THE SIMULATED DISCLOSURE — preserved verbatim in spirit: this is
  // simulated research substance, and every number above is the project's
  // own declared record, never a fabricated research statistic.
  const disclosure = 'a SIMULATED research deliverable — composed from this project\'s own captured records (the goal, the constraint set, the launch world) at completion time; it is simulated substance under the console\'s SIMULATED badge and never a fabricated research statistic';

  // FW-43-B (F-12): the derived-statistics statement rides the summary
  // between the mandate and the lineage — the persona-read surface (the
  // RESULT section renders this sentence; the structured `statistics`
  // field carries the same figures, so text and fields can never disagree).
  //
  // FW-45 (the E-6 MVP): the NOTES statement rides the same provenance
  // block — the count + every title + WHERE the verbatim text lives (the
  // goal-set row + the workspace export's note-attached events: the
  // deliverable NAMES the notes, never re-quotes them, and NOTHING
  // computes over their text — the disclosed next step, never a claimed
  // capability). An absent/unwired read composes the honest absence
  // sentence, never a fabricated reference.
  const notesRefs = input.notes === undefined || input.notes === null ? [] : [...input.notes];
  const notesStatement = notesRefs.length === 0
    ? 'no research notes attached to this project on record'
    : `${notesRefs.length} attached research note${notesRefs.length === 1 ? '' : 's'} (${notesRefs.map((ref) => JSON.stringify(ref.title)).join('; ')}) — their verbatim text lives on this project's goal-set record and in the workspace export's note-attached events, which carry it in the chain; nothing computes over it here`;
  const summary = `${worldSentence}. ${mandateSentence}. ${statisticsStatement}. Research provenance: ${notesStatement}. Downstream lineage: ${lineageStatement}. This is ${disclosure}.`;

  return deepFreeze({
    kind: 'release-candidate',
    specId: director,
    version: 1,
    project,
    title: `the research release candidate of ${project}`,
    summary,
    objective: mandate === null ? 'no goal statement on record for this project at this host' : mandate.goal.objective,
    markets: Object.freeze(markets),
    venues: Object.freeze(venues),
    capitalBudget,
    riskBudget,
    horizon: mandate === null
      ? Object.freeze({ statement: 'no goal statement on record for this project at this host' })
      : Object.freeze(horizonWithDerivedLabel(mandate.goal)),
    constraints: Object.freeze(facts.map((fact) => Object.freeze({ id: fact.id, domain: fact.domain, subject: fact.subject, kind: fact.kind, bound: fact.bound }))),
    // FW-43-B (F-12): the derived-statistics block — null when no session
    // records are on file (the honest absence, never a fabricated figure).
    statistics,
    // FW-45 (the E-6 MVP): the notes block — the count + the refs + the
    // statement exactly when notes are on record (the honest-absence block
    // carries count 0 + empty refs; text and fields can never disagree).
    notes: Object.freeze(notesRefs.length === 0
      ? { count: 0, refs: Object.freeze([]) }
      : { count: notesRefs.length, refs: Object.freeze(notesRefs.map((ref) => Object.freeze({ noteId: ref.noteId, title: ref.title }))), statement: notesStatement }),
    lineage: Object.freeze({
      promotedDecision: promotion === null ? null : promotion.outcomeId,
      statement: lineageStatement,
    }),
    disclosure,
  });
}
