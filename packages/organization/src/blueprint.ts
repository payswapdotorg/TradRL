/**
 * @tradrl/organization — the OrganizationBlueprint: the search-space axes
 * as ONE record.
 *
 * Spec anchors — spec/ARCHITECTURE.md, "Organization compiler", VERBATIM:
 * "Given goals, constraints, market/data universe and resource budgets,
 * discover agent count, specializations, body/model assignments,
 * communication topology, training allocation, cadence and adversarial
 * population. Optimize objective attainment, risk, compute, coordination
 * cost, latency, robustness and redundancy." (The optimization sentence
 * is the objective model — see objective.ts; this module is the SEVEN
 * discovery axes.)
 *
 * And spec/LEARNING-LOOP.md, "Organization learning", VERBATIM: "Search
 * over agent count, specializations, bodies, models, communication
 * topology, training allocation, decision cadence and adversarial
 * population."
 *
 * Laws honored here:
 * - L16a: specializations are CAPABILITY-CONTRACT references, never role
 *   labels; assignments cite capability RECORDS (measured evidence), never
 *   labels. The label scan runs over the whole blueprint tree.
 * - Safety (spec/CAPABILITY-DISCOVERY.md: "Discovery does not grant
 *   consequential execution authority. Risk, authorization and execution
 *   policy remain independent gates."): a blueprint embedding execution
 *   authority or granting risk/authorization is a TYPED error
 *   (`authority_in_blueprint`). Risk/authorization/execution POLICY
 *   references are legal ONLY as opaque refs through the declared fields
 *   (`riskPolicyRefs`) — references to independent gates, never grants.
 * - Axis completeness: all SEVEN axes are required; a missing axis is the
 *   typed error `axis_missing` (and fails the structural guard).
 * - The blueprint references agent-os kernel communication ONLY through
 *   the topic-addressed envelope mirror (topics); it never redefines the
 *   fourteen-verb kernel (packages/agent-os/src/index.ts: organizational
 *   structure "lives in consumers such as the T016 organization compiler —
 *   never here" — this package IS that consumer, and it adds no verbs).
 */

import {
  type AdversaryBlueprintRef,
  type CapabilityKey,
  type CapabilityRecordId,
  type ProjectId,
  type RiskPolicyRef,
  type TenantId,
  type TopicName,
  deepFreeze,
  isAdversaryBlueprintRef,
  isArrayOf,
  isCapabilityKey,
  isCapabilityRecordId,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isProjectId,
  isRecord,
  isRiskPolicyRef,
  isTenantId,
  isTopicName,
} from './primitives';
import {
  type RegistrySubjectMirror,
  isRegistrySubjectMirror,
  labelKeyPathsMirror,
} from './capability-mirror';
import { type OrgError, type OrgResult, invalidField, invalidType } from './errors';
import type { CapabilityGapId } from './primitives';

// ---------------------------------------------------------------------------
// The seven axes (ARCHITECTURE.md "Organization compiler", verbatim nouns)
// ---------------------------------------------------------------------------

/**
 * The closed axis vocabulary — the seven discovery axes: agent count,
 * specializations, body/model assignments, communication topology,
 * training allocation, (decision) cadence, adversarial population.
 */
export const ORGANIZATION_AXES = [
  'agentCount',
  'specializations',
  'assignments',
  'topology',
  'trainingAllocation',
  'decisionCadence',
  'adversarialPopulation',
] as const;

/** One of the seven organization axes. */
export type OrganizationAxis = (typeof ORGANIZATION_AXES)[number];

/** Guard: `OrganizationAxis`. */
export function isOrganizationAxis(v: unknown): v is OrganizationAxis {
  return isMemberOf(ORGANIZATION_AXES, v);
}

// ---------------------------------------------------------------------------
// L16a + safety trip-wire vocabularies
// ---------------------------------------------------------------------------

/**
 * The closed key vocabulary that makes a blueprint EMBED AUTHORITY — the
 * safety trip-wire (spec/CAPABILITY-DISCOVERY.md Safety; ARCHITECTURE-LOCK
 * L8/L20). A blueprint carrying any of these keys anywhere in its JSON
 * tree fails validation with `authority_in_blueprint` and fails the
 * structural guard: blueprints and capability records carry NO execution
 * authority; risk/authorization/execution policy refs are opaque
 * references to independent gates (the declared `riskPolicyRefs` field),
 * never embedded grants, tokens, credentials or scopes.
 */
export const AUTHORITY_EMBEDDING_KEYS = [
  'authority',
  'authorityToken',
  'executionAuthority',
  'executionGrant',
  'grant',
  'authorizedActions',
  'token',
  'credential',
  'apiKey',
  'secret',
  'permissions',
  'scopes',
] as const;

/** One authority-embedding key (the typed crime scene). */
export type AuthorityEmbeddingKey = (typeof AUTHORITY_EMBEDDING_KEYS)[number];

/** Guard: `AuthorityEmbeddingKey`. */
export function isAuthorityEmbeddingKey(v: unknown): v is AuthorityEmbeddingKey {
  return isMemberOf(AUTHORITY_EMBEDDING_KEYS, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key in
 * {@link AUTHORITY_EMBEDDING_KEYS} (the authority scan — the same walk
 * discipline as the label scan).
 */
export function authorityKeyPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of authorityKeyPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (isAuthorityEmbeddingKey(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of authorityKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Specializations (capability-contract refs — NEVER role labels; L16a)
// ---------------------------------------------------------------------------

/**
 * One requested specialization, as a CAPABILITY CONTRACT reference — the
 * demand side of discovery step 2 ("Characterize the required capability
 * contract"). `benchmarkRefs` are opaque references to the task-specific
 * capability suites that will benchmark candidates (step 6);
 * `gapId` links the demand to the typed deficit that produced it (step 1)
 * when the demand is failure-driven.
 */
export interface SpecializationRequest {
  /** The capability contract this specialization asks the registry for. */
  readonly capabilityKey: CapabilityKey;
  /** Opaque benchmark-suite references that will measure candidates (may be empty). */
  readonly benchmarkRefs: readonly string[];
  /** The typed capability gap that produced this demand, when failure-driven. */
  readonly gapId?: CapabilityGapId;
}

/** Guard: `SpecializationRequest` (a capability contract, never a label). */
export function isSpecializationRequest(v: unknown): v is SpecializationRequest {
  if (!isRecord(v)) return false;
  if (!isCapabilityKey(v.capabilityKey)) return false;
  if (!isArrayOf(v.benchmarkRefs, isNonEmptyString)) return false;
  if (v.gapId !== undefined && typeof v.gapId !== 'string') return false;
  if (v.gapId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.gapId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Body/substrate assignments (possession-shaped; cite capability records)
// ---------------------------------------------------------------------------

/**
 * One agent slot assignment: WHICH subject (an immutable BodyVersion or a
 * CognitiveSubstrate — the L2 separation kept in the closed subject union)
 * fills the slot, cited by the capability RECORDS (measured evidence)
 * that justify the assignment. `riskPolicyRefs` are OPAQUE references to
 * the independent risk gates (T020 lane) — the legal, declared form of
 * referencing risk policy; embedding authority is the typed crime
 * (`authority_in_blueprint`).
 */
export interface AgentAssignment {
  /** Slot identity (unique within the blueprint; `slot-N` in the reference strategy). */
  readonly slotId: string;
  /** The subject filling the slot (body-version | cognitive-substrate). */
  readonly subject: RegistrySubjectMirror;
  /** Capability records (measured evidence) justifying the assignment — NON-EMPTY. */
  readonly capabilityRecordRefs: readonly CapabilityRecordId[];
  /** Opaque references to independent risk-policy gates (may be empty). */
  readonly riskPolicyRefs: readonly string[];
}

/** Guard: `AgentAssignment`. */
export function isAgentAssignment(v: unknown): v is AgentAssignment {
  if (!isRecord(v)) return false;
  if (typeof v.slotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.slotId)) {
    return false;
  }
  if (!isRegistrySubjectMirror(v.subject)) return false;
  if (!Array.isArray(v.capabilityRecordRefs) || v.capabilityRecordRefs.length === 0) return false;
  if (!isArrayOf(v.capabilityRecordRefs, isCapabilityRecordId)) return false;
  if (!isArrayOf(v.riskPolicyRefs, isRiskPolicyRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Communication topology (topic-addressed; agent-os envelope mirror)
// ---------------------------------------------------------------------------

/**
 * One topic wire: a topic on the kernel's topic-addressed message fabric
 * (packages/agent-os/src/envelope.ts — `MessageEnvelope` carries
 * `topic`/`sender`/`sequence`; the payload is opaque to the kernel), plus
 * the assignment slots that publish to and subscribe to it. Topic names
 * are guarded by the SAME identifier discipline as agent-os `TopicName`
 * (runtime parity — the trip wire in interop.test.ts), and KERNEL topics
 * are RESERVED: "consumers MUST NOT use them as organization topics"
 * (envelope.ts, KERNEL_TOPICS) — enforced by {@link isOrganizationTopic}.
 */
export interface TopicWire {
  /** Topic address on the agent-os fabric (never a `kernel.*` reserved topic). */
  readonly topic: TopicName;
  /** Assignment slot ids publishing to the topic; non-empty. */
  readonly publishers: readonly string[];
  /** Assignment slot ids subscribed to the topic; non-empty. */
  readonly subscribers: readonly string[];
}

/**
 * Guard: an organization topic name — the agent-os `TopicName` identifier
 * discipline MINUS the reserved kernel namespace (`kernel.*`). Consumers
 * must not use kernel topics as organization topics (envelope.ts).
 */
export function isOrganizationTopic(v: unknown): v is TopicName {
  return isTopicName(v) && typeof v === 'string' && !v.startsWith('kernel.');
}

/** Guard: `TopicWire`. */
export function isTopicWire(v: unknown): v is TopicWire {
  if (!isRecord(v)) return false;
  if (!isOrganizationTopic(v.topic)) return false;
  const slotId = (item: unknown): item is string =>
    typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(item);
  if (!Array.isArray(v.publishers) || v.publishers.length === 0) return false;
  if (!v.publishers.every((item) => slotId(item))) return false;
  if (!Array.isArray(v.subscribers) || v.subscribers.length === 0) return false;
  if (!v.subscribers.every((item) => slotId(item))) return false;
  return true;
}

/**
 * The communication topology: the topic wires of the organization. The
 * blueprint NEVER redefines the kernel's fourteen verbs (SPAWN, TERMINATE,
 * DELEGATE, ...) — it only wires topics the kernel's PUBLISH/SUBSCRIBE
 * already transports.
 */
export interface CommunicationTopology {
  /** Non-empty; topics unique. */
  readonly wires: readonly TopicWire[];
}

/** Guard: `CommunicationTopology`. */
export function isCommunicationTopology(v: unknown): v is CommunicationTopology {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.wires) || v.wires.length === 0) return false;
  if (!isArrayOf(v.wires, isTopicWire)) return false;
  const seen = new Set<string>();
  for (const wire of v.wires) {
    if (seen.has(wire.topic)) return false; // topics unique
    seen.add(wire.topic);
  }
  return true;
}

/**
 * Counts the message wires a topology declares: for each topic, every
 * (publisher, subscriber) pair EXCEPT self-pairs — the declared
 * coordination-cost input of the objective model. The all-to-all
 * coordination pattern (every slot publishing and subscribing one shared
 * topic) is legal; the MEASUREMENT excludes self-delivery because a slot
 * coordinating with itself is not coordination.
 */
export function countTopologyWires(topology: CommunicationTopology): number {
  let wires = 0;
  for (const wire of topology.wires) {
    for (const publisher of wire.publishers) {
      for (const subscriber of wire.subscribers) {
        if (publisher !== subscriber) wires += 1;
      }
    }
  }
  return wires;
}

// ---------------------------------------------------------------------------
// Training allocation (per-assignment budget records; method per LEARNING-LOOP)
// ---------------------------------------------------------------------------

/**
 * The closed training-method vocabulary — spec/LEARNING-LOOP.md, "Method
 * selection", VERBATIM: "Per capability: RL, offline RL, supervised
 * learning, imitation, preference optimization, bandits, self-play,
 * adversarial training, population search or statistical/causal methods."
 * The compiler ALLOCATES training; the curriculum itself is T015's.
 */
export const TRAINING_METHODS = [
  'rl',
  'offline-rl',
  'supervised',
  'imitation',
  'preference-optimization',
  'bandits',
  'self-play',
  'adversarial-training',
  'population-search',
  'statistical-causal',
] as const;

/** One training method (LEARNING-LOOP vocabulary). */
export type TrainingMethod = (typeof TRAINING_METHODS)[number];

/** Guard: `TrainingMethod`. */
export function isTrainingMethod(v: unknown): v is TrainingMethod {
  return isMemberOf(TRAINING_METHODS, v);
}

/**
 * One per-assignment training budget record: which declared method trains
 * the slot, and how much compute the allocation grants.
 */
export interface TrainingAllocationEntry {
  /** The assignment slot this allocation trains. */
  readonly slotId: string;
  /** The declared training method (LEARNING-LOOP vocabulary). */
  readonly method: TrainingMethod;
  /** Granted training compute budget (units >= 0; 0 = no training). */
  readonly computeUnits: number;
}

/** Guard: `TrainingAllocationEntry`. */
export function isTrainingAllocationEntry(v: unknown): v is TrainingAllocationEntry {
  if (!isRecord(v)) return false;
  if (typeof v.slotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.slotId)) {
    return false;
  }
  if (!isTrainingMethod(v.method)) return false;
  return isNonNegativeInteger(v.computeUnits);
}

/** The training allocation axis: one budget record per assignment. */
export interface TrainingAllocation {
  /** Non-empty; slot ids unique. */
  readonly entries: readonly TrainingAllocationEntry[];
}

/** Guard: `TrainingAllocation`. */
export function isTrainingAllocation(v: unknown): v is TrainingAllocation {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.entries) || v.entries.length === 0) return false;
  if (!isArrayOf(v.entries, isTrainingAllocationEntry)) return false;
  const seen = new Set<string>();
  for (const entry of v.entries) {
    if (seen.has(entry.slotId)) return false; // one allocation per slot
    seen.add(entry.slotId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Decision cadence
// ---------------------------------------------------------------------------

/**
 * One per-assignment decision-cadence record: how often the slot decides
 * (epoch-millisecond interval — an interval, never an absolute instant,
 * so the blueprint stays clock-free; the determinism law).
 */
export interface DecisionCadenceEntry {
  readonly slotId: string;
  /** Decision interval in milliseconds; integer >= 1. */
  readonly intervalMs: number;
}

/** Guard: `DecisionCadenceEntry`. */
export function isDecisionCadenceEntry(v: unknown): v is DecisionCadenceEntry {
  if (!isRecord(v)) return false;
  if (typeof v.slotId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.slotId)) {
    return false;
  }
  return isPositiveInteger(v.intervalMs);
}

/** The decision-cadence axis: one cadence record per assignment. */
export interface DecisionCadence {
  /** Non-empty; slot ids unique. */
  readonly entries: readonly DecisionCadenceEntry[];
}

/** Guard: `DecisionCadence`. */
export function isDecisionCadence(v: unknown): v is DecisionCadence {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.entries) || v.entries.length === 0) return false;
  if (!isArrayOf(v.entries, isDecisionCadenceEntry)) return false;
  const seen = new Set<string>();
  for (const entry of v.entries) {
    if (seen.has(entry.slotId)) return false; // one cadence per slot
    seen.add(entry.slotId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Adversarial population (L10 discipline)
// ---------------------------------------------------------------------------

/**
 * The adversarial-population axis: whether the goal demands adversarial
 * stress before attainment is claimable (mirrored from the goal's
 * evaluation policy, L10: "friendly replay alone does not release a
 * strategy"), and the DECLARED adversary blueprints the organization will
 * be tested against — opaque references to adversary-blueprint records
 * owned by THIS lane (T016).
 */
export interface AdversarialPopulation {
  /** Mirrored from the goal's `evaluation.adversarialRequired`. */
  readonly adversarialRequired: boolean;
  /** Opaque adversary-blueprint references (NON-EMPTY when adversarialRequired). */
  readonly adversaryRefs: readonly AdversaryBlueprintRef[];
}

/** Guard: `AdversarialPopulation`. */
export function isAdversarialPopulation(v: unknown): v is AdversarialPopulation {
  if (!isRecord(v)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  if (!isArrayOf(v.adversaryRefs, isAdversaryBlueprintRef)) return false;
  if (v.adversarialRequired && (v.adversaryRefs as readonly string[]).length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The blueprint (all seven axes, one record)
// ---------------------------------------------------------------------------

/**
 * The OrganizationBlueprint — the seven search-space axes as ONE record
 * (ARCHITECTURE.md "Organization compiler"; LEARNING-LOOP.md "Organization
 * learning"). Every axis is required; cross-axis coherence (slots covered,
 * agent count agreement, demand/assignment agreement) is enforced by
 * {@link validateOrganizationBlueprint}.
 */
export interface OrganizationBlueprint {
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
  /** AXIS 1 — agent count (must equal the assignment count). */
  readonly agentCount: number;
  /** AXIS 2 — specializations (capability-contract refs, NEVER role labels). */
  readonly specializations: readonly SpecializationRequest[];
  /** AXIS 3 — body/substrate assignments (cite capability records). */
  readonly assignments: readonly AgentAssignment[];
  /** AXIS 4 — communication topology (topic-addressed, agent-os mirror). */
  readonly topology: CommunicationTopology;
  /** AXIS 5 — training allocation (per-assignment budget records). */
  readonly trainingAllocation: TrainingAllocation;
  /** AXIS 6 — decision cadence (per-assignment intervals). */
  readonly decisionCadence: DecisionCadence;
  /** AXIS 7 — adversarial population (declared adversary blueprint ref set). */
  readonly adversarialPopulation: AdversarialPopulation;
}

/**
 * Guard: `OrganizationBlueprint` — structural totality over ALL SEVEN axes
 * (a missing axis fails the guard) INCLUDING the L16a label scan and the
 * authority-embedding scan over the whole blueprint tree.
 */
export function isOrganizationBlueprint(v: unknown): v is OrganizationBlueprint {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isPositiveInteger(v.agentCount)) return false;
  if (!Array.isArray(v.specializations) || v.specializations.length === 0) return false;
  if (!isArrayOf(v.specializations, isSpecializationRequest)) return false;
  if (!Array.isArray(v.assignments) || v.assignments.length === 0) return false;
  if (!isArrayOf(v.assignments, isAgentAssignment)) return false;
  if (!isCommunicationTopology(v.topology)) return false;
  if (!isTrainingAllocation(v.trainingAllocation)) return false;
  if (!isDecisionCadence(v.decisionCadence)) return false;
  if (!isAdversarialPopulation(v.adversarialPopulation)) return false;
  if (labelKeyPathsMirror(v).length > 0) return false; // L16a: no labels
  if (authorityKeyPaths(v).length > 0) return false; // safety: no embedded authority
  return true;
}

/**
 * Validates an organization blueprint against the FULL law (collect-all):
 *
 * 1. SEVEN-AXIS COMPLETENESS — a missing axis is the typed error
 *    `axis_missing`, naming the axis (spec/ARCHITECTURE.md "Organization
 *    compiler": the compiler discovers ALL seven).
 * 2. L16a — label keys anywhere in the tree are `label_as_evidence`.
 * 3. SAFETY — authority-embedding keys anywhere in the tree are
 *    `authority_in_blueprint` (risk/authorization/execution policy stay
 *    independent gates; refs are legal, grants are not).
 * 4. CROSS-AXIS COHERENCE — agent count equals the assignment count;
 *    specializations and assignments agree one-for-one (demand/fulfillment
 *    agreement, unique capability keys, unique slot ids); training
 *    allocation and decision cadence cover exactly the assignment slots;
 *    topology wires reference existing slots; a slot never subscribes to
 *    its own publishing topic (self-wires are not coordination).
 */
export function validateOrganizationBlueprint(v: unknown): OrgResult<OrganizationBlueprint> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType('blueprint must be a plain JSON object')] };
  }
  const errors: OrgError[] = [];
  // 1. Seven-axis completeness — each axis named precisely when missing.
  for (const axis of ORGANIZATION_AXES) {
    if (v[axis] === undefined) {
      errors.push({
        code: 'axis_missing',
        path: axis,
        message: `blueprint axis "${axis}" is missing — every blueprint carries ALL seven axes (agent count, specializations, assignments, topology, training allocation, cadence, adversarial population; spec/ARCHITECTURE.md "Organization compiler")`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  // 2. L16a label scan.
  for (const path of labelKeyPathsMirror(v)) {
    errors.push({
      code: 'label_as_evidence',
      path,
      message: `field "${path}" cites a profession/role label — specializations are capability-contract refs and assignments cite capability records; labels alone never establish suitability (L16a)`,
    });
  }
  // 3. Authority-embedding scan (safety).
  for (const path of authorityKeyPaths(v)) {
    errors.push({
      code: 'authority_in_blueprint',
      path,
      message: `field "${path}" embeds execution authority or grants risk/authorization — blueprints carry NO execution authority; policy refs are opaque references to independent gates (spec/CAPABILITY-DISCOVERY.md Safety)`,
    });
  }
  // Structural per-axis validation (typed invalid_field with axis paths).
  if (!isTenantId(v.tenantId)) errors.push(invalidField('tenantId', 'invalid TenantId (L12)'));
  if (!isProjectId(v.projectId)) errors.push(invalidField('projectId', 'invalid ProjectId (L12)'));
  if (!isPositiveInteger(v.agentCount)) {
    errors.push(invalidField('agentCount', 'must be an integer >= 1'));
  }
  if (!Array.isArray(v.specializations) || v.specializations.length === 0) {
    errors.push(invalidField('specializations', 'must be a non-empty array'));
  } else if (!isArrayOf(v.specializations, isSpecializationRequest)) {
    errors.push(invalidField('specializations', 'every entry must be a capability-contract request'));
  }
  if (!Array.isArray(v.assignments) || v.assignments.length === 0) {
    errors.push(invalidField('assignments', 'must be a non-empty array'));
  } else if (!isArrayOf(v.assignments, isAgentAssignment)) {
    errors.push(invalidField('assignments', 'every entry must be a possession-shaped assignment citing capability records'));
  }
  if (!isCommunicationTopology(v.topology)) {
    errors.push(invalidField('topology', 'invalid CommunicationTopology (topic wires; kernel topics are reserved)'));
  }
  if (!isTrainingAllocation(v.trainingAllocation)) {
    errors.push(invalidField('trainingAllocation', 'invalid TrainingAllocation'));
  }
  if (!isDecisionCadence(v.decisionCadence)) {
    errors.push(invalidField('decisionCadence', 'invalid DecisionCadence'));
  }
  if (!isAdversarialPopulation(v.adversarialPopulation)) {
    errors.push(invalidField('adversarialPopulation', 'invalid AdversarialPopulation (non-empty refs when adversarialRequired)'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const blueprint = v as unknown as OrganizationBlueprint;
  // 4. Cross-axis coherence.
  if (blueprint.agentCount !== blueprint.assignments.length) {
    errors.push(
      invalidField(
        'agentCount',
        `agentCount ${blueprint.agentCount} disagrees with ${blueprint.assignments.length} assignment(s) — the count axis and the assignment axis must agree`,
      ),
    );
  }
  const capabilityKeys = blueprint.specializations.map((s) => s.capabilityKey);
  if (new Set(capabilityKeys).size !== capabilityKeys.length) {
    errors.push(invalidField('specializations', 'capability keys must be unique — one slot per capability contract'));
  }
  const slotIds = blueprint.assignments.map((a) => a.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    errors.push(invalidField('assignments', 'slot ids must be unique'));
  }
  if (blueprint.specializations.length !== blueprint.assignments.length) {
    errors.push(
      invalidField(
        'assignments',
        `${blueprint.specializations.length} specialization(s) but ${blueprint.assignments.length} assignment(s) — demand and fulfillment agree one-for-one`,
      ),
    );
  }
  const slotSet = new Set(slotIds);
  const coverExactly = (entries: readonly { slotId: string }[], axis: string): void => {
    const covered = entries.map((entry) => entry.slotId);
    if (new Set(covered).size !== covered.length) {
      errors.push(invalidField(axis, `slot ids must be unique within ${axis}`));
    }
    for (const slot of covered) {
      if (!slotSet.has(slot)) {
        errors.push(invalidField(axis, `slot "${slot}" has no assignment`));
      }
    }
    for (const slot of slotSet) {
      if (!covered.includes(slot)) {
        errors.push(invalidField(axis, `assignment slot "${slot}" is not covered by ${axis}`));
      }
    }
  };
  coverExactly(blueprint.trainingAllocation.entries, 'trainingAllocation.entries');
  coverExactly(blueprint.decisionCadence.entries, 'decisionCadence.entries');
  for (const wire of blueprint.topology.wires) {
    for (const slot of [...wire.publishers, ...wire.subscribers]) {
      if (!slotSet.has(slot)) {
        errors.push(invalidField('topology.wires', `slot "${slot}" has no assignment`));
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...blueprint }) as OrganizationBlueprint };
}

/**
 * Constructs a deeply frozen `OrganizationBlueprint`, running the FULL
 * validation law first. Throws `TypeError` (all problems collected) on
 * invalid input.
 */
export function createOrganizationBlueprint(draft: unknown): OrganizationBlueprint {
  const result = validateOrganizationBlueprint(draft);
  if (!result.ok) {
    const problems = result.errors.map(
      (e) => `(${e.code}) ${e.path === '' ? '<root>' : e.path}: ${e.message}`,
    );
    throw new TypeError(`createOrganizationBlueprint: ${problems.join('; ')}`);
  }
  return result.value;
}
