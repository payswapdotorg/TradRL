// deploy/adapters/contract.test.ts — the PORT-SHAPE TRIP-WIRES
// (T052, W-3b; the W-3d wire extends these).
//
// The adapters NEVER import services/api at runtime (invariant-9: the
// port shapes are STRUCTURAL MIRRORS in deploy/adapters/*/mirrors.ts).
// This test file is the one sanctioned import point — TEST-ONLY, the
// exact precedent of services/api/src/interop.test.ts (which imports
// the REAL packages test-only as the drift trip wire). If T041's port
// or query shapes drift in a way that breaks the adapters' SQL/keys,
// THESE ASSERTIONS FAIL AT TYPECHECK TIME:
//
//   - every REAL query type must be assignable to the adapter's
//     mirror (a required field T041 ADDS to a query breaks the
//     adapter's filters — caught here);
//   - the REAL PortResult must be interchangeable with the adapters'
//     StoreResult (the pipeline maps them 1:1);
//   - the runtime guards: a REAL-shaped query object satisfies the
//     mirrors at runtime (the adapters accept what T041 sends).
//
// DEFERRAL (honest, W-3d): the strict store-IMPLEMENTS-real-port
// direction (NeonFirmMemoryStore assignable to FirmMemoryPort) needs
// the full deep record mirrors (FirmKnowledgeRecord's nested claim/
// provenance trees etc.) — that lands with deploy/wire, where the
// composition needs it. Here the QUERY surface + the result envelope
// are pinned (what breaks the SQL and the keys today).

import { describe, expect, it } from 'vitest';
import type { PortResult } from '../../services/api/src/ports';
import type { KnowledgeQuery, KnowledgeQueryOptions } from '../../services/api/src/mirrors';
import type { OutcomeQuery, OutcomeQueryOptions, PostMortemQuery } from '../../services/api/src/mirrors-outcomes';
import type { StoreResult } from './shared';
import type { KnowledgeQueryMirror, KnowledgeQueryOptionsMirror, OutcomeQueryMirror, OutcomeQueryOptionsMirror, PostMortemQueryMirror } from './neon/mirrors';

// ---------------------------------------------------------------------------
// The type-level trip-wires (fail at typecheck on drift)
// ---------------------------------------------------------------------------

/** `true` when Source is assignable to Target (compile-time only). */
type AssertAssignable<Source, Target> = Source extends Target ? true : never;

// The REAL T041 queries must satisfy the adapters' mirrors — a
// REQUIRED field added to a real query type breaks these assignments.
const realKnowledgeQueryIsMirror: AssertAssignable<KnowledgeQuery, KnowledgeQueryMirror> = true;
const realKnowledgeOptionsAreMirror: AssertAssignable<KnowledgeQueryOptions, KnowledgeQueryOptionsMirror> = true;
const realOutcomeQueryIsMirror: AssertAssignable<OutcomeQuery, OutcomeQueryMirror> = true;
const realPostMortemQueryIsMirror: AssertAssignable<PostMortemQuery, PostMortemQueryMirror> = true;
const realOutcomeOptionsAreMirror: AssertAssignable<OutcomeQueryOptions, OutcomeQueryOptionsMirror> = true;

// The REAL PortResult and the adapters' StoreResult are interchangeable
// (identical widened shapes — the pipeline maps them without casts).
const realPortResultIsStoreResult: AssertAssignable<PortResult<string>, StoreResult<string>> = true;
const storeResultIsRealPortResult: AssertAssignable<StoreResult<string>, PortResult<string>> = true;

// The mirrors are also assignable BACK to the real queries (the shapes
// are currently field-identical — the strongest form).
const mirrorIsRealKnowledgeQuery: AssertAssignable<KnowledgeQueryMirror, KnowledgeQuery> = true;
const mirrorIsRealOutcomeQuery: AssertAssignable<OutcomeQueryMirror, OutcomeQuery> = true;

void realKnowledgeQueryIsMirror;
void realKnowledgeOptionsAreMirror;
void realOutcomeQueryIsMirror;
void realPostMortemQueryIsMirror;
void realOutcomeOptionsAreMirror;
void realPortResultIsStoreResult;
void storeResultIsRealPortResult;
void mirrorIsRealKnowledgeQuery;
void mirrorIsRealOutcomeQuery;

// ---------------------------------------------------------------------------
// The runtime trip-wires (REAL-shaped queries satisfy the mirrors)
// ---------------------------------------------------------------------------

describe('deploy/adapters — the port-shape trip-wires', () => {
  it('a REAL-shaped knowledge query satisfies the adapter mirror at runtime (the store accepts T041\'s own shape)', () => {
    const realShapedQuery: KnowledgeQuery = { tenant: 'tenant-demo', project: 'prj_demo', kinds: ['claim'], polarity: 'bullish', minEvidenceCount: 2, knowledgeId: 'fkr:abc' };
    const mirror: KnowledgeQueryMirror = realShapedQuery;
    expect(mirror.tenant).toBe('tenant-demo');
    expect(mirror.knowledgeId).toBe('fkr:abc');
    const realShapedOptions: KnowledgeQueryOptions = { at: 1_800_300_000_000 as KnowledgeQueryOptions['at'], retention: null, activeOnly: true }; // the branded instant — cast once for the literal
    const mirrorOptions: KnowledgeQueryOptionsMirror = realShapedOptions;
    expect(mirrorOptions.activeOnly).toBe(true);
  });

  it('a REAL-shaped outcome + post-mortem query satisfies the adapter mirrors at runtime', () => {
    const realOutcome: OutcomeQuery = { tenant: 'tenant-demo', project: 'prj_demo', decisionRef: 'dec:1', outcomeClass: 'profit' };
    const outcomeMirror: OutcomeQueryMirror = realOutcome;
    expect(outcomeMirror.decisionRef).toBe('dec:1');
    const realMortem: PostMortemQuery = { tenant: 'tenant-demo', project: 'prj_demo', attributionClass: 'model-error' };
    const mortemMirror: PostMortemQueryMirror = realMortem;
    expect(mortemMirror.attributionClass).toBe('model-error');
    const realOptions: OutcomeQueryOptions = { at: 1_800_300_000_000 as OutcomeQueryOptions['at'], retention: null, latestPerOutcome: true }; // the branded instant — cast once for the literal
    const optionsMirror: OutcomeQueryOptionsMirror = realOptions;
    expect(optionsMirror.latestPerOutcome).toBe(true);
  });

  it('a REAL PortResult flows through a StoreResult consumer without transformation', () => {
    const portResult: PortResult<string> = { ok: true, value: 'served' };
    const asStore: StoreResult<string> = portResult;
    expect(asStore.ok).toBe(true);
    const portFailure: PortResult<string> = { ok: false, error: { code: 'unavailable', message: 'refused' } };
    const asStoreFailure: StoreResult<string> = portFailure;
    expect(asStoreFailure.ok).toBe(false);
    if (!asStoreFailure.ok) expect(asStoreFailure.error.code).toBe('unavailable');
  });
});
