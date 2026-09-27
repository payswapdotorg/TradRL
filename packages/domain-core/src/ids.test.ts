import { describe, expectTypeOf, expect, it } from 'vitest';
import {
  AgentInstanceId,
  BodyVersionId,
  ConstraintSetId,
  DecisionId,
  EvidenceCapsuleId,
  ExecutionId,
  ExperimentId,
  GoalId,
  InstrumentId,
  LessonId,
  OrganizationId,
  OutcomeId,
  PostMortemId,
  ProjectId,
  RiskPolicyId,
  TenantId,
  TopologyId,
  VenueId,
  CapabilityGapId,
  isAgentInstanceId,
  isBodyVersionId,
  isConstraintSetId,
  isDecisionId,
  isEvidenceCapsuleId,
  isExecutionId,
  isExperimentId,
  isGoalId,
  isInstrumentId,
  isLessonId,
  isOrganizationId,
  isOutcomeId,
  isPostMortemId,
  isProjectId,
  isRiskPolicyId,
  isTenantId,
  isTopologyId,
  isVenueId,
  isCapabilityGapId,
} from './ids';
import { DecimalString, Timestamp, isDecimalString, isTimestamp } from './primitives';

describe('branded id discipline (compile-time)', () => {
  it('distinct branded ids are NOT interchangeable', () => {
    const projectId: ProjectId = 'prj_1' as ProjectId;
    const goalId: GoalId = 'goal_1' as GoalId;

    // @ts-expect-error ProjectId must not be assignable to GoalId
    const asGoal: GoalId = projectId;
    // @ts-expect-error GoalId must not be assignable to ProjectId
    const asProject: ProjectId = goalId;

    // Runtime identity is the underlying string; the discipline is nominal.
    expect(asGoal).toBe('prj_1');
    expect(asProject).toBe('goal_1');

    expectTypeOf<ProjectId>().not.toMatchTypeOf<GoalId>();
    expectTypeOf<GoalId>().not.toMatchTypeOf<ProjectId>();
  });

  it('opaque cross-lane ids are not interchangeable with domain-core ids', () => {
    const bodyVersionId: BodyVersionId = 'body_1' as BodyVersionId;
    // @ts-expect-error a T003 body version id is not a domain-core ProjectId
    const asProject: ProjectId = bodyVersionId;
    expect(asProject).toBe('body_1');

    const agentInstanceId: AgentInstanceId = 'inst_1' as AgentInstanceId;
    // @ts-expect-error an agent instance id is not a BodyVersionId
    const asBodyVersion: BodyVersionId = agentInstanceId;
    expect(asBodyVersion).toBe('inst_1');

    expectTypeOf<BodyVersionId>().not.toMatchTypeOf<ProjectId>();
    expectTypeOf<AgentInstanceId>().not.toMatchTypeOf<BodyVersionId>();
  });

  it('branded scalars (Timestamp, DecimalString) are not assignable from plain strings', () => {
    const plain = '2027-01-04T09:30:00Z';
    // @ts-expect-error a plain string is not a Timestamp
    const asTimestamp: Timestamp = plain;
    expect(isTimestamp(asTimestamp)).toBe(true);

    const plainNumber = '1234.56';
    // @ts-expect-error a plain string is not a DecimalString
    const asDecimal: DecimalString = plainNumber;
    expect(isDecimalString(asDecimal)).toBe(true);
  });

  it('branded ids ARE assignable to the underlying string type (erosion is one-way)', () => {
    const projectId: ProjectId = 'prj_1' as ProjectId;
    const asString: string = projectId; // OK: brand erases toward string
    expect(typeof asString).toBe('string');
  });
});

describe('branded id guards (runtime)', () => {
  it('every id guard accepts a non-empty string value', () => {
    expect(isProjectId('prj_1')).toBe(true);
    expect(isGoalId('goal_1')).toBe(true);
    expect(isConstraintSetId('cs_1')).toBe(true);
    expect(isInstrumentId('instr_1')).toBe(true);
    expect(isVenueId('venue_1')).toBe(true);
    expect(isOrganizationId('org_1')).toBe(true);
    expect(isDecisionId('dec_1')).toBe(true);
    expect(isOutcomeId('out_1')).toBe(true);
    expect(isLessonId('lesson_1')).toBe(true);
    expect(isTenantId('tenant_1')).toBe(true);
    expect(isAgentInstanceId('inst_1')).toBe(true);
    expect(isBodyVersionId('body_1')).toBe(true);
    expect(isRiskPolicyId('risk_1')).toBe(true);
    expect(isEvidenceCapsuleId('ev_1')).toBe(true);
    expect(isExperimentId('exp_1')).toBe(true);
    expect(isExecutionId('exec_1')).toBe(true);
    expect(isPostMortemId('pm_1')).toBe(true);
    expect(isCapabilityGapId('gap_1')).toBe(true);
    expect(isTopologyId('topo_1')).toBe(true);
  });

  it('every id guard rejects empty strings, whitespace, non-strings and null', () => {
    const bad: unknown[] = ['', '   ', 42, null, undefined, {}, true];
    const guards = [
      isProjectId,
      isGoalId,
      isConstraintSetId,
      isInstrumentId,
      isVenueId,
      isOrganizationId,
      isDecisionId,
      isOutcomeId,
      isLessonId,
      isTenantId,
      isAgentInstanceId,
      isBodyVersionId,
      isRiskPolicyId,
      isEvidenceCapsuleId,
      isExperimentId,
      isExecutionId,
      isPostMortemId,
      isCapabilityGapId,
      isTopologyId,
    ];
    for (const guard of guards) {
      for (const value of bad) {
        expect(guard(value)).toBe(false);
      }
    }
  });
});
