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

/** Parse the constraints grammar; null when any entry is malformed (never a partial list). */
export function parseConstraintsValue(value: string): readonly ConstraintStatement[] | null {
  const entries = parseListValue(value);
  const constraints: ConstraintStatement[] = [];
  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length < 5 || parts.length > 6) return null;
    const [id, domain, subject, kind, boundText, severityText] = parts as [string, string, string, string, string, string | undefined];
    if (id.length === 0) return null;
    if (!(CONSTRAINT_DOMAINS as readonly string[]).includes(domain)) return null;
    if (!isIdentifierPath(subject)) return null;
    if (!CONSTRAINT_PREDICATE_KINDS.includes(kind as 'limit.max')) return null;
    const bound = Number(boundText);
    if (!Number.isFinite(bound)) return null;
    if (severityText !== undefined && severityText !== 'advisory' && severityText !== 'blocking') return null;
    const severity: 'advisory' | 'blocking' = severityText === 'advisory' ? 'advisory' : 'blocking';
    const predicate: CriterionPredicate = (kind === 'equals' ? { kind: 'equals', value: bound } : { kind, bound }) as CriterionPredicate;
    constraints.push({ id, domain: domain as 'outcome', subject, predicate, severity });
  }
  return constraints;
}

/** The legal execution modes (the select's options — the closed set). */
export const EXECUTION_MODES: readonly ExecutionMode[] = ['simulation', 'shadow', 'live'];

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
  if (field === 'horizonStartsAt') return String(draft.horizon.startsAt);
  if (field === 'horizonEndsAt') return String(draft.horizon.endsAt);
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
 * non-integer horizon, a malformed preference/constraint list) is NOT
 * absorbed: the returned draft keeps the field's prior value and the
 * raw string stays pending in the form layer (the render keeps showing
 * it via the merge, the validation explains it, and the review gate
 * blocks on it — nothing is silently dropped or fabricated).
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
    const parsed = Number(text);
    if (!Number.isInteger(parsed)) return draft;
    return { ...draft, horizon: { ...draft.horizon, startsAt: parsed } };
  }
  if (field === 'horizonEndsAt') {
    const parsed = Number(text);
    if (!Number.isInteger(parsed)) return draft;
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
 * a parse); lists always parse; the horizon/mode/preferences/
 * constraints grammars absorb only when they parse. An unabsorbed
 * edit stays pending in the app layer's buffer — still rendered via
 * the merge, still explained by the validation, still gating review.
 */
export function absorbedEdit(field: LaunchFieldName, value: string): boolean {
  if (field === 'name' || field === 'objective') return true;
  if (field === 'capitalBudget' || field === 'riskBudget') return true;
  if (field === 'markets' || field === 'venues' || field === 'dataSources') return true;
  if (field === 'horizonStartsAt' || field === 'horizonEndsAt') return Number.isInteger(Number(value.trim()));
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
    const starts = Number(values.horizonStartsAt.trim());
    const ends = Number(values.horizonEndsAt.trim());
    if (!Number.isInteger(starts) || !Number.isInteger(ends)) return 'Enter the horizon instants as epoch milliseconds.';
    if (starts >= ends) return 'The horizon must end after it starts.';
    return '';
  }
  if (field === 'executionMode') return (EXECUTION_MODES as readonly string[]).includes(values.executionMode.trim()) ? '' : 'Choose an execution mode.';
  if (field === 'preferences') return parsePreferencesValue(values.preferences) === null ? 'Preferences are key=value pairs, e.g. rebalance=daily.' : '';
  return parseConstraintsValue(values.constraints) === null ? `Each constraint is id:domain:subject:kind:bound, e.g. ${CONSTRAINT_GRAMMAR_EXAMPLE}.` : '';
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
