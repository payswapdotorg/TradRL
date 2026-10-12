// Tests for the activity timeline model (core/timeline.ts — UX-DESIGN §4.6, T051).
//
// Laws pinned here:
//   - the period buckets: TODAY / YESTERDAY / weekday (within the past
//     week) / "Mon D" (older) — computed on UTC calendar days;
//   - buckets order latest-first; entries inside a bucket latest-first;
//   - HH:MM is UTC, zero-padded, tabular-friendly;
//   - DETERMINISM: identical (entries, now) -> identical buckets; no
//     locale, no Intl, no wall clock (now is injected);
//   - FW-49 (S3): the row-meta time rides the same bucket vocabulary,
//     derived from the view instant (one law, two surfaces).

import { describe, expect, it } from 'vitest';
import { bucketLabelOf, formatTimeUtc, rowMetaTimeOf, timelineBucketsOf, type TimelineEntry } from './timeline';

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

// ---------------------------------------------------------------------------
// FW-49 (the Round M minors — S3): the row-meta time — one law, two
// surfaces. The inbox notice row's summary column composes through
// rowMetaTimeOf: the SAME bucketLabelOf vocabulary the Home timeline
// headers carry, derived from the VIEW instant (a scrubbed view
// re-buckets the meta exactly as it re-buckets the timeline headers).
// ---------------------------------------------------------------------------

describe('FW-49 (S3): the row-meta time at the timeline surface', () => {
  it('the four vocabulary forms: the same UTC day = the compact HH:MM; an earlier day = the bucket label + the time (YESTERDAY / weekday / "Mon D")', () => {
    // the SAME UTC day: the compact HH:MM, unchanged (the same-day row never carried a date)
    expect(rowMetaTimeOf(Date.UTC(2026, 9, 4, 7, 5), NOW)).toBe('07:05');
    expect(rowMetaTimeOf(NOW, NOW)).toBe('12:00');
    // YESTERDAY: the bucket label + the time
    expect(rowMetaTimeOf(Date.UTC(2026, 9, 3, 21, 13), NOW)).toBe('YESTERDAY 21:13');
    // the weekday form within the week — and the law's own boundary at 7 days: SIX days back is still the weekday form, seven is the "Mon D" form (both asserted — the boundary itself is pinned)
    expect(rowMetaTimeOf(Date.UTC(2026, 8, 28, 9, 0), NOW)).toBe('Monday 09:00');  // 6 days back — the weekday form (2026-09-28 is a Monday)
    expect(rowMetaTimeOf(Date.UTC(2026, 8, 27, 9, 0), NOW)).toBe('Sep 27 09:00');  // 7 days back — the "Mon D" form (the boundary's other side)
    // the "Mon D" form for anything older than a week
    expect(rowMetaTimeOf(Date.UTC(2026, 8, 20, 21, 13), NOW)).toBe('Sep 20 21:13');
  });

  it('the label derives from the VIEW instant — a scrubbed view re-buckets the meta exactly as it re-buckets the timeline headers (one law, two surfaces)', () => {
    const at = Date.UTC(2026, 9, 4, 7, 5); // 2026-10-04 07:05 UTC — Sunday morning, the record under review
    // the view on the record's own day: the compact form
    expect(rowMetaTimeOf(at, Date.UTC(2026, 9, 4, 12, 0))).toBe('07:05');
    // the view a day later: the SAME record now reads YESTERDAY
    expect(rowMetaTimeOf(at, Date.UTC(2026, 9, 5, 12, 0))).toBe('YESTERDAY 07:05');
    // the view two days later: the weekday form (the record's own day — Oct 4 2026 is a Sunday) — and the timeline's own header re-buckets identically
    expect(rowMetaTimeOf(at, Date.UTC(2026, 9, 6, 12, 0))).toBe('Sunday 07:05');
    expect(bucketLabelOf(at, Date.UTC(2026, 9, 6, 12, 0))).toBe('Sunday');
    // scrubbing BACK re-buckets it the other way: the same record at the Tuesday view reads the weekday form, at the Monday view YESTERDAY, at its own day the compact one
    expect(rowMetaTimeOf(at, Date.UTC(2026, 9, 5, 12, 0))).toBe('YESTERDAY 07:05');
    expect(rowMetaTimeOf(at, Date.UTC(2026, 9, 4, 12, 0))).toBe('07:05');
  });
});
