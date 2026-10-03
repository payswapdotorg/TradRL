/**
 * Cross-lane interoperability trip wires for the API boundary lane
 * (Work Order T041): the REAL lanes this boundary consumes ONLY
 * through its STRUCTURAL MIRRORS are loaded STATICALLY here (the
 * tests are the trip wires — the src lane itself imports neither):
 *
 *   - packages/control-domain (T007) + services/control-plane: the
 *     REAL GoalStatement/ConstraintSetStatement/ProjectRecord satisfy
 *     the mirrors field-for-field (type-level witnesses + runtime
 *     guards), and the REAL ControlPlane service DRIVES the boundary
 *     through a thin throwing-to-result adapter — a project created
 *     over the API compiles at the REAL control plane, reads back
 *     through the mirror, and a cross-tenant probe is the REAL lane's
 *     own indistinguishable not-found.
 *   - packages/firm-memory (T034) + services/firm-memory: the REAL
 *     promotion pipeline (ingestFirmLearning over the REAL scenario
 *     snapshots) builds a REAL brain; the REAL queryFirmKnowledge
 *     serving surface DRIVES the boundary's knowledge route through a
 *     thin adapter; the served records satisfy the mirrors.
 *   - packages/execution-policy (T019) +
 *     packages/execution-authority + services/execution-gateway
 *     (T040): the REAL StrategyIntent/OrderIntent/decisions satisfy
 *     the mirrors, and the REAL 13-stage gateway DRIVES the
 *     boundary's execution route through a thin adapter — a REAL
 *     compliant intent submitted over the API routes THROUGH the real
 *     chokepoint and the REAL routed submission satisfies the mirror
 *     (the L8 law's end-to-end trip wire).
 *   - packages/outcomes (T033): the REAL OutcomeRecord and a REAL
 *     minted PostMortemRecord satisfy the mirrors; the REAL query
 *     shapes drive the boundary's outcome/evidence routes.
 *   - packages/security (T044): the REAL Scope IS the boundary's
 *     scope mirror (one identity space, L12); the credential-opacity
 *     trip wires agree on a contamination corpus.
 *   - packages/observability + services/audit (T043): the REAL
 *     PlatformAuditRecord's actor/lineage blocks ARE the boundary's
 *     audit shapes (emit, never define — the drift trip wire).
 */

import { describe, expect, it } from 'vitest';

// --- The REAL packages (test-only; the src lane imports NONE of these) -------
import * as controlDomain from '../../../packages/control-domain/src/index';
import { exampleConstraintSetStatement, exampleGoalStatement, EXAMPLE_TENANT } from '../../../packages/control-domain/src/examples';
import * as controlPlaneService from '../../control-plane/src/index';
import * as firmMemoryService from '../../firm-memory/src/index';
import * as firmMemoryContracts from '../../../packages/firm-memory/src/index';
import { FIRM_PROJECT, FIRM_TENANT, FIRM_T0, firmScenarioPolicy, firmScenarioServingPolicy, scenarioSnapshotAdverse, scenarioSnapshotReinforce, scenarioSnapshotChallenger } from '../../firm-memory/src/fixtures';
import * as executionPolicy from '../../../packages/execution-policy/src/index';
import * as executionAuthority from '../../../packages/execution-authority/src/index';
import * as executionGatewayService from '../../execution-gateway/src/index';
import {
  SUBSTRATE,
  T0 as GATEWAY_T0,
  compliantIntent,
  referenceExposure,
  referenceKillSwitch,
  referencePolicy,
  referencePortfolio,
  referenceRegistry,
  referenceRiskPolicy,
  referenceRoutingTable,
  referenceVenueState,
} from '../../execution-gateway/src/fixtures';
import * as outcomesContracts from '../../../packages/outcomes/src/index';
import { logWithOneOutcome } from '../../../packages/outcomes/src/fixtures';
import * as security from '../../../packages/security/src/index';
import * as observability from '../../../packages/observability/src/index';
import * as auditService from '../../audit/src/index';

// --- The boundary's own surface ------------------------------------------------
import {
  createApiService,
  credentialValueViolations,
  isFirmKnowledgeRecord,
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  isProjectRecord,
  isServedKnowledge,
  isStrategyIntent,
  isGatewaySubmissionRecord,
  type ApiCredential,
  type ApproveDecisionRecord,
  type AuditActor,
  type AuditLineage,
  type ConstraintSetStatement,
  type FirmKnowledgeRecord,
  type GoalStatement,
  type GatewaySubmissionRecord,
  type OrderIntentRecord,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type ProjectRecord,
  type Scope,
  type StrategyIntent,
} from './index';
import { request } from './fixtures';
import { scriptedInstants } from './instants';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T007 GoalStatement IS this lane's mirror. */
function realGoalSatisfiesMirror(goal: controlDomain.GoalStatement): GoalStatement {
  return goal;
}

/** Compiles iff the REAL T007 ConstraintSetStatement IS this lane's mirror. */
function realConstraintSetSatisfiesMirror(set: controlDomain.ConstraintSetStatement): ConstraintSetStatement {
  return set;
}

/** Compiles iff the REAL T007 ProjectRecord IS this lane's mirror. */
function realProjectRecordSatisfiesMirror(record: controlDomain.ProjectRecord): ProjectRecord {
  return record;
}

/** Compiles iff the REAL T019 StrategyIntent IS this lane's mirror. */
function realIntentSatisfiesMirror(intent: executionPolicy.StrategyIntentMirror): StrategyIntent {
  return intent;
}

/** Compiles iff the REAL T040 OrderIntentRecord IS this lane's mirror. */
function realOrderSatisfiesMirror(order: executionAuthority.OrderIntentRecord): OrderIntentRecord {
  return order;
}

/** Compiles iff the REAL T040 ApproveDecisionRecord IS this lane's mirror. */
function realDecisionSatisfiesMirror(decision: executionAuthority.ApproveDecisionRecord): ApproveDecisionRecord {
  return decision;
}

/** Compiles iff the REAL T040 GatewaySubmissionRecord IS this lane's mirror. */
function realSubmissionSatisfiesMirror(record: executionGatewayService.GatewaySubmissionRecord): GatewaySubmissionRecord {
  return record;
}

/** Compiles iff the REAL T034 FirmKnowledgeRecord IS this lane's mirror. */
function realKnowledgeSatisfiesMirror(record: firmMemoryContracts.FirmKnowledgeRecord): FirmKnowledgeRecord {
  return record;
}

/** Compiles iff the REAL T033 OutcomeRecord IS this lane's mirror. */
function realOutcomeSatisfiesMirror(record: outcomesContracts.OutcomeRecord): OutcomeRecordMirror {
  return record;
}

/** Compiles iff the REAL T033 PostMortemRecord IS this lane's mirror. */
function realPostMortemSatisfiesMirror(record: outcomesContracts.PostMortemRecord): PostMortemRecordMirror {
  return record;
}

/** Compiles iff the REAL T044 Scope IS this lane's scope (one identity space, L12). */
function realScopeSatisfiesMirror(scope: security.Scope): Scope {
  return scope;
}

/** Compiles iff the REAL T043 PlatformAuditActor IS this lane's audit actor shape. */
function realActorSatisfiesMirror(actor: auditService.PlatformAuditActor): AuditActor {
  return actor;
}

/** Compiles iff the REAL T043 PlatformAuditLineage IS this lane's audit lineage shape. */
function realLineageSatisfiesMirror(lineage: auditService.PlatformAuditLineage): AuditLineage {
  return lineage;
}

void realGoalSatisfiesMirror;
void realConstraintSetSatisfiesMirror;
void realProjectRecordSatisfiesMirror;
void realIntentSatisfiesMirror;
void realOrderSatisfiesMirror;
void realDecisionSatisfiesMirror;
void realSubmissionSatisfiesMirror;
void realKnowledgeSatisfiesMirror;
void realOutcomeSatisfiesMirror;
void realPostMortemSatisfiesMirror;
void realScopeSatisfiesMirror;
void realActorSatisfiesMirror;
void realLineageSatisfiesMirror;

// ---------------------------------------------------------------------------
// The thin adapters (throwing/ errors-array REAL services -> the result-shaped ports)
// ---------------------------------------------------------------------------

/** Adapt the REAL ControlPlane (throwing) to the boundary's port (result-shaped). */
function realControlPlanePort(plane: controlPlaneService.ControlPlane): import('./ports').ControlPlanePort {
  const adapt = <T>(operation: () => T): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { code: string; message: string; problems?: { path: string; message: string }[] } } => {
    try {
      return { ok: true, value: operation() };
    } catch (cause) {
      if (cause instanceof controlDomain.ControlDomainError) {
        return { ok: false, error: { code: cause.code, message: cause.message, ...(cause.details.length === 0 ? {} : { problems: cause.details.map((detail: string) => ({ path: detail, message: 'the control plane rejected the input' })) }) } };
      }
      throw cause;
    }
  };
  return {
    createProject: (input) => adapt(() => plane.createProject(input as never) as never) as never,
    getProject: (tenantId, projectId) => adapt(() => plane.getProject(tenantId as never, projectId as never)) as never,
    projectsOf: (tenantId) => adapt(() => plane.projectsOf(tenantId as never)) as never,
    transition: (input) => adapt(() => plane.transition(input as never)) as never,
    bindOrganization: (input) => adapt(() => plane.bindOrganization(input as never)) as never,
  };
}

/** Adapt the REAL queryFirmKnowledge to the boundary's port. */
function realFirmMemoryPort(state: unknown): import('./ports').FirmMemoryPort {
  return {
    queryKnowledge: (query, options) => {
      const result = firmMemoryService.queryFirmKnowledge(state, query as never, options as never);
      if (result.ok) return { ok: true, value: result.value } as never;
      return { ok: false, error: { code: result.errors[0]?.code ?? 'invalid_type', message: result.errors[0]?.message ?? 'the firm memory refused the query' } } as never;
    },
  };
}

/** Adapt the REAL outcome/post-mortem query surfaces to the boundary's port. */
function realOutcomeLearningPort(outcomes: readonly outcomesContracts.OutcomeRecord[], postMortems: readonly outcomesContracts.PostMortemRecord[]): import('./ports').OutcomeLearningPort {
  return {
    queryOutcomes: (query) => {
      const served = outcomes.filter((record) => record.tenant === query.tenant && record.project === query.project);
      return { ok: true, value: served as never };
    },
    queryPostMortems: (query) => {
      const served = postMortems.filter((record) => record.lineage.tenant === query.tenant && record.lineage.project === query.project);
      return { ok: true, value: served as never };
    },
  };
}

/** Adapt the REAL 13-stage gateway session to the boundary's port (THE L8 chokepoint). */
function realGatewayPort(gateway: executionGatewayService.ExecutionGatewaySession): import('./ports').ExecutionGatewayPort {
  return {
    submitRequest: (intent) => {
      const result = gateway.submitDecision(intent as never);
      if (result.ok) return { ok: true, value: result.value } as never;
      return { ok: false, error: { code: result.errors[0]?.code ?? 'invalid_type', message: result.errors[0]?.message ?? 'the execution gateway refused the submission' } } as never;
    },
  };
}

/** A developer credential fixture over the REAL example tenant. */
function developerCredentialOf(tenant: string, token: string, permissions: readonly string[]): { credential: ApiCredential; token: string } {
  return {
    credential: {
      kind: 'developer',
      credentialId: `dev:${observability.fnv1a32Hex(observability.canonicalJson(['interop', tenant]))}` as never,
      tenant: tenant as never,
      principal: 'interop-developer',
      permissions: permissions as never,
    },
    token,
  };
}

// ---------------------------------------------------------------------------
// T007 — the REAL control plane drives the boundary
// ---------------------------------------------------------------------------

describe('T007 — the REAL control-domain/control-plane parity', () => {
  it('the REAL example statements satisfy the mirrors at runtime', () => {
    expect(controlDomain.isGoalStatement(exampleGoalStatement)).toBe(true);
    expect(isProjectRecord(realGoalSatisfiesMirror(exampleGoalStatement) as never) as boolean).toBe(false); // a goal is not a project record — negative control
    void realConstraintSetSatisfiesMirror(exampleConstraintSetStatement);
    expect(controlDomain.isConstraintSetStatement(exampleConstraintSetStatement)).toBe(true);
  });

  it('the REAL ControlPlane service drives the boundary: create/read/list/transition/bind end-to-end', () => {
    const plane = controlPlaneService.createControlPlane();
    const construction = createApiService({
      credentials: [developerCredentialOf(EXAMPLE_TENANT, 'tok-interop-acme', ['projects:read', 'projects:write', 'meta:read'])],
      controlPlane: realControlPlanePort(plane),
      firmMemory: realFirmMemoryPort(null),
      outcomeLearning: realOutcomeLearningPort([], []),
      executionGateway: realGatewayPort({ submitDecision: () => ({ ok: false, errors: [{ code: 'unavailable', message: 'not wired in this fixture' }] }) } as never),
      jobSubmission: { submitJob: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired in this fixture' } }) },
      instants: scriptedInstants(Array.from({ length: 50 }, (_, index) => 1_800_200_000_000 + index)),
    });
    expect(construction.ok).toBe(true);
    if (!construction.ok) return;
    const service = construction.service;

    // Create a project over the API with the REAL example statements — the REAL control plane compiles the acceptance criteria.
    const create = service.handle({
      method: 'POST',
      path: '/v1/projects',
      headers: { authorization: 'Bearer tok-interop-acme' },
      body: {
        id: 'prj_interop_alpha',
        name: 'Interop Alpha',
        executionMode: 'simulation',
        goal: exampleGoalStatement,
        constraintSet: exampleConstraintSetStatement,
        at: 1_800_200_000_000,
      },
    } as never) as never as { status: number; body: { data: unknown } };
    expect(create.status).toBe(201);
    expect(isProjectRecord(create.body.data)).toBe(true);
    const record = create.body.data as ProjectRecord;
    expect(record.lifecycle.acceptanceCriteriaId).toMatch(/^ac:/); // the REAL compiler's content-addressed id.

    // Bind + activate through the API (the REAL reducer's preconditions enforced).
    const bind = service.handle({ method: 'POST', path: '/v1/projects/prj_interop_alpha/organization', headers: { authorization: 'Bearer tok-interop-acme' }, body: { organizationRef: 'org:interop-compiled', at: 1_800_200_000_001 } } as never) as never as { status: number; body: { data: unknown } };
    expect(bind.status).toBe(200);
    const activate = service.handle({ method: 'POST', path: '/v1/projects/prj_interop_alpha/lifecycle', headers: { authorization: 'Bearer tok-interop-acme' }, body: { event: 'activate', at: 1_800_200_000_002 } } as never) as never as { status: number; body: { data: { record: ProjectRecord } } };
    expect(activate.status).toBe(200);
    expect(activate.body.data.record.lifecycle.status).toBe('active');

    // Read + list through the mirror.
    const get = service.handle({ method: 'GET', path: '/v1/projects/prj_interop_alpha', headers: { authorization: 'Bearer tok-interop-acme' } } as never) as never as { status: number; body: { data: unknown } };
    expect(get.status).toBe(200);
    expect(isProjectRecord(get.body.data)).toBe(true);

    // An illegal transition surfaces the REAL reducer's typed error through the boundary's conflict mapping.
    const illegal = service.handle({ method: 'POST', path: '/v1/projects/prj_interop_alpha/lifecycle', headers: { authorization: 'Bearer tok-interop-acme' }, body: { event: 'activate', at: 1_800_200_000_003 } } as never) as never as { status: number; body: { error: { code: string } } };
    expect(illegal.status).toBe(409);
    expect(illegal.body.error.code).toBe('conflict');
  });

  it('a cross-tenant probe over the REAL control plane is the REAL lane\'s indistinguishable not-found', () => {
    const plane = controlPlaneService.createControlPlane();
    const construction = createApiService({
      credentials: [developerCredentialOf(EXAMPLE_TENANT, 'tok-interop-acme', ['projects:read', 'projects:write']), developerCredentialOf('tenant_other', 'tok-interop-other', ['projects:read'])],
      controlPlane: realControlPlanePort(plane),
      firmMemory: realFirmMemoryPort(null),
      outcomeLearning: realOutcomeLearningPort([], []),
      executionGateway: { submitRequest: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      jobSubmission: { submitJob: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      instants: scriptedInstants(Array.from({ length: 20 }, (_, index) => 1_800_200_000_000 + index)),
    });
    if (!construction.ok) return;
    // The acme tenant creates a project.
    construction.service.handle({ method: 'POST', path: '/v1/projects', headers: { authorization: 'Bearer tok-interop-acme' }, body: { id: 'prj_hidden', name: 'Hidden', executionMode: 'simulation', goal: exampleGoalStatement, constraintSet: exampleConstraintSetStatement, at: 1_800_200_000_000 } } as never);
    // The other tenant probes it: the REAL lane's 404, indistinguishable from unknown.
    const probe = construction.service.handle({ method: 'GET', path: '/v1/projects/prj_hidden', headers: { authorization: 'Bearer tok-interop-other' } } as never) as never as { status: number; body: { error: { code: string } } };
    expect(probe.status).toBe(404);
    expect(probe.body.error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// T034 — the REAL firm-memory brain drives the boundary's knowledge route
// ---------------------------------------------------------------------------

describe('T034 — the REAL firm-memory serving parity', () => {
  it('the REAL promotion pipeline + the REAL query surface drive the knowledge route; the served records satisfy the mirrors', () => {
    // Build a REAL brain: ingest the adverse + reinforce + challenger batches under the REAL promotion policy.
    let state: unknown = firmMemoryService.createFirmMemoryState();
    for (const snapshot of [scenarioSnapshotAdverse(), scenarioSnapshotReinforce(), scenarioSnapshotChallenger()]) {
      const ingested = firmMemoryService.ingestFirmLearning(state, snapshot as never, firmScenarioPolicy as never, { at: (snapshot.at ?? FIRM_T0) as never });
      expect(ingested.ok).toBe(true);
      if (ingested.ok) state = ingested.value.state;
    }
    // The REAL serving surface over the REAL state.
    const direct = firmMemoryService.queryFirmKnowledge(state, { tenant: FIRM_TENANT, project: FIRM_PROJECT } as never, { at: (FIRM_T0 + 400_000) as never, retention: firmScenarioServingPolicy as never });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(direct.value.length).toBeGreaterThan(0);
    for (const entry of direct.value) {
      expect(firmMemoryContracts.isFirmKnowledgeRecord(entry.record)).toBe(true);
      expect(isFirmKnowledgeRecord(realKnowledgeSatisfiesMirror(entry.record))).toBe(true);
      expect(isServedKnowledge(entry)).toBe(true);
    }

    // Drive the boundary's knowledge route through the REAL serving surface.
    const construction = createApiService({
      credentials: [developerCredentialOf(FIRM_TENANT, 'tok-interop-brain', ['knowledge:read'])],
      controlPlane: { createProject: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      firmMemory: realFirmMemoryPort(state),
      outcomeLearning: realOutcomeLearningPort([], []),
      executionGateway: { submitRequest: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      jobSubmission: { submitJob: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      instants: scriptedInstants(Array.from({ length: 10 }, (_, index) => FIRM_T0 + 500_000 + index)),
      knowledgeRetention: firmScenarioServingPolicy,
    });
    if (!construction.ok) return;
    const response = construction.service.handle({
      method: 'POST',
      path: '/v1/knowledge/query',
      headers: { authorization: 'Bearer tok-interop-brain' },
      body: { project: FIRM_PROJECT, at: FIRM_T0 + 400_000 },
    } as never) as never as { status: number; body: { data: { items: readonly { record: unknown }[] } } };
    expect(response.status).toBe(200);
    expect(response.body.data.items.length).toBe(direct.value.length);
    for (const entry of response.body.data.items) {
      expect(isFirmKnowledgeRecord(entry.record)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T040 — the REAL 13-stage gateway drives the boundary's execution route
// ---------------------------------------------------------------------------

describe('T040 — the REAL execution gateway parity (the L8 end-to-end trip wire)', () => {
  it('the REAL StrategyIntent + decision shapes satisfy the mirrors', () => {
    const intent = compliantIntent();
    expect(executionPolicy.isStrategyIntentMirror(intent)).toBe(true);
    expect(isStrategyIntent(realIntentSatisfiesMirror(intent))).toBe(true);
    void realOrderSatisfiesMirror;
    void realDecisionSatisfiesMirror;
  });

  it('a REAL compliant intent submitted over the API routes THROUGH the REAL gateway; the REAL submission satisfies the mirror', () => {
    // The reference gateway over recording fake ports (the REAL 13-stage pipeline).
    const construction = executionGatewayService.createExecutionGateway({
      policy: referencePolicy() as never,
      gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
      risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
      authority: referenceRegistry(),
      routing: referenceRoutingTable(),
      adapters: [
        { adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: executionGatewayService.recordingPort() },
        { adapterRef: 'adapter:adapter-oms-ems@0.0.0' as never, port: executionGatewayService.recordingPort() },
      ],
      killSwitch: referenceKillSwitch(),
      instants: executionGatewayService.scriptedInstants(Array.from({ length: 10 }, (_, index) => GATEWAY_T0 + index * 1_000)),
      substrate: SUBSTRATE,
    });
    expect(construction.ok).toBe(true);
    if (!construction.ok) return;
    const gateway = construction.gateway;

    // The boundary over the REAL gateway port, with a credential matching the REAL intent's tenant.
    const api = createApiService({
      credentials: [developerCredentialOf('tenant-gateway', 'tok-interop-gateway', ['execution:write', 'meta:read'])],
      controlPlane: { createProject: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      firmMemory: realFirmMemoryPort(null),
      outcomeLearning: realOutcomeLearningPort([], []),
      executionGateway: realGatewayPort(gateway),
      jobSubmission: { submitJob: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      instants: scriptedInstants(Array.from({ length: 10 }, (_, index) => GATEWAY_T0 + index)),
    });
    expect(api.ok).toBe(true);
    if (!api.ok) return;

    const intent = compliantIntent();
    const response = api.service.handle({
      method: 'POST',
      path: '/v1/execution/requests',
      headers: { authorization: 'Bearer tok-interop-gateway', 'idempotency-key': 'idem:interop:gateway:1' },
      body: { intent },
    } as never) as never as { status: number; body: { data: unknown } };
    expect(response.status).toBe(200);
    expect(isGatewaySubmissionRecord(response.body.data)).toBe(true);
    const submission = response.body.data as GatewaySubmissionRecord;
    expect(submission.kind).toBe('routed');
    expect(realSubmissionSatisfiesMirror(submission as never)).toBe(submission as never); // the mirror IS the shape.

    // The REAL gateway's audit trail verifies (the chokepoint ran for real).
    const audit = gateway.auditTrail();
    expect(executionAuthority ? (audit as { records: readonly unknown[] }).records.length : 0).toBeGreaterThan(0);
    expect(gateway.verifyGatewayCoherence().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T033 — the REAL outcome/post-mortem records drive the boundary's read routes
// ---------------------------------------------------------------------------

describe('T033 — the REAL outcome/evidence parity', () => {
  it('the REAL OutcomeRecord and a REAL minted PostMortemRecord satisfy the mirrors and drive the read routes', () => {
    const { record: outcome } = logWithOneOutcome();
    expect(outcomesContracts.isOutcomeRecord(outcome)).toBe(true);
    expect(isOutcomeRecordMirror(realOutcomeSatisfiesMirror(outcome))).toBe(true);

    // Mint a REAL post-mortem over the outcome's subject.
    const minted = outcomesContracts.mintPostMortem({
      ordinal: 1,
      subject: {
        outcomeRecordRef: outcome.outcomeId,
        decisionRef: outcome.decision.decisionRef,
        intentRef: outcome.decision.intentRef,
        outcomeClass: outcome.outcomeClass,
      },
      expected: { expectedQuantity: outcome.expectation.expectedQuantity, expectedRealized: outcome.expectation.expectedRealized, tolerance: outcome.expectation.tolerance },
      happened: { disposition: outcome.decision.disposition, filledQuantity: outcome.realization.filledQuantity, realizedOutcome: outcome.realization.realizedOutcome, feeTotal: outcome.realization.feeTotal, notionalTotal: outcome.realization.notionalTotal },
      gap: { quantityShortfall: outcome.deviation.quantityShortfall, realizedGap: outcome.deviation.realizedGap, withinTolerance: outcome.deviation.withinTolerance },
      hypotheses: [
        { class: 'decision', confidence: '0.8', detail: { dimension: 'timing' }, evidence: outcome.evidence, note: null },
      ],
      evidence: outcome.evidence,
      lineage: { tenant: outcome.tenant, project: outcome.project, shadowSessionRef: outcome.lineage.shadow.sessionId, shadowOutcomeRef: outcome.lineage.shadowOutcomeRef, trajectoryRef: outcome.lineage.trajectoryRef, experiment: outcome.lineage.experiment },
      asOf: (outcome.asOf + 1_000) as never,
      priorChainHead: outcome.priorChainHead,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(outcomesContracts.isPostMortemRecord(minted.value)).toBe(true);
    expect(isPostMortemRecordMirror(realPostMortemSatisfiesMirror(minted.value))).toBe(true);

    // Drive the boundary's read routes over the REAL records.
    const api = createApiService({
      credentials: [developerCredentialOf(outcome.tenant, 'tok-interop-outcomes', ['outcomes:read'])],
      controlPlane: { createProject: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      firmMemory: realFirmMemoryPort(null),
      outcomeLearning: realOutcomeLearningPort([outcome], [minted.value]),
      executionGateway: { submitRequest: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      jobSubmission: { submitJob: () => ({ ok: false, error: { code: 'unavailable', message: 'not wired' } }) } as never,
      instants: scriptedInstants(Array.from({ length: 10 }, (_, index) => 1_700_100_000_000 + index)),
    });
    if (!api.ok) return;
    const outcomesResponse = api.service.handle({
      method: 'POST',
      path: '/v1/outcomes/query',
      headers: { authorization: 'Bearer tok-interop-outcomes' },
      body: { project: outcome.project, at: 1_700_200_000_000 },
    } as never) as never as { status: number; body: { data: { items: readonly unknown[] } } };
    expect(outcomesResponse.status).toBe(200);
    expect(outcomesResponse.body.data.items.length).toBe(1);
    expect(isOutcomeRecordMirror(outcomesResponse.body.data.items[0])).toBe(true);

    const postMortemsResponse = api.service.handle({
      method: 'POST',
      path: '/v1/post-mortems/query',
      headers: { authorization: 'Bearer tok-interop-outcomes' },
      body: { project: outcome.project, at: 1_700_200_000_000, latestPerOutcome: true },
    } as never) as never as { status: number; body: { data: { items: readonly unknown[] } } };
    expect(postMortemsResponse.status).toBe(200);
    expect(postMortemsResponse.body.data.items.length).toBe(1);
    expect(isPostMortemRecordMirror(postMortemsResponse.body.data.items[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T044 + T043 — the security-scope and audit-shape parity
// ---------------------------------------------------------------------------

describe('T044 — the REAL security-scope parity', () => {
  it('the REAL Scope IS the boundary\'s scope (one identity space, L12)', () => {
    const realScope = security.validateScope({ tenant: 'tenant-acme', project: 'prj_alpha' });
    expect(realScope.ok).toBe(true);
    if (!realScope.ok) return;
    const scope = realScopeSatisfiesMirror(realScope.value);
    expect(scope.tenant).toBe('tenant-acme');
    expect(scope.project).toBe('prj_alpha');
  });

  it('the credential-opacity trip wires agree on a contamination corpus (T019/T040/T044 mirror law)', () => {
    const corpus: readonly unknown[] = [
      { notes: 'clean' },
      { apiKey: 'sk-live-123' },
      { nested: { secret: 'value', other: 1 } },
      { list: [{ apiKeyId: 'x' }, { safe: 'y' }] },
      { credentialRef: 'cred:0123abcd' }, // a REF is fine — never a value.
    ];
    for (const payload of corpus) {
      const mine = credentialValueViolations(payload);
      const theirs = observability.credentialValueViolations(payload);
      expect(mine.length > 0).toBe(theirs.length > 0);
    }
    expect(credentialValueViolations({ apiKey: 'x' })).toEqual(['apiKey']);
    expect(credentialValueViolations({ credentialRef: 'cred:x' })).toEqual([]);
  });
});

describe('T043 — the REAL platform-audit shape parity (emit, never define)', () => {
  it('the REAL actor/lineage blocks ARE the boundary\'s audit shapes', () => {
    const actor = { kind: 'principal', ref: 'developer-alpha' } as auditService.PlatformAuditActor;
    const lineage = { goal: { goalId: 'goal_alpha', version: 1 }, project: 'prj_alpha' } as auditService.PlatformAuditLineage;
    const mirroredActor = realActorSatisfiesMirror(actor);
    const mirroredLineage = realLineageSatisfiesMirror(lineage);
    expect(mirroredActor.kind).toBe('principal');
    expect(mirroredLineage.goal?.goalId).toBe('goal_alpha');
  });

  it('the boundary\'s emitted audit records carry T043-compatible actor kinds and platform-object refs', async () => {
    const { isAuditActor, isPlatformAuditActorKind } = await import('./index');
    const { API_AUDIT_ACTION_KINDS } = await import('./audit');
    // The actor-kind vocabulary is REUSED verbatim from T043's closed set (adding a word is T043's decision).
    expect(isPlatformAuditActorKind('principal')).toBe(true);
    expect(isPlatformAuditActorKind('operator')).toBe(true);
    expect(isAuditActor({ kind: 'service', ref: 'agent-runtime' })).toBe(true);
    expect(isAuditActor({ kind: 'wizard', ref: 'x' })).toBe(false);
    // The action vocabulary is this lane's own (closed; the SDK surfaces it verbatim).
    expect(API_AUDIT_ACTION_KINDS).toEqual(['request.allowed', 'request.denied', 'request.replayed']);
  });
});
