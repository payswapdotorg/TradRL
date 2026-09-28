# @tradrl/agent-os

**Owning Work Order: T006** (frozen write surface: `packages/agent-os`,
`services/agent-runtime`)

The **Agent OS kernel**: the stable runtime substrate that hosts
AgentInstances (from `@tradrl/agent-body`, referenced only through opaque
ids) as addressable, communicating, supervisable processes.

```
KernelOperation (exactly 14)  ──applyOperation──►  { KernelState', KernelEffect[] }
                                                        │
                     replayOperationLog(state) ◄────────┘  (pure fold — L9)
```

The kernel is EXACTLY the fourteen operations frozen in
spec/ARCHITECTURE.md ("Agent OS"):

`SPAWN, TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE, CHALLENGE,
PROPOSE, APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT`

Anything else — planners, markets for tasks, negotiation strategies,
organization discovery, decision cadence — is ADAPTIVE structure that lives
in consumers such as the T016 organization compiler, never here. The kernel
must read as obviously SMALL and STABLE.

## Status: implemented

Zero runtime dependencies, no build step, TypeScript strict, no `any`,
hand-rolled total type guards (`isX(v): v is X` for every exported record —
the guards ARE the machine-checkable schema), `deepFreeze` on construction,
rejections as pure data. The reference runtime lives in
[`services/agent-runtime`](../../services/agent-runtime); the human-readable
authority for the agent lane is [`contracts/agent/`](../../contracts/agent/)
(T003 — binding for this package).

## Module map

| Module | Contents |
|---|---|
| `src/timestamp.ts` | `TimestampMs` — structural mirror of `@tradrl/time-engine` (D-003/D-004 discipline; trip wire in `interop.test.ts`) |
| `src/primitives.ts` | Branded ids (`KernelOpId`, `TenantId`, `TopicName`, `MessageId`, `AgentInstanceId` mirror), opaque cross-lane refs (`BodyVersionRef`, `SubstrateRef`, `TaskRef`, `ProposalRef`, `IntentRef`, `AuthorityTokenRef`, `QueryRef`, `LessonRef`, `ReportDetailRef`), deep-freeze/deep-clone helpers, structural type-check helpers |
| `src/actions.ts` | The fourteen `KernelActionName`s (mirror of agent-body's `AGENT_ACTION_NAMES`), proposal verdicts, bounded `ReasonText` |
| `src/authority.ts` | `KernelAuthority` — the live enforcement record over the fourteen-verb whitelist (mirror of agent-body's `AuthorityScope`); `isActionAllowed` is the ENTIRE authority evaluation the kernel performs |
| `src/errors.ts` | The kernel error taxonomy (frozen six: unknown-instance, cross-tenant, not-subscribed, circular-delegation-chain, duplicate-op-id, monotonicity-violation + supervisory completions); rejections as pure data |
| `src/envelope.ts` | `MessageEnvelope` — topic-addressed, tenant-scoped, opaque payload, per-sender sequence, causality id; reserved kernel topics |
| `src/operations.ts` | The fourteen-operation discriminated union + total guard + `createKernelOperation` factory |
| `src/state.ts` | `KernelState` (mailbox registry, live instance registry, topic subscriptions, operation log + monotonicity/sequence/op-id indexes), tenant-scoped lookup helpers, management-cycle detection, semantic state validation |
| `src/kernel.ts` | `applyOperation` — the reducer — plus the `KernelEffect` union (spawned/terminated/delivered/escalated/execution-transported/observation/learning/report), `applyOperations`, `replayOperationLog` |
| `src/index.ts` | Public API barrel + `packageInfo` |

## Key laws enforced here

- **L2 (body/model separation)** — bodies, substrates and possessions are
  referenced ONLY through opaque branded refs; nothing from sibling
  packages is imported (structural mirrors + interop trip wires instead).
- **L8/L20 (execution authority outside prompts)** — `EXECUTE` carries an
  opaque `intentRef` and an opaque `authorityTokenRef` and transports them
  VERBATIM to the execution gate. The kernel's only authority evaluation is
  the declarative whitelist check. A source-scan test proves no token
  inspection exists.
- **L9 (replayable lineage)** — the kernel is a pure reducer over an
  append-only operation log; `replayOperationLog` re-folds the log to an
  identical state; operations carry their own timestamps (no wall clocks,
  no randomness — `Date.now`/`Math.random` never appear, enforced by test).
- **L12 (tenant isolation)** — every operation, envelope, registry row and
  effect is tenant-scoped; all lookup helpers take the tenant first and
  never search across tenants; cross-tenant references are rejected
  (`cross-tenant`), never rerouted.
- **Kernel smallness** — fourteen operations, one reducer, one effect
  vocabulary. No policy. No organization.

## Supervision model

- Manager chains are enforced: TERMINATE may only be issued by the target
  itself or one of its ancestor managers (`manager-chain-violation`).
- ESCALATE routes to the nearest manager (the actor's direct manager;
  management links are always live). Root escalations surface to the
  control plane with `to = null`.
- Termination cascade: terminating a manager re-parents each report to the
  terminated manager's own manager and emits an `escalated` effect (plus a
  `kernel.cascade-escalate` mailbox message) for every report — dangling
  parents never form.
- Delegation chains are validated end-to-end: non-empty, actor-terminated,
  acyclic (no duplicate members, no returning targets), all members live in
  the tenant, and every member's `maxDelegationDepth` permits the resulting
  chain.

## Usage sketch

```ts
import {
  applyOperation, applyOperations, createInitialKernelState,
  createKernelOperation, createKernelAuthority, replayOperationLog,
} from '@tradrl/agent-os';

let state = createInitialKernelState();
const spawn = createKernelOperation({ opId, type: 'SPAWN', timestamp, actor, tenantId, target, managerId, bodyVersionRef, substrateRef, authority });
const result = applyOperation(state, spawn);       // { ok: true, state, effects } | { ok: false, state, error }
if (result.ok) state = result.state;               // rejections leave no trace
replayOperationLog(state);                          // determinism proof
```

## Testing

`pnpm verify` runs typecheck + vitest across the workspace. This package's
suites cover: guard totality over the fourteen-operation union (positive,
negative, class-instance rejection), the full error taxonomy, tenant
isolation (positive and negative), supervision (manager-chain enforcement,
escalation routing, cascade re-parenting + escalations), EXECUTE authority
neutrality (verbatim transport + source scan), reducer purity and
determinism (double-fold, replay, no-input-mutation), state semantic
validation (cycles, orphan mailboxes/subscribers, tenant leaks), and the
cross-package structural-mirror trip wires (time-engine, market-protocol,
agent-body).
