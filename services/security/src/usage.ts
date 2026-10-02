/**
 * @tradrl/security-service — the usage-accounting hooks.
 *
 * THE LAW (spec/SECURITY.md Tenant isolation — VERBATIM: "Isolate data,
 * projects, trajectories, memory, artifacts, credentials and usage.";
 * the T044 Work Order: "usage-accounting hooks"). Usage is one of the
 * seven isolated surfaces: events are scoped records, counters are
 * per-scope, and cross-tenant reads are the typed `cross_tenant_access`
 * error (never a filter).
 *
 * THE MODEL: every billable security act (a credential resolution, an
 * episode admission, an export, a record write) fires a typed
 * {@link UsageEvent} through the {@link UsageHook} into the
 * {@link UsageLedger}. The ledger appends the event (deterministic
 * content-addressed event ids) and maintains per-scope, per-kind
 * counters. `usageFor` reads ONE scope's accounting — any other scope's
 * accounting is unreachable (typed error).
 *
 * Determinism: event ids are content-addressed over (scope, sequence,
 * kind, units, at); counters are integers; injected instants only.
 */

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isMemberOf,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  mintUsageEventId,
  type Scope,
  type TimestampMs,
  type UsageEventId,
} from '../../../packages/security/src/index';

// ---------------------------------------------------------------------------
// The usage vocabulary
// ---------------------------------------------------------------------------

/** The billable security acts (closed vocabulary). */
export type UsageKind = 'credential_resolution' | 'episode_admitted' | 'export' | 'record_write';

/** Runtime-checkable list of usage kinds. */
export const USAGE_KINDS: readonly UsageKind[] = ['credential_resolution', 'episode_admitted', 'export', 'record_write'] as const;

/** `true` iff the value is on the closed usage-kind list. */
export function isUsageKind(v: unknown): v is UsageKind {
  return isMemberOf(USAGE_KINDS, v);
}

/** One usage event: the scoped, content-addressed fact of one billable act. */
export interface UsageEvent {
  readonly event_id: UsageEventId;
  readonly tenant: Scope['tenant'];
  readonly project: Scope['project'];
  readonly kind: UsageKind;
  /** The billable units (a positive integer; resolutions/admissions/exports count 1). */
  readonly units: number;
  /** The act instant (epoch ms; injected). */
  readonly at: TimestampMs;
  /** The billable subject (an opaque ref — e.g. 'cred:...@2' or 'ep-...'). */
  readonly subject: string;
}

/** One scope's accounting: the per-kind counters plus the event count. */
export interface ScopeUsage {
  readonly tenant: Scope['tenant'];
  readonly project: Scope['project'];
  readonly credentialResolutions: number;
  readonly episodesAdmitted: number;
  readonly exports: number;
  readonly recordWrites: number;
  readonly eventCount: number;
}

/** The typed hook every security act fires (compose with billing/metering lanes). */
export type UsageHook = (event: UsageEvent) => void;

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/** The usage ledger. An opaque value; state is module-private (WeakMap). */
export interface UsageLedger {
  readonly kind: 'tradrl/usage-ledger/v1';
}

interface LedgerState {
  /** scopeKey -> events (insertion order). */
  readonly byScope: Map<string, UsageEvent[]>;
  readonly hooks: UsageHook[];
}

const LEDGER_STATES = new WeakMap<UsageLedger, LedgerState>();

function stateOf(ledger: UsageLedger): LedgerState {
  const state = LEDGER_STATES.get(ledger);
  if (state === undefined) throw new Error('usage ledger: unknown ledger instance (create one with createUsageLedger)');
  return state;
}

/** Create an empty usage ledger. */
export function createUsageLedger(): UsageLedger {
  const ledger: UsageLedger = { kind: 'tradrl/usage-ledger/v1' };
  LEDGER_STATES.set(ledger, { byScope: new Map(), hooks: [] });
  return Object.freeze(ledger);
}

/** Register a usage hook (fires on every recorded event; hooks are the accounting integration surface). */
export function onUsage(ledger: UsageLedger, hook: UsageHook): void {
  stateOf(ledger).hooks.push(hook);
}

/**
 * Record one usage event — THE accounting hook's fire path. The event id
 * is content-addressed over (scope, sequence, kind, units, at, subject):
 * identical act streams produce identical event-id streams
 * (determinism). Returns the frozen event.
 */
export function recordUsage(
  ledger: UsageLedger,
  scope: Scope,
  kind: UsageKind,
  units: number,
  subject: string,
  at: TimestampMs,
): { readonly ok: true; readonly value: UsageEvent } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(ledger);
  if (!isRecord(scope) || typeof scope.tenant !== 'string' || scope.tenant === '' || typeof scope.project !== 'string' || scope.project === '') {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'usage events must carry their tenant+project scope (L12)' }] };
  }
  if (!isUsageKind(kind)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `kind must be one of ${USAGE_KINDS.join(' | ')}` }] };
  }
  if (!isPositiveSafeInteger(units)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'units must be a positive integer' }] };
  }
  if (typeof subject !== 'string' || subject === '') {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'subject must be a non-empty opaque ref' }] };
  }
  if (!isTimestampMs(at)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'at must be an epoch-ms instant (no ambient clock)' }] };
  }
  const key = `${scope.tenant}/${scope.project}`;
  const events = state.byScope.get(key) ?? [];
  const sequence = events.length + 1;
  const event: UsageEvent = deepFreeze({
    event_id: mintUsageEventId(fnv1a32Hex(canonicalJson({ tenant: scope.tenant, project: scope.project, sequence, kind, units, at, subject }))),
    tenant: scope.tenant,
    project: scope.project,
    kind,
    units,
    at,
    subject,
  });
  events.push(event);
  state.byScope.set(key, events);
  for (const hook of [...state.hooks]) hook(event);
  return { ok: true, value: event };
}

/**
 * Read ONE scope's accounting. THE LAW: another scope's accounting is
 * unreachable — a foreign scope argument is the typed
 * `cross_tenant_access` error (usage is isolated per L12; the caller
 * never receives another tenant's counters).
 */
export function usageFor(
  ledger: UsageLedger,
  scope: Scope,
): { readonly ok: true; readonly value: ScopeUsage } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(ledger);
  if (!isRecord(scope) || typeof scope.tenant !== 'string' || typeof scope.project !== 'string') {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'usageFor requires a { tenant, project } scope (L12)' }] };
  }
  const events = state.byScope.get(`${scope.tenant}/${scope.project}`) ?? [];
  const summary: ScopeUsage = deepFreeze({
    tenant: scope.tenant,
    project: scope.project,
    credentialResolutions: events.filter((e) => e.kind === 'credential_resolution').reduce((acc, e) => acc + e.units, 0),
    episodesAdmitted: events.filter((e) => e.kind === 'episode_admitted').reduce((acc, e) => acc + e.units, 0),
    exports: events.filter((e) => e.kind === 'export').reduce((acc, e) => acc + e.units, 0),
    recordWrites: events.filter((e) => e.kind === 'record_write').reduce((acc, e) => acc + e.units, 0),
    eventCount: events.length,
  });
  return { ok: true, value: summary };
}

/** One scope's usage events (insertion order; the scope's OWN events only). */
export function usageEventsFor(ledger: UsageLedger, scope: Scope): readonly UsageEvent[] {
  return Object.freeze([...(stateOf(ledger).byScope.get(`${scope.tenant}/${scope.project}`) ?? [])]);
}
