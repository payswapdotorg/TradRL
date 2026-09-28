// @tradrl/agent-runtime — the Agent OS reference runtime.
//
// Owning Work Order: T006 (frozen write surface: services/agent-runtime).
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS" — stable kernel, adaptive
// organization above it); spec/ARCHITECTURE-LOCK.md L8 (execution authority
// outside prompts — the runtime only TRANSPORTS execution-transported
// effects to the gate lane), L9 (replayable operation logs), L12 (tenant
// isolation), L20 (safety outside prompts).
//
// The kernel (packages/agent-os) is a pure reducer: state transitions are
// `applyOperation(state, op) -> {state', effects}` with no clocks and no
// randomness. The runtime is the thin, zero-dependency DRIVER around it:
// it feeds a deterministic operation source into the reducer, materializes
// the deterministic OperationLog / Mailboxes / instance registry, exposes
// tenant-scoped views, and PROVES determinism by re-folding its own
// operation log from the initial state and comparing deeply.
//
// The runtime deliberately contains NO policy: no planners, no task markets,
// no negotiation strategies — those are adaptive structure owned by the
// organization compiler (T016). It also never evaluates authority tokens
// (L8/L20): execution-transported effects are surfaced verbatim for the
// execution-gate lane (T019/T020/T034) to decide.

import {
  type AgentInstanceId,
  type InstanceRecord,
  type KernelEffect,
  type KernelError,
  type KernelOperation,
  type KernelState,
  type TenantId,
  type TopicName,
  applyOperation,
  createInitialKernelState,
  instanceOf,
  isKernelState,
  mailboxOf,
  replayOperationLog,
  subscribersOf,
} from '../../../packages/agent-os/src/index';

// ---------------------------------------------------------------------------
// Operation sources
// ---------------------------------------------------------------------------

/**
 * A pure source of kernel operations. `remaining()` returns the operations
 * still to be submitted, in issuance order; `take()` consumes the front.
 * Implementations must be DETERMINISTIC: the same source state yields the
 * same operations. Sources own their own sequencing and timestamps — the
 * runtime never supplies clocks or ids.
 */
export interface OperationSource {
  /** Operations still to be submitted, in order. */
  remaining(): readonly KernelOperation[];
  /** Consumes and returns the next `count` operations (fewer if exhausted). */
  take(count: number): readonly KernelOperation[];
}

/**
 * A scripted (recorded) operation source — a finite, mutable-consumption
 * queue over an immutable script. Deterministic by construction: replaying
 * the same script through a fresh runtime yields bit-identical state.
 */
export class ScriptedSource implements OperationSource {
  private queue: readonly KernelOperation[];

  constructor(operations: readonly KernelOperation[]) {
    this.queue = [...operations];
  }

  remaining(): readonly KernelOperation[] {
    return this.queue;
  }

  take(count: number): readonly KernelOperation[] {
    if (!Number.isInteger(count) || count <= 0) {
      throw new TypeError(`ScriptedSource.take: count must be a positive integer (got ${count})`);
    }
    const taken = this.queue.slice(0, count);
    this.queue = this.queue.slice(taken.length);
    return taken;
  }
}

// ---------------------------------------------------------------------------
// Runtime results and reports
// ---------------------------------------------------------------------------

/** The outcome of one `submit`/`submitAll`/`drive` call. */
export type SubmitResult =
  | { readonly ok: true; readonly effects: readonly KernelEffect[] }
  | { readonly ok: false; readonly error: KernelError };

/**
 * The determinism proof: the runtime's own operation log, re-folded from the
 * initial state, must reproduce the live state exactly (L9 — replayable
 * operation logs). `operationsReplayed`/`liveOperations` are reported so a
 * violation can be forensically diffed; they match whenever `replayClean`
 * is true.
 */
export interface DeterminismReport {
  /** `true` iff replaying the log reproduced the live state deeply-equal. */
  readonly replayClean: boolean;
  /** Number of operations the replay fold accepted (0 when it rejected). */
  readonly operationsReplayed: number;
  /** Number of operations in the live log. */
  readonly liveOperations: number;
  /** The replay fold's first rejection, or `null` (any rejection is unclean). */
  readonly replayError: KernelError | null;
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/**
 * The Agent OS reference runtime. Instantiates the kernel reducer, drives it
 * with an operation source, and materializes the deterministic OperationLog,
 * Mailboxes and instance registry.
 *
 * Laws:
 * - The ONLY transition surface is `submit`/`submitAll`/`drive` (all
 *   delegate to the kernel reducer). No method mutates state directly.
 * - Rejections are DATA (`KernelError` via `SubmitResult`), leave the state
 *   untouched, and never enter the log.
 * - All views are tenant-scoped (L12): cross-tenant queries are not
 *   expressible through this API.
 * - `verifyDeterminism()` re-folds the accumulated log from the initial
 *   state and deep-compares — the L9 proof, runnable at any moment.
 */
export class AgentRuntime {
  private state: KernelState;
  private readonly effects: KernelEffect[] = [];
  private rejection: KernelError | null = null;

  constructor(initial: KernelState = createInitialKernelState()) {
    if (!isKernelState(initial)) {
      throw new TypeError('AgentRuntime: initial state failed the structural guard (isKernelState)');
    }
    this.state = initial;
  }

  /** Submits one operation; returns its effects or the rejection. */
  submit(operation: KernelOperation): SubmitResult {
    const result = applyOperation(this.state, operation);
    if (result.ok) {
      this.state = result.state;
      this.effects.push(...result.effects);
      this.rejection = null;
      return { ok: true, effects: result.effects };
    }
    this.rejection = result.error;
    return { ok: false, error: result.error };
  }

  /** Submits operations in order; stops at (and returns) the first rejection. */
  submitAll(operations: readonly KernelOperation[]): SubmitResult {
    for (const operation of operations) {
      const result = this.submit(operation);
      if (!result.ok) return result;
    }
    return { ok: true, effects: [] };
  }

  /** Drives the runtime from an operation source until the source is empty. */
  drive(source: OperationSource): SubmitResult {
    for (const operation of source.remaining()) {
      const result = this.submit(operation);
      if (!result.ok) return result;
    }
    return { ok: true, effects: [] };
  }

  /** The current kernel state (deeply frozen; read-only by contract). */
  get kernelState(): KernelState {
    return this.state;
  }

  /** The accepted operation log — the replayable record (L9). */
  get operationLog(): readonly KernelOperation[] {
    return this.state.operationLog;
  }

  /** All effects produced by accepted operations, in production order. */
  get allEffects(): readonly KernelEffect[] {
    return this.effects;
  }

  /** The most recent rejection, or `null` after any accepted submission. */
  get lastRejection(): KernelError | null {
    return this.rejection;
  }

  /** The mailbox of one instance in one tenant (L12 — never cross-tenant). */
  mailbox(tenant: TenantId, instance: AgentInstanceId) {
    return mailboxOf(this.state, tenant, instance);
  }

  /** The live instance record, or `null` (L12 — never cross-tenant). */
  instance(tenant: TenantId, instance: AgentInstanceId): InstanceRecord | null {
    return instanceOf(this.state, tenant, instance);
  }

  /** All live instances of one tenant. */
  liveInstances(tenant: TenantId): readonly InstanceRecord[] {
    const perTenant = this.state.instances[tenant];
    if (perTenant === undefined) return [];
    const records: InstanceRecord[] = [];
    for (const key of Object.keys(perTenant)) {
      const record = perTenant[key];
      if (record !== undefined) records.push(record);
    }
    return records;
  }

  /** Subscribers of one topic in one tenant (L12 — never cross-tenant). */
  subscribers(tenant: TenantId, topic: TopicName): readonly AgentInstanceId[] {
    return subscribersOf(this.state, tenant, topic);
  }

  /**
   * The L9 determinism proof: re-fold this runtime's operation log from the
   * initial state and compare deeply. A clean runtime replays bit-identically.
   */
  verifyDeterminism(): DeterminismReport {
    const replayed = replayOperationLog(this.state);
    const replayClean =
      replayed.error === null && JSON.stringify(replayed.state) === JSON.stringify(this.state);
    return {
      replayClean,
      operationsReplayed: replayed.error === null ? this.state.operationLog.length : 0,
      liveOperations: this.state.operationLog.length,
      replayError: replayed.error,
    };
  }
}
