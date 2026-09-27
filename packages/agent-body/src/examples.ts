// @tradrl/agent-body — canonical examples.
//
// These records are the single source of truth for the JSON examples in
// `contracts/agent/*.md`: the documentation examples are JSON renderings of
// these exact objects, and the test-suite validates every one of them through
// the guards and factories. If you change an example here, re-render the docs.
//
// Provider names are deliberately fictional (L13/L14 — vendor neutrality).

import {
  type CognitiveSubstrate,
  createSubstrate,
} from './substrate';
import {
  type AgentBody,
  type BodyVersion,
  type CertifiedBodyVersion,
  type CertificationEvidence,
  certifyBodyVersion,
  createAgentBody,
  createBodyVersion,
} from './body';
import {
  type SubstrateCompatibilityManifest,
} from './compatibility';
import {
  type Possession,
  createPossession,
} from './possession';
import {
  type AgentInstance,
  createAgentInstance,
} from './instance';
import {
  type SemVer,
  agentInstanceId,
  bodyId,
  environmentProfileRef,
  evidenceRef,
  goalRef,
  iso8601,
  knowledgeSourceRef,
  makeBodyVersionId,
  parseSemVer,
  policyBundleRef,
  possessionId,
  projectRef,
  riskPolicyRef,
  runtimeStateRef,
  skillArtifactRef,
  substitutionClass,
  toolRef,
} from './primitives';

function semver(input: string): SemVer {
  const parsed = parseSemVer(input);
  if (parsed === null) throw new Error(`example semver "${input}" failed to parse`);
  return parsed;
}

// ---------------------------------------------------------------------------
// CognitiveSubstrate examples
// ---------------------------------------------------------------------------

/** The primary substrate example: a frontier reasoning model. */
export const exampleSubstrate: CognitiveSubstrate = createSubstrate({
  provider: 'acme-models',
  modelId: 'reasoner-2',
  modelVersion: '2026.03',
  capabilities: {
    contextWindowTokens: 256000,
    maxOutputTokens: 32768,
    inputModalities: ['text'],
    outputModalities: ['text'],
    toolUse: true,
    structuredOutput: true,
  },
  costLatency: {
    currency: 'USD',
    inputCostPerMTokens: 12,
    outputCostPerMTokens: 48,
    p50LatencyMs: 800,
    p95LatencyMs: 2400,
  },
  substitutionClass: substitutionClass('frontier-reasoner'),
});

/** A substitution candidate: same class, cheaper, larger context. */
export const exampleSubstituteSubstrate: CognitiveSubstrate = createSubstrate({
  provider: 'delta-labs',
  modelId: 'swift-1',
  modelVersion: '2026.02',
  capabilities: {
    contextWindowTokens: 400000,
    maxOutputTokens: 16384,
    inputModalities: ['text'],
    outputModalities: ['text'],
    toolUse: true,
    structuredOutput: true,
  },
  costLatency: {
    currency: 'USD',
    inputCostPerMTokens: 3,
    outputCostPerMTokens: 15,
    p50LatencyMs: 450,
    p95LatencyMs: 1200,
  },
  substitutionClass: substitutionClass('frontier-reasoner'),
});

/** An incompatible substrate: small, no tool use, no structured output. */
export const exampleIncompatibleSubstrate: CognitiveSubstrate = createSubstrate({
  provider: 'local-lab',
  modelId: 'small-7b',
  modelVersion: '2026.01',
  capabilities: {
    contextWindowTokens: 8192,
    maxOutputTokens: 1024,
    inputModalities: ['text'],
    outputModalities: ['text'],
    toolUse: false,
    structuredOutput: false,
  },
  costLatency: {
    currency: 'USD',
    inputCostPerMTokens: 0,
    outputCostPerMTokens: 0,
    p50LatencyMs: 90,
    p95LatencyMs: 400,
  },
  substitutionClass: substitutionClass('edge-small'),
});

// ---------------------------------------------------------------------------
// AgentBody + compatibility manifest + BodyVersion examples
// ---------------------------------------------------------------------------

/** The body identity used across the examples: a market-regime researcher. */
export const exampleBody: AgentBody = createAgentBody({
  id: bodyId('regime-researcher'),
  name: 'Regime Researcher',
  description:
    'Classifies market regimes and publishes regime assessments for the trading organization.',
  domain: 'research',
  createdAt: iso8601('2026-01-15T09:00:00Z'),
});

/** The substrate compatibility manifest carried by `regime-researcher@1.0.0`. */
export const exampleCompatibilityManifest: SubstrateCompatibilityManifest = {
  requirements: {
    minContextWindowTokens: 128000,
    minMaxOutputTokens: 4096,
    requiredInputModalities: ['text'],
    requiredOutputModalities: ['text'],
    toolUse: 'required',
    structuredOutput: 'required',
  },
  constraints: {
    allowedSubstitutionClasses: [substitutionClass('frontier-reasoner')],
    maxInputCostPerMTokens: 20,
    maxOutputCostPerMTokens: 80,
    maxP95LatencyMs: 5000,
  },
  testedSubstrates: [
    {
      substrate: exampleSubstrate.id,
      result: 'pass',
      testedAt: iso8601('2026-03-02T14:30:00Z'),
      evidence: evidenceRef('evidence/regime-researcher@1.0.0/substitution/acme-reasoner-2'),
      notes: null,
    },
    {
      substrate: exampleSubstituteSubstrate.id,
      result: 'conditional',
      testedAt: iso8601('2026-03-04T10:15:00Z'),
      evidence: evidenceRef('evidence/regime-researcher@1.0.0/substitution/delta-swift-1'),
      notes: 'Passed with degraded calibration in high-volatility regimes; see evaluation report.',
    },
  ],
};

/** The composition shared by the example versions of `regime-researcher`. */
const exampleComposition = {
  mission: {
    summary:
      'Continuously classify the current market regime and publish calibrated regime probabilities to subscribed decision-makers.',
    goalRefs: [goalRef('goal/project-atlas/regime-awareness')],
    standingDirectives: [
      'Prefer recall of regime transitions over precision of the dominant label.',
      'Never use post-availability information (point-in-time compliance is systemic).',
    ],
  },
  capabilities: [
    {
      id: 'regime-classification',
      name: 'Regime Classification',
      description:
        'Classify the market into trend/range/volatility-expansion/crisis regimes with probabilities.',
      category: 'research',
      skillArtifactRefs: [skillArtifactRef('skills/regime/classifier-v3')],
      critical: true,
    },
    {
      id: 'macro-synthesis',
      name: 'Macro Synthesis',
      description:
        'Summarize macro drivers relevant to the current regime from allowed knowledge sources.',
      category: 'research',
      skillArtifactRefs: [skillArtifactRef('skills/macro/synthesis-v1')],
      critical: false,
    },
  ],
  knowledgeToolPolicy: {
    allowedTools: [toolRef('tools/market-history-query'), toolRef('tools/regime-model-inference')],
    forbiddenTools: [toolRef('tools/order-entry')],
    toolCallBudgetPerDecision: 12,
    allowedKnowledgeSources: [knowledgeSourceRef('knowledge/point-in-time/macro-wire')],
    forbiddenKnowledgeSources: [knowledgeSourceRef('knowledge/private/another-tenant')],
  },
  procedures: [
    {
      id: 'regime-assessment-cycle',
      name: 'Regime Assessment Cycle',
      trigger: 'scheduled',
      steps: [
        {
          id: 'collect-observations',
          description: 'Query allowed market-history tools for the current observation window.',
          toolRefs: [toolRef('tools/market-history-query')],
          approvalRequired: false,
        },
        {
          id: 'publish-assessment',
          description: 'Publish the regime probability assessment to subscribers.',
          toolRefs: [],
          approvalRequired: false,
        },
      ],
    },
    {
      id: 'regime-break-alert',
      name: 'Regime Break Alert',
      trigger: 'event',
      steps: [
        {
          id: 'verify-break',
          description: 'Verify a candidate regime break against secondary observations.',
          toolRefs: [toolRef('tools/market-history-query')],
          approvalRequired: false,
        },
        {
          id: 'escalate',
          description: 'Escalate the verified regime break to the escalation category.',
          toolRefs: [],
          approvalRequired: true,
        },
      ],
    },
  ],
  planningPolicy: {
    style: 'hybrid',
    maxPlanDepth: 2,
    replanTriggers: ['regime-break-verified', 'data-gap-detected', 'manager-request'],
  },
  delegationPolicy: {
    canDelegate: true,
    maxDelegationDepth: 1,
    delegateeCategories: ['research'],
    escalationCategories: ['trading-director'],
  },
  authorityBoundary: {
    allowedActions: [
      'OBSERVE',
      'SUBSCRIBE',
      'PUBLISH',
      'REQUEST',
      'PROPOSE',
      'LEARN',
      'REPORT',
      'ESCALATE',
    ],
    prohibitedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE'],
    approvalRequiredActions: ['ESCALATE'],
    executionAuthority: 'none',
    riskPolicyRef: riskPolicyRef('risk/regime-researcher/default'),
  },
  evaluationEnvironment: {
    requiredEvaluationLayers: [
      'functional-correctness',
      'historical-performance',
      'blind-generalization',
      'model-substitution',
    ],
    requiredEnvironmentFeatures: ['market-event-stream', 'point-in-time-knowledge-firewall'],
    requiredDataCategories: ['crypto-spot-trade', 'crypto-spot-book'],
    requiredFidelityModes: ['exact-replay', 'reactive-replay'],
  },
  substrateCompatibility: exampleCompatibilityManifest,
} as const;

/** The uncertified example version `regime-researcher@1.0.0` (root of the lineage). */
export const exampleBodyVersion: BodyVersion = createBodyVersion({
  bodyId: exampleBody.id,
  version: semver('1.0.0'),
  parentId: null,
  composition: exampleComposition,
  createdAt: iso8601('2026-03-01T08:00:00Z'),
});

/** Certification evidence for `regime-researcher@1.0.0`. */
export const exampleCertificationEvidence: CertificationEvidence = {
  evidenceRefs: [evidenceRef('evidence/regime-researcher@1.0.0/certification')],
  evaluationRefs: [
    evidenceRef('evaluation/regime-researcher@1.0.0/walk-forward-2026-03'),
    evidenceRef('evaluation/regime-researcher@1.0.0/model-substitution-2026-03'),
  ],
  certifiedBy: 'tradrl-verification-service',
  certifiedAt: iso8601('2026-03-05T16:45:00Z'),
  summary:
    'Certified after functional, historical, blind-generalization and model-substitution evaluation layers passed with the required confidence targets.',
};

/** The certified example version `regime-researcher@1.0.0`. */
export const exampleCertifiedBodyVersion: CertifiedBodyVersion = (() => {
  const result = certifyBodyVersion(exampleBodyVersion, exampleCertificationEvidence);
  if (!result.ok) {
    throw new Error(
      `example certification must succeed: ${result.violations.map((v) => v.message).join('; ')}`,
    );
  }
  return result.certified;
})();

// ---------------------------------------------------------------------------
// Lineage examples
// ---------------------------------------------------------------------------

/** The example lineage: `1.0.0` (certified) -> `1.1.0` -> `2.0.0` (both uncertified). */
export const exampleLineage: readonly BodyVersion[] = [
  exampleCertifiedBodyVersion,
  createBodyVersion({
    bodyId: exampleBody.id,
    version: semver('1.1.0'),
    parentId: exampleCertifiedBodyVersion.id,
    composition: exampleComposition,
    createdAt: iso8601('2026-04-10T11:00:00Z'),
  }),
  createBodyVersion({
    bodyId: exampleBody.id,
    version: semver('2.0.0'),
    parentId: makeBodyVersionId(exampleBody.id, semver('1.1.0')),
    composition: exampleComposition,
    createdAt: iso8601('2026-05-20T13:00:00Z'),
  }),
];

// ---------------------------------------------------------------------------
// Possession + AgentInstance examples
// ---------------------------------------------------------------------------

/** The example possession (state `draft`): acme reasoner-2 possesses regime-researcher@1.0.0. */
export const examplePossession: Possession = createPossession({
  id: possessionId('possession-regime-atlas-0001'),
  bodyVersionId: exampleCertifiedBodyVersion.id,
  substrateId: exampleSubstrate.id,
  adapter: {
    adapterId: 'adapter/substrate/acme-models',
    configRef: 'config/adapter/acme-reasoner-2/atlas',
  },
  runtimeProfile: {
    timeoutMs: 60000,
    maxRetries: 2,
    maxConcurrentInvocations: 4,
    costBudgetRef: 'budget/project-atlas/research-substrates',
  },
  environmentProfile: {
    environmentRef: environmentProfileRef('environment/project-atlas/research-sim-v2'),
    fidelityMode: 'exact-replay',
  },
  policyBundleRef: policyBundleRef('policy/project-atlas/researcher-default'),
  createdAt: iso8601('2026-03-06T09:30:00Z'),
});

/** The example agent instance (state `spawning`) operating the example possession. */
export const exampleAgentInstance: AgentInstance = createAgentInstance({
  id: agentInstanceId('agent-instance-atlas-0001'),
  possessionId: examplePossession.id,
  projectId: projectRef('project/atlas'),
  managerId: null,
  authority: {
    allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'LEARN', 'REPORT'],
    deniedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
    maxDelegationDepth: 0,
  },
  runtimeStateRef: runtimeStateRef('agent-state/agent-instance-atlas-0001'),
  spawnedAt: iso8601('2026-03-06T09:31:00Z'),
});
