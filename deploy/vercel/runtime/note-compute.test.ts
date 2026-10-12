// deploy/vercel/runtime/note-compute.test.ts — THE E-6 COMPUTE LAYER'S OWN
// PINS (FW-48, M3's second YES-flip condition: "the day the compute layer
// reads what I ingest AND pricing publishes sanely, my verdict flips").
//
// THE LAWS PINNED HERE (the work order's own words, each a seam the
// pre-FW-48 deployment disclosed as open — ROUND-M-REPORT §2: "nothing yet
// COMPUTES over the note text (the deeper E-6 world)"):
//
//   - THE PARSE LAW: a note line in the CONSTRAINT GRAMMAR the wizard
//     already teaches (id:domain:subject:kind:bound[:severity] — the same
//     grammar the host's pre-trade gate reads, ONE LAW TWO SURFACES) is a
//     typed declaration; every other line is evidence text. WHOLE-LINE
//     ONLY — no NLP, no mid-sentence extraction; the bound is a POSITIVE
//     exact decimal (the gate's own law).
//   - THE HONEST BOUNDARY: free text stays free text. M1's Round M
//     desk-head digest (half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay
//     correlation 0.62) and EVERY Round M marker text parse ZERO
//     parameters — a note carrying no typed declaration rides as evidence
//     only, never fabricated into parameters.
//   - THE PROVENANCE: every parsed parameter cites its own note
//     ("from note:<id>" — per-parameter provenance, required at the parse).
//   - THE INPUT SET: the notes ride at their OWN attachedAt (L4 — never
//     the composition clock), each named with what it contributed.
//   - THE EVALUATION LAW: each note-derived parameter is tested against
//     the desk's OWN booked fill records (the standing-book law — the SAME
//     GatewaySubmissionRecord rows the blotter/statistics/export fold, ONE
//     SOURCE OF TRUTH), classified by the SAME gateSubjectClassOf the
//     pre-trade gate reads; order_notional/book_notional/daily_turnover
//     evaluate in EXACT DECIMALS; the position/concentration/risk/
//     drawdown/foreign classes are honestly not_computable with the
//     standing law's teaching named on the row; the per-kind breach test
//     MIRRORS the gate's own law.
//   - ANALYSIS NEVER ENFORCEMENT (L20): the rows are post-hoc observation;
//     the pre-trade gate alone refuses candidates.
//
// The marker/digest texts are the Round M measured shapes verbatim
// (P2M-M1/M2/L2/L3/S1's own notes) — the honest boundary is pinned against
// the REAL free text the seats actually ingested, never a strawman.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord } from '../../../services/api/src/index';
import { demoSubmissionBlotter } from './demo';
import type { ResearchNoteRecord } from './notes';
import {
  evaluateNoteParameters,
  noteAnalysisOf,
  noteComputeInputsOf,
  parseNoteTypedDeclarations,
  type NoteParameterEvaluation,
} from './note-compute';
import { gateSubjectClassOf } from './project-evidence';

// ---------------------------------------------------------------------------
// The Round M fixtures (the measured shapes, verbatim)
// ---------------------------------------------------------------------------

const AT = 1_700_000_000_000;

/** M2's own marker note (note:78705f8a, the id the Round M export carried) — free-text priors + ONE grammar line. */
function markerNoteWithDeclaration(): ResearchNoteRecord {
  return {
    noteId: 'note:78705f8a',
    tenant: 'tenant-fw48',
    project: 'prj-fw48-deep',
    attachedAt: AT,
    title: 'M2 Round M desk research priors',
    text: 'P2M desk research priors — the sizing discipline the analysts run.\n'
      + 'c-1:outcome:order.notional:limit.max:30000\n'
      + 'half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62, turnover 8.3x/month, fee budget 2.5 bps',
  } as ResearchNoteRecord;
}

/** The control note — the same digest family, ZERO grammar lines (evidence only). */
function controlNote(): ResearchNoteRecord {
  return {
    noteId: 'note:43b8a354',
    tenant: 'tenant-fw48',
    project: 'prj-fw48-deep',
    attachedAt: AT + 1_000,
    title: 'Factset export notes',
    text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4',
  } as ResearchNoteRecord;
}

/** One booked-fill row in the boundary's own submission shape (the standing-book law's row). */
function fillRow(submissionId: string, notional: string, fee: string, filledAt: number): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId,
    decisionId: `xd:${submissionId}`,
    auditId: `xga:${submissionId}`,
    requestRef: `gor:${submissionId}`,
    venue: 'BROKER-FIX',
    adapterRef: 'adapter:demo-broker',
    channelRef: 'chan:demo-main',
    routedAt: filledAt,
    order: { clientOrderId: `ord-${submissionId}`, instrumentId: 'BTC-USD', venueId: 'BROKER-FIX', side: 'buy', kind: 'limit', quantity: '0.75', price: '61000.50', timeInForce: 'gtc', createdAt: new Date(filledAt).toISOString() },
    fill: { state: 'filled', quantity: '0.75', price: '61000.50', notional, fee, filledAt },
  } as unknown as GatewaySubmissionRecord;
}

// ---------------------------------------------------------------------------
// The parse law
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-48: the typed-declaration parse (the constraint grammar the wizard already teaches)', () => {
  it('a WHOLE LINE in the constraint grammar parses as ONE typed declaration — id, domain, subject, kind, the bound VERBATIM, the optional severity suffix (blocking the default)', () => {
    const parsed = parseNoteTypedDeclarations('c-1:outcome:order.notional:limit.max:30000', 'note:78705f8a');
    expect(parsed).toEqual([
      { id: 'c-1', domain: 'outcome', subject: 'order.notional', kind: 'limit.max', bound: '30000', severity: 'blocking', fromNote: 'note:78705f8a' },
    ]);
    // The optional severity suffix rides verbatim; blocking stays the default (the form's own law).
    const advisory = parseNoteTypedDeclarations('c-2:observation:costs.dailyTurnover:limit.max:50000:advisory', 'note:78705f8a');
    expect(advisory).toEqual([
      { id: 'c-2', domain: 'observation', subject: 'costs.dailyTurnover', kind: 'limit.max', bound: '50000', severity: 'advisory', fromNote: 'note:78705f8a' },
    ]);
    // The bound is carried VERBATIM (exact decimals — a trailing zero is the note's own text, never normalized).
    const precise = parseNoteTypedDeclarations('c-3:action:capital.budget:equals:60000.00', 'note:78705f8a');
    expect(precise[0]!.bound).toBe('60000.00');
    // ONE declaration per line, several lines per note — each its own row, in the note's own line order.
    const multi = parseNoteTypedDeclarations('intro line\nc-1:outcome:order.notional:limit.max:30000\nc-2:outcome:risk.maxDrawdown:limit.max:0.2\noutro line', 'note:78705f8a');
    expect(multi.map((entry) => entry.id)).toEqual(['c-1', 'c-2']);
  });

  it('N-2 (Round N register — the single-line note input, now closed at the console surface): the register\'s own multi-line shape — a typed-declaration grammar line plus a free-text desk-head digest line in ONE note — parses the grammar line as ONE typed parameter while the digest line rides EVIDENCE ONLY (the compute layer was already whole-line correct; the console\'s single-line input was the only broken link)', () => {
    // the exact shape the console's N-2 pin attaches through the now-multi-line textarea (apps/web console-interactions: the grammar line + the digest line, newline-separated)
    const registerNote = 'c-1:outcome:risk.maxDrawdown:limit.max:0.2\nDesk-head digest: half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62.';
    const parsed = parseNoteTypedDeclarations(registerNote, 'note:n2-1');
    expect(parsed).toEqual([
      { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', kind: 'limit.max', bound: '0.2', severity: 'blocking', fromNote: 'note:n2-1' }, // the grammar line — ONE typed parameter
    ]);
    // the digest line rode as evidence only (never a fabricated parameter) — the same fold the input set names
    const inputs = noteComputeInputsOf([{ noteId: 'note:n2-1', tenant: 'tenant-a', project: 'prj-a', attachedAt: AT, title: 'Sizing discipline priors', text: registerNote } as ResearchNoteRecord]);
    expect(inputs.notes[0]?.contributed).toBe('1 typed parameter');
    expect(inputs.parameters).toHaveLength(1);
  });

  it('WHOLE-LINE ONLY — grammar text embedded mid-sentence, prefixed, or suffixed NEVER parses (no NLP, no mid-sentence extraction, never a fabricated parameter)', () => {
    const from = 'note:78705f8a';
    expect(parseNoteTypedDeclarations('see c-1:outcome:order.notional:limit.max:30000 above', from)).toEqual([]);
    expect(parseNoteTypedDeclarations('c-1:outcome:order.notional:limit.max:30000 (the desk\'s cap)', from)).toEqual([]);
    expect(parseNoteTypedDeclarations('bound: c-1:outcome:order.notional:limit.max:30000', from)).toEqual([]);
    expect(parseNoteTypedDeclarations('the cap is c-1:outcome:order.notional:limit.max:30000 and it binds', from)).toEqual([]);
    expect(parseNoteTypedDeclarations('', from)).toEqual([]); // an empty note text parses nothing — honestly
  });

  it('THE HONEST BOUNDARY: M1\'s Round M desk-head digest parses ZERO parameters (half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62 — free text stays free text)', () => {
    // M1's own measured note text (P2M-M1, the marker M1-E6-M-ALPHA-3d8e digest): research-native
    // parameters ride as EVIDENCE ONLY, never parsed — the disclosed remaining seam.
    const m1Digest = 'M1 Round M macro oversight note.\n'
      + 'half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62, turnover 8.3x/month, fee budget 2.5 bps\n'
      + 'the desk-head digest above is the register\'s own measured shape';
    expect(parseNoteTypedDeclarations(m1Digest, 'note:4d6ac364')).toEqual([]);
  });

  it('THE HONEST BOUNDARY: every Round M marker text parses ZERO parameters (the markers the seats actually ingested — M1-E6-M-ALPHA-3d8e, P2M-L2-MARKER-9f3a, P2M-L3-MARKER-7a91, P2M-S2-MARKER-4f2a)', () => {
    const markerTexts = [
      // M1 (the macro oversight marker note).
      'M1-E6-M-ALPHA-3d8e — half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62, turnover 8.3x/month, fee budget 2.5 bps',
      // L2 (the lineage marker note — the priors digest: numbers that look like bounds, none in the grammar).
      'P2M-L2-MARKER-9f3a — half-life 5.8d, z 2.0/0.5, decay corr 0.58, turnover 6.2x/mo, fee 2.0 bps, dd ceiling 0.05',
      // L3 (the compliance risk marker note).
      'P2M-L3-MARKER-7a91 — L3 compliance risk note, Round M marker: the mandate\'s numbers stay in the mandate.',
      // S2 (the round-M desk note).
      'P2M-S2-MARKER-4f2a — S2 round-M desk note: the market surface holds, the fills reconcile.',
    ];
    for (const text of markerTexts) {
      expect(parseNoteTypedDeclarations(text, 'note:be8680ff'), `the marker text must parse ZERO parameters: ${text.slice(0, 40)}...`).toEqual([]);
    }
  });

  it('THE MALFORMED-GRAMMAR REJECTIONS: a line that almost matches is EVIDENCE, never a parameter — non-positive bound, unknown domain, unknown kind, unknown severity, wrong arity, non-decimal bound, non-dotted subject', () => {
    const from = 'note:78705f8a';
    const almosts = [
      'c-1:outcome:order.notional:limit.max:-0.2', // negative bound — the gate's own positive-decimal law
      'c-1:outcome:order.notional:limit.max:0', // zero is not a positive bound
      'c-1:outcome:order.notional:limit.max:0.0', // zero again, fraction form
      'c-1:finance:order.notional:limit.max:30000', // unknown domain (the closed set is observation|state|action|outcome)
      'c-1:outcome:order.notional:advisory.max:30000', // unknown kind (L3's own 'advisory.max' rejection)
      'c-1:outcome:order.notional:limit.max:30000:urgent', // unknown severity suffix
      'c-1:outcome:order.notional:limit.max', // four fields — the arity law
      'c-1:outcome:order.notional:limit.max:30000:advisory:extra', // seven fields — the arity law
      'c-1:outcome:order notional:limit.max:30000', // the subject is not a dotted identifier path
      'c-1:outcome:order.notional:limit.max:3e4', // not a decimal literal
      'c-1:outcome:order.notional:limit.max:30000.5.6', // not a decimal literal
      ':outcome:order.notional:limit.max:30000', // empty id
    ];
    for (const line of almosts) {
      expect(parseNoteTypedDeclarations(line, from), `the almost-matching line must ride as evidence: ${line}`).toEqual([]);
    }
  });

  it('THE PROVENANCE: every parsed parameter cites its own note (fromNote = the note id — the per-parameter provenance law, REQUIRED at the parse)', () => {
    const parsed = parseNoteTypedDeclarations('c-1:outcome:order.notional:limit.max:30000', 'note:78705f8a');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.fromNote).toBe('note:78705f8a'); // the note the declaration rode — never an unattributed parameter
    const other = parseNoteTypedDeclarations('c-1:outcome:order.notional:limit.max:30000', 'note:43b8a354');
    expect(other[0]!.fromNote).toBe('note:43b8a354'); // the same line, another note — the provenance follows the NOTE
  });
});

// ---------------------------------------------------------------------------
// The input set
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-48: the input set (which notes, at which instants, what each contributed)', () => {
  it('the notes ride at their OWN attachedAt with what each contributed — the parameter-carrying note named with its count, the evidence-only note named as evidence', () => {
    const inputs = noteComputeInputsOf([markerNoteWithDeclaration(), controlNote()]);
    // The notes at their OWN instants (L4 — never a composition clock), in the record's own order.
    expect(inputs.notes).toEqual([
      { noteId: 'note:78705f8a', attachedAt: AT, title: 'M2 Round M desk research priors', contributed: '1 typed parameter' },
      { noteId: 'note:43b8a354', attachedAt: AT + 1_000, title: 'Factset export notes', contributed: 'evidence only' },
    ]);
    // The parsed parameters carry the per-parameter provenance.
    expect(inputs.parameters).toEqual([
      { id: 'c-1', domain: 'outcome', subject: 'order.notional', kind: 'limit.max', bound: '30000', severity: 'blocking', fromNote: 'note:78705f8a' },
    ]);
    // The disclosure states the boundary itself (the anti-deception law's own surface).
    expect(inputs.disclosure).toContain('constraint grammar');
    expect(inputs.disclosure).toContain('evidence only');
    expect(inputs.disclosure).toContain('never fabricated into parameters');
    // An EMPTY note list is the honestly-empty input set: zero notes, zero
    // parameters, the empty disclosure — never a fabricated entry.
    const empty = noteComputeInputsOf([]);
    expect(empty.notes).toEqual([]);
    expect(empty.parameters).toEqual([]);
    expect(empty.disclosure).toContain('read no attached notes'); // the empty input set, disclosed as empty
  });
});

// ---------------------------------------------------------------------------
// The evaluation law (the desk's OWN booked fills — the standing-book law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-48: the evaluation against the desk\'s own booked fills (the standing-book law)', () => {
  /** The order.notional parameter the marker note declares (M2's own bound). */
  function orderNotionalParameter(bound: string, kind = 'limit.max') {
    return { id: 'c-1', domain: 'outcome', subject: 'order.notional', kind, bound, severity: 'blocking', fromNote: 'note:78705f8a' } as const;
  }

  it('THE EVALUATION LAW (order_notional): the largest single booked fill\'s notional in EXACT DECIMALS — the demo blotter\'s own 45750.375 past a 30000 limit.max is EXCEEDED; a 50000 bound is WITHIN', () => {
    const submissions = [...demoSubmissionBlotter()]; // 2 booked fills (45750.375 + 20472.60) + 1 refusal — the desk's own rows
    const exceeded = evaluateNoteParameters([orderNotionalParameter('30000')], submissions);
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0]!.subjectClass).toBe('order_notional'); // the SAME classifier the pre-trade gate reads
    expect(exceeded[0]!.status).toBe('evaluated');
    expect(exceeded[0]!.observed).toBe('45750.375'); // the largest single booked fill — exact decimals, never a float
    expect(exceeded[0]!.verdict).toBe('exceeded');
    expect(exceeded[0]!.basis).toContain('2 booked fill'); // the row count it folded — the one-source-of-truth citation
    expect(exceeded[0]!.basis).toContain(submissions[0]!.submissionId); // the standing fill past the bound, itemized (the blotter's OWN row id — the content-addressed xgs id, never a guessed literal)
    expect(exceeded[0]!.basis).not.toContain(submissions[1]!.submissionId); // the within-bound fill is never itemized (only the STANDING rows, never every row id)
    const within = evaluateNoteParameters([orderNotionalParameter('50000')], submissions);
    expect(within[0]!.observed).toBe('45750.375');
    expect(within[0]!.verdict).toBe('within');
    expect(within[0]!.basis).toContain('no standing fill stands past the bound');
  });

  it('THE EVALUATION LAW (book_notional): the cumulative booked notional of the standing fills (45750.375 + 20472.60 = 66222.975 — EXACT DECIMALS, the same fold the statistics block serves)', () => {
    const submissions = [...demoSubmissionBlotter()];
    const capital = { id: 'c-4', domain: 'outcome', subject: 'capital.budget', kind: 'limit.max', bound: '60000', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    const evaluated = evaluateNoteParameters([capital], submissions);
    expect(evaluated[0]!.subjectClass).toBe('book_notional');
    expect(evaluated[0]!.status).toBe('evaluated');
    expect(evaluated[0]!.observed).toBe('66222.975'); // 45750.375 + 20472.60 — the exact-decimal sum, never a float
    expect(evaluated[0]!.verdict).toBe('exceeded'); // 66222.975 > 60000
    expect(evaluated[0]!.basis).toContain('2 booked fill'); // the citation names the row count it folded
  });

  it('THE EVALUATION LAW (daily_turnover): the latest UTC trading day\'s booked notional sum — an older day\'s fills never leak into the day-scoped observation (the standing read\'s own day law)', () => {
    const dayOne = Date.UTC(2026, 0, 5, 10, 0, 0);
    const dayTwo = Date.UTC(2026, 0, 6, 10, 0, 0);
    const submissions = [
      fillRow('sub-day1-a', '100', '0.01', dayOne),
      fillRow('sub-day2-a', '50', '0.01', dayTwo),
      fillRow('sub-day2-b', '25', '0.01', dayTwo),
    ];
    const turnover = { id: 'c-2', domain: 'observation', subject: 'costs.dailyTurnover', kind: 'limit.max', bound: '60', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    const evaluated = evaluateNoteParameters([turnover], submissions);
    expect(evaluated[0]!.subjectClass).toBe('daily_turnover');
    expect(evaluated[0]!.status).toBe('evaluated');
    expect(evaluated[0]!.observed).toBe('75'); // 50 + 25 — the LATEST day only, never 175 (the older day never leaks)
    expect(evaluated[0]!.verdict).toBe('exceeded'); // 75 > 60
    expect(evaluated[0]!.basis).toContain('2026-01-06'); // the day named, UTC
  });

  it('THE PER-KIND BREACH TEST mirrors the gate\'s own law: limit.min breaches BELOW the bound, limit.max and equals breach PAST it (the equals bound is a cap — the gate\'s own arithmetic, never a second classifier)', () => {
    const submissions = [...demoSubmissionBlotter()];
    const minBound = { id: 'c-5', domain: 'outcome', subject: 'order.notional', kind: 'limit.min', bound: '50000', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    expect(evaluateNoteParameters([minBound], submissions)[0]!.verdict).toBe('exceeded'); // observed 45750.375 < the limit.min 50000 — the gate's own below-breach
    const minMet = { id: 'c-6', domain: 'outcome', subject: 'order.notional', kind: 'limit.min', bound: '40000', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    expect(evaluateNoteParameters([minMet], submissions)[0]!.verdict).toBe('within');
    const equalsCap = { id: 'c-7', domain: 'outcome', subject: 'capital.budget', kind: 'equals', bound: '60000', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    expect(evaluateNoteParameters([equalsCap], submissions)[0]!.verdict).toBe('exceeded'); // the equals bound is a cap past-ward (the gate's own law)
    const equalsUnder = { id: 'c-8', domain: 'outcome', subject: 'capital.budget', kind: 'equals', bound: '70000', severity: 'blocking', fromNote: 'note:78705f8a' } as const;
    expect(evaluateNoteParameters([equalsUnder], submissions)[0]!.verdict).toBe('within'); // under an equals bound is the gate's own non-breach
  });

  it('THE HONEST NOT-COMPUTABLE CLASSES: position/concentration/risk-consumption/drawdown/foreign subjects carry the standing law\'s teaching on the row — never a fabricated observation', () => {
    const submissions = [...demoSubmissionBlotter()];
    const notComputable = [
      { id: 'c-9', domain: 'outcome', subject: 'position.grossExposure', kind: 'limit.max', bound: '2', severity: 'blocking', fromNote: 'note:78705f8a' } as const,
      { id: 'c-10', domain: 'outcome', subject: 'position.concentration', kind: 'limit.max', bound: '0.25', severity: 'blocking', fromNote: 'note:78705f8a' } as const,
      { id: 'c-11', domain: 'outcome', subject: 'risk.budget', kind: 'limit.max', bound: '3000', severity: 'blocking', fromNote: 'note:78705f8a' } as const,
      { id: 'c-12', domain: 'outcome', subject: 'risk.maxDrawdown', kind: 'limit.max', bound: '0.07', severity: 'blocking', fromNote: 'note:78705f8a' } as const,
      { id: 'c-13', domain: 'observation', subject: 'signal.sharpe', kind: 'limit.max', bound: '3', severity: 'advisory', fromNote: 'note:78705f8a' } as const,
    ];
    const evaluated = evaluateNoteParameters(notComputable, submissions);
    const expectedClasses = ['position_gross_exposure', 'position_concentration', 'risk_consumption', 'drawdown', 'not_gate_evaluable'];
    for (let index = 0; index < notComputable.length; index += 1) {
      const row = evaluated[index] as NoteParameterEvaluation;
      expect(row.subjectClass, `the SAME classifier the pre-trade gate reads (one law, two surfaces): ${notComputable[index]!.subject}`).toBe(expectedClasses[index]);
      expect(gateSubjectClassOf(notComputable[index]!.subject)).toBe(expectedClasses[index]); // mirrored from the gate's own classifier, never a second one
      expect(row.status).toBe('not_computable');
      expect(row.observed).toBeNull(); // never a fabricated observation
      expect(row.verdict).toBeNull();
      expect(row.note.length).toBeGreaterThan(0); // the standing law's teaching, named ON the row
    }
    // The teaching names the standing causes: no position store, no equity curve.
    expect(evaluated[0]!.note).toContain('no position store');
    expect(evaluated[3]!.note).toContain('no equity curve');
    expect(evaluated[4]!.note).toContain('not a subject class this deployment'); // the foreign class, taught
  });

  it('THE TWO DISTINCT HONEST CAUSES: no session records on file vs no fill records on file — both taught distinctly, never one blanket absence', () => {
    const parameter = [orderNotionalParameter('30000')];
    // NULL session records (the pre-FW-43-B caller shape — nothing was read at all).
    const noRecords = evaluateNoteParameters(parameter, null);
    expect(noRecords[0]!.status).toBe('not_computable');
    expect(noRecords[0]!.observed).toBeNull();
    expect(noRecords[0]!.note).toContain('no session records on file');
    expect(noRecords[0]!.note).not.toContain('no fill records on file'); // the DISTINCT cause, never the blanket one
    // Session records on file but ZERO booked fills (a desk that executed nothing — the direct-submit shape M2 measured).
    const noFills = evaluateNoteParameters(parameter, []);
    expect(noFills[0]!.status).toBe('not_computable');
    expect(noFills[0]!.note).toContain('no fill records on file');
    expect(noFills[0]!.note).not.toContain('no session records on file');
    // A routed row WITHOUT fill economics is not a booked fill either (the statistics fold's own law — one source of truth).
    const routedWithoutFill = [{ kind: 'routed', submissionId: 'sub-pending', decisionId: 'xd:p', auditId: 'xga:p', requestRef: 'gor:p', venue: 'BROKER-FIX', adapterRef: 'adapter:demo-broker', channelRef: 'chan:demo-main', routedAt: AT } as unknown as GatewaySubmissionRecord];
    expect(evaluateNoteParameters(parameter, routedWithoutFill)[0]!.note).toContain('no fill records on file');
  });

  it('ANALYSIS NEVER ENFORCEMENT (L20): the analysis block is post-hoc observation — its statement names the law, and no row carries any refusal or enforcement verdict (the pre-trade gate alone refuses candidates)', () => {
    const submissions = [...demoSubmissionBlotter()];
    const analysis = noteAnalysisOf([markerNoteWithDeclaration(), controlNote()], submissions);
    expect(analysis).not.toBeNull();
    expect(analysis!.evaluations).toHaveLength(1); // the one parsed parameter, evaluated
    expect(analysis!.evaluations[0]!.verdict).toBe('exceeded'); // the observation itself — named, never acted on
    // The statement is the post-hoc-observation disclosure: analysis, never enforcement.
    expect(analysis!.statement).toContain('post-hoc observation');
    expect(analysis!.statement).toContain('analysis, never enforcement');
    expect(analysis!.statement).toContain('the pre-trade gate alone refuses'); // L20, named on the block itself
    // The verdict vocabulary is observational: exceeded/within — never the gate's refusal vocabulary.
    expect(analysis!.evaluations[0]!.verdict === 'exceeded' || analysis!.evaluations[0]!.verdict === 'within').toBe(true);
    // A note set with no typed declarations composes NO analysis block (nothing parsed — nothing to test; the
    // evidence-only teaching rides the inputs disclosure, never a fabricated analysis).
    expect(noteAnalysisOf([controlNote()], submissions)).toBeNull();
    expect(noteAnalysisOf([], submissions)).toBeNull();
  });
});
