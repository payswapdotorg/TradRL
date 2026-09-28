/**
 * Behavioral tests for the FirewallService (T026 reference implementation):
 * inclusive boundary at the service layer, tenant scoping with L12-safe
 * audit entries, filter paths, typed rejections, determinism, audit replay
 * and verification, tamper detection, immutability. The fixtures come from
 * the REAL knowledge module (integration wiring) — see interop.test.ts for
 * the structural trip-wires that make that typing sound.
 */

import { describe, expect, it } from 'vitest';

import {
  cleanKnowledgeGraph,
  firewallClockAt,
  ids,
  leakyKnowledgeGraph,
  tenantIsolationScenario,
} from './fixtures';
import {
  createFirewallService,
  firewallGetRecord,
  firewallQuery,
  replayFirewallAudit,
  verifyFirewallAudit,
  type FirewallAuditLog,
  type FirewallDecision,
  type FirewallQueryResult,
} from './service';
import {
  isTimestampMs,
  type FirewallResult,
  type KnowledgeBaseView,
  type KnowledgeQueryFilter,
  type KnowledgeRecordId,
  type TenantId,
  type TimestampMs,
} from './mirrors';

function unwrapQuery(value: FirewallResult<FirewallQueryResult>): FirewallQueryResult {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

/** Map records to plain-string ids for list assertions. */
function recordIds(records: readonly { readonly record_id: KnowledgeRecordId }[]): string[] {
  return records.map((record) => record.record_id as string);
}

describe('firewallQuery — clock-policed, tenant-scoped reads over the clean fixture', () => {
  const fixture = cleanKnowledgeGraph();

  it('returns ONLY the visible, tenant-scoped records, in base order', () => {
    const result = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    expect(recordIds(result.records)).toEqual([
      'kr-trade-1',
      'kr-trade-2',
      'kr-trade-3',
      'kr-feature-vwap', // available EXACTLY at 3_250 — the inclusive boundary
    ]);
    expect(result.audit.scanned).toBe(5);
    expect(result.audit.at).toBe(3_250);
  });

  it('the INCLUSIVE boundary: available_time == now IS visible; == now+1 is NOT', () => {
    // The feature is available at exactly 3_250: == now -> visible.
    const atBoundary = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    expect(recordIds(atBoundary.records)).toContain('kr-feature-vwap');

    // One millisecond earlier the feature's availability is now+1 -> withheld.
    const oneMsEarly = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_249), ids.acme(), {}));
    expect(recordIds(oneMsEarly.records)).not.toContain('kr-feature-vwap');

    // The aggregate releases at 4_250: withheld one millisecond before,
    // visible exactly at the release instant.
    const aggregateWithheld = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(4_249), ids.acme(), {}));
    expect(recordIds(aggregateWithheld.records)).not.toContain('kr-aggregate-daily');
    const aggregateAtRelease = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(4_250), ids.acme(), {}));
    expect(recordIds(aggregateAtRelease.records)).toContain('kr-aggregate-daily');
  });

  it('the decision audit log explains every inclusion and exclusion', () => {
    const result = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_000), ids.acme(), {}));
    const byId = new Map(result.audit.decisions.map((decision) => [decision.record_id as string, decision]));
    expect(byId.get('kr-trade-3')).toMatchObject({ decision: 'included', reason: 'visible', available_time: 3_000 });
    expect(byId.get('kr-feature-vwap')).toMatchObject({ decision: 'excluded', reason: 'not_yet_available', available_time: 3_250 });
    expect(byId.get('kr-aggregate-daily')).toMatchObject({ decision: 'excluded', reason: 'not_yet_available', available_time: 4_250 });
    for (const decision of result.audit.decisions) {
      expect(isTimestampMs(decision.now)).toBe(true);
    }
  });

  it('tenant scope first: cross-tenant records are excluded WITHOUT disclosing their timing (L12)', () => {
    const mixed = tenantIsolationScenario();
    // Clock AFTER both records' availability: the globex record is visible
    // but STILL excluded for the tenant boundary — the tenant check runs
    // first, and its audit entry discloses no timing.
    const result = unwrapQuery(firewallQuery(mixed.base, firewallClockAt(2_000), ids.acme(), {}));
    expect(recordIds(result.records)).toEqual(['kr-acme-1']);
    const globexDecision = result.audit.decisions.find((decision) => decision.record_id === 'kr-globex-1');
    expect(globexDecision).toMatchObject({ decision: 'excluded', reason: 'tenant_boundary' });
    expect(globexDecision?.available_time).toBeNull(); // never disclose another tenant's timing
  });

  it('the boundary is ORIGIN-BLIND at the service layer too', () => {
    // The feature (simulated origin) is withheld exactly like the historical
    // trades when the clock precedes its availability.
    const early = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(2_999), ids.acme(), {}));
    const simulatedDecision = early.audit.decisions.find((d) => d.record_id === 'kr-feature-vwap');
    const historicalDecision = early.audit.decisions.find((d) => d.record_id === 'kr-trade-3');
    expect(simulatedDecision?.reason).toBe('not_yet_available');
    expect(historicalDecision?.reason).toBe('not_yet_available');
  });
});

describe('firewallQuery — the data-shaped filter', () => {
  const fixture = cleanKnowledgeGraph();

  it('restricts by ids', () => {
    const filter: KnowledgeQueryFilter = { ids: [ids.record('kr-trade-1'), ids.record('kr-trade-3')] };
    const result = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(4_500), ids.acme(), filter));
    expect(recordIds(result.records)).toEqual(['kr-trade-1', 'kr-trade-3']);
    const filtered = result.audit.decisions.find((d) => d.record_id === 'kr-trade-2');
    expect(filtered).toMatchObject({ decision: 'excluded', reason: 'filtered_out' });
  });

  it('restricts by availability window', () => {
    const result = unwrapQuery(
      firewallQuery(fixture.base, firewallClockAt(4_500), ids.acme(), {
        availableFrom: 2_000 as TimestampMs,
        availableTo: 3_250 as TimestampMs,
      }),
    );
    expect(recordIds(result.records)).toEqual(['kr-trade-2', 'kr-trade-3', 'kr-feature-vwap']);
  });

  it('an empty ids array means no restriction (treated as absent)', () => {
    const result = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(4_500), ids.acme(), { ids: [] }));
    expect(result.records.length).toBe(5);
  });

  it('rejects invalid filters with typed errors', () => {
    // Runtime guards must hold even when untyped callers smuggle bad values
    // past the compile-time brands (assertions emulate untrusted input).
    const emptyId = firewallQuery(fixture.base, firewallClockAt(1), ids.acme(), { ids: ['' as KnowledgeRecordId] });
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) expect(emptyId.error.code).toBe('invalid_filter');

    const duplicateIds = firewallQuery(fixture.base, firewallClockAt(1), ids.acme(), {
      ids: [ids.record('kr-trade-1'), ids.record('kr-trade-1')],
    });
    expect(duplicateIds.ok).toBe(false);
    if (!duplicateIds.ok) expect(duplicateIds.error.code).toBe('invalid_filter');

    const badBounds = firewallQuery(fixture.base, firewallClockAt(1), ids.acme(), {
      availableFrom: 5_000 as TimestampMs,
      availableTo: 4_000 as TimestampMs,
    });
    expect(badBounds.ok).toBe(false);
    if (!badBounds.ok) expect(badBounds.error.code).toBe('invalid_filter');

    const badFrom = firewallQuery(fixture.base, firewallClockAt(1), ids.acme(), { availableFrom: -1 as unknown as TimestampMs });
    expect(badFrom.ok).toBe(false);
    if (!badFrom.ok) expect(badFrom.error.code).toBe('invalid_filter');
  });
});

describe('firewallQuery — total input guards', () => {
  const fixture = cleanKnowledgeGraph();

  it('rejects invalid clocks, tenants and bases with typed errors', () => {
    const badClock = firewallQuery(fixture.base, { now: -1 as unknown as TimestampMs }, ids.acme(), {});
    expect(badClock.ok).toBe(false);
    if (!badClock.ok) expect(badClock.error.code).toBe('invalid_clock');

    const badTenant = firewallQuery(fixture.base, firewallClockAt(1), '' as TenantId, {});
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.error.code).toBe('invalid_tenant');

    const badBase = firewallQuery({ records: [{ record_id: 'x' }], size: 1 } as unknown as KnowledgeBaseView, firewallClockAt(1), ids.acme(), {});
    expect(badBase.ok).toBe(false);
    if (!badBase.ok) expect(badBase.error.code).toBe('invalid_base');
  });
});

describe('firewallGetRecord — typed single-record reads', () => {
  const mixed = tenantIsolationScenario();

  it('serves visible same-tenant records and withholds future ones with typed errors', () => {
    const visible = firewallGetRecord(mixed.base, firewallClockAt(2_000), ids.acme(), ids.record('kr-acme-1'));
    expect(visible.ok).toBe(true);

    // Not yet available: the clean fixture's aggregate releases at 4_250.
    const fixture = cleanKnowledgeGraph();
    const withheld = firewallGetRecord(fixture.base, firewallClockAt(4_000), ids.acme(), ids.record('kr-aggregate-daily'));
    expect(withheld.ok).toBe(false);
    if (!withheld.ok) expect(withheld.error.code).toBe('not_yet_available');
  });

  it('REJECTS cross-tenant reads with a typed tenant_isolation error', () => {
    const cross = firewallGetRecord(mixed.base, firewallClockAt(2_000), ids.globex(), ids.record('kr-acme-1'));
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.error.code).toBe('tenant_isolation');
      expect(cross.error.message).toContain('L12');
    }
  });

  it('reports unknown records with a typed error', () => {
    const absent = firewallGetRecord(mixed.base, firewallClockAt(2_000), ids.acme(), ids.record('kr-nope'));
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error.code).toBe('unknown_record');
  });
});

describe('determinism — identical queries produce identical, frozen results', () => {
  const fixture = cleanKnowledgeGraph();

  it('two identical queries produce deep-equal results and audits', () => {
    const first = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    const second = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    expect(first).toEqual(second);
    expect(first.audit.decisions).toEqual(second.audit.decisions);
  });

  it('results are deeply frozen (audit logs are evidence, not scratch space)', () => {
    const result = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    const mutable = result.audit as unknown as { at: number };
    expect(() => {
      mutable.at = 0;
    }).toThrow();
    const mutableDecision = result.audit.decisions[0] as unknown as { decision: string };
    if (mutableDecision !== undefined) {
      expect(() => {
        mutableDecision.decision = 'excluded';
      }).toThrow();
    }
  });

  it('the decision is a pure function of (record, clock): advancing the clock flips the decision', () => {
    const before = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_249), ids.acme(), {}));
    const at = unwrapQuery(firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), {}));
    const beforeDecision = before.audit.decisions.find((d) => d.record_id === 'kr-feature-vwap');
    const atDecision = at.audit.decisions.find((d) => d.record_id === 'kr-feature-vwap');
    expect(beforeDecision?.decision).toBe('excluded');
    expect(atDecision?.decision).toBe('included');
  });
});

describe('audit replay — the log reproduces identical decisions', () => {
  const fixture = cleanKnowledgeGraph();
  const result = unwrapQuery(
    firewallQuery(fixture.base, firewallClockAt(3_250), ids.acme(), { availableFrom: 1_000 as TimestampMs }),
  );
  const audit: FirewallAuditLog = result.audit;
  const producingFilter: KnowledgeQueryFilter = { availableFrom: 1_000 as TimestampMs };

  it('a clean log replays identically (clean report, no mismatches)', () => {
    const replay = replayFirewallAudit(audit);
    expect(replay.clean).toBe(true);
    expect(replay.mismatches).toEqual([]);
    expect(replay.entriesChecked).toBe(audit.decisions.length);
  });

  it('verification against the base reproduces the identical log', () => {
    const verification = verifyFirewallAudit(fixture.base, firewallClockAt(3_250), ids.acme(), producingFilter, audit);
    expect(verification.clean).toBe(true);
  });

  it('a tampered decision is detected by replay AND verification', () => {
    const tampered = tamper(audit, (decision) => ({ ...decision, decision: 'included' }));
    const replay = replayFirewallAudit(tampered);
    expect(replay.clean).toBe(false);
    expect(replay.mismatches.length).toBeGreaterThan(0);
    expect(replay.mismatches[0]?.recorded.decision).not.toBe(replay.mismatches[0]?.replayed.decision);

    const verification = verifyFirewallAudit(fixture.base, firewallClockAt(3_250), ids.acme(), producingFilter, tampered);
    expect(verification.clean).toBe(false);
  });

  it('a tampered timestamp is detected by replay', () => {
    const tampered = tamper(audit, (decision) =>
      decision.available_time === null ? decision : { ...decision, available_time: 1 as TimestampMs },
    );
    // The aggregate entry (not_yet_available, 4_250) tampered to 1 replays
    // as excluded/filtered_out — a mismatch against the recorded exclusion.
    const replay = replayFirewallAudit(tampered);
    expect(replay.clean).toBe(false);
    expect(replay.mismatches[0]?.replayed.decision).toBe('excluded');
    expect(replay.mismatches[0]?.replayed.reason).toBe('filtered_out');
  });

  it('a truncated log fails verification (length mismatch)', () => {
    const truncated: FirewallAuditLog = { ...audit, decisions: audit.decisions.slice(0, 2) };
    const verification = verifyFirewallAudit(fixture.base, firewallClockAt(3_250), ids.acme(), producingFilter, truncated);
    expect(verification.clean).toBe(false);
  });
});

describe('createFirewallService — the wrapper around a base', () => {
  it('wraps a validated base and delegates the pure operations', () => {
    const fixture = cleanKnowledgeGraph();
    const serviceResult = createFirewallService(fixture.base);
    if (!serviceResult.ok) throw new Error('fixture base must be valid');
    const service = serviceResult.value;

    const query = service.query(firewallClockAt(3_250), ids.acme(), {});
    const unwrapped = unwrapQuery(query);
    expect(recordIds(unwrapped.records)).toContain('kr-feature-vwap');

    const get = service.getRecord(firewallClockAt(4_250), ids.acme(), ids.record('kr-aggregate-daily'));
    expect(get.ok).toBe(true);

    // Verification with the SAME (tenant, clock, filter) reproduces the log.
    const matching = service.verify(firewallClockAt(3_250), ids.acme(), {}, unwrapped.audit);
    expect(matching.clean).toBe(true);

    // Verification with a DIFFERENT filter must NOT reproduce it.
    const different = service.verify(firewallClockAt(3_250), ids.acme(), { ids: [ids.record('kr-trade-1')] }, unwrapped.audit);
    expect(different.clean).toBe(false);
  });

  it('rejects structurally invalid bases at construction', () => {
    const invalid = createFirewallService({ records: [{ record_id: 'x' }], size: 1 } as unknown as KnowledgeBaseView);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('invalid_base');
  });
});

describe('the leaky fixture — reads are still policed while the scan reports the graph corruption', () => {
  it('the scan over the leaky base names the offending chain, and the firewall still polices reads', () => {
    const leaky = leakyKnowledgeGraph();
    expect(leaky.scan.clean).toBe(false);
    const finding = leaky.scan.findings[0];
    expect(finding?.kind).toBe('leaky_record');
    if (finding?.kind === 'leaky_record') {
      expect(finding.record_id).toBe(leaky.leakyId);
      expect(finding.chain).toEqual([leaky.leakyId, leaky.parentId]);
    }

    // Reads remain policed by available_time: at clock 8_999 the leaky record
    // (dated 9_000) is withheld — the firewall cannot repair a corrupt
    // available_time, the scan is the instrument that flags it.
    const result = unwrapQuery(firewallQuery(leaky.base, firewallClockAt(8_999), ids.acme(), {}));
    expect(recordIds(result.records)).toEqual([]);
  });
});

/** Build a tampered copy of an audit log, rewriting the first EXCLUDED decision. */
function tamper(audit: FirewallAuditLog, rewrite: (decision: FirewallDecision) => FirewallDecision): FirewallAuditLog {
  const index = audit.decisions.findIndex((decision) => decision.decision === 'excluded');
  if (index < 0) throw new Error('fixture log must have an excluded decision');
  const target = audit.decisions[index];
  if (target === undefined) throw new Error('unreachable');
  return {
    ...audit,
    decisions: [...audit.decisions.slice(0, index), rewrite(target), ...audit.decisions.slice(index + 1)],
  };
}
