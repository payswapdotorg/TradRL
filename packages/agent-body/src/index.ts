// @tradrl/agent-body — public API.
//
// Owning Work Order: T003 (frozen write surface: packages/agent-body, contracts/agent).
//
// Contracts for the system's core abstraction (spec/ARCHITECTURE-LOCK.md L2/L3):
//
//   Agent Instance = Agent Body Version
//                  + Cognitive Substrate
//                  + Possession Configuration
//                  + Environment
//                  + Runtime State
//
// - primitives: branded ids, opaque cross-lane refs, SemVer, ISO8601,
//   deep-freeze helpers, structural type guards.
// - substrate: CognitiveSubstrate (model identity, capability manifest,
//   cost/latency profile, substitution class).
// - compatibility: SubstrateCompatibilityManifest, CompatibilityVerdict,
//   tested-substrate records (substitution testing contracts).
// - body: AgentBody, BodyComposition, BodyVersion, CertifiedBodyVersion,
//   certification (immutable versioned capability — L3).
// - possession: Possession binding + state machine + possession validity law.
// - instance: AgentInstance (authority scope, manager chain, runtime-state
//   handle, lifecycle) + management-cycle detection.
// - lineage: version lineage index, chain walking, acyclicity and
//   monotonicity enforcement.
// - examples: canonical records mirrored by the JSON examples in contracts/agent/.
//
// Human-readable contracts: contracts/agent/*.md (authority for the Agent OS
// lane, T006, and the body forge, T017).

export * from './primitives';
export * from './substrate';
export * from './compatibility';
export * from './body';
export * from './possession';
export * from './instance';
export * from './lineage';
export * from './examples';

// T016 absorption (program decisions D-006/D-007): the substrate capability
// registry — an ADDITIVE, SELF-CONTAINED module (it imports nothing, not
// even from sibling modules of this package; the additivity trip-wire is a
// source scan in capability-registry.test.ts). Only this re-export line was
// added to this file — no other line changed.
export * from './capability-registry';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/agent-body',
  owner: 'T003',
  status: 'implemented',
  concepts: [
    'CognitiveSubstrate',
    'SubstrateCompatibilityManifest',
    'AgentBody',
    'BodyVersion',
    'CertifiedBodyVersion',
    'Possession',
    'AgentInstance',
    'LineageIndex',
  ],
} as const;
