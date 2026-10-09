// @tradrl/web-console — the activity timeline model (UX-DESIGN.md §4.6, T051).
//
// THE CHARTER: timelines group by period buckets — TODAY / YESTERDAY /
// weekday / "Mon D" — with 0.65rem uppercase tracking headers; entries
// carry HH:MM tabular times, semibold titles (the latest row tinted),
// one-line descriptions and expandable typed-slug details.
//
// This module is PURE and DETERMINISTIC: bucketing runs on UTC calendar
// days against an INJECTED `now` (never a wall-clock read — the render
// pass injects its instant), the month/weekday names are a closed
// vocabulary (no Intl, no locale — identical inputs give identical
// bytes on every machine), and buckets order latest-first with entries
// latest-first inside each bucket.

/** One timeline entry (the sanitized surface shape — never reasoning). */
export interface TimelineEntry {
  /** The entry's instant (ms since the epoch). */
  readonly at: number;
  /** The semibold one-line title. */
  readonly title: string;
  /** The one-line description (optional). */
  readonly description?: string;
  /** The typed event slug for the expandable mono detail (e.g. `failed_evaluation`). */
  readonly slug?: string;
  /** The severity tint of the icon circle: info (teal) / warn (amber) / error (rose). */
  readonly severity?: 'info' | 'warn' | 'error';
  /**
   * FW-36-B (Round E register E-8, part 3 — the demo-tenant contamination
   * marking): true when this entry derives from the SHARED DEMO PROJECT
   * (the scope is the teaching desk — every fresh session's first world).
   * The timeline row then carries the quiet `DEMO` chip. Absent = the
   * honest non-demo default (no marker, never a fabricated one).
   */
  readonly demo?: boolean;
}

/** One period bucket: a charter label + its entries, latest-first. */
export interface TimelineBucket {
  readonly label: string;
  readonly entries: readonly TimelineEntry[];
}

/** The closed month-name vocabulary (short, en, deterministic — no Intl). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The closed weekday vocabulary (full, en, deterministic — no Intl). */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The UTC calendar day index of an instant (whole days since the epoch). */
function utcDay(at: number): number {
  return Math.floor(at / 86_400_000);
}

/** The label of one bucket: TODAY / YESTERDAY / weekday (within the week) / "Mon D". */
export function bucketLabelOf(at: number, now: number): string {
  const daysAgo = utcDay(now) - utcDay(at);
  if (daysAgo <= 0) return 'TODAY';
  if (daysAgo === 1) return 'YESTERDAY';
  const date = new Date(at);
  if (daysAgo < 7) return WEEKDAYS[date.getUTCDay()];
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** The HH:MM (UTC, tabular) of an instant — the timeline's time column. */
export function formatTimeUtc(at: number): string {
  const date = new Date(at);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Bucket entries by period, latest bucket first, entries latest-first
 * inside each bucket. Deterministic: same (entries, now) -> same
 * buckets; entry order among equal instants is stable (a stable sort
 * over the input order).
 */
export function timelineBucketsOf(entries: readonly TimelineEntry[], now: number): readonly TimelineBucket[] {
  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const buckets: { label: string; entries: TimelineEntry[] }[] = [];
  for (const entry of sorted) {
    const label = bucketLabelOf(entry.at, now);
    const existing = buckets[buckets.length - 1];
    if (existing !== undefined && existing.label === label) {
      existing.entries.push(entry);
    } else {
      buckets.push({ label, entries: [entry] });
    }
  }
  return buckets;
}
