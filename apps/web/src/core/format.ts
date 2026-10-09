// @tradrl/web-console — pure instant/duration formatting.
//
// Deterministic, locale-free, timezone-fixed (UTC) formatting of the
// console's injected instants. No Date object, no Intl, no locale —
// identical inputs -> identical bytes on every machine, forever (the
// wall-clock law's formatting half: even the LABELS are pure).

/** Format an epoch-ms instant as a fixed UTC string (YYYY-MM-DDTHH:mm:ss.mmmZ). */
export function formatInstantUtc(at: number): string {
  if (!Number.isFinite(at) || !Number.isInteger(at) || at < 0) {
    throw new Error(`formatInstantUtc: ${at} is not a non-negative integer of epoch ms`);
  }
  const millis = at % 1000;
  const seconds = Math.floor(at / 1000) % 60;
  const minutes = Math.floor(at / 60_000) % 60;
  const hours = Math.floor(at / 3_600_000) % 24;
  const daysTotal = Math.floor(at / 86_400_000);
  // The civil-from-days algorithm (Howard Hinnant's) — pure integer arithmetic.
  const z = daysTotal + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const fullYear = month <= 2 ? year + 1 : year;
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(fullYear, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
}

/** Format a duration in ms as a fixed compact string (e.g. 1h 02m 03s / 456ms). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms < 0) {
    throw new Error(`formatDurationMs: ${ms} is not a non-negative integer of ms`);
  }
  if (ms < 1000) return `${ms}ms`;
  const secondsTotal = Math.floor(ms / 1000);
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${String(minutes).padStart(2, '0')}m`);
  parts.push(`${String(seconds).padStart(2, '0')}s`);
  return parts.join(' ');
}

/**
 * FW-37-B (Round F register F-2 + F-6): parse the boundary's own UTC
 * ISO-8601 instant (YYYY-MM-DDTHH:mm:ss.sssZ — the exact shape
 * formatInstantUtc emits and the runtime's toISOString serves) back
 * into epoch ms. PURE integer arithmetic, the exact inverse of
 * formatInstantUtc — no Date object, no locale (the module's own law).
 * Null for anything the canonical grammar does not cover (never a
 * throw in a render path, never a fabricated instant — the caller
 * treats an unparseable instant as UNKNOWN, exactly like a null
 * utilization current).
 */
export function parseInstantUtc(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const millis = Number(match[7]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) return null;
  // days-from-civil (Howard Hinnant's) — the inverse of formatInstantUtc's civil-from-days.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const daysTotal = era * 146_097 + doe - 719_468;
  return daysTotal * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
}
