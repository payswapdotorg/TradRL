// @tradrl/agent-body — CognitiveSubstrate contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation), L13/L14
// (provider neutrality; external substrates are replaceable), L20 (safety
// outside prompts); spec/DOMAIN-MODEL.md (CognitiveSubstrate); spec/ADAPTERS.md
// ("Translate provider/model APIs into CognitiveSubstrate. A model provider
// never owns an Agent Body.").
//
// A CognitiveSubstrate is the model-side runtime that POSSESSES an Agent Body
// (see possession.ts). It is pure descriptive data: identity, capability
// manifest, cost/latency profile and substitution class. Vendor specifics are
// produced by adapters (T036 lane) and never leak into bodies.

import {
  type SubstitutionClass,
  type SubstrateRef,
  deepFreeze,
  isArrayOf,
  isBoolean,
  isEnum,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isString,
  isSubstitutionClass,
  isSubstrateRef,
  makeSubstrateRef,
} from './primitives';

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

/** Input/output modalities a substrate can handle. */
export const MODALITIES = ['text', 'image', 'audio', 'video'] as const;

/** A substrate modality. */
export type Modality = (typeof MODALITIES)[number];

/** Guard: `Modality`. */
export const isModality = isEnum(MODALITIES);

/**
 * What a substrate can do: context window, output budget, modalities, tool use
 * and structured output. All fields are declarative measurements reported by
 * the provider adapter — not guarantees.
 */
export interface SubstrateCapabilityManifest {
  /** Maximum total context (input + output) in tokens. */
  readonly contextWindowTokens: number;
  /** Maximum single-response output in tokens. */
  readonly maxOutputTokens: number;
  /** Modalities the substrate accepts as input. Non-empty. */
  readonly inputModalities: readonly Modality[];
  /** Modalities the substrate can emit. Non-empty. */
  readonly outputModalities: readonly Modality[];
  /** Whether the substrate supports tool/function calling. */
  readonly toolUse: boolean;
  /** Whether the substrate supports structured/schema-constrained output. */
  readonly structuredOutput: boolean;
}

/** Guard: `SubstrateCapabilityManifest`. */
export function isSubstrateCapabilityManifest(v: unknown): v is SubstrateCapabilityManifest {
  if (!isRecord(v)) return false;
  return (
    isPositiveInteger(v.contextWindowTokens) &&
    isPositiveInteger(v.maxOutputTokens) &&
    isArrayOf(v.inputModalities, isModality) &&
    (v.inputModalities as readonly Modality[]).length > 0 &&
    isArrayOf(v.outputModalities, isModality) &&
    (v.outputModalities as readonly Modality[]).length > 0 &&
    isBoolean(v.toolUse) &&
    isBoolean(v.structuredOutput)
  );
}

// ---------------------------------------------------------------------------
// Cost / latency profile
// ---------------------------------------------------------------------------

/**
 * Declarative cost and latency estimates used for planning and budgeting.
 * Currency is a stable symbol string (e.g. `USD`); values are per one million
 * tokens; latencies are time-to-first-token estimates in milliseconds.
 */
export interface SubstrateCostLatencyProfile {
  /** Cost currency symbol, e.g. `USD`. */
  readonly currency: string;
  /** Estimated input cost per 1,000,000 tokens. */
  readonly inputCostPerMTokens: number;
  /** Estimated output cost per 1,000,000 tokens. */
  readonly outputCostPerMTokens: number;
  /** Median (p50) time-to-first-token estimate in milliseconds. */
  readonly p50LatencyMs: number;
  /** 95th percentile time-to-first-token estimate in milliseconds. */
  readonly p95LatencyMs: number;
}

/** Guard: `SubstrateCostLatencyProfile`. */
export function isSubstrateCostLatencyProfile(v: unknown): v is SubstrateCostLatencyProfile {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.currency) &&
    isNonNegativeInteger(v.inputCostPerMTokens) &&
    isNonNegativeInteger(v.outputCostPerMTokens) &&
    isNonNegativeInteger(v.p50LatencyMs) &&
    isNonNegativeInteger(v.p95LatencyMs)
  );
}

// ---------------------------------------------------------------------------
// CognitiveSubstrate
// ---------------------------------------------------------------------------

/** Draft shape accepted by `createSubstrate` (identity is derived). */
export type SubstrateDraft = Omit<CognitiveSubstrate, 'id'>;

/**
 * A CognitiveSubstrate is the model runtime that can possess Agent Bodies.
 *
 * Identity (`id`) is the canonical `provider/modelId@modelVersion` reference;
 * it is derived at construction and cannot drift from the components.
 * `substitutionClass` is a TradRL-internal class (not a vendor name): two
 * substrates in the same class are candidates to possess the same bodies
 * (spec/DOMAIN-MODEL.md, "substitution class").
 */
export interface CognitiveSubstrate {
  /** Canonical identity `provider/modelId@modelVersion`. */
  readonly id: SubstrateRef;
  /** Provider identity as exposed by the adapter layer (e.g. `acme-models`). */
  readonly provider: string;
  /** Provider's model identifier (e.g. `reasoner-2`). */
  readonly modelId: string;
  /** Provider's model version/revision (e.g. `2026.03`). */
  readonly modelVersion: string;
  /** What the substrate can do. */
  readonly capabilities: SubstrateCapabilityManifest;
  /** What the substrate costs and how fast it answers. */
  readonly costLatency: SubstrateCostLatencyProfile;
  /** Substitution class — substrates that are candidates to possess the same bodies. */
  readonly substitutionClass: SubstitutionClass;
}

/** Guard: `CognitiveSubstrate`. */
export function isCognitiveSubstrate(v: unknown): v is CognitiveSubstrate {
  if (!isRecord(v)) return false;
  if (!isSubstrateRef(v.id)) return false;
  if (!isString(v.provider) || !isString(v.modelId) || !isString(v.modelVersion)) return false;
  return (
    isSubstrateCapabilityManifest(v.capabilities) &&
    isSubstrateCostLatencyProfile(v.costLatency) &&
    isSubstitutionClass(v.substitutionClass)
  );
}

/**
 * Constructs a deeply frozen `CognitiveSubstrate` from a draft. The canonical
 * `id` is derived from `provider`/`modelId`/`modelVersion`, so identity and
 * components can never disagree. Throws `TypeError` (field-prefixed) on
 * invalid input.
 */
export function createSubstrate(draft: SubstrateDraft): CognitiveSubstrate {
  const problems: string[] = [];
  if (!isNonEmptyString(draft.provider)) problems.push('provider: must be a non-empty string without whitespace, "/" or "@"');
  if (!isNonEmptyString(draft.modelId)) problems.push('modelId: must be a non-empty string without whitespace, "/" or "@"');
  if (!isNonEmptyString(draft.modelVersion)) problems.push('modelVersion: must be a non-empty string without whitespace, "/" or "@"');
  if (problems.length === 0) {
    let derived: SubstrateRef | null = null;
    try {
      derived = makeSubstrateRef(draft.provider, draft.modelId, draft.modelVersion);
    } catch {
      problems.push('id: provider/modelId/modelVersion must not contain whitespace, "/" or "@"');
    }
    if (derived === null) problems.push('id: could not derive canonical substrate reference');
  }
  if (!isSubstrateCapabilityManifest(draft.capabilities)) {
    problems.push('capabilities: invalid SubstrateCapabilityManifest');
  } else {
    if (new Set(draft.capabilities.inputModalities).size !== draft.capabilities.inputModalities.length) {
      problems.push('capabilities.inputModalities: duplicate modality');
    }
    if (new Set(draft.capabilities.outputModalities).size !== draft.capabilities.outputModalities.length) {
      problems.push('capabilities.outputModalities: duplicate modality');
    }
  }
  if (!isSubstrateCostLatencyProfile(draft.costLatency)) {
    problems.push('costLatency: invalid SubstrateCostLatencyProfile');
  } else if (draft.costLatency.p95LatencyMs < draft.costLatency.p50LatencyMs) {
    problems.push('costLatency.p95LatencyMs: must be >= p50LatencyMs');
  }
  if (!isSubstitutionClass(draft.substitutionClass)) {
    problems.push('substitutionClass: invalid SubstitutionClass');
  }
  if (problems.length > 0) {
    throw new TypeError(`createSubstrate: ${problems.join('; ')}`);
  }
  const substrate: CognitiveSubstrate = {
    id: makeSubstrateRef(draft.provider, draft.modelId, draft.modelVersion),
    provider: draft.provider,
    modelId: draft.modelId,
    modelVersion: draft.modelVersion,
    capabilities: draft.capabilities,
    costLatency: draft.costLatency,
    substitutionClass: draft.substitutionClass,
  };
  return deepFreeze(substrate);
}
