/**
 * @tradrl/body-forge (service) — the reference fixtures.
 *
 * Work Order T017, section 5 — "Fixtures: a parent body version (mirror),
 * a small skill-delta set, gap records per kind, golden forged candidate
 * (byte-stable), a certification accept path + rejection paths (evidence
 * missing, compatibility fail, undeclared breaking change)."
 *
 * Every fixture is deterministic (no clocks, no randomness): the golden
 * candidate is the BYTE-STABLE forge output for the golden input — the
 * determinism test forges TWICE and asserts deep-equality and identical
 * canonical bytes.
 *
 * The gap fixtures cover ALL SIX failure classes of spec/LEARNING-LOOP.md
 * ("regime, sentiment/event, liquidity, execution, risk or coordination
 * failure") — one per kind.
 *
 * (Type note: fixture literals are authored as plain records and cast to
 * the branded contract types once — the brands are compile-time only and
 * every fixture is re-validated by the real guards in the tests.)
 */

import type { CapabilityGapMirror, SkillDelta, TimestampMs } from '../../../packages/skills/src/index';
import { deepFreeze } from '../../../packages/skills/src/index';
import type { ForgedCandidate, ForgeInput } from './forge';
import { forgeBodyVersion } from './forge';
import type { BodyVersionMirror } from './mirrors';

// ---------------------------------------------------------------------------
// The parent body version (a full agent-body-shaped mirror record)
// ---------------------------------------------------------------------------

/** The golden parent: `regime-researcher@1.2.0` (certified, deeply frozen). */
export const fixtureParentBodyVersion: BodyVersionMirror = deepFreeze({
  id: 'regime-researcher@1.2.0',
  bodyId: 'regime-researcher',
  version: { major: 1, minor: 2, patch: 0, prerelease: [], build: [] },
  parentId: 'regime-researcher@1.1.0',
  composition: {
    mission: {
      summary: 'Research market regimes and propose regime-shift hypotheses for the trading director.',
      goalRefs: ['goal/regime-alpha'],
      standingDirectives: ['Point-in-time evidence only (L4).', 'Never execute (L8).'],
    },
    capabilities: [
      {
        id: 'regime-detection',
        name: 'Regime detection',
        description: 'Detects market regime shifts from recorded replay evidence.',
        category: 'research',
        critical: true,
        skillArtifactRefs: ['skill-artifact:regime-1'],
      },
      {
        id: 'legacy-signal-reading',
        name: 'Legacy signal reading',
        description: 'A deprecated pre-regime signal capability kept for continuity.',
        category: 'research',
        critical: false,
        skillArtifactRefs: ['skill-artifact:legacy-1'],
      },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['tool/obs-reader', 'tool/regime-stat'],
      forbiddenTools: ['tool/order-router'],
      toolCallBudgetPerDecision: 4,
      allowedKnowledgeSources: ['ks/equities-v2'],
      forbiddenKnowledgeSources: ['ks/equities-v1'],
    },
    procedures: [
      {
        id: 'regime-review',
        name: 'Regime review',
        trigger: 'scheduled',
        steps: [
          {
            id: 'gather',
            description: 'Gather the latest observation refs.',
            toolRefs: ['tool/obs-reader'],
            approvalRequired: false,
          },
          {
            id: 'publish',
            description: 'Publish the regime hypothesis.',
            toolRefs: ['tool/regime-stat'],
            approvalRequired: false,
          },
        ],
      },
      {
        id: 'legacy-signal-scan',
        name: 'Legacy signal scan',
        trigger: 'scheduled',
        steps: [
          {
            id: 'scan',
            description: 'Scan the legacy signal set.',
            toolRefs: ['tool/obs-reader'],
            approvalRequired: false,
          },
        ],
      },
    ],
    planningPolicy: {
      style: 'hybrid',
      maxPlanDepth: 2,
      replanTriggers: ['regime-shift-detected'],
    },
    delegationPolicy: {
      canDelegate: false,
      maxDelegationDepth: 0,
      delegateeCategories: [],
      escalationCategories: ['trading-director'],
    },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'REPORT', 'ESCALATE'],
      prohibitedActions: ['EXECUTE', 'APPROVE', 'SPAWN'],
      approvalRequiredActions: [],
      executionAuthority: 'none',
      riskPolicyRef: null,
    },
    evaluationEnvironment: {
      requiredEvaluationLayers: ['data-integrity', 'functional-correctness', 'historical-performance'],
      requiredEnvironmentFeatures: ['replay/equities'],
      requiredDataCategories: ['equities/ohlcv'],
      requiredFidelityModes: ['exact-replay'],
    },
    substrateCompatibility: {
      requirements: {
        minContextWindowTokens: 32_768,
        minMaxOutputTokens: 2_048,
        requiredInputModalities: ['text'],
        requiredOutputModalities: ['text'],
        toolUse: 'optional',
        structuredOutput: 'required',
      },
      constraints: {
        allowedSubstitutionClasses: ['frontier-reasoner'],
        maxInputCostPerMTokens: 10,
        maxOutputCostPerMTokens: 40,
        maxP95LatencyMs: 4_000,
      },
      testedSubstrates: [
        {
          substrate: 'acme-models/reasoner-2@2026.03',
          result: 'pass',
          testedAt: '2026-03-01T00:00:00Z',
          evidence: 'capsule/substitution/reasoner-2-2026.03',
          notes: null,
        },
      ],
    },
  },
  createdAt: '2026-03-01T00:00:00Z',
  certified: true,
  certificationEvidence: {
    evidenceRefs: ['capsule/cert/regime-researcher-1.2.0'],
    evaluationRefs: ['capsule/eval/regime-researcher-1.2.0'],
    certifiedBy: 'verification-pipeline/1',
    certifiedAt: '2026-03-02T00:00:00Z',
    summary: 'Certified on layers 0-2 with a passing substitution test.',
  },
} as unknown as BodyVersionMirror);

// ---------------------------------------------------------------------------
// The gap fixtures (one per failure class — all six LEARNING-LOOP kinds)
// ---------------------------------------------------------------------------

const GAP_TENANT = 'tenant-forge';
const GAP_PROJECT = 'project-forge';
const GAP_DETECTED_AT = 1_710_000_000_000 as TimestampMs;

/** Gap fixtures covering ALL SIX failure classes (LEARNING-LOOP, verbatim list). */
export const fixtureGaps = deepFreeze([
  {
    gapId: 'gap-regime-1',
    kind: 'regime',
    capabilityKey: 'regime-detection-v2',
    evidenceRef: 'capsule:gap-regime-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    gapId: 'gap-sentiment-1',
    kind: 'sentiment-event',
    capabilityKey: 'sentiment-event-impact',
    evidenceRef: 'capsule:gap-sentiment-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    gapId: 'gap-liquidity-1',
    kind: 'liquidity',
    capabilityKey: 'liquidity-impact-estimation',
    evidenceRef: 'capsule:gap-liquidity-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    gapId: 'gap-execution-1',
    kind: 'execution',
    capabilityKey: 'execution-cost-forecasting',
    evidenceRef: 'capsule:gap-execution-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    gapId: 'gap-risk-1',
    kind: 'risk',
    capabilityKey: 'drawdown-attribution',
    evidenceRef: 'capsule:gap-risk-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    gapId: 'gap-coordination-1',
    kind: 'coordination',
    capabilityKey: 'hypothesis-handoff',
    evidenceRef: 'capsule:gap-coordination-1',
    detectedAt: GAP_DETECTED_AT,
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
] as const) as unknown as readonly CapabilityGapMirror[];

// ---------------------------------------------------------------------------
// The golden skill-delta set (a small set, exercising the patch vocabulary)
// ---------------------------------------------------------------------------

/** The golden delta set (two deltas; canonical application order is derived). */
export const fixtureDeltas = deepFreeze([
  {
    deltaId: 'delta-regime-v2',
    skillRecordRef: 'skill-regime-v2',
    changes: [
      {
        change: 'add-capability',
        capabilityId: 'microstructure-analysis',
        name: 'Microstructure analysis',
        description: 'Analyzes order-book microstructure from replay evidence.',
        category: 'research',
        critical: false,
        skillArtifactRefs: ['skill-artifact:microstructure-1'],
      },
      {
        change: 'refine-capability',
        capabilityId: 'regime-detection',
        description: 'Regime detection with liquidity awareness, refined from recorded failures.',
        additionalSkillArtifactRefs: ['skill-artifact:regime-2'],
      },
      {
        change: 'amend-knowledge-tool-policy',
        allowTools: ['tool/orderbook-ladder'],
        forbidTools: ['tool/legacy-tick-reader'],
        allowKnowledgeSources: ['ks/news-v2'],
        forbidKnowledgeSources: [],
        toolCallBudgetPerDecision: 6,
      },
      {
        change: 'amend-procedures',
        addProcedures: [
          {
            id: 'regime-shift-review',
            name: 'Regime shift review',
            trigger: 'event',
            steps: [
              {
                id: 'gather',
                description: 'Gather the latest observation refs.',
                toolRefs: ['tool/obs-reader'],
                approvalRequired: false,
              },
              {
                id: 'escalate',
                description: 'Escalate the confirmed regime shift.',
                toolRefs: [],
                approvalRequired: false,
              },
            ],
          },
        ],
        removeProcedureIds: [],
      },
    ],
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
  {
    deltaId: 'delta-legacy-removal',
    skillRecordRef: 'skill-legacy-removal',
    changes: [
      {
        change: 'remove-capability',
        capabilityId: 'legacy-signal-reading',
        declaredBreakingChange: {
          rationale: 'Superseded by refined regime detection; the deprecated signal capability is dropped.',
          addressesGapIds: ['gap-regime-1'],
        },
      },
      {
        change: 'amend-procedures',
        addProcedures: [],
        removeProcedureIds: ['legacy-signal-scan'],
      },
    ],
    tenantId: GAP_TENANT,
    projectId: GAP_PROJECT,
  },
] as const) as unknown as readonly SkillDelta[];

// ---------------------------------------------------------------------------
// The golden forge input + the golden (byte-stable) forged candidate
// ---------------------------------------------------------------------------

/** The golden forge input: (parent, deltas, gaps, evidence, seed, forge version, target, createdAt). */
export const fixtureForgeInput = deepFreeze({
  parent: fixtureParentBodyVersion,
  deltas: fixtureDeltas,
  gaps: [fixtureGaps[0], fixtureGaps[2]],
  evidence: {
    trajectoryRefs: ['traj-regime-42'],
    trialRefs: ['trial-regime-9'],
    verdictRefs: ['v-regime-1'],
  },
  seed: 'forge-seed-1',
  forgeVersion: 'reference-forge/1',
  targetVersion: { major: 1, minor: 3, patch: 0, prerelease: [], build: [] },
  createdAt: '2026-04-01T00:00:00Z',
  tenantId: GAP_TENANT,
  projectId: GAP_PROJECT,
} as const) as unknown as ForgeInput;

/**
 * The golden forge input with the UNDECLARED removal (negative path — an
 * INVALID delta the forge must refuse with `undeclared_breaking_change`
 * at the delta guard).
 */
export const fixtureUndeclaredRemovalForgeInput: unknown = deepFreeze({
  ...fixtureForgeInput,
  deltas: [
    fixtureDeltas[0],
    {
      deltaId: 'delta-undeclared',
      skillRecordRef: 'skill-undeclared-removal',
      changes: [
        {
          change: 'remove-capability',
          capabilityId: 'legacy-signal-reading',
          // declaredBreakingChange ABSENT — the undeclared-breaking-change negative path.
        },
      ],
      tenantId: GAP_TENANT,
      projectId: GAP_PROJECT,
    },
  ],
});

/**
 * A forged input whose parent carries a BROKEN substrate-compatibility
 * manifest (the compatibility-fail negative path: negative token counts
 * and a non-canonical substrate ref).
 */
export const fixtureBrokenCompatibilityForgeInput: unknown = deepFreeze({
  ...fixtureForgeInput,
  parent: {
    ...fixtureParentBodyVersion,
    composition: {
      ...fixtureParentBodyVersion.composition,
      substrateCompatibility: {
        requirements: {
          minContextWindowTokens: -1, // broken: negative token count
          minMaxOutputTokens: 2_048,
          requiredInputModalities: ['text'],
          requiredOutputModalities: ['text'],
          toolUse: 'optional',
          structuredOutput: 'required',
        },
        constraints: fixtureParentBodyVersion.composition.substrateCompatibility.constraints,
        testedSubstrates: [
          {
            substrate: 'not-canonical', // broken: not provider/modelId@modelVersion
            result: 'pass',
            testedAt: '2026-03-01T00:00:00Z',
            evidence: 'capsule/substitution/broken',
            notes: null,
          },
        ],
      },
    },
  },
});

/** The golden forged candidate — the byte-stable forge output for the golden input. */
export const fixtureForgedCandidate: ForgedCandidate = forgeBodyVersion(fixtureForgeInput)
  .candidate as ForgedCandidate;

// ---------------------------------------------------------------------------
// The certification accept + rejection paths (fixed instants — no clock)
// ---------------------------------------------------------------------------

/** The fixed instant used by the certification paths (no ambient clock). */
export const CERTIFY_AT = 1_711_000_000_000 as TimestampMs;

/** The certification-ACCEPT decision inputs (evaluation attained, compatibility satisfied, passing test recorded). */
export const fixtureCertificationAcceptInput: unknown = deepFreeze({
  candidate: fixtureForgedCandidate,
  certificationId: 'cert-forge-accept-1',
  evaluationVerdictRef: 'v-regime-1',
  evaluationAttained: true,
  compatibilityVerdictRef: 'compat-regime-1',
  compatibilitySatisfied: true,
  certifiedBy: 'verification-pipeline/1',
  certifiedAt: CERTIFY_AT,
});

/** The certification-REJECTION inputs: evidence missing (no evaluation verdict cited). */
export const fixtureCertificationEvidenceMissingInput: unknown = deepFreeze({
  candidate: fixtureForgedCandidate,
  certificationId: 'cert-forge-reject-1',
  // evaluationVerdictRef ABSENT — the evidence-missing negative path.
  compatibilityVerdictRef: 'compat-regime-1',
  compatibilitySatisfied: true,
  certifiedBy: 'verification-pipeline/1',
  certifiedAt: CERTIFY_AT,
});

/** The certification-REJECTION inputs: compatibility fail (verdict not satisfied). */
export const fixtureCertificationCompatibilityFailInput: unknown = deepFreeze({
  candidate: fixtureForgedCandidate,
  certificationId: 'cert-forge-reject-2',
  evaluationVerdictRef: 'v-regime-1',
  evaluationAttained: true,
  compatibilityVerdictRef: 'compat-regime-1',
  compatibilitySatisfied: false, // the compatibility verdict is NOT satisfied.
  certifiedBy: 'verification-pipeline/1',
  certifiedAt: CERTIFY_AT,
});
