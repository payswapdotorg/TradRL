// deploy/vercel/runtime/note-compute.ts — THE E-6 COMPUTE LAYER (FW-48, M3's
// second YES-flip condition, verbatim: "the day the compute layer reads what
// I ingest AND pricing publishes sanely, my verdict flips"). ALL COMPUTE
// SERVER-SIDE, here in deploy/vercel/runtime where the work order prefers it
// — ZERO console.ts growth (the console renders the structured blocks via
// its already-total projection, pinned keep-green by render/model.test.ts).
//
// THE SEAM THIS CLOSES (ROUND-M-REPORT §2, M3's top standing friction):
// "the compute layer still reads nothing I ingest — my notes reach the chain
// verbatim but no research compute over my data". Since FW-45 the notes are
// stored verbatim and carried in the chain (seam e answered); nothing ever
// COMPUTED over them. This module is that compute — the honest, minimal
// version the repo's own laws bound:
//
//   - THE PARSE LAW: a note line in the CONSTRAINT GRAMMAR the launch
//     wizard already teaches (apps/web/src/core/launch-form.ts —
//     id:domain:subject:kind:bound[:severity]; domains
//     observation|state|action|outcome; kinds limit.min|limit.max|equals)
//     is a TYPED DECLARATION; every other line is evidence text. WHOLE-LINE
//     ONLY — no NLP, no mid-sentence extraction, never a fabricated
//     parameter. The bound is a POSITIVE exact decimal, carried VERBATIM
//     ('60000.00' stays '60000.00' — the note's own text, never normalized;
//     the gate's own positive-decimal law). ONE law, TWO surfaces: the same
//     grammar the host's pre-trade gate reads.
//   - THE HONEST BOUNDARY: free text stays free text. M1's Round M
//     desk-head digest (half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay
//     correlation 0.62) and EVERY Round M marker text parse ZERO parameters
//     — research-native parameters ride as EVIDENCE ONLY (the disclosed
//     remaining seam: a richer note-grammar the wizard would teach is the
//     NEXT step, never claimed here).
//   - THE PROVENANCE: every parsed parameter cites its own note (fromNote =
//     'note:<id>' — per-parameter provenance, REQUIRED at the parse, never
//     an unattributed parameter).
//   - THE INPUT SET (L4): the notes ride at their OWN attachedAt (the
//     record's own instants, never the composition clock), each named with
//     what it contributed; the input set rides the job record's own result
//     payload (durable + immutable-once-terminal via FW-47-B — there is no
//     separate input-set record class; the manifest's recordScopeNote/
//     derivedEventRule are untouched by design).
//   - THE EVALUATION LAW (the standing-book law): each note-derived
//     parameter is tested against the desk's OWN booked fill records — the
//     SAME GatewaySubmissionRecord rows the blotter/statistics/export fold,
//     ONE SOURCE OF TRUTH — classified by the SAME gateSubjectClassOf the
//     pre-trade gate reads (never a second classifier). The
//     order_notional/book_notional/daily_turnover classes evaluate in EXACT
//     DECIMALS (compareExactDecimalStrings + sumExactDecimalStrings, the
//     project-evidence folds — never a float, never a second arithmetic);
//     the per-kind breach test MIRRORS the gate's own law: limit.min
//     breaches BELOW the bound, limit.max and equals breach PAST it.
//   - THE HONEST NOT-COMPUTABLE CLASSES: position/concentration/
//     risk-consumption/drawdown/foreign subjects carry the standing law's
//     teaching ON the row (no position store, no equity curve, the foreign
//     class taught) — never a fabricated observation.
//   - ANALYSIS NEVER ENFORCEMENT (L20): every row is POST-HOC OBSERVATION
//     composed at research-job completion; the pre-trade gate ALONE refuses
//     candidates — these rows observe, they never refuse.
//
// THE NO-CYCLE LAW (the risk-utilization/promotion precedent): this module
// is imported BY runtime/deliverable.ts (+ its own test), so it imports
// TYPES + the pure project-evidence folds only — never './routes', never
// './demo', never './deliverable'.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive), R45
// (provenance), R46 (typed degradation, never a throw), L4 (the notes' own
// instants), L12 (the caller's own tenant-scoped rows — the fold receives
// only rows the authorized composition already read), L20 (analysis, never
// enforcement); ROUND-M-REPORT §2 + §4 (the E-6 seam); UX-DESIGN §7
// (anti-deception — the boundary is taught, never hidden).

import { deepFreeze, type GatewaySubmissionRecord } from '../../../services/api/src/index';
import type { ResearchNoteRecord } from './notes';
import {
  compareExactDecimalStrings,
  gateSubjectClassOf,
  sumExactDecimalStrings,
  type GateSubjectClass,
} from './project-evidence';

// ---------------------------------------------------------------------------
// The typed-declaration parse (the constraint grammar the wizard teaches)
// ---------------------------------------------------------------------------

/** The grammar's accepted domains (the closed set the wizard's own hint teaches). */
const DECLARATION_DOMAINS = ['observation', 'state', 'action', 'outcome'] as const;

/** The grammar's accepted kinds (the wizard's own hint; equals is the budget form). */
const DECLARATION_KINDS = ['limit.min', 'limit.max', 'equals'] as const;

/** The grammar's accepted severities (the optional suffix; blocking is the default). */
const DECLARATION_SEVERITIES = ['advisory', 'blocking'] as const;

/**
 * One WHOLE LINE of the constraint grammar, verbatim: the id (the wizard's
 * own identifier vocabulary), one of the closed domains, a DOTTED subject
 * path (the grammar's own subject spelling — 'order.notional', never 'order
 * notional'), one of the closed kinds, a POSITIVE exact-decimal bound
 * carried VERBATIM, and the optional severity suffix.
 */
const DECLARATION_PATTERN = new RegExp(
  `^([A-Za-z0-9][A-Za-z0-9_-]*)` // the id — non-empty, the wizard's identifier characters
    + `:(${DECLARATION_DOMAINS.join('|')})` // the domain — the closed set
    + ':([A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)+)' // the subject — a dotted identifier path
    + `:(${DECLARATION_KINDS.map((kind) => kind.replace('.', '\\.')).join('|')})` // the kind — the closed set
    + ':((?:0|[1-9][0-9]*)(?:\\.[0-9]+)?)' // the bound — a canonical decimal literal, captured WHOLE and carried VERBATIM (positivity checked below)
    + `(?::(${DECLARATION_SEVERITIES.join('|')}))?$`, // the optional severity suffix
);

/** The canonical positive exact decimal (the gate's own bound law — zero and negatives are not bounds). */
function isPositiveExactDecimal(bound: string): boolean {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(bound)) return false;
  const [whole, fraction = ''] = bound.split('.');
  return BigInt(`${whole}${fraction}`) > 0n;
}

/** One parsed TYPED DECLARATION — the note's own line, verbatim, with its per-parameter provenance. */
export interface NoteTypedDeclaration {
  /** The declaration's own id, verbatim (the wizard's identifier vocabulary — 'c-1', 'k-capital-budget'). */
  readonly id: string;
  /** The declaration's domain, verbatim (the closed set the wizard teaches). */
  readonly domain: string;
  /** The declaration's subject, verbatim (the dotted path the gate reads). */
  readonly subject: string;
  /** The declaration's kind, verbatim (limit.min | limit.max | equals). */
  readonly kind: string;
  /** The declared bound, VERBATIM — never normalized ('60000.00' stays '60000.00'; the note's own text). */
  readonly bound: string;
  /** The declared severity, verbatim (advisory | blocking; blocking is the grammar's default). */
  readonly severity: string;
  /** The per-parameter provenance, REQUIRED at the parse: the note the declaration rode ('note:<id>'). */
  readonly fromNote: string;
}

/**
 * Parse ONE note's typed declarations: each WHOLE LINE that is exactly the
 * constraint grammar the wizard already teaches becomes ONE typed
 * declaration (in the note's own line order); every other line — free text,
 * a digest, a marker, a grammar line embedded mid-sentence, an
 * almost-matching line — is EVIDENCE, never a parameter. The bound must be
 * a POSITIVE exact decimal (the gate's own law); the provenance is REQUIRED
 * (the caller passes the note's own id). Never a throw, never an NLP
 * extraction, never a fabricated parameter.
 */
export function parseNoteTypedDeclarations(text: string, fromNote: string): readonly NoteTypedDeclaration[] {
  if (typeof text !== 'string' || text.length === 0) return Object.freeze([]);
  const declarations: NoteTypedDeclaration[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = DECLARATION_PATTERN.exec(line);
    if (match === null) continue; // not the grammar, whole-line — evidence only
    const bound = match[5] as string;
    if (!isPositiveExactDecimal(bound)) continue; // zero/negative — the gate's own positive-decimal law
    declarations.push({
      id: match[1] as string,
      domain: match[2] as string,
      subject: match[3] as string,
      kind: match[4] as string,
      bound,
      severity: match[6] === undefined ? 'blocking' : (match[6] as string), // blocking is the grammar's default (the form's own law)
      fromNote,
    });
  }
  return Object.freeze(declarations);
}

// ---------------------------------------------------------------------------
// The input set (which notes, at which instants, what each contributed)
// ---------------------------------------------------------------------------

/** One note's own row in the compute's INPUT SET — at the record's OWN instant, with what it contributed. */
export interface NoteComputeInputNote {
  /** The note's own content-addressed id (the record's identity). */
  readonly noteId: string;
  /** The note's OWN attachedAt (L4 — the record's instant, never the composition clock). */
  readonly attachedAt: number;
  /** The note's own title, verbatim. */
  readonly title: string;
  /** What THIS note contributed: 'k typed parameter(s)' or 'evidence only' — the honest count, never a fabricated parameter. */
  readonly contributed: string;
}

/** THE COMPUTE'S INPUT SET: the notes it read (at their own instants), the parameters it parsed (with provenance), and the boundary disclosure. */
export interface NoteComputeInputs {
  /** Every note the compute read, in the record's own order, at their OWN attachedAt. */
  readonly notes: readonly NoteComputeInputNote[];
  /** Every typed declaration parsed from those notes (per-parameter provenance on every row). */
  readonly parameters: readonly NoteTypedDeclaration[];
  /** The disclosure that states the boundary itself (the anti-deception law's own surface). */
  readonly disclosure: string;
}

/** The boundary disclosure's shared teaching — the grammar, the provenance, and the honest limit (evidence only). */
const INPUT_BOUNDARY_TEACHING = 'a whole line in the constraint grammar the launch wizard already teaches (id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2) is parsed as a typed parameter with per-parameter provenance ("from note:<id>"); every other line rides as evidence only, never fabricated into parameters';

/** The empty input set's own disclosure — the empty set disclosed AS EMPTY, never a fabricated entry. */
const EMPTY_INPUT_DISCLOSURE = `the compute layer read no attached notes for this research job (the input set is empty, disclosed as empty — never a fabricated entry); ${INPUT_BOUNDARY_TEACHING}`;

/** The non-empty input set's disclosure — what the compute reads, and the boundary it holds. */
const INPUT_DISCLOSURE = `the compute layer reads the attached notes' own lines whole at research-job completion: ${INPUT_BOUNDARY_TEACHING}`;

/**
 * Compose the compute's INPUT SET over the notes the composition read (the
 * same rows the goal route serves — one source of truth): each note at its
 * OWN attachedAt with what it contributed, each parsed parameter with its
 * per-parameter provenance, and the boundary disclosure itself. An EMPTY
 * note list is the honestly-empty input set — zero notes, zero parameters,
 * the empty disclosure — never a fabricated entry. Pure, deterministic,
 * never a throw (R46).
 */
export function noteComputeInputsOf(notes: readonly ResearchNoteRecord[]): NoteComputeInputs {
  const inputNotes: NoteComputeInputNote[] = [];
  const parameters: NoteTypedDeclaration[] = [];
  for (const note of notes) {
    if (typeof note !== 'object' || note === null) continue; // a malformed row is skipped honestly, R46
    const parsed = parseNoteTypedDeclarations(note.text, note.noteId);
    parameters.push(...parsed);
    inputNotes.push({
      noteId: note.noteId,
      attachedAt: note.attachedAt, // L4 — the record's OWN instant, never the composition clock
      title: note.title,
      contributed: parsed.length === 0 ? 'evidence only' : `${parsed.length} typed parameter${parsed.length === 1 ? '' : 's'}`,
    });
  }
  return deepFreeze({
    notes: Object.freeze(inputNotes),
    parameters: Object.freeze(parameters),
    disclosure: inputNotes.length === 0 ? EMPTY_INPUT_DISCLOSURE : INPUT_DISCLOSURE,
  });
}

// ---------------------------------------------------------------------------
// The evaluation (the desk's OWN booked fills — the standing-book law)
// ---------------------------------------------------------------------------

/** One booked fill as the evaluation folds it (the statistics fold's own row law — notional + fee, exact decimals). */
interface BookedFill {
  readonly submissionId: string;
  readonly notional: string;
  readonly filledAt: number;
}

/** The standing-book fold: the ROUTED rows carrying honest fill economics — the SAME fill law deriveSessionStatistics rides (one source of truth). */
function bookedFillsOf(submissions: readonly GatewaySubmissionRecord[]): readonly BookedFill[] {
  const fills: BookedFill[] = [];
  for (const submission of submissions) {
    if (typeof submission !== 'object' || submission === null) continue; // R46
    if (submission.kind !== 'routed') continue; // refusals never booked a fill (the blotter's own law)
    const fill = (submission as { readonly fill?: { readonly notional?: unknown; readonly fee?: unknown; readonly filledAt?: unknown } }).fill;
    if (typeof fill !== 'object' || fill === null) continue; // routed without fill economics — not a booked fill
    const notional = fill.notional;
    const fee = fill.fee;
    if (typeof notional !== 'string' || typeof fee !== 'string') continue; // never a coerced operand
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(notional) || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(fee)) continue; // malformed economics — skipped honestly (R46)
    const filledAt = fill.filledAt;
    if (typeof filledAt !== 'number' || !Number.isFinite(filledAt)) continue;
    fills.push({ submissionId: submission.submissionId, notional, filledAt });
  }
  return Object.freeze(fills);
}

/** One note-derived parameter's evaluation — the observation itself, its basis, and its honest cause where no test is possible. */
export interface NoteParameterEvaluation {
  /** The declaration's own fields, verbatim (id/domain/subject/kind/bound/severity/fromNote — traceable). */
  readonly id: string;
  readonly domain: string;
  readonly subject: string;
  readonly kind: string;
  readonly bound: string;
  readonly severity: string;
  readonly fromNote: string;
  /** The SAME class the pre-trade gate reads (gateSubjectClassOf — one law, two surfaces, never a second classifier). */
  readonly subjectClass: GateSubjectClass;
  /** 'evaluated' when the desk's own records allow an exact test; 'not_computable' with the teaching on the row otherwise. */
  readonly status: 'evaluated' | 'not_computable';
  /** The observed figure in EXACT DECIMALS (the string-money law); null when not computable — never a fabricated observation. */
  readonly observed: string | null;
  /** 'exceeded' | 'within' by the gate's own per-kind breach law; null when not computable. */
  readonly verdict: 'exceeded' | 'within' | null;
  /** The citation: what was folded, the row count, the standing rows past the bound — the one-source-of-truth reconciliation. */
  readonly basis: string;
  /** The honest cause where no test is possible (the standing law's teaching, named ON the row). */
  readonly note: string;
}

/** The gate's own per-kind breach law, mirrored exactly: limit.min breaches BELOW the bound; limit.max and equals breach PAST it (never a second classifier). */
function breachVerdictOf(kind: string, observed: string, bound: string): 'exceeded' | 'within' | null {
  const comparison = compareExactDecimalStrings(observed, bound);
  if (comparison === null) return null; // malformed — never a fabricated verdict (R46)
  const breach = kind === 'limit.min' ? comparison === -1 : comparison === 1;
  return breach ? 'exceeded' : 'within';
}

/** The standing law's teaching for a class the post-hoc fold cannot observe — the honest not_computable note, named per class. */
function notComputableNoteOf(subject: string, subjectClass: GateSubjectClass): string {
  if (subjectClass === 'position_gross_exposure' || subjectClass === 'position_concentration') {
    return `not computable post-hoc over the booked fill records: ${subject} observes an open-position count/share and there is no position store on any backing — an open position cannot be derived from fills without fabricating a book (the standing risk-utilization law reads the same class honestly unknown; the bound stays declared and enforced at the pre-trade gate)`;
  }
  if (subjectClass === 'risk_consumption') {
    return `not computable post-hoc over the booked fill records: ${subject} observes the session outcome chain's realized cumulative (the standing risk-utilization law's own source), and this fold reads only the desk's booked fills — never a fabricated observation`;
  }
  if (subjectClass === 'drawdown') {
    return `not computable post-hoc over the booked fill records: ${subject} needs a mark-to-market series and no equity curve exists on any backing — a drawdown cannot be computed from fills without fabricating one (the standing risk-utilization law reads the same class honestly unknown)`;
  }
  return `not computable: ${subject} is not a subject class this deployment's gate or compute observes (the same honestly-unknown class the standing risk-utilization read reports) — the declaration rides as a typed parameter, never fabricated into an observation`;
}

/** The UTC trading day of one instant (YYYY-MM-DD — the standing read's own day law). */
function utcDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Evaluate the note-derived parameters against the desk's OWN booked fill
 * records (the SAME GatewaySubmissionRecord rows the blotter/statistics/
 * export fold — ONE SOURCE OF TRUTH; null = no session records on file at
 * all, the pre-FW-43-B caller shape). Each row carries the SAME subject
 * class the pre-trade gate reads (gateSubjectClassOf); the
 * order_notional/book_notional/daily_turnover classes evaluate in EXACT
 * DECIMALS with the gate's own per-kind breach law; every other class —
 * and every no-records/no-fills shape — carries its honest cause ON the
 * row (never a fabricated observation). ANALYSIS NEVER ENFORCEMENT (L20):
 * the rows observe, they never refuse. Pure, deterministic, never a throw.
 */
export function evaluateNoteParameters(
  parameters: readonly NoteTypedDeclaration[],
  submissions: readonly GatewaySubmissionRecord[] | null,
): readonly NoteParameterEvaluation[] {
  const fills = submissions === null ? null : bookedFillsOf(submissions);
  const evaluations: NoteParameterEvaluation[] = [];
  for (const parameter of parameters) {
    const subjectClass = gateSubjectClassOf(parameter.subject); // the SAME classifier the pre-trade gate reads
    const base = { id: parameter.id, domain: parameter.domain, subject: parameter.subject, kind: parameter.kind, bound: parameter.bound, severity: parameter.severity, fromNote: parameter.fromNote, subjectClass };
    // THE HONEST NOT-COMPUTABLE CLASSES — the standing law's teaching named on the row, never a fabricated observation.
    if (subjectClass !== 'order_notional' && subjectClass !== 'book_notional' && subjectClass !== 'daily_turnover') {
      evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: notComputableNoteOf(parameter.subject, subjectClass) }));
      continue;
    }
    // THE TWO DISTINCT HONEST CAUSES — never one blanket absence.
    if (fills === null) {
      evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: no session records on file for this project at this host (the composition read no session records — the note-declared bound is named, never tested against fabricated rows)' }));
      continue;
    }
    if (fills.length === 0) {
      evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: no fill records on file for this project at this host (the session records carry no booked fill — a desk that executed nothing; the note-declared bound is named, never tested)' }));
      continue;
    }
    const rowCount = `${fills.length} booked fill${fills.length === 1 ? '' : 's'}`;
    const oneSource = 'the same rows the execution blotter, the derived-statistics block and the workspace export carry — one source of truth';
    if (subjectClass === 'order_notional') {
      // The largest single booked fill's notional, in exact decimals.
      let largest = fills[0] as BookedFill;
      for (const fill of fills) {
        if ((compareExactDecimalStrings(fill.notional, largest.notional) ?? 0) === 1) largest = fill;
      }
      const verdict = breachVerdictOf(parameter.kind, largest.notional, parameter.bound);
      if (verdict === null) {
        evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: `not computable: the largest booked fill's notional could not be compared against the bound in exact decimals (a malformed operand — never a fabricated comparison)` }));
        continue;
      }
      const standing = fills.filter((fill) => breachVerdictOf(parameter.kind, fill.notional, parameter.bound) === 'exceeded');
      const basis = standing.length === 0
        ? `the largest single booked fill's notional, folded from ${rowCount} on record — no standing fill stands past the bound (${oneSource})`
        : `the largest single booked fill's notional, folded from ${rowCount} on record — the standing fills past the bound, itemized: ${standing.map((fill) => `${fill.submissionId} (notional ${fill.notional})`).join('; ')} (${oneSource})`;
      evaluations.push(deepFreeze({ ...base, status: 'evaluated', observed: largest.notional, verdict, basis, note: 'the largest single booked fill\'s notional observed post-hoc — analysis, never enforcement (L20: the pre-trade gate alone refuses candidates)' }));
      continue;
    }
    if (subjectClass === 'book_notional') {
      // The cumulative booked notional of the standing fills — the SAME exact-decimal fold the statistics block serves.
      const observed = sumExactDecimalStrings(fills.map((fill) => fill.notional));
      if (observed === null) {
        evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: the cumulative booked notional could not be derived in exact decimals (a malformed operand — never a fabricated figure)' }));
        continue;
      }
      const verdict = breachVerdictOf(parameter.kind, observed, parameter.bound);
      if (verdict === null) {
        evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: the cumulative booked notional could not be compared against the bound in exact decimals (never a fabricated comparison)' }));
        continue;
      }
      evaluations.push(deepFreeze({ ...base, status: 'evaluated', observed, verdict, basis: `the cumulative booked notional of the standing fills, folded from ${rowCount} on record (${oneSource}; the same fold the derived-statistics block's total serves)`, note: 'the cumulative booked notional observed post-hoc — analysis, never enforcement (L20: the pre-trade gate alone refuses candidates)' }));
      continue;
    }
    // daily_turnover — the LATEST UTC trading day's booked notional sum (an older day's fills never leak into the day-scoped observation).
    let latestDay = fills[0] as BookedFill;
    for (const fill of fills) {
      if (fill.filledAt > latestDay.filledAt) latestDay = fill;
    }
    const day = utcDayOf(latestDay.filledAt);
    const dayFills = fills.filter((fill) => utcDayOf(fill.filledAt) === day);
    const observed = sumExactDecimalStrings(dayFills.map((fill) => fill.notional));
    if (observed === null) {
      evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: the trading day\'s booked notional could not be derived in exact decimals (never a fabricated figure)' }));
      continue;
    }
    const verdict = breachVerdictOf(parameter.kind, observed, parameter.bound);
    if (verdict === null) {
      evaluations.push(deepFreeze({ ...base, status: 'not_computable', observed: null, verdict: null, basis: 'none', note: 'not computable: the trading day\'s booked notional could not be compared against the bound in exact decimals (never a fabricated comparison)' }));
      continue;
    }
    evaluations.push(deepFreeze({ ...base, status: 'evaluated', observed, verdict, basis: `the booked notional of trading day ${day} (UTC — the latest trading day on record), folded from ${dayFills.length} booked fill${dayFills.length === 1 ? '' : 's'} of the ${rowCount} on record (${oneSource})`, note: 'the latest trading day\'s booked notional observed post-hoc — analysis, never enforcement (L20: the pre-trade gate alone refuses candidates)' }));
  }
  return Object.freeze(evaluations);
}

// ---------------------------------------------------------------------------
// The analysis block (post-hoc observation — analysis, never enforcement)
// ---------------------------------------------------------------------------

/** THE NOTE-DERIVED ANALYSIS BLOCK: the evaluations + the post-hoc-observation statement (L20 on the block itself). */
export interface NoteAnalysisBlock {
  /** Every note-derived parameter's evaluation (one row per parsed declaration, the parse's own order). */
  readonly evaluations: readonly NoteParameterEvaluation[];
  /** The post-hoc-observation statement — the law named on the block itself. */
  readonly statement: string;
}

/** The analysis statement: post-hoc observation, analysis never enforcement, the pre-trade gate alone refuses (L20 verbatim on the block). */
const ANALYSIS_STATEMENT = "post-hoc observation composed at research-job completion over the desk's own booked fill records — analysis, never enforcement (L20: the pre-trade gate alone refuses candidates; these rows observe, they never refuse)";

/**
 * Compose the note-derived analysis over the notes the composition read:
 * parse their typed declarations and evaluate each against the desk's own
 * records. A note set with NO typed declaration composes NO analysis block
 * (nothing parsed — nothing to test; the evidence-only teaching rides the
 * input set's disclosure, never a fabricated analysis). Pure, deterministic,
 * never a throw (R46).
 */
export function noteAnalysisOf(notes: readonly ResearchNoteRecord[], submissions: readonly GatewaySubmissionRecord[] | null): NoteAnalysisBlock | null {
  const parameters: NoteTypedDeclaration[] = [];
  for (const note of notes) {
    if (typeof note !== 'object' || note === null) continue; // R46
    parameters.push(...parseNoteTypedDeclarations(note.text, note.noteId));
  }
  if (parameters.length === 0) return null;
  return deepFreeze({ evaluations: evaluateNoteParameters(Object.freeze(parameters), submissions), statement: ANALYSIS_STATEMENT });
}

