// Tests for the activity timeline model (core/timeline.ts — UX-DESIGN §4.6, T051).
//
// Laws pinned here:
//   - the period buckets: TODAY / YESTERDAY / weekday (within the past
//     week) / "Mon D" (older) — computed on UTC calendar days;
//   - buckets order latest-first; entries inside a bucket latest-first;
//   - HH:MM is UTC, zero-padded, tabular-friendly;
//   - DETERMINISM: identical (entries, now) -> identical buckets; no
//     locale, no Intl, no wall clock (now is injected).

import { describe, expect, it } from 'vitest';
import { bucketLabelOf, formatTimeUtc, timelineBucketsOf, type TimelineEntry } from './timeline';

// 2026-10-04 was a Sunday; anchor `now` mid-day UTC.
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function entry(at: number, title: string): TimelineEntry {
  return { at, title };
}

describe('timeline: the period bucket labels (§4.6)', () => {
  it('TODAY for the same UTC calendar day; YESTERDAY for the day before', () => {
    expect(bucketLabelOf(NOW, NOW)).toBe('TODAY');
    expect(bucketLabelOf(NOW - 3_600_000, NOW)).toBe('TODAY');
    expect(bucketLabelOf(NOW - 86_400_000, NOW)).toBe('YESTERDAY');
    expect(bucketLabelOf(Date.UTC(2026, 9, 3, 1, 0), NOW)).toBe('YESTERDAY');
  });

  it('the weekday name within the past week (2-6 days ago)', () => {
    expect(bucketLabelOf(Date.UTC(2026, 9, 2, 9, 0), NOW)).toBe('Friday');     // 2 days ago
    expect(bucketLabelOf(Date.UTC(2026, 8, 29, 9, 0), NOW)).toBe('Tuesday');   // 5 days ago
  });

  it('"Mon D" for anything older than a week', () => {
    expect(bucketLabelOf(Date.UTC(2026, 8, 20, 9, 0), NOW)).toBe('Sep 20');    // 14 days ago
    expect(bucketLabelOf(Date.UTC(2026, 0, 2, 9, 0), NOW)).toBe('Jan 2');
  });

  it('future instants clamp into TODAY (never a future bucket)', () => {
    expect(bucketLabelOf(NOW + 3_600_000, NOW)).toBe('TODAY');
  });
});

describe('timeline: HH:MM (UTC, tabular)', () => {
  it('zero-pads hours and minutes', () => {
    expect(formatTimeUtc(Date.UTC(2026, 9, 4, 7, 5))).toBe('07:05');
    expect(formatTimeUtc(Date.UTC(2026, 9, 4, 23, 59))).toBe('23:59');
    expect(formatTimeUtc(Date.UTC(2026, 9, 4, 0, 0))).toBe('00:00');
  });
});

describe('timeline: bucketing + ordering', () => {
  it('groups by period, latest bucket first, entries latest-first inside a bucket', () => {
    const entries = [
      entry(Date.UTC(2026, 9, 1, 10, 0), 'older-weekday'),   // Thursday
      entry(Date.UTC(2026, 9, 4, 9, 30), 'today-early'),
      entry(Date.UTC(2026, 9, 3, 18, 0), 'yesterday-late'),
      entry(Date.UTC(2026, 9, 4, 11, 0), 'today-late'),
      entry(Date.UTC(2026, 8, 20, 8, 0), 'much-older'),      // Sep 20
    ];
    const buckets = timelineBucketsOf(entries, NOW);
    expect(buckets.map((bucket) => bucket.label)).toEqual(['TODAY', 'YESTERDAY', 'Thursday', 'Sep 20']);
    expect(buckets[0].entries.map((item) => item.title)).toEqual(['today-late', 'today-early']);
    expect(buckets[1].entries.map((item) => item.title)).toEqual(['yesterday-late']);
  });

  it('DETERMINISM: identical (entries, now) -> identical buckets (and the input order never leaks)', () => {
    const a = [entry(NOW - 1_000, 'a'), entry(NOW - 2_000, 'b'), entry(NOW - 1_500, 'c')];
    const b = [entry(NOW - 2_000, 'b'), entry(NOW - 1_500, 'c'), entry(NOW - 1_000, 'a')];
    expect(timelineBucketsOf(a, NOW)).toEqual(timelineBucketsOf(b, NOW));
    expect(timelineBucketsOf(a, NOW)).toEqual(timelineBucketsOf(a, NOW));
    // equal instants keep a stable order (input order, no swap)
    const equal = [entry(NOW, 'first'), entry(NOW, 'second')];
    expect(timelineBucketsOf(equal, NOW)[0].entries.map((item) => item.title)).toEqual(['first', 'second']);
  });

  it('an empty entry list yields no buckets (never a labeled empty region)', () => {
    expect(timelineBucketsOf([], NOW)).toEqual([]);
  });
});
