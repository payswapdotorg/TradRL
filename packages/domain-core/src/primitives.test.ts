import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  compareTimestamps,
  isAssetClass,
  isDataCategory,
  isDecimalString,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isTimestamp,
  isUnitInterval,
  hasNoDuplicates,
} from './primitives';
import { DecimalString, Timestamp } from './primitives';

const ts = (s: string) => s as Timestamp;
const dec = (s: string) => s as DecimalString;

describe('guard helpers', () => {
  it('isRecord accepts plain objects and rejects null/arrays/primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it('isNonEmptyString rejects empty and whitespace-only strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' trade ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });

  it('isFiniteNumber rejects NaN and Infinity', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber('1')).toBe(false);
  });

  it('isUnitInterval accepts 0 and 1, rejects out-of-range and non-numbers', () => {
    expect(isUnitInterval(0)).toBe(true);
    expect(isUnitInterval(1)).toBe(true);
    expect(isUnitInterval(0.5)).toBe(true);
    expect(isUnitInterval(-0.01)).toBe(false);
    expect(isUnitInterval(1.01)).toBe(false);
    expect(isUnitInterval(Number.NaN)).toBe(false);
  });

  it('hasNoDuplicates detects repeated entries', () => {
    expect(hasNoDuplicates(['a', 'b'])).toBe(true);
    expect(hasNoDuplicates(['a', 'a'])).toBe(false);
    expect(hasNoDuplicates([])).toBe(true);
  });
});

describe('isTimestamp (point-in-time discipline, L4)', () => {
  it('accepts RFC 3339 timestamps with Z or explicit numeric offset', () => {
    expect(isTimestamp('2027-01-04T09:30:00Z')).toBe(true);
    expect(isTimestamp('2027-01-04T09:30:00.123Z')).toBe(true);
    expect(isTimestamp('2027-01-04T09:30:00+00:00')).toBe(true);
    expect(isTimestamp('2027-01-04T09:30:00-05:00')).toBe(true);
  });

  it('rejects timestamps without an explicit offset', () => {
    expect(isTimestamp('2027-01-04T09:30:00')).toBe(false);
    expect(isTimestamp('2027-01-04 09:30:00Z')).toBe(false);
    expect(isTimestamp('2027-01-04')).toBe(false);
  });

  it('rejects impossible calendar dates and times', () => {
    expect(isTimestamp('2027-13-01T00:00:00Z')).toBe(false); // month 13
    expect(isTimestamp('2027-01-32T00:00:00Z')).toBe(false); // day 32
    expect(isTimestamp('2027-01-04T25:00:00Z')).toBe(false); // hour 25
  });

  it('compares by instant, not by textual offset representation', () => {
    // 10:00Z and 11:00+01:00 are the same instant -> 0
    expect(compareTimestamps(ts('2027-01-04T10:00:00Z'), ts('2027-01-04T11:00:00+01:00'))).toBe(0);
    // 10:00Z is before 12:00+01:00 (== 11:00Z)
    expect(compareTimestamps(ts('2027-01-04T10:00:00Z'), ts('2027-01-04T12:00:00+01:00'))).toBe(-1);
    expect(compareTimestamps(ts('2027-01-04T12:00:00+01:00'), ts('2027-01-04T10:00:00Z'))).toBe(1);
  });
});

describe('isDecimalString (canonical exact decimals)', () => {
  it('accepts canonical integers, fractions and negatives', () => {
    expect(isDecimalString('0')).toBe(true);
    expect(isDecimalString('42')).toBe(true);
    expect(isDecimalString('0.5')).toBe(true);
    expect(isDecimalString('1234.5678')).toBe(true);
    expect(isDecimalString('-3.5')).toBe(true);
    expect(isDecimalString('-0.0001')).toBe(true);
  });

  it('rejects non-canonical and non-numeric forms', () => {
    expect(isDecimalString('.5')).toBe(false); // leading dot
    expect(isDecimalString('5.')).toBe(false); // trailing dot
    expect(isDecimalString('01.2')).toBe(false); // leading zero
    expect(isDecimalString('-0')).toBe(false); // negative zero
    expect(isDecimalString('1e5')).toBe(false); // exponent
    expect(isDecimalString('NaN')).toBe(false);
    expect(isDecimalString('Infinity')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(isDecimalString(1.5)).toBe(false); // numbers are not decimal strings
    expect(isDecimalString(' 1')).toBe(false); // whitespace
    expect(isDecimalString('+1')).toBe(false); // explicit plus
  });
});

describe('compareDecimal (exact ordering, no float rounding)', () => {
  it('orders by sign first', () => {
    expect(compareDecimal(dec('-5'), dec('1'))).toBe(-1);
    expect(compareDecimal(dec('1'), dec('-5'))).toBe(1);
    expect(compareDecimal(dec('-1'), dec('0'))).toBe(-1);
  });

  it('compares magnitudes with fractional padding', () => {
    expect(compareDecimal(dec('0'), dec('0.0'))).toBe(0);
    expect(compareDecimal(dec('1.1'), dec('1.09'))).toBe(1);
    expect(compareDecimal(dec('1.10'), dec('1.1'))).toBe(0);
    expect(compareDecimal(dec('2'), dec('10'))).toBe(-1);
    expect(compareDecimal(dec('10'), dec('9.99999'))).toBe(1);
  });

  it('handles large values beyond float integer precision', () => {
    // 2^53+1 is not representable as a double and collapses onto 2^53.
    expect(Number(9007199254740993n)).toBe(Number(9007199254740992n));
    // As canonical decimals they are distinct and correctly ordered.
    expect(compareDecimal(dec('9007199254740993'), dec('9007199254740992'))).toBe(1);
    expect(compareDecimal(dec('9007199254740992'), dec('9007199254740993'))).toBe(-1);
  });
});

describe('closed vocabularies', () => {
  it('isAssetClass accepts only the closed vocabulary', () => {
    expect(isAssetClass('crypto')).toBe(true);
    expect(isAssetClass('equity')).toBe(true);
    expect(isAssetClass('equities')).toBe(false);
    expect(isAssetClass('')).toBe(false);
    expect(isAssetClass(7)).toBe(false);
  });

  it('isDataCategory accepts only the closed vocabulary', () => {
    expect(isDataCategory('market-data')).toBe(true);
    expect(isDataCategory('news')).toBe(true);
    expect(isDataCategory('market')).toBe(false);
    expect(isDataCategory(null)).toBe(false);
  });
});
