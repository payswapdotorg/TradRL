// @tradrl/agent-os — public API.
//
// Owning Work Order: T006 (frozen write surface: packages/agent-os,
// services/agent-runtime).
//
// The Agent OS is the runtime substrate that hosts AgentInstances (from
// @tradrl/agent-body, referenced ONLY through opaque ids) as addressable,
// communicating, supervisable processes. The kernel is EXACTLY the fourteen
// frozen operations (spec/ARCHITECTURE.md, "Agent OS") and is a pure
// reducer over an operation log — small, stable, replayable. Everything
// organizational (planners, task markets, negotiation strategies, decision
// cadence) is adaptive structure that lives in consumers such as the T016
// organization compiler — never here.
//
// - timestamp: the `TimestampMs` structural mirror of @tradrl/time-engine
//   (D-003/D-004 mirror discipline; trip wire in interop.test.ts).
// - primitives: branded ids, opaque cross-lane refs, deep-freeze helpers,
//   structural type guards (structural mirror of agent-body's primitives).
// - actions: the fourteen kernel action names (+ proposal verdicts,
//   bounded reason text).
// - authority: KernelAuthority — the live enforcement record over the
//   fourteen-verb whitelist (mirror of agent-body's AuthorityScope).
// - errors: the kernel error taxonomy (rejections as pure data).
// - envelope: topic-addressed, tenant-scoped message envelopes.
// - operations: the fourteen-operation discriminated union + total guard.
// - state: KernelState (mailbox registry, instance registry, topic
//   subscriptions, operation log) + supervision helpers + semantic
//   validation.
// - kernel: applyOperation — the reducer — plus the effect union and the
//   folding/replay helpers.
//
// Human-readable contracts: contracts/agent/*.md (owned by T003; binding
// for this lane). The reference runtime lives in services/agent-runtime.

export * from './timestamp';
export * from './primitives';
export * from './actions';
export * from './authority';
export * from './errors';
export * from './envelope';
export * from './operations';
export * from './state';
export * from './kernel';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/agent-os',
  owner: 'T006',
  status: 'implemented',
  concepts: [
    'KernelActionName',
    'KernelAuthority',
    'KernelOperation',
    'MessageEnvelope',
    'InstanceRecord',
    'KernelState',
    'KernelEffect',
    'KernelError',
    'applyOperation',
  ],
} as const;
