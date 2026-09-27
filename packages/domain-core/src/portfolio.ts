// @tradrl/domain-core — Portfolio: positions plus summary metrics (data only).
//
// A Portfolio is a point-in-time snapshot of a project's positions with
// summary metrics RECORDED as data. No PnL or exposure computation happens in
// this lane — strategy (T018) and evaluation (T012) produce the numbers.

import {
  DecimalString,
  Timestamp,
  isDecimalString,
  isNonEmptyString,
  isRecord,
  isTimestamp,
} from './primitives';
import { ProjectId, isProjectId } from './ids';
import { Position, isPosition } from './position';

/** Portfolio-level summary metrics. Recorded data — computed by producers, never here. */
export interface PortfolioSummaryMetrics {
  readonly grossExposure?: DecimalString;
  readonly netExposure?: DecimalString;
  readonly marketValue?: DecimalString;
  readonly realizedPnl?: DecimalString;
  readonly unrealizedPnl?: DecimalString;
  readonly totalPnl?: DecimalString;
}

export interface Portfolio {
  /** Project this portfolio belongs to. */
  readonly projectId: ProjectId;
  readonly name?: string;
  /** Reporting currency symbol, e.g. "USD". */
  readonly baseCurrency?: string;
  readonly positions: readonly Position[];
  readonly summary: PortfolioSummaryMetrics;
  /** Point-in-time snapshot instant. Required (L4). */
  readonly asOf: Timestamp;
}

function positionKey(position: Position): string {
  return position.venueId === undefined
    ? `${position.instrumentId}|*`
    : `${position.instrumentId}|${position.venueId}`;
}

const SUMMARY_FIELDS: readonly (keyof PortfolioSummaryMetrics)[] = [
  'grossExposure',
  'netExposure',
  'marketValue',
  'realizedPnl',
  'unrealizedPnl',
  'totalPnl',
];

export function isPortfolioSummaryMetrics(v: unknown): v is PortfolioSummaryMetrics {
  if (!isRecord(v)) return false;
  for (const field of SUMMARY_FIELDS) {
    const value = v[field];
    if (value !== undefined && !isDecimalString(value)) return false;
  }
  return true;
}

export function isPortfolio(v: unknown): v is Portfolio {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (v.baseCurrency !== undefined && !isNonEmptyString(v.baseCurrency)) return false;
  if (!Array.isArray(v.positions)) return false;
  const positions: unknown[] = v.positions;
  if (!positions.every((x) => isPosition(x))) return false;
  // Netting discipline: at most one position per (instrument, venue) key.
  const keys = positions.map((p) => positionKey(p as Position));
  if (new Set(keys).size !== keys.length) return false;
  if (!isPortfolioSummaryMetrics(v.summary)) return false;
  if (!isTimestamp(v.asOf)) return false;
  return true;
}
