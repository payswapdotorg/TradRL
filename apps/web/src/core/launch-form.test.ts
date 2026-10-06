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
  absorbedEdit,
  blankLaunchDraft,
  editLaunchField,
  firstBadConstraintEntry,
  launchFieldValidation,
  launchFieldValue,
  launchDraftProblems,
  launchFormValues,
  launchFormValuesOfDraft,
  parseConstraintsValue,
  parseListValue,
  parsePreferencesValue,
  type LaunchFormValues,
  type LaunchFieldName,
} from './launch-form';

const T0 = 1_700_000_000_000;

/** A fully valid form (every field valid — the review gate's passing case). */
function validValues(): LaunchFormValues {
  return {
    name: 'Momentum scout',
    objective: 'Find and keep an edge in momentum.',
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    markets: 'binance:BTC-USDT, kraken:ETH-USDT',
    venues: 'binance, kraken',
    dataSources: 'candles:1m, ticker',
    horizonStartsAt: String(T0),
    horizonEndsAt: String(T0 + 86_400_000),
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
      ['horizonStartsAt', 'soon', 'Enter the horizon instants as epoch milliseconds.'],
      ['horizonEndsAt', 'never', 'Enter the horizon instants as epoch milliseconds.'],
      ['executionMode', 'paper', 'Choose an execution mode.'],
      ['preferences', 'broken', 'Preferences are key=value pairs, e.g. rebalance=daily.'],
      // D-6b (W-25C): the constraint message NAMES the offending entry —
      // which one (1-based) + what it says + the expected grammar.
      ['constraints', 'nope', 'Constraints entry 1 ("nope") is malformed — each entry is id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2.'],
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
    const inverted = { ...base, horizonEndsAt: String(T0) } as LaunchFormValues;
    expect(launchFieldValidation(inverted, 'horizonEndsAt')).toBe('The horizon must end after it starts.');
    expect(launchFieldValidation(inverted, 'horizonStartsAt')).toBe('The horizon must end after it starts.');
  });

  it('D-6b: the constraint validation names the OFFENDING entry — a mixed list points at the broken one (index + raw text), the good ones stay unnamed', () => {
    const base = validValues();
    const good = 'c-1:outcome:risk.maxDrawdown:limit.max:0.2';
    const alsoGood = 'c-2:action:position.size:limit.max:10:advisory';
    const broken = 'c-3:outcome:risk.maxDrawdown:limit.max:abc'; // not a number
    const values = { ...base, constraints: `${good}, ${alsoGood}, ${broken}` } as LaunchFormValues;
    expect(firstBadConstraintEntry(values.constraints)).toEqual({ index: 3, entry: broken });
    expect(launchFieldValidation(values, 'constraints')).toBe(
      `Constraints entry 3 ("${broken}") is malformed — each entry is id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2.`,
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
