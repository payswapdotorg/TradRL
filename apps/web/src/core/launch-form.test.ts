// Tests for core/launch-form.ts (the J3 form model — W-10c): the
// seeded blank draft, the field grammars' round-trips, the merge with
// pending edits, the per-field §4.11 validation mirroring
// validateLaunchDraft, and the review gate's problem list.
//
// Laws pinned here:
//   - the blank draft is HONEST: empty name/objective/budgets and
//     empty lists (validation teaches; nothing is fabricated as
//     filled), a one-day horizon from the injected start instant, the
//     floor success criterion + the console's evaluation discipline
//     (the composition's own inputs, not user claims), and the
//     SIMULATION execution mode (the anti-deception default);
//   - every field's edit round-trips through launchFieldValue;
//   - unparseable edits (non-integer horizons, malformed preference/
//     constraint entries) are never absorbed — never a throw, never a
//     silent partial parse;
//   - a form whose per-field problems are all empty PASSES the REAL
//     validateLaunchDraft (the review gate and the submit gate agree);
//   - the merge (draft + pending edits) is what the rendered inputs
//     carry, so a pending edit survives any re-render.

import { describe, expect, it } from 'vitest';
import type { LaunchDraft } from './launch';
import { validateLaunchDraft } from './launch';
import {
  LAUNCH_FIELD_NAMES,
  CONSTRAINT_SUBJECT_VOCABULARY,
  absorbedEdit,
  blankLaunchDraft,
  constraintGrammarHint,
  editLaunchField,
  firstBadConstraintEntry,
  formatHorizonInstant,
  isLaunchFieldName,
  launchFieldValidation,
  launchFieldValue,
  launchDraftProblems,
  launchFormValues,
  launchFormValuesOfDraft,
  launchStepFields,
  parseConstraintsValue,
  parseHorizonInstant,
  parseListValue,
  parsePreferencesValue,
  type LaunchFormValues,
  type LaunchFieldName,
} from './launch-form';

const T0 = 1_700_000_000_000;

/** A fully valid form (every field valid — the review gate's passing case). FW-33-B: the horizon fields carry the datetime-local grammar (UTC, second precision — the form's own canonical shape), never raw epoch ms. */
function validValues(): LaunchFormValues {
  return {
    name: 'Momentum scout',
    objective: 'Find and keep an edge in momentum.',
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    markets: 'binance:BTC-USDT, kraken:ETH-USDT',
    venues: 'binance, kraken',
    dataSources: 'candles:1m, ticker',
    horizonStartsAt: formatHorizonInstant(T0),
    horizonEndsAt: formatHorizonInstant(T0 + 86_400_000),
    executionMode: 'simulation',
    preferences: 'rebalance=daily, report=weekly',
    constraints: 'c-1:outcome:risk.maxDrawdown:limit.max:0.2, c-2:action:position.size:limit.max:10:advisory',
  };
}

describe('launch-form: the seeded blank draft', () => {
  it('is honest: empty where the user must speak, defaulted only where the console composes', () => {
    const draft = blankLaunchDraft(T0);
    expect(draft.name).toBe('');
    expect(draft.objective).toBe('');
    expect(draft.capitalBudget).toBe('');
    expect(draft.riskBudget).toBe('');
    expect(draft.markets).toEqual([]);
    expect(draft.venues).toEqual([]);
    expect(draft.dataSources).toEqual([]);
    expect(draft.executionMode).toBe('simulation'); // the SIMULATED anti-deception default
    expect(draft.horizon).toEqual({ startsAt: T0, endsAt: T0 + 86_400_000, label: 'one day' });
    expect(draft.successCriteria.length).toBeGreaterThan(0); // the floor criterion: the API needs >= 1
    expect(draft.evaluation.adversarialRequired).toBe(true); // L10: adversarial required
    expect(draft.preferences).toEqual([]);
    expect(draft.constraints).toEqual([]);
  });

  it('the blank draft FAILS validation until the user fills it (validation teaches)', () => {
    expect(() => validateLaunchDraft(blankLaunchDraft(T0))).toThrow();
    const problems = launchDraftProblems(launchFormValuesOfDraft(blankLaunchDraft(T0)));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('launch-form: the field grammars round-trip', () => {
  it('every field: edit -> draft -> the same canonical form value', () => {
    const values = validValues();
    let draft = blankLaunchDraft(T0);
    for (const field of LAUNCH_FIELD_NAMES) {
      draft = editLaunchField(draft, field, values[field]);
    }
    for (const field of LAUNCH_FIELD_NAMES) {
      expect(launchFieldValue(draft, field), field).toBe(values[field]);
    }
  });

  it('csv lists parse with trimming and empty-entry dropping', () => {
    expect(parseListValue(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(editLaunchField(blankLaunchDraft(T0), 'markets', ' binance:BTC-USDT , ,kraken:ETH-USDT ').markets).toEqual(['binance:BTC-USDT', 'kraken:ETH-USDT']);
  });

  it('preferences: key=value pairs; a malformed entry is refused whole (never a partial list)', () => {
    expect(parsePreferencesValue('rebalance=daily, report=weekly')).toEqual([{ key: 'rebalance', value: 'daily' }, { key: 'report', value: 'weekly' }]);
    expect(parsePreferencesValue('rebalance')).toBeNull();
    expect(parsePreferencesValue('=daily')).toBeNull();
    expect(parsePreferencesValue('rebalance=')).toBeNull();
  });

  it('constraints: the id:domain:subject:kind:bound[:severity] grammar; malformed entries are refused whole', () => {
    const parsed = parseConstraintsValue('c-1:outcome:risk.maxDrawdown:limit.max:0.2, c-2:action:position.size:limit.max:10:advisory');
    expect(parsed).toEqual([
      { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking' },
      { id: 'c-2', domain: 'action', subject: 'position.size', predicate: { kind: 'limit.max', bound: 10 }, severity: 'advisory' },
    ]);
    expect(parseConstraintsValue('c-1:bogus-domain:x:limit.max:1')).toBeNull();      // not a legal domain
    expect(parseConstraintsValue('c-1:outcome:not an identifier:limit.max:1')).toBeNull(); // not an identifier path
    expect(parseConstraintsValue('c-1:outcome:risk.maxDrawdown:limit.max:abc')).toBeNull(); // not a number
    expect(parseConstraintsValue('c-1:outcome:risk.maxDrawdown:bogus.kind:1')).toBeNull();  // not a legal predicate kind
    expect(parseConstraintsValue('c-1:outcome:risk.maxDrawdown:limit.max:1:bogus')).toBeNull(); // not a legal severity
  });

  it('unparseable edits are never absorbed (and never throw)', () => {
    const draft = blankLaunchDraft(T0);
    expect(editLaunchField(draft, 'horizonStartsAt', 'not-a-number').horizon.startsAt).toBe(T0); // kept
    expect(absorbedEdit('horizonStartsAt', 'not-a-number')).toBe(false);
    expect(editLaunchField(draft, 'preferences', 'broken').preferences).toEqual([]);
    expect(absorbedEdit('preferences', 'broken')).toBe(false);
    expect(editLaunchField(draft, 'constraints', 'nope').constraints).toEqual([]);
    expect(absorbedEdit('constraints', 'nope')).toBe(false);
    expect(editLaunchField(draft, 'executionMode', 'paper').executionMode).toBe('simulation');
    expect(absorbedEdit('executionMode', 'paper')).toBe(false);
    expect(absorbedEdit('name', '')).toBe(true); // text absorbs raw — the message teaches
  });

  it('a valid form passes the REAL validateLaunchDraft (the review gate and the submit gate agree)', () => {
    const draft = blankLaunchDraft(T0);
    const filled = LAUNCH_FIELD_NAMES.reduce((current, field) => editLaunchField(current, field, validValues()[field]), draft);
    expect(() => validateLaunchDraft(filled)).not.toThrow();
    expect(launchDraftProblems(validValues())).toEqual([]);
  });
});

describe('launch-form: the per-field §4.11 validation', () => {
  it('mirrors the pinned copy for every field', () => {
    const base = validValues();
    const cases: readonly (readonly [LaunchFieldName, string, string])[] = [
      ['name', '', 'Give the launch a name.'],
      ['objective', '  ', 'Describe the objective in one sentence.'],
      ['capitalBudget', '10.5.0', 'Enter an exact non-negative decimal.'],
      ['riskBudget', '-1', 'Enter an exact non-negative decimal.'],
      ['markets', ' , ,', 'List at least one market.'],
      ['venues', '', 'List at least one venue.'],
      ['dataSources', '   ', 'List at least one data source.'],
      ['horizonStartsAt', 'soon', 'Enter the horizon as a UTC date and time, e.g. 2026-01-15T09:30:00 (epoch milliseconds also parse).'],
      ['horizonEndsAt', 'never', 'Enter the horizon as a UTC date and time, e.g. 2026-01-15T09:30:00 (epoch milliseconds also parse).'],
      ['executionMode', 'paper', 'Choose an execution mode.'],
      // FW-47-B (Round M register M-6, the D-6b convention extended): the
      // preferences message NAMES the typed offender + teaches the grammar
      // (the optional/leave-empty contract included) — the pre-fix
      // grammar-less one-liner taught neither.
      ['preferences', 'broken', 'Preferences ("broken") are malformed — each entry is key=value, e.g. rebalance=daily, report=weekly (optional; leave empty for none).'],
      // D-6b (W-25C): the constraint message NAMES the offending entry —
      // which one (1-based) + what it says + the expected grammar. FW-40-C
      // (H-1): the message also pre-teaches the closed KIND + SEVERITY sets
      // (L3's 'advisory.max' rejection — a plausible kind under the product's
      // advisory taxonomy — is now named away at the field itself). FW-51:
      // the LIST grammar rides the same sentence (the separator named —
      // the message's own surface, updated with the fix).
      ['constraints', 'nope', 'Constraints entry 1 ("nope") is malformed — each entry is id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2 (kinds: limit.min | limit.max | equals; severities: :advisory | :blocking; separate entries with commas — a newline is not a separator).'],
    ];
    for (const [field, value, message] of cases) {
      const values = { ...base, [field]: value } as LaunchFormValues;
      expect(launchFieldValidation(values, field), `${field}: ${value}`).toBe(message);
    }
    for (const field of LAUNCH_FIELD_NAMES) {
      expect(launchFieldValidation(base, field), field).toBe('');
    }
  });

  it('the horizon PAIR: equal or inverted bounds are caught (on both fields)', () => {
    const base = validValues();
    const inverted = { ...base, horizonEndsAt: formatHorizonInstant(T0) } as LaunchFormValues; // equal to the start
    expect(launchFieldValidation(inverted, 'horizonEndsAt')).toBe('The horizon must end after it starts.');
    expect(launchFieldValidation(inverted, 'horizonStartsAt')).toBe('The horizon must end after it starts.');
    // the epoch-ms form (the seeded drafts' own shape) still validates
    const epochForm = { ...base, horizonStartsAt: String(T0), horizonEndsAt: String(T0) } as LaunchFormValues;
    expect(launchFieldValidation(epochForm, 'horizonStartsAt')).toBe('The horizon must end after it starts.');
  });

  // FW-51 (the Round N minors — S2's one recorded friction event: "the
  // constraints multi-entry separator still untaught at the field (newline
  // reads as one malformed entry, comma discovered by trial)", S3
  // corroborated). THE LAW: the malformed-entry message teaches the LIST
  // grammar too — the FW-47-B refusal precedent (teach on error: the
  // offender named + the grammar pre-taught) extended to the separator,
  // because S2's exact failure shape is two well-formed entries separated
  // by a newline reading as ONE malformed entry with no named fix.
  it('FW-51: the malformed-entry message TEACHES THE SEPARATOR — two newline-separated entries read as ONE malformed entry (S2\'s exact shape), and the message names the comma law', () => {
    const base = validValues();
    const first = 'c-1:outcome:risk.maxDrawdown:limit.max:0.2';
    const second = 'c-2:outcome:order.notional:limit.max:30000';
    const values = { ...base, constraints: `${first}\n${second}` } as LaunchFormValues; // S2's exact input shape: a newline between two well-formed entries
    // the newline is NOT a separator (parseListValue splits on commas only):
    // the two entries ride as ONE entry — entry 1, its raw text carrying the newline
    expect(firstBadConstraintEntry(values.constraints)).toEqual({ index: 1, entry: `${first}\n${second}` });
    const message = launchFieldValidation(values, 'constraints');
    expect(message).toContain('Constraints entry 1');
    // THE SEPARATOR TAUGHT AT THE REFUSAL — the fix is in the sentence
    // (UX-DESIGN's error-copy convention), so the comma is never discovered
    // by trial again
    expect(message).toContain('separate entries with commas — a newline is not a separator');
  });

  it('D-6b: the constraint validation names the OFFENDING entry — a mixed list points at the broken one (index + raw text), the good ones stay unnamed', () => {
    const base = validValues();
    const good = 'c-1:outcome:risk.maxDrawdown:limit.max:0.2';
    const alsoGood = 'c-2:action:position.size:limit.max:10:advisory';
    const broken = 'c-3:outcome:risk.maxDrawdown:limit.max:abc'; // not a number
    const values = { ...base, constraints: `${good}, ${alsoGood}, ${broken}` } as LaunchFormValues;
    expect(firstBadConstraintEntry(values.constraints)).toEqual({ index: 3, entry: broken });
    expect(launchFieldValidation(values, 'constraints')).toBe(
      `Constraints entry 3 ("${broken}") is malformed — each entry is id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2 (kinds: limit.min | limit.max | equals; severities: :advisory | :blocking; separate entries with commas — a newline is not a separator).`,
    );
    // the offender rides the REVIEW banner's problem list too (the D-6b surface: "FIX BEFORE LAUNCHING" names its offender)
    const problems = launchDraftProblems(values);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.[0]).toBe('constraints');
    expect(problems[0]?.[1]).toContain('Constraints entry 3');
    expect(problems[0]?.[1]).toContain(broken);
    // a first-entry failure names entry 1; a fully valid list names nothing
    const firstBroken = { ...base, constraints: `${broken}, ${good}` } as LaunchFormValues;
    expect(firstBadConstraintEntry(firstBroken.constraints)?.index).toBe(1);
    expect(firstBadConstraintEntry(base.constraints)).toBeNull();
    expect(launchFieldValidation(base, 'constraints')).toBe('');
  });

  it('launchDraftProblems lists every problem in field order (the review gate\'s input)', () => {
    const values = { ...validValues(), name: '', capitalBudget: 'x', venues: '' } as LaunchFormValues;
    expect(launchDraftProblems(values)).toEqual([
      ['name', 'Give the launch a name.'],
      ['capitalBudget', 'Enter an exact non-negative decimal.'],
      ['venues', 'List at least one venue.'],
    ]);
  });
});

describe('launch-form: the pending-edit merge', () => {
  it('pending edits override the draft\'s values (a re-render never reverts the last typed text)', () => {
    const draft = blankLaunchDraft(T0);
    draft && expect(launchFieldValue(draft, 'name')).toBe('');
    const merged = launchFormValues(draft, { name: 'Mom' });
    expect(merged.name).toBe('Mom');
    expect(merged.objective).toBe(launchFieldValue(draft, 'objective'));
  });

  it('an EMPTY buffered edit overrides too (a field just cleared stays cleared across a re-render)', () => {
    // a draft with a committed name, then the user clears the input:
    const filled = editLaunchField(blankLaunchDraft(T0), 'name', 'Momentum scout');
    const cleared = launchFormValues(filled, { name: '' });
    expect(cleared.name).toBe(''); // the merge carries the cleared text, not the committed value
    // an unbuffered field still reads the draft's own value:
    expect(cleared.objective).toBe(filled.objective);
  });

  it('the merge carries every field', () => {
    const draft = blankLaunchDraft(T0);
    const edits: Record<string, string> = { markets: 'a, b', horizonEndsAt: '123', executionMode: 'shadow' };
    const merged = launchFormValues(draft, edits);
    expect(merged.markets).toBe('a, b');
    expect(merged.horizonEndsAt).toBe('123');
    expect(merged.executionMode).toBe('shadow');
    expect(merged.dataSources).toBe('');
  });

  it('a filled draft plus its own edits round-trips (determinism of the merge layer)', () => {
    let draft: LaunchDraft = blankLaunchDraft(T0);
    for (const field of LAUNCH_FIELD_NAMES) draft = editLaunchField(draft, field, validValues()[field]);
    expect(launchFormValues(draft, {})).toEqual(validValues());
    expect(launchFormValues(draft, {})).toEqual(launchFormValuesOfDraft(draft));
  });
});

describe('launch-form: FW-33-B — the horizon datetime grammar (Round B blocker 3)', () => {
  it('parses the datetime-local grammar as UTC: date-only, minute and second precision', () => {
    // 2023-11-14T22:13:20Z = T0 (the whole console renders UTC; the input's hint says so)
    expect(parseHorizonInstant('2023-11-14T22:13:20')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
    expect(parseHorizonInstant('2023-11-14T22:13')).toBe(Date.UTC(2023, 10, 14, 22, 13, 0));
    expect(parseHorizonInstant('2023-11-14')).toBe(Date.UTC(2023, 10, 14, 0, 0, 0));
    expect(parseHorizonInstant('  2023-11-14T22:13:20  ')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20)); // trimmed
  });

  it('a bare epoch-ms integer still parses (the seeded drafts and pre-FW-33-B edits round-trip)', () => {
    expect(parseHorizonInstant(String(T0))).toBe(T0);
    expect(parseHorizonInstant('0')).toBe(0);
  });

  it('refuses what is neither: garbage, impossible calendars, impossible clock components, empty', () => {
    expect(parseHorizonInstant('')).toBeNull();
    expect(parseHorizonInstant('soon')).toBeNull();
    expect(parseHorizonInstant('2023-02-30')).toBeNull(); // Feb 30 is not a calendar date
    expect(parseHorizonInstant('2023-13-01')).toBeNull(); // month 13
    expect(parseHorizonInstant('2023-11-14T24:00')).toBeNull(); // hour 24
    expect(parseHorizonInstant('2023-11-14T22:60')).toBeNull(); // minute 60
    expect(parseHorizonInstant('2023-11-14T22:13:60')).toBeNull(); // second 60
    expect(parseHorizonInstant('14/11/2023')).toBeNull(); // a locale-form date, never silently re-read
    expect(parseHorizonInstant('0099-01-01')).toBeNull(); // Date.UTC remaps years <100 to 1900+year — never a silently-wrong instant
  });

  it('formatHorizonInstant renders the UTC datetime-local shape at SECOND precision (the lossless round-trip)', () => {
    expect(formatHorizonInstant(Date.UTC(2026, 0, 15, 9, 30, 0))).toBe('2026-01-15T09:30:00');
    expect(formatHorizonInstant(Date.UTC(2023, 10, 14, 22, 13, 20))).toBe('2023-11-14T22:13:20');
    // the seeded draft's horizon renders as a DATE, never a 13-digit epoch integer (S5's finding)
    const values = launchFormValuesOfDraft(blankLaunchDraft(T0));
    expect(values.horizonStartsAt).toBe('2023-11-14T22:13:20');
    expect(values.horizonStartsAt).not.toMatch(/^\d{13}$/);
    // and the round-trip is exact: format -> parse -> the same instant
    expect(parseHorizonInstant(values.horizonStartsAt)).toBe(T0);
  });

  it('editLaunchField absorbs a typed datetime and a typed epoch identically (one law, both forms)', () => {
    const draft = blankLaunchDraft(T0);
    expect(editLaunchField(draft, 'horizonEndsAt', '2023-11-20T09:00:00').horizon.endsAt).toBe(Date.UTC(2023, 10, 20, 9, 0, 0));
    expect(editLaunchField(draft, 'horizonEndsAt', String(T0 + 60_000)).horizon.endsAt).toBe(T0 + 60_000);
    expect(absorbedEdit('horizonStartsAt', '2023-11-14T22:13:20')).toBe(true);
    expect(absorbedEdit('horizonStartsAt', 'soon')).toBe(false);
    // the canonical form value of a datetime edit is the datetime form (never the epoch integer)
    const edited = editLaunchField(draft, 'horizonStartsAt', '2023-11-14T22:13:20');
    expect(launchFieldValue(edited, 'horizonStartsAt')).toBe('2023-11-14T22:13:20');
  });

  it('the validation message names the datetime grammar and never says "epoch milliseconds" alone (S5: "a CFO must hand-compute epoch milliseconds")', () => {
    const base = validValues();
    const broken = { ...base, horizonStartsAt: '2023-02-30' } as LaunchFormValues; // an impossible date
    const message = launchFieldValidation(broken, 'horizonStartsAt');
    expect(message).toBe('Enter the horizon as a UTC date and time, e.g. 2026-01-15T09:30:00 (epoch milliseconds also parse).');
    expect(message).not.toBe('Enter the horizon instants as epoch milliseconds.');
    expect(message).not.toContain(' 0'); // never a bare "0" (the pre-fix "ISO dates parse to 0")
  });
});

// ---------------------------------------------------------------------------
// FW-40-C — H-1 (L1's find): the constraint-grammar SUBJECT vocabulary,
// the full-grammar hint, and the wizard's step-fields map.
// ---------------------------------------------------------------------------

describe('launch-form: FW-40-C — H-1 the constraint-grammar vocabulary + the step-fields map', () => {
  it('H-1: the ACCEPTED SUBJECT LIST — every canonical subject parses under the FORM grammar (identifier paths) and the list is the FULL closed set the hint teaches (one example each)', () => {
    // the canonical subjects the demo Risk page + the product's own docs teach — the vocabulary L1 had to reverse-engineer
    expect(CONSTRAINT_SUBJECT_VOCABULARY.map((entry) => entry.subject)).toEqual([
      'position.concentration',
      'position.grossExposure',
      'costs.dailyTurnover',
      'order.notional',
      'capital.budget',
      'risk.budget',
      'risk.maxDrawdown',
    ]);
    // every canonical example PARSES as a form-grammar constraint entry (identifier-path subjects)
    for (const entry of CONSTRAINT_SUBJECT_VOCABULARY) {
      const parsed = parseConstraintsValue(`c-1:outcome:${entry.subject}:limit.max:0.2`);
      expect(parsed, entry.subject).not.toBeNull();
      expect(parsed?.[0]?.subject, entry.subject).toBe(entry.subject);
      expect(isLaunchFieldName('name')).toBe(true); // the guard import stays exercised
    }
    // every taught subject carries its gate class + its one-sentence teaching (never an empty string)
    for (const entry of CONSTRAINT_SUBJECT_VOCABULARY) {
      expect(entry.gateClass.length, entry.subject).toBeGreaterThan(0);
      expect(entry.teaches.length, entry.subject).toBeGreaterThan(0);
    }
  });

  it('H-1: the hint renders the FULL grammar — the entry shape, the domains, the kinds (L3\'s \'advisory.max\' pre-taught away), the severity suffix, EVERY accepted subject with its teaching, and the honest taught-never-enforced note', () => {
    const hint = constraintGrammarHint();
    // FW-51 (the Round N minors — S2's friction, S3 corroborated): the hint
    // teaches the LIST grammar first — the same comma-separated law the
    // sibling list fields teach at their own hints (render/model.ts:
    // markets 'Comma-separated instrument ids.', venues, data sources — one
    // law, every surface), with the newline anti-trap named (a newline is
    // part of one entry, never a separator — S2's exact discovery-by-trial
    // shape pre-taught away).
    expect(hint).toContain('a comma-separated list of entries');
    expect(hint).toContain('a newline is not a separator; separate entries with commas');
    expect(hint).toContain('each entry is id:domain:subject:kind:bound');
    expect(hint).toContain('c-1:outcome:risk.maxDrawdown:limit.max:0.2');
    expect(hint).toContain('Domains: observation | state | action | outcome');
    expect(hint).toContain('Kinds: limit.min | limit.max | equals');
    expect(hint).toContain(':advisory or :blocking');
    for (const entry of CONSTRAINT_SUBJECT_VOCABULARY) {
      expect(hint, entry.subject).toContain(`${entry.subject} (${entry.teaches})`); // one example each, verbatim
    }
    expect(hint).toContain('Any other dotted subject parses but is taught, never enforced at the gate');
  });

  it('the wizard\'s step-fields map (the inline-validation-at-the-step law\'s own map): every step names exactly the fields its rendered card carries; review names none', () => {
    expect(launchStepFields('goal')).toEqual(['name', 'objective']);
    expect(launchStepFields('budget')).toEqual(['capitalBudget', 'riskBudget']);
    expect(launchStepFields('markets')).toEqual(['markets', 'venues', 'dataSources']);
    expect(launchStepFields('world')).toEqual(['horizonStartsAt', 'horizonEndsAt', 'executionMode', 'preferences', 'constraints']);
    expect(launchStepFields('review')).toEqual([]);
    expect(launchStepFields('anything-else')).toEqual([]);
    // every mapped field is a real launch field name (the form\'s own vocabulary)
    for (const step of ['goal', 'budget', 'markets', 'world'] as const) {
      for (const field of launchStepFields(step)) {
        expect((LAUNCH_FIELD_NAMES as readonly string[]).includes(field), `${step}: ${field}`).toBe(true);
      }
    }
  });
});
