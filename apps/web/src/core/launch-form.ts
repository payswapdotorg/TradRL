// @tradrl/web-console — THE LAUNCH FORM MODEL (the J3 primary-flow
// entry, W-10c).
//
// THE HOLE THIS CLOSES (the Lead's J3 finding + W-10b's delivery
// note): the launch wizard RENDERS its labeled fields, but nothing
// ever dispatched `launch-draft-started` from the UI and the inputs
// carried no change wiring — the real user had NO WAY to enter the
// data (the delegated step/confirm branches were proven live, but
// only a test seeding a draft through handle.dispatch could reach
// them). This module is the pure bridge between the FORM (what the
// user types — strings) and the DRAFT (core/launch.ts's typed
// LaunchDraft the composition consumes):
//
//   blankLaunchDraft     the seeded draft the entry affordance starts
//                        from (honest defaults: an empty name/objective
//                        and empty budgets/lists so validation TEACHES,
//                        a one-day horizon from the start instant, the
//                        evaluation discipline the console composes for
//                        every launch, one floor success criterion —
//                        net profit non-negative — and the SIMULATION
//                        execution mode, the anti-deception default);
//   launchFieldValue     draft -> the form's string for one field
//                        (csv lists, the constraint grammar, epoch-ms
//                        horizons render as integers);
//   editLaunchField      one field's new string -> the next draft
//                        (pure, never throws — an unparseable value is
//                        simply NOT absorbed and stays pending in the
//                        form layer until it parses or is replaced);
//   launchFormValues     the merged live form (the draft's values +
//                        the app layer's pending edits — the render
//                        always shows what the user last typed);
//   launchFieldValidation the per-field §4.11 blur validation message
//                        ('' when valid) mirroring validateLaunchDraft's
//                        own per-field laws;
//   launchDraftProblems  the full problem list the REVIEW step gates
//                        on (every field's message — the launch confirm
//                        stays unreachable while any is non-empty; the
//                        submit path still runs the REAL
//                        validateLaunchDraft as defense in depth).
//
// Purity: no DOM, no clock (the start instant is INJECTED by the
// caller), no randomness. Spec anchors: UX-DESIGN §4.11 (labels above,
// inline validation on blur, the review step, the two-step confirm),
// §3 (Goal copy), R1/R36, the exact-decimal law.

import type { LaunchDraft, LaunchPreference } from './launch';
import type { ConstraintStatement, CriterionPredicate, ExecutionMode, SuccessCriterion } from '../api/contracts';
import { isNonNegativeDecimal } from './decimals';
import { isIdentifierPath } from './launch';

/** The launch wizard's editable fields (the form's own names — the data-launch-field vocabulary). */
export const LAUNCH_FIELD_NAMES = [
  'name',
  'objective',
  'capitalBudget',
  'riskBudget',
  'markets',
  'venues',
  'dataSources',
  'horizonStartsAt',
  'horizonEndsAt',
  'executionMode',
  'preferences',
  'constraints',
] as const;

/** One editable launch field. */
export type LaunchFieldName = (typeof LAUNCH_FIELD_NAMES)[number];

/** Guard: an editable launch field. */
export function isLaunchFieldName(value: unknown): value is LaunchFieldName {
  return typeof value === 'string' && (LAUNCH_FIELD_NAMES as readonly string[]).includes(value);
}

/** The editable form values (one string per field — exactly what the inputs carry). */
export interface LaunchFormValues {
  readonly name: string;
  readonly objective: string;
  readonly capitalBudget: string;
  readonly riskBudget: string;
  readonly markets: string;
  readonly venues: string;
  readonly dataSources: string;
  readonly horizonStartsAt: string;
  readonly horizonEndsAt: string;
  readonly executionMode: string;
  readonly preferences: string;
  readonly constraints: string;
}

// ---------------------------------------------------------------------------
// The seeded blank draft (the entry's starting point).
// ---------------------------------------------------------------------------

/** The console's floor success criterion — net profit non-negative (the honest default every launch carries). */
export const FLOOR_SUCCESS_CRITERION: SuccessCriterion = Object.freeze({
  id: 'sc-1',
  metric: 'pnl.net',
  predicate: { kind: 'limit.min', bound: 0 } as CriterionPredicate,
  description: 'net profit is non-negative',
});

/** The evaluation discipline the console composes for every launch (blind + walk-forward + regime suites; adversarial REQUIRED — L10). */
export const CONSOLE_EVALUATION: LaunchDraft['evaluation'] = Object.freeze({
  blindRef: 'eval:blind-console',
  walkForwardRef: 'eval:walk-forward-console',
  regimeRef: 'eval:regime-console',
  adversarialRequired: true,
});

/** The seeded blank draft the launch entry starts from (validation teaches; nothing is fabricated as filled). */
export function blankLaunchDraft(startAt: number): LaunchDraft {
  const dayMs = 86_400_000;
  return {
    name: '',
    objective: '',
    horizon: { startsAt: startAt, endsAt: startAt + dayMs, label: 'one day' },
    successCriteria: [FLOOR_SUCCESS_CRITERION],
    evaluation: CONSOLE_EVALUATION,
    constraints: [],
    capitalBudget: '',
    riskBudget: '',
    markets: [],
    venues: [],
    dataSources: [],
    executionMode: 'simulation',
    preferences: [],
  };
}

// ---------------------------------------------------------------------------
// The csv/grammar layers (pure string <-> typed value).
// ---------------------------------------------------------------------------

/** Split a comma-separated list (trimmed, empties dropped). */
export function parseListValue(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** Join a list back to the form's csv (the round-trip normalizer). */
export function formatListValue(entries: readonly string[]): string {
  return entries.join(', ');
}

/** One preference as `key=value` (the form's grammar). */
function formatPreference(preference: LaunchPreference): string {
  return `${preference.key}=${preference.value}`;
}

/** Parse the preferences grammar; null when any entry is malformed. */
export function parsePreferencesValue(value: string): readonly LaunchPreference[] | null {
  const entries = parseListValue(value);
  const preferences: LaunchPreference[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) return null;
    preferences.push({ key: entry.slice(0, separator).trim(), value: entry.slice(separator + 1).trim() });
  }
  return preferences;
}

/** The constraint grammar's field order (documented in the hint): id:domain:subject:kind:bound[:severity]. */
const CONSTRAINT_GRAMMAR_EXAMPLE = 'c-1:outcome:risk.maxDrawdown:limit.max:0.2';

/** The constraint grammar's legal predicate kinds (numeric bounds only — the form's own closed set). */
const CONSTRAINT_PREDICATE_KINDS: readonly ('limit.min' | 'limit.max' | 'equals')[] = ['limit.min', 'limit.max', 'equals'];

/** The constraint grammar's legal domains. */
const CONSTRAINT_DOMAINS: readonly ('observation' | 'state' | 'action' | 'outcome')[] = ['observation', 'state', 'action', 'outcome'];

/** The constraint grammar's legal severities. */
const CONSTRAINT_SEVERITIES: readonly ('advisory' | 'blocking')[] = ['advisory', 'blocking'];

/** FW-36-B (Round E register §3.7 — S2's 3 fix cycles): the ALLOWED vocabulary, disclosed where the grammar is taught. The domains + the predicate kinds as plain lists. */
export function constraintGrammarDomains(): readonly string[] {
  return [...CONSTRAINT_DOMAINS];
}

/** FW-36-B (§3.7): the legal predicate kinds (the subject is any dot-separated identifier path — the hint's own sentence). */
export function constraintGrammarKinds(): readonly string[] {
  return [...CONSTRAINT_PREDICATE_KINDS];
}

/** FW-36-B (§3.7): one plain sentence stating the whole allowed vocabulary (the hint + the malformed entry's message both carry it). */
export function constraintGrammarVocabularySentence(): string {
  return `Domains: ${CONSTRAINT_DOMAINS.join(', ')}. Kinds: ${CONSTRAINT_PREDICATE_KINDS.join(', ')}. Subjects: any dot-separated identifier path, e.g. risk.maxDrawdown or capital.perDesk.`;
}

/** One constraint as the form's grammar string. */
function formatConstraint(constraint: ConstraintStatement): string {
  const predicate = constraint.predicate as { kind: string; bound?: unknown; value?: unknown };
  const bound = typeof (predicate as { readonly bound?: unknown }).bound === 'number'
    ? (predicate as { readonly bound: number }).bound
    : typeof (predicate as { readonly value?: unknown }).value === 'number'
      ? (predicate as { readonly value: number }).value
      : 0;
  const severity = constraint.severity === 'advisory' ? ':advisory' : '';
  return `${constraint.id}:${constraint.domain}:${constraint.subject}:${predicate.kind}:${bound}${severity}`;
}

/** Parse ONE constraints-grammar entry; the REASON it is malformed (FW-36-B §3.7 — the message names WHICH part, never a bare refusal). */
function constraintEntryReason(entry: string): string | null {
  const parts = entry.split(':');
  if (parts.length < 5 || parts.length > 6) return 'the entry must have 5 or 6 colon-separated fields (id:domain:subject:kind:bound[:severity])';
  const [id, domain, subject, kind, boundText, severityText] = parts as [string, string, string, string, string, string | undefined];
  if (id.length === 0) return 'the id is empty';
  if (!(CONSTRAINT_DOMAINS as readonly string[]).includes(domain)) return `the domain "${domain}" is not allowed (allowed: ${CONSTRAINT_DOMAINS.join(', ')})`;
  if (!isIdentifierPath(subject)) return `the subject "${subject}" is not a dot-separated identifier path`;
  if (!CONSTRAINT_PREDICATE_KINDS.includes(kind as 'limit.max')) return `the kind "${kind}" is not allowed (allowed: ${CONSTRAINT_PREDICATE_KINDS.join(', ')})`;
  if (!Number.isFinite(Number(boundText))) return `the bound "${boundText}" is not a finite number`;
  if (severityText !== undefined && severityText !== 'advisory' && severityText !== 'blocking') return 'the severity must be advisory or blocking';
  return null;
}

/** Parse ONE constraints-grammar entry; false when it is malformed (the per-entry half of the grammar — D-6b's offender-naming validation reads the same law). */
function constraintEntryParses(entry: string): boolean {
  return constraintEntryReason(entry) === null;
}

/** Parse the constraints grammar; null when any entry is malformed (never a partial list). */
export function parseConstraintsValue(value: string): readonly ConstraintStatement[] | null {
  const entries = parseListValue(value);
  const constraints: ConstraintStatement[] = [];
  for (const entry of entries) {
    if (!constraintEntryParses(entry)) return null;
    const [id, domain, subject, kind, boundText, severityText] = entry.split(':') as [string, string, string, string, string, string | undefined];
    const bound = Number(boundText);
    const severity: 'advisory' | 'blocking' = severityText === 'advisory' ? 'advisory' : 'blocking';
    const predicate: CriterionPredicate = (kind === 'equals' ? { kind: 'equals', value: bound } : { kind, bound }) as CriterionPredicate;
    constraints.push({ id, domain: domain as 'outcome', subject, predicate, severity });
  }
  return constraints;
}

/**
 * The FIRST malformed constraints entry (D-6b, W-25C — the offender-
 * naming validation): its 1-BASED index among the comma-separated
 * entries, the raw entry text, and the REASON (FW-36-B §3.7 — S2's
 * finding: "the FIX alert does not disclose the valid domain
 * vocabulary"; 3 fix cycles). Null when every entry parses (an empty
 * list is valid — nothing names nothing).
 */
export function firstBadConstraintEntry(value: string): { readonly index: number; readonly entry: string; readonly reason: string } | null {
  const entries = parseListValue(value);
  for (let position = 0; position < entries.length; position += 1) {
    const entry = entries[position] as string;
    const reason = constraintEntryReason(entry);
    if (reason !== null) return { index: position + 1, entry, reason };
  }
  return null;
}

/** The legal execution modes (the select's options — the closed set). */
export const EXECUTION_MODES: readonly ExecutionMode[] = ['simulation', 'shadow', 'live'];

// ---------------------------------------------------------------------------
// The horizon datetime grammar (FW-33-B, Round B blocker 3).
// ---------------------------------------------------------------------------

/**
 * THE HORIZON INPUT GRAMMAR (FW-33-B, Round B blocker 3 — S5's finding:
 * "ISO dates parse to 0; a CFO must hand-compute epoch milliseconds").
 * The wizard's horizon inputs are `datetime-local` controls: their value
 * grammar is `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` / `YYYY-MM-DDTHH:mm:ss`,
 * interpreted as UTC (the console's whole instant discipline is UTC —
 * the review line, the readouts, the availability projections; the
 * input's hint says so). A bare integer string (epoch milliseconds)
 * still parses — the seeded drafts and every pre-FW-33-B edit round-
 * trip unchanged. Purity: no Date parsing (no clock, no timezone
 * reads) — the components map through Date.UTC directly.
 */

/** The datetime-local grammar (date-only, minute or second precision — the browser's own value shapes). */
const HORIZON_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** True when the day-of-month/month pair is a real calendar date (Feb 30 is not). */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths: readonly number[] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const length = lengths[month - 1] ?? 0;
  return day <= length;
}

/** The seconds component of a parsed horizon match (absent = 0). */
function secondOfMatch(match: RegExpMatchArray): number {
  const raw = match[6];
  return raw === undefined ? 0 : Number(raw);
}

/**
 * Parse one horizon input's string to epoch milliseconds; null when it
 * is neither the datetime grammar nor a bare epoch-ms integer. Pure and
 * total — never throws, never reads a clock.
 */
export function parseHorizonInstant(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const asInteger = Number(trimmed);
  if (Number.isInteger(asInteger)) return asInteger; // the epoch-ms form (seeds, pre-FW-33-B edits)
  const match = HORIZON_DATETIME_PATTERN.exec(trimmed);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = secondOfMatch(match);
  if (year < 1000) return null; // Date.UTC remaps 0-99 to 1900+year — a silently-wrong instant, never absorbed
  if (!isRealCalendarDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The two-digit zero-padded form of one calendar component. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Format epoch milliseconds as the datetime-local grammar at SECOND
 * precision, UTC (`2026-01-15T09:30:00` — the input's own value shape,
 * so a seeded draft renders as a real date the professional can read
 * and edit, never a 13-digit epoch integer). SECOND precision is the
 * lossless choice: a minute-truncated form value would round-trip a
 * :20-seeded instant to :00 and the review line would render an
 * instant that was never chosen — the exactness law wins over a
 * cleaner-looking picker.
 */
export function formatHorizonInstant(at: number): string {
  const date = new Date(at);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

// ---------------------------------------------------------------------------
// draft <-> form values.
// ---------------------------------------------------------------------------

/** The form's string for one field of a draft (the round-trip normalizer). */
export function launchFieldValue(draft: LaunchDraft, field: LaunchFieldName): string {
  if (field === 'name') return draft.name;
  if (field === 'objective') return draft.objective;
  if (field === 'capitalBudget') return draft.capitalBudget;
  if (field === 'riskBudget') return draft.riskBudget;
  if (field === 'markets') return formatListValue(draft.markets);
  if (field === 'venues') return formatListValue(draft.venues);
  if (field === 'dataSources') return formatListValue(draft.dataSources);
  if (field === 'horizonStartsAt') return formatHorizonInstant(draft.horizon.startsAt);
  if (field === 'horizonEndsAt') return formatHorizonInstant(draft.horizon.endsAt);
  if (field === 'executionMode') return draft.executionMode;
  if (field === 'preferences') return formatListValue(draft.preferences.map(formatPreference));
  return formatListValue(draft.constraints.map(formatConstraint));
}

/** The form's values for a whole draft. */
export function launchFormValuesOfDraft(draft: LaunchDraft): LaunchFormValues {
  return {
    name: launchFieldValue(draft, 'name'),
    objective: launchFieldValue(draft, 'objective'),
    capitalBudget: launchFieldValue(draft, 'capitalBudget'),
    riskBudget: launchFieldValue(draft, 'riskBudget'),
    markets: launchFieldValue(draft, 'markets'),
    venues: launchFieldValue(draft, 'venues'),
    dataSources: launchFieldValue(draft, 'dataSources'),
    horizonStartsAt: launchFieldValue(draft, 'horizonStartsAt'),
    horizonEndsAt: launchFieldValue(draft, 'horizonEndsAt'),
    executionMode: launchFieldValue(draft, 'executionMode'),
    preferences: launchFieldValue(draft, 'preferences'),
    constraints: launchFieldValue(draft, 'constraints'),
  };
}

/**
 * The merged live form: the draft's values overridden by the app
 * layer's PENDING edits (the app buffers field edits in its view —
 * this merge is what the rendered inputs carry, so a re-render at any
 * instant never reverts what the user last typed, even before the
 * edit is committed into the state machine).
 */
export function launchFormValues(draft: LaunchDraft, pending: Readonly<Record<string, string>>): LaunchFormValues {
  const base = launchFormValuesOfDraft(draft);
  const merged: Record<string, string> = { ...base };
  for (const field of LAUNCH_FIELD_NAMES) {
    // ANY buffered edit overrides — including the EMPTY string: the
    // buffer is the live form, so a field the user just cleared stays
    // cleared across a re-render (the flush commits it into the draft
    // on the next action; until then the merge carries it).
    if (Object.prototype.hasOwnProperty.call(pending, field)) merged[field] = pending[field] as string;
  }
  return merged as unknown as LaunchFormValues;
}

// ---------------------------------------------------------------------------
// The edit (pure, never throws; unparseable values are not absorbed).
// ---------------------------------------------------------------------------

/**
 * Apply one field's new string to a draft. An UNPARSEABLE value (a
 * horizon the datetime grammar rejects, a malformed preference/
 * constraint list) is NOT absorbed: the returned draft keeps the
 * field's prior value and the raw string stays pending in the form
 * layer (the render keeps showing it via the merge, the validation
 * explains it, and the review gate blocks on it — nothing is silently
 * dropped or fabricated).
 *
 * FW-33-B (Round B blocker 3): the horizon fields parse the
 * datetime-local grammar (UTC) — `2026-01-15T09:30` is a first-class
 * value now, never a hand-computed epoch integer; a bare epoch-ms
 * integer still absorbs (the seeded drafts' round-trip).
 */
export function editLaunchField(draft: LaunchDraft, field: LaunchFieldName, value: string): LaunchDraft {
  const text = value.trim();
  if (field === 'name') return { ...draft, name: value };
  if (field === 'objective') return { ...draft, objective: value };
  if (field === 'capitalBudget') return { ...draft, capitalBudget: value.trim() };
  if (field === 'riskBudget') return { ...draft, riskBudget: value.trim() };
  if (field === 'markets') return { ...draft, markets: parseListValue(value) };
  if (field === 'venues') return { ...draft, venues: parseListValue(value) };
  if (field === 'dataSources') return { ...draft, dataSources: parseListValue(value) };
  if (field === 'horizonStartsAt') {
    const parsed = parseHorizonInstant(text);
    if (parsed === null) return draft;
    return { ...draft, horizon: { ...draft.horizon, startsAt: parsed } };
  }
  if (field === 'horizonEndsAt') {
    const parsed = parseHorizonInstant(text);
    if (parsed === null) return draft;
    return { ...draft, horizon: { ...draft.horizon, endsAt: parsed } };
  }
  if (field === 'executionMode') {
    if (!(EXECUTION_MODES as readonly string[]).includes(text)) return draft;
    return { ...draft, executionMode: text as ExecutionMode };
  }
  if (field === 'preferences') {
    const parsed = parsePreferencesValue(value);
    if (parsed === null) return draft;
    return { ...draft, preferences: parsed };
  }
  const parsed = parseConstraintsValue(value);
  if (parsed === null) return draft;
  return { ...draft, constraints: parsed };
}

/**
 * Whether an edit CAN be absorbed into the draft (the flush's test):
 * text fields absorb verbatim (their validation is the message, never
 * a parse); lists always parse; the horizon datetime/epoch grammars,
 * the mode and the preferences/constraints grammars absorb only when
 * they parse. An unabsorbed edit stays pending in the app layer's
 * buffer — still rendered via the merge, still explained by the
 * validation, still gating review.
 */
export function absorbedEdit(field: LaunchFieldName, value: string): boolean {
  if (field === 'name' || field === 'objective') return true;
  if (field === 'capitalBudget' || field === 'riskBudget') return true;
  if (field === 'markets' || field === 'venues' || field === 'dataSources') return true;
  if (field === 'horizonStartsAt' || field === 'horizonEndsAt') return parseHorizonInstant(value) !== null;
  if (field === 'executionMode') return (EXECUTION_MODES as readonly string[]).includes(value.trim());
  if (field === 'preferences') return parsePreferencesValue(value) !== null;
  return parseConstraintsValue(value) !== null;
}

// ---------------------------------------------------------------------------
// The per-field §4.11 validation (mirrors validateLaunchDraft's laws).
// ---------------------------------------------------------------------------

/** The per-field validation message ('' when the field is valid) — the inline blur validation's source. */
export function launchFieldValidation(values: LaunchFormValues, field: LaunchFieldName): string {
  if (field === 'name') return values.name.trim().length === 0 ? 'Give the launch a name.' : '';
  if (field === 'objective') return values.objective.trim().length === 0 ? 'Describe the objective in one sentence.' : '';
  if (field === 'capitalBudget') return isNonNegativeDecimal(values.capitalBudget.trim()) ? '' : 'Enter an exact non-negative decimal.';
  if (field === 'riskBudget') return isNonNegativeDecimal(values.riskBudget.trim()) ? '' : 'Enter an exact non-negative decimal.';
  if (field === 'markets') return parseListValue(values.markets).length === 0 ? 'List at least one market.' : '';
  if (field === 'venues') return parseListValue(values.venues).length === 0 ? 'List at least one venue.' : '';
  if (field === 'dataSources') return parseListValue(values.dataSources).length === 0 ? 'List at least one data source.' : '';
  if (field === 'horizonStartsAt' || field === 'horizonEndsAt') {
    // FW-33-B (Round B blocker 3): the horizon message names the
    // datetime grammar (UTC) — never "epoch milliseconds", never a
    // bare 0 (S5's finding: "ISO dates parse to 0; a CFO must
    // hand-compute epoch milliseconds"). The epoch-ms form stays legal
    // (the seeded drafts) but the TEACHING form is the date-and-time
    // one the input renders.
    const starts = parseHorizonInstant(values.horizonStartsAt);
    const ends = parseHorizonInstant(values.horizonEndsAt);
    if (starts === null || ends === null) return 'Enter the horizon as a UTC date and time, e.g. 2026-01-15T09:30:00 (epoch milliseconds also parse).';
    if (starts >= ends) return 'The horizon must end after it starts.';
    return '';
  }
  if (field === 'executionMode') return (EXECUTION_MODES as readonly string[]).includes(values.executionMode.trim()) ? '' : 'Choose an execution mode.';
  if (field === 'preferences') return parsePreferencesValue(values.preferences) === null ? 'Preferences are key=value pairs, e.g. rebalance=daily.' : '';
  // D-6b (W-25C): the constraint-format message NAMES the offending
  // entry — which one (1-based, among the comma-separated entries) and
  // what it says — plus the expected grammar (UX-DESIGN's error-copy
  // conventions: plain language, one sentence, the fix is in the
  // sentence). The same message rides the field's inline blur
  // validation AND the review banner's problem list, so the "FIX
  // BEFORE LAUNCHING" card can no longer fire without naming its
  // offender.
  const badConstraint = firstBadConstraintEntry(values.constraints);
  if (badConstraint !== null) {
    return `Constraints entry ${badConstraint.index} ("${badConstraint.entry}") is malformed — ${badConstraint.reason}. Each entry is id:domain:subject:kind:bound, e.g. ${CONSTRAINT_GRAMMAR_EXAMPLE}. ${constraintGrammarVocabularySentence()}`;
  }
  return '';
}

/**
 * The full problem list (the REVIEW step's gate): every field's
 * message, in field order. The launch confirm stays unreachable while
 * any problem is non-empty; the list renders as the review's
 * validation card so the user knows exactly what to fix.
 */
export function launchDraftProblems(values: LaunchFormValues): readonly (readonly [LaunchFieldName, string])[] {
  const problems: (readonly [LaunchFieldName, string])[] = [];
  for (const field of LAUNCH_FIELD_NAMES) {
    const message = launchFieldValidation(values, field);
    if (message.length > 0) problems.push([field, message] as const);
  }
  return problems;
}

/** The constraint grammar's documented example (the hint renders it). */
export function constraintGrammarExample(): string {
  return CONSTRAINT_GRAMMAR_EXAMPLE;
}
