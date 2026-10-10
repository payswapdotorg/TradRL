// @tradrl/web-console — THE FILL-DERIVED STANDING BOOK (FW-38-B, Round G
// register G-2 + G-5 + G-12 — THE truth wave's core fold; 9 scopes, the
// round's top friction):
//   M1/L1/L2/M2/M3/S3/S1/... — "the governed view's numbers must be the
//   book". The pre-fix standing rows (the Risk panel AND the Oversight
//   desk cards) rendered the READ'S OWN `current` as the standing
//   utilization — and the boundary's read puts the LAST GATE OBSERVATION
//   (the refused candidate's own projection) at precedence 1, so every
//   compliant desk with one refusal on file rendered as a standing
//   BREACH at 38-445x overstatement (L2: 15,033.7494 projected vs a
//   33.75 book; L1: 2,359,999.92 vs 360,000), and the position standing
//   read "unknown" while the blotter plainly showed open fills.
//
// THE LAW THIS MODULE OWNS (the work order's own words): "the standing
// utilization rows derive from the desk's own FILLS (the blotter's
// cumulative booked notional + open-position count at the view instant —
// L4-projected), NEVER from a gate observation. The gate's projection
// may remain visible but ONLY labeled as what it is (the last gate
// observation), never as the standing book. The 'breach' stamp on a
// standing row must reflect the fill-derived book vs the bound."
//
//   L4 — the standing book is computed over the VIEW-INSTANT PROJECTED
//   submissions the caller passes (exactly the rows the Execution
//   blotter renders at that instant); a fill after the view instant
//   never enters the book.
//   L9 — the notional sums are EXACT DECIMAL SUMS of the served strings
//   (core/decimals.ts's sumExactDecimals), never float arithmetic; the
//   bound comparison is decimal-to-decimal, never a float compare.
//   G-5 (L1, sharpened by L3) — a gate observation NEVER renders before
//   its observed instant: the fold marks an observation withheldAtView
//   when its own observed instant (the newest refusal citing the bound)
//   is after the view instant (an unparseable observed instant is
//   withheld too — the L4-conservative choice, the same law
//   breachesAtView rides since FW-37-B).
//   G-12 (M2) — the fold names the DATA'S OWN AS-OF (the newest fill or
//   non-withheld observation the rows derive from), never the
//   read-capture instant (the read's served `asOf` is the capture
//   instant; the render layer cites it separately, labeled as what it
//   is).
//   L20/honesty — the metric-class matching mirrors the boundary's own
//   read (risk-utilization.ts precedence 2, case-insensitive over the
//   constraint's own subject) so the console's standing row and the
//   boundary's own fill-derived arithmetic agree by construction; a
//   class the fills cannot produce (realized losses, drawdown) stays
//   honestly unknown — never a fabricated number, never the gate's
//   projection standing in for the book.
//
// This module is PURE: identical (utilization, submissions, viewAt) ->
// identical rows. No DOM, no clock, no transport.

import type { GatewaySubmissionRecord, RiskUtilizationRead } from '../api/contracts';
import { sumExactDecimals } from './decimals';
import { parseInstantUtc } from './format';

/**
 * THE DESK'S OWN FILL-DERIVED BOOK — the two numbers the work order
 * names (the cumulative booked notional + the open-position count) plus
 * the day-windowed notional (the turnover class's own fold, the same
 * arithmetic the boundary's read performs) and the book's own as-of.
 */
export interface StandingBook {
  /** The fills on record at the view instant — each one an open position on the records this console holds (no position store exists on any backing; the count is the blotter's own). */
  readonly fills: number;
  /** The exact-decimal cumulative gross booked notional of those fills ('0' when none). */
  readonly bookedNotional: string;
  /** The latest UTC trading day among the fills (ISO date), null when no fills. */
  readonly latestDay: string | null;
  /** The fills of that latest day (the turnover window's own count). */
  readonly latestDayFills: number;
  /** The exact-decimal booked notional of that latest day ('0' when no fills). */
  readonly latestDayNotional: string;
  /** The newest fill instant at the view instant, null when no fills. */
  readonly newestFillAt: number | null;
}

/** The book of the (L4-PROJECTED) submissions the caller passes — the same rows the Execution blotter renders at that instant. */
export function standingBookOf(submissions: readonly GatewaySubmissionRecord[]): StandingBook {
  const notionals: string[] = [];
  const dayNotionals = new Map();
  let fills = 0;
  let newestFillAt: number | null = null;
  for (const submission of submissions) {
    if (submission.kind !== 'routed') continue;
    const fill = submission.fill;
    if (fill === undefined) continue; // a routed row without fill economics is never a fabricated fill (the blotter's own law)
    fills += 1;
    notionals.push(fill.notional);
    const day = new Date(fill.filledAt).toISOString().slice(0, 10);
    const prior = dayNotionals.get(day);
    if (prior === undefined) {
      dayNotionals.set(day, [fill.notional]);
    } else {
      prior.push(fill.notional);
    }
    if (newestFillAt === null || fill.filledAt > newestFillAt) newestFillAt = fill.filledAt;
  }
  let latestDay: string | null = null;
  for (const day of dayNotionals.keys()) {
    if (latestDay === null || day > latestDay) latestDay = day;
  }
  const latestDayList = latestDay === null ? [] : dayNotionals.get(latestDay);
  return {
    fills,
    bookedNotional: sumExactDecimals(notionals),
    latestDay,
    latestDayFills: latestDayList === undefined ? 0 : latestDayList.length,
    latestDayNotional: latestDayList === undefined ? '0' : sumExactDecimals(latestDayList),
    newestFillAt,
  };
}

/**
 * Decimal-text comparison over the boundary's own numeric grammar
 * (optional sign, digits, optional fraction) — never a float compare.
 * Returns null when either text is not a decimal (the caller folds to
 * the honest unknown, never a guessed comparison).
 */
export function compareDecimalTexts(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (text: string): { readonly sign: number; readonly whole: string; readonly fraction: string } | null => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    const negative = trimmed.startsWith('-');
    const body = negative ? trimmed.slice(1) : trimmed;
    const dot = body.indexOf('.');
    const whole = dot === -1 ? body : body.slice(0, dot);
    const fraction = dot === -1 ? '' : body.slice(dot + 1);
    return { sign: negative ? -1 : 1, whole: whole.replace(/^0+(?=\d)/, ''), fraction };
  };
  const left = parse(a);
  const right = parse(b);
  if (left === null || right === null) return null;
  // Whole parts: longer (after leading-zero strip) is greater; equal
  // lengths compare digit-wise (the fraction compares padded below —
  // lexicographic on same-scale strings is exact).
  const wholeCompare = left.whole.length !== right.whole.length
    ? (left.whole.length > right.whole.length ? 1 : -1)
    : (left.whole === right.whole ? 0 : left.whole > right.whole ? 1 : -1);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(scale, '0');
  const rightFraction = right.fraction.padEnd(scale, '0');
  const fractionCompare = leftFraction === rightFraction ? 0 : leftFraction > rightFraction ? 1 : -1;
  const magnitude = wholeCompare !== 0 ? wholeCompare : fractionCompare;
  if (magnitude === 0) return 0;
  if (left.sign !== right.sign) return left.sign > right.sign ? 1 : -1;
  return (magnitude * left.sign) as -1 | 0 | 1;
}

/** The last gate observation for one bound — the read's own `current` when a refusal on file cites the bound (the boundary's precedence-1 row), carried WITH its observed instant so the render can withhold it before that instant (G-5). */
export interface StandingObservation {
  /** The served `current` for the bound (verbatim — a number only when the read serves one). */
  readonly value: number | null;
  /** The served `status` for the bound (verbatim, never re-decided). */
  readonly status: string;
  /** The served `source` (verbatim — the read's own disclosure of what produced the number). */
  readonly source: string;
  /** The observed instant, epoch ms, parsed from the newest citing refusal's own `at`. */
  readonly observedAt: number | null;
  /** The observed instant verbatim (the breach row's own ISO text). */
  readonly observedAtText: string;
  /** True when the view instant is before the observed instant (or the instant is unparseable) — the observation NEVER renders then (G-5, the L4-conservative choice). */
  readonly withheldAtView: boolean;
}

/** One bound's standing row — the fill-derived book vs the bound, with the last gate observation labeled as what it is. */
export interface StandingRow {
  readonly constraintId: string;
  /** The metric the bound binds (verbatim, e.g. 'outcome.capital.budget'). */
  readonly metric: string;
  /** The bound's own max-side number as served ('' when none declared). */
  readonly boundMax: string;
  /** The FILL-DERIVED standing — a number ONLY when the desk's own fills produce a defensible one; null = honestly unknown, never the gate's projection. */
  readonly standing: number | null;
  /** Why the standing row reads what it reads (the fill-derived basis, disclosed — L20). */
  readonly standingBasis: string;
  /** The standing verdict: the fill-derived book against the bound (ok / breach / unknown) — never the gate's. */
  readonly standingStatus: 'ok' | 'breach' | 'unknown';
  /** The last gate observation (the boundary's precedence-1 `current` when a refusal cites the bound) — rendered ONLY labeled as the observation, never as the standing book; null when no refusal cites the bound. */
  readonly observation: StandingObservation | null;
  /** The read's own NON-observation number (its fill/outcome-derived precedence-2 `current`, e.g. a realized-loss risk budget) — rendered verbatim with its source when the fill-derived fold has no number for the class; null otherwise. */
  readonly served: { readonly value: number; readonly status: string; readonly source: string } | null;
}

/** The whole standing fold of one desk's utilization read at a view instant. */
export interface StandingReadFold {
  /** The per-bound standing rows (the capital and risk budget rows first, every other bound after in the read's own order — the surface's own ordering law). */
  readonly rows: readonly StandingRow[];
  /** The DATA'S OWN AS-OF (G-12): the newest instant any rendered row derives from (a fill's own instant or a non-withheld observation's observed instant), null when nothing derives. */
  readonly dataAsOf: number | null;
}

/** The fill-derived standing of one metric class — a number only when the book's own folds produce one (mirrors the boundary's own class matching, case-insensitive over the subject). */
function fillDerivedStandingOf(metric: string, book: StandingBook): { readonly value: string | null; readonly basis: string } {
  const needle = metric.toLowerCase();
  if (needle.includes('turnover')) {
    if (book.fills === 0 || book.latestDay === null) {
      return { value: null, basis: 'no routed fill on record carries fill economics at this view instant — a turnover cannot be summed from rows that do not exist (the standing row stays honestly unknown)' };
    }
    return {
      value: book.latestDayNotional,
      basis: `the booked notional of the ${book.latestDayFills} fill(s) on record for the latest trading day (${book.latestDay}, UTC) at this view instant — the desk's own fills, exact decimals`,
    };
  }
  if (needle.includes('capital') && needle.includes('budget')) {
    return {
      value: book.bookedNotional,
      basis: `the cumulative booked notional of the ${book.fills} fill(s) on record at this view instant — the desk's own fills, exact decimals (the fill-derived book, never a gate observation)`,
    };
  }
  if (needle.includes('exposure') || needle.includes('position')) {
    return {
      value: String(book.fills),
      basis: `the ${book.fills} open position(s) on record at this view instant — every fill on record is an open position on the records this console holds (no position store exists on any backing; the count is the blotter's own)`,
    };
  }
  if (needle.includes('risk') && needle.includes('budget')) {
    return { value: null, basis: 'no fill-derived number on file for this class — a realized-loss sum derives from outcome records, not the fills (the standing row stays honestly unknown; the boundary\'s own outcome-derived read renders beside it when it serves one)' };
  }
  if (needle.includes('drawdown')) {
    return { value: null, basis: 'no fill-derived number on file — a drawdown needs an equity curve no backing serves (the standing row stays honestly unknown)' };
  }
  return { value: null, basis: 'no fill-derived number on file for this metric class (the standing row stays honestly unknown)' };
}

/** The newest refusal on file citing one bound (its own observed instant + verbatim text), null when none cites it. */
function newestObservationCiting(breaches: RiskUtilizationRead['activeBreaches'], constraintId: string): { readonly at: number | null; readonly atText: string } | null {
  let newest: { readonly at: number | null; readonly atText: string } | null = null;
  for (const breach of breaches) {
    if (breach.violations === undefined) continue;
    if (!breach.violations.some((violation) => violation.constraintId === constraintId)) continue;
    const at = parseInstantUtc(breach.at);
    if (newest === null || (at !== null && (newest.at === null || at > newest.at))) {
      newest = { at, atText: breach.at };
    }
  }
  return newest;
}

/**
 * THE STANDING READ FOLD — one desk's utilization read against its own
 * L4-projected blotter at the view instant. Pure and total: an absent
 * read folds to empty rows (the render names the honest absence, never
 * a fabricated number).
 */
export function standingReadFoldOf(utilization: RiskUtilizationRead | null, submissions: readonly GatewaySubmissionRecord[], viewAt: number): StandingReadFold {
  if (utilization === null) return { rows: [], dataAsOf: null };
  const book = standingBookOf(submissions);
  const rows: StandingRow[] = utilization.bounds.map((bound) => {
    const derived = fillDerivedStandingOf(bound.metric, book);
    const boundMax = bound.boundMax === null ? '' : bound.boundMax;
    // The standing verdict: the fill-derived book vs the bound — never
    // the gate's projection, never the read's re-decided status.
    const comparison = derived.value === null || boundMax.length === 0 ? null : compareDecimalTexts(derived.value, boundMax);
    const standingStatus: 'ok' | 'breach' | 'unknown' = comparison === null ? 'unknown' : comparison > 0 ? 'breach' : 'ok';
    const citing = newestObservationCiting(utilization.activeBreaches, bound.constraintId);
    const observation: StandingObservation | null = citing === null ? null : {
      value: bound.current,
      status: bound.status,
      source: bound.source,
      observedAt: citing.at,
      observedAtText: citing.atText,
      // G-5: the observation NEVER renders before its own observed
      // instant — an unparseable instant withholds too (the
      // L4-conservative choice, the same law breachesAtView rides).
      withheldAtView: citing.at === null || citing.at > viewAt,
    };
    const served = citing === null && bound.current !== null
      ? { value: bound.current, status: bound.status, source: bound.source }
      : null;
    return {
      constraintId: bound.constraintId,
      metric: bound.metric,
      boundMax,
      standing: derived.value === null ? null : Number(derived.value),
      standingBasis: derived.basis,
      standingStatus,
      observation,
      served,
    };
  });
  // The surface's own ordering law (the oversight fold's since FW-37-B):
  // the capital budget rows first, the risk budget rows after them,
  // every other bound in the read's own order.
  const isCapital = (row: StandingRow): boolean => row.metric.toLowerCase().includes('capital') && row.metric.toLowerCase().includes('budget');
  const isRisk = (row: StandingRow): boolean => row.metric.toLowerCase().includes('risk') && row.metric.toLowerCase().includes('budget');
  const capital = rows.filter(isCapital);
  const risk = rows.filter((row) => isRisk(row) && !isCapital(row));
  const rest = rows.filter((row) => !isCapital(row) && !isRisk(row));
  const ordered = [...capital, ...risk, ...rest];
  // G-12: the data's own as-of — the newest fill instant or
  // non-withheld observation instant the rows derive from.
  let dataAsOf = book.newestFillAt;
  for (const row of ordered) {
    if (row.observation !== null && !row.observation.withheldAtView && row.observation.observedAt !== null) {
      if (dataAsOf === null || row.observation.observedAt > dataAsOf) dataAsOf = row.observation.observedAt;
    }
  }
  return { rows: ordered, dataAsOf };
}
