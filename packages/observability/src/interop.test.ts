/**
 * @tradrl/observability — cross-package interop trip wires.
 *
 * The observed seams are STRUCTURAL MIRRORS of the REAL packages
 * (law D-004: never imports in sources); this test is the trip wire —
 * if any mirror drifts, the TYPE-LEVEL witnesses below fail
 * `pnpm typecheck`, and the RUNTIME parity checks fail the package
 * test run. Cross-package imports happen ONLY in tests, via relative
 * paths (the repo's established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: a REAL T006 `MessageEnvelope` IS this package's
 *      `MessageEnvelopeMirror`; a REAL T006 `KernelOperation` IS the
 *      `KernelOperationMirror`; a REAL T040 `GatewayAuditRecord` IS
 *      the `GatewayAuditRecordMirror`; a REAL T007
 *      `ProjectAuditEntry` IS the `ProjectAuditEntryMirror`; a REAL
 *      event-store `StorableEvent` IS the `StorableEventMirror` —
 *      mutually assignable, ZERO CASTS in the witnesses.
 *   2. RUNTIME: REAL records minted by the REAL packages (the T006
 *      factories, the T040 trail minter, the T007 journal, the
 *      event-store-validated event) satisfy the mirror guards
 *      VERBATIM.
 *   3. RUNTIME: the vocabularies are parity-identical (the fourteen
 *      kernel verbs, the control-plane operation kinds, the event
 *      taxonomy, the asset classes).
 *   4. RUNTIME: the credential-opacity trip wires (T040's and this
 *      package's) flag the IDENTICAL trees — the opacity law is one
 *      law across the lanes.
 *   5. RUNTIME: the id-space guards are prefix-for-prefix identical
 *      ('tel:', 'pau:', 'xga:').
 *   6. RUNTIME: the seam-ref derivations project REAL records onto
 *      their identity refs exactly (the observed-seam pointer law).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  credentialValueViolations as observabilityCredentialViolations,
  isGatewayAuditRecordId as observabilityIsGatewayAuditRecordId,
  isPlatformAuditRecordId,
  isTelemetryRecordId,
  isGatewayAuditRecordMirror,
  isKernelOperationMirror,
  isMessageEnvelopeMirror,
  isProjectAuditEntryMirror,
  isStorableEventMirror,
  seamRefOfEnvelope,
  seamRefOfGatewayAudit,
  seamRefOfOperation,
  seamRefOfProjectAuditEntry,
  seamRefOfStorableEvent,
  type GatewayAuditRecordMirror,
  type MessageEnvelopeMirror,
  type KernelOperationMirror,
  type ProjectAuditEntryMirror,
  type StorableEventMirror,
  type TenantId,
  type ProjectId,
  type TimestampMs,
} from './index';
import {
  ASSET_CLASSES_MIRROR,
  EVENT_TYPES_MIRROR,
  KERNEL_ACTION_NAMES_MIRROR,
  PROJECT_AUDIT_OPERATION_KINDS_MIRROR,
} from './index';

// The REAL agent-os package (T006).
import {
  createKernelOperation,
  createMessageEnvelope,
  KERNEL_ACTION_NAMES,
  type KernelOperation as T006KernelOperation,
  type MessageEnvelope as T006MessageEnvelope,
} from '../../../packages/agent-os/src/index';

// The REAL execution-authority package (T040).
import {
  appendGatewayAuditRecord,
  canonicalJson as t040CanonicalJson,
  credentialValueViolations as t040CredentialViolations,
  gatewayAuditRecordAt,
  isGatewayAuditRecordId as t040IsGatewayAuditRecordId,
  mintAdapterDescriptorRef,
  mintChannelRef,
  startGatewayAuditTrail,
  verifyGatewayAuditChain,
  type AdapterDescriptorRef,
  type CredentialRef,
  type GatewayAuditRecord as T040GatewayAuditRecord,
} from '../../../packages/execution-authority/src/index';

// The REAL control plane (T007 — service + contract surface).
import {
  ProjectAuditLog,
  PROJECT_AUDIT_OPERATION_KINDS,
  type ConstraintSetRef,
  type GoalRef,
  type OrganizationRef,
  type ProjectAuditEntry as T007ProjectAuditEntry,
} from '../../../services/control-plane/src/index';

// The REAL event store (the data-plane seam).
import {
  EVENT_TYPES,
  ASSET_CLASSES,
  validateStorableEvent,
  type StorableEvent,
} from '../../../services/event-store/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical (branded spaces share tags).
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T006 MessageEnvelope IS this package's MessageEnvelopeMirror. */
function realEnvelopeIsMirrorEnvelope(value: T006MessageEnvelope): MessageEnvelopeMirror {
  return value;
}

/** Compiles iff the REAL T006 KernelOperation IS this package's KernelOperationMirror. */
function realOperationIsMirrorOperation(value: T006KernelOperation): KernelOperationMirror {
  return value;
}

/** Compiles iff the REAL T040 GatewayAuditRecord IS this package's GatewayAuditRecordMirror. */
function realGatewayAuditIsMirrorGatewayAudit(value: T040GatewayAuditRecord): GatewayAuditRecordMirror {
  return value;
}

/** Compiles iff the REAL T007 ProjectAuditEntry IS this package's ProjectAuditEntryMirror. */
function realProjectEntryIsMirrorProjectEntry(value: T007ProjectAuditEntry): ProjectAuditEntryMirror {
  return value;
}

/** Compiles iff the REAL event-store StorableEvent IS this package's StorableEventMirror. */
function realEventIsMirrorEvent(value: StorableEvent): StorableEventMirror {
  return value;
}

// Keep the witnesses referenced (type-level only).
void realEnvelopeIsMirrorEnvelope;
void realOperationIsMirrorOperation;
void realGatewayAuditIsMirrorGatewayAudit;
void realProjectEntryIsMirrorProjectEntry;
void realEventIsMirrorEvent;

// ---------------------------------------------------------------------------
// The shared fixture scope (explicit literals — no ambient clock).
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-interop' as TenantId;
const PROJECT = 'project-interop' as ProjectId;

// ---------------------------------------------------------------------------
// The REAL records
// ---------------------------------------------------------------------------

/** A REAL T006 message envelope, minted by the real factory. */
function realEnvelope(): T006MessageEnvelope {
  return createMessageEnvelope({
    id: 'msg-interop-0001',
    topic: 'org.research.signals',
    tenantId: 'tenant-interop',
    sender: 'inst-regime-researcher',
    payload: JSON.stringify({ signal: 'risk-on', strength: 0.72 }),
    sequence: 1,
    causalityId: 'kop-interop-0001',
    publishedAt: T0,
  });
}

/** A REAL T006 SPAWN kernel operation, minted by the real factory. */
function realSpawnOperation(): T006KernelOperation {
  return createKernelOperation({
    opId: 'kop-interop-0001',
    type: 'SPAWN',
    timestamp: T0,
    actor: 'inst-trading-director',
    tenantId: 'tenant-interop',
    target: 'inst-regime-researcher',
    managerId: null,
    bodyVersionRef: 'bodyv:regime-researcher@3',
    substrateRef: 'substrate:glm-4-plus',
    authority: { allowedActions: ['PUBLISH', 'REPORT', 'ESCALATE'], deniedActions: ['EXECUTE'], maxDelegationDepth: 2 },
  });
}

/** A REAL T006 REPORT kernel operation (the reporting-lane transport — T043 owns the detail referent). */
function realReportOperation(): T006KernelOperation {
  return createKernelOperation({
    opId: 'kop-interop-0002',
    type: 'REPORT',
    timestamp: T0 + 1_000,
    actor: 'inst-regime-researcher',
    tenantId: 'tenant-interop',
    summary: {
      subject: 'inst-regime-researcher',
      headline: 'regime flip detected: contraction -> expansion',
      detailRef: 'report:regime-2024-06-04-0001',
    },
  });
}

/** A REAL T006 EXECUTE kernel operation (the L8 authority-neutral transport). */
function realExecuteOperation(): T006KernelOperation {
  return createKernelOperation({
    opId: 'kop-interop-0003',
    type: 'EXECUTE',
    timestamp: T0 + 2_000,
    actor: 'inst-trading-director',
    tenantId: 'tenant-interop',
    intentRef: 'si:interop-0001',
    authorityTokenRef: 'grant:gateway-execute-limit@1',
  });
}

/** The content of one REAL T040 gateway audit record (routed outcome — the full sentence). */
function realGatewayAuditContent() {
  return {
    who: {
      bodyVersion: { specId: 'spec-interop-director', version: 1 },
      intentRef: 'si:interop-0001',
      decisionId: 'xd:a1b2c3d4',
      decisionKind: 'approve' as const,
      clientOrderId: 'cl-interop-0001',
    },
    substrate: 'substrate:glm-4-plus',
    policy: { policyId: 'xpol:interop-0001', version: 1 },
    visibleState: {
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      instrumentClass: 'crypto',
      referencePrice: '42000.00',
      rateWindowOrderCount: 3,
      riskExposureRef: 'exp:interop-0001',
    },
    riskChecks: {
      evaluationId: 'rls:interop-0001',
      riskPolicy: { policyId: 'rpol:interop-0001', version: 1 },
      within: 5,
      breaching: 0,
      blocked: 0,
    },
    order: {
      adapterRef: mintAdapterDescriptorRef({ id: 'adapter-brokers', version: '0.0.0' }) as AdapterDescriptorRef,
      channelRef: mintChannelRef('newOrderSingle'),
      credentialRef: 'cred:interop-broker@1' as CredentialRef,
      clientOrderId: 'cl-interop-0001',
      requestRef: 'gor:interop-0001',
    },
    execution: {
      routed: true,
      submissionAt: T0,
      messageDigest: '0f1e2d3c',
    },
    outcome: 'routed' as const,
    refusal: null,
    lineage: {
      intentRef: 'si:interop-0001',
      strategy: { specId: 'spec-interop-director', version: 1 },
      goal: { goalId: 'goal-interop-0001', version: 1 },
      policy: { policyId: 'xpol:interop-0001', version: 1 },
      venues: ['BINANCE'],
      seed: 'interop-seed-0001',
      tenant: TENANT,
      project: PROJECT,
    },
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
  };
}

/** A REAL T040 gateway audit record, minted at a REAL trail's first position. */
function realGatewayAuditRecord(): T040GatewayAuditRecord {
  const trail = startGatewayAuditTrail(TENANT, PROJECT);
  if (!trail.ok) throw new Error(`fixture trail must start: ${JSON.stringify(trail.errors)}`);
  const minted = gatewayAuditRecordAt(trail.value, realGatewayAuditContent());
  if (!minted.ok) throw new Error(`fixture audit record must mint: ${JSON.stringify(minted.errors)}`);
  return minted.value;
}

/** A REAL T007 control-plane journal entry, appended through the REAL log. */
function realProjectAuditEntry(): T007ProjectAuditEntry {
  const log = new ProjectAuditLog();
  return log.append(
    { kind: 'organization.bound', organizationRef: 'org-interop-0001' as OrganizationRef },
    {
      at: T0 as never,
      tenantId: TENANT,
      projectId: PROJECT,
      lineage: {
        projectId: PROJECT,
        goal: { goalId: 'goal-interop-0001' as GoalRef, version: 1 },
        constraintSet: { id: 'cs-interop-0001' as ConstraintSetRef, version: 1 },
      },
    },
  );
}

/** A REAL T007 control-plane lifecycle entry (the second operation shape). */
function realProjectTransitionEntry(): T007ProjectAuditEntry {
  const log = new ProjectAuditLog();
  return log.append(
    { kind: 'project.transitioned', event: 'activate' },
    {
      at: (T0 + 5_000) as never,
      tenantId: TENANT,
      projectId: PROJECT,
      lineage: {
        projectId: PROJECT,
        goal: { goalId: 'goal-interop-0001' as GoalRef, version: 1 },
        constraintSet: { id: 'cs-interop-0001' as ConstraintSetRef, version: 1 },
      },
    },
  );
}

/** A REAL event-store storable event (validated by the REAL store validator). */
function realStorableEvent(): StorableEvent {
  const event: StorableEvent = {
    event_id: 'evt-interop-0001',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: null,
    available_time: T0,
    ingestion_time: T0,
    sequence: 1,
    provider: 'binance',
    provenance: {
      origin: 'historical',
      adapter: { id: 'binance-adapter', version: '1.4.0' },
      derived_from: [],
      transform: null,
    },
    payload: { price: '42000.00', size: '0.010' },
  };
  const validation = validateStorableEvent(event);
  if (!validation.ok) throw new Error(`fixture event must validate: ${JSON.stringify(validation.errors)}`);
  return event;
}

// ---------------------------------------------------------------------------
// The trip wires
// ---------------------------------------------------------------------------

describe('interop: the agent-plane seam (T006 @tradrl/agent-os)', () => {
  it('accepts a REAL MessageEnvelope minted by the real factory', () => {
    const envelope = realEnvelope();
    expect(isMessageEnvelopeMirror(envelope)).toBe(true);
  });

  it('accepts REAL KernelOperations minted by the real factory (SPAWN, REPORT, EXECUTE)', () => {
    expect(isKernelOperationMirror(realSpawnOperation())).toBe(true);
    expect(isKernelOperationMirror(realReportOperation())).toBe(true);
    expect(isKernelOperationMirror(realExecuteOperation())).toBe(true);
  });

  it('holds the fourteen-verb vocabulary at parity with the REAL kernel', () => {
    expect([...KERNEL_ACTION_NAMES_MIRROR]).toEqual([...KERNEL_ACTION_NAMES]);
    expect(KERNEL_ACTION_NAMES_MIRROR).toHaveLength(14);
  });

  it('rejects a record with an unknown verb (the vocabulary is closed on both sides)', () => {
    expect(isKernelOperationMirror({ ...realSpawnOperation(), type: 'TELEPORT' })).toBe(false);
  });

  it('projects REAL records onto their observed-seam refs exactly', () => {
    expect(seamRefOfEnvelope(realEnvelope())).toEqual({
      kind: 'agent-envelope',
      messageId: 'msg-interop-0001',
      topic: 'org.research.signals',
      tenant: 'tenant-interop',
    });
    expect(seamRefOfOperation(realReportOperation())).toEqual({
      kind: 'kernel-operation',
      opId: 'kop-interop-0002',
      type: 'REPORT',
      tenant: 'tenant-interop',
    });
  });
});

describe('interop: the execution-plane seam (T040 @tradrl/execution-authority)', () => {
  it('accepts a REAL GatewayAuditRecord minted by the REAL trail minter', () => {
    const record = realGatewayAuditRecord();
    // The record is genuinely valid in its own lane first (the real chain accepts it).
    const trail = startGatewayAuditTrail(TENANT, PROJECT);
    if (!trail.ok) throw new Error('fixture trail must start');
    const appended = appendGatewayAuditRecord(trail.value, record);
    expect(appended.ok).toBe(true);
    if (appended.ok) expect(verifyGatewayAuditChain(appended.value).ok).toBe(true);
    // The mirror guard accepts it verbatim.
    expect(isGatewayAuditRecordMirror(record)).toBe(true);
  });

  it('keeps the opacity trip wire at parity with the REAL T040 scan (identical trees flagged identically)', () => {
    const contaminated = {
      tenant: 'tenant-interop',
      order: { credentialRef: 'cred:interop-broker@1' },
      detail: { nested: [{ api_key: 'AKIA-SECRET-VALUE' }, { 'Pass-Phrase': 'hunter2' }] },
    };
    expect([...observabilityCredentialViolations(contaminated)]).toEqual([...t040CredentialViolations(contaminated)]);
    expect(observabilityCredentialViolations(contaminated)).toEqual(['detail.nested[0].api_key', 'detail.nested[1].Pass-Phrase']);
    // A 'cred:' REF is fine on both sides (references, never values).
    const clean = { credentialRef: 'cred:interop-broker@1', token: 'cred:another@2' };
    expect(observabilityCredentialViolations(clean)).toEqual(t040CredentialViolations(clean));
    expect(observabilityCredentialViolations(clean)).toEqual(['token']);
  });

  it('keeps the xga: id-space guards prefix-for-prefix identical', () => {
    for (const candidate of ['xga:0f1e2d3c', 'xga:', 'tel:0f1e2d3c', 'pau:0f1e2d3c', 'gor:0f1e2d3c']) {
      expect(observabilityIsGatewayAuditRecordId(candidate)).toBe(t040IsGatewayAuditRecordId(candidate));
    }
    expect(observabilityIsGatewayAuditRecordId('xga:0f1e2d3c')).toBe(true);
  });

  it('keeps this lane\u2019s own id prefixes closed (tel: and pau: are not interchangeable)', () => {
    expect(isTelemetryRecordId('tel:0f1e2d3c')).toBe(true);
    expect(isTelemetryRecordId('pau:0f1e2d3c')).toBe(false);
    expect(isPlatformAuditRecordId('pau:0f1e2d3c')).toBe(true);
    expect(isPlatformAuditRecordId('tel:0f1e2d3c')).toBe(false);
  });

  it('projects a REAL T040 record onto the opaque complement join key exactly', () => {
    const record = realGatewayAuditRecord();
    expect(seamRefOfGatewayAudit(record)).toEqual({
      kind: 'gateway-audit',
      auditId: record.auditId,
      tenant: TENANT,
      project: PROJECT,
    });
  });
});

describe('interop: the control-plane seam (T007 services/control-plane)', () => {
  it('accepts REAL ProjectAuditEntries appended through the REAL journal', () => {
    expect(isProjectAuditEntryMirror(realProjectAuditEntry())).toBe(true);
    expect(isProjectAuditEntryMirror(realProjectTransitionEntry())).toBe(true);
  });

  it('holds the operation-kind vocabulary at parity with the REAL journal', () => {
    expect([...PROJECT_AUDIT_OPERATION_KINDS_MIRROR]).toEqual([...PROJECT_AUDIT_OPERATION_KINDS]);
  });

  it('rejects a journal entry whose lineage project identity is incoherent (the T007 law, mirrored)', () => {
    const entry = realProjectAuditEntry();
    const forged = { ...entry, lineage: { ...entry.lineage, projectId: 'project-OTHER' } };
    expect(isProjectAuditEntryMirror(forged)).toBe(false);
  });

  it('projects a REAL journal entry onto its sequence-identity seam ref', () => {
    const entry = realProjectAuditEntry();
    expect(seamRefOfProjectAuditEntry(entry)).toEqual({
      kind: 'control-plane-audit',
      sequence: 1,
      tenant: TENANT,
      project: PROJECT,
    });
  });
});

describe('interop: the data-plane seam (services/event-store)', () => {
  it('accepts a REAL StorableEvent validated by the REAL store validator', () => {
    expect(isStorableEventMirror(realStorableEvent())).toBe(true);
  });

  it('holds the taxonomy at parity with the REAL store (event types + asset classes)', () => {
    expect([...EVENT_TYPES_MIRROR]).toEqual([...EVENT_TYPES]);
    expect([...ASSET_CLASSES_MIRROR]).toEqual([...ASSET_CLASSES]);
  });

  it('rejects what the REAL store rejects: available_time before event_time (the L4 quartet law, mirrored)', () => {
    const event = realStorableEvent();
    const skewed = { ...event, available_time: event.event_time - 1 };
    expect(validateStorableEvent(skewed).ok).toBe(false);
    expect(isStorableEventMirror(skewed)).toBe(false);
  });

  it('rejects what the REAL store rejects: a historical event without an adapter (provenance law, mirrored)', () => {
    const event = realStorableEvent();
    const orphan = { ...event, provenance: { ...event.provenance, adapter: null } };
    expect(validateStorableEvent(orphan).ok).toBe(false);
    expect(isStorableEventMirror(orphan)).toBe(false);
  });

  it('projects a REAL event onto its identity seam ref', () => {
    expect(seamRefOfStorableEvent(realStorableEvent())).toEqual({
      kind: 'event-store',
      eventId: 'evt-interop-0001',
      venue: 'BINANCE',
    });
  });
});

describe('interop: canonical serialization parity', () => {
  it('digests the shared canonical form identically to the T040 primitives (the byte-determinism law is one law)', () => {
    const value = { b: 2, a: 1, nested: { z: 'last', m: [3, 1, 2] }, n: null } as const;
    expect(canonicalJson(value)).toBe(t040CanonicalJson(value));
    expect(canonicalJson(value)).toBe('{"a":1,"b":2,"n":null,"nested":{"m":[3,1,2],"z":"last"}}');
  });
});
