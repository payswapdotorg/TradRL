# @tradrl/agent-runtime

**Owning Work Order: T006** (frozen write surface: `services/agent-runtime`,
`packages/agent-os`)

The reference runtime for the **Agent OS kernel** (`@tradrl/agent-os`). The
kernel is a pure reducer over an operation log —
`applyOperation(state, op) -> {state', effects}` — with no wall clocks and no
randomness. This service is the thin, zero-dependency driver around it:

- **`AgentRuntime`** — instantiates the kernel reducer, drives it with an
  operation source (`ScriptedSource` or any custom `OperationSource`),
  materializes the deterministic **OperationLog**, **Mailboxes** and
  **instance registry**, and exposes tenant-scoped views only (L12).
- **`verifyDeterminism()`** — the L9 proof, runnable at any moment: re-folds
  the accumulated operation log from the initial state and asserts the
  result is deeply equal to the live state.
- Rejections are **data** (`KernelError` via `SubmitResult`), leave state
  untouched, and never enter the log.

## Status: implemented

Zero runtime dependencies, no build step, TypeScript strict, no `any`. The
kernel contracts live in
[`packages/agent-os`](../../packages/agent-os); the human-readable authority
for the agent lane is [`contracts/agent/`](../../contracts/agent/) (T003).

## What the runtime is NOT

No planners, no task markets, no negotiation strategies, no organization
discovery, no environment/episode semantics, no execution gates, no
trajectories, no model invocation, no persistence, no network. Those belong
to their own lanes; the kernel is exactly the fourteen frozen operations and
the runtime only drives them (spec/ARCHITECTURE.md, "Agent OS").

## How T016 (organization compiler) consumes this kernel

The organization compiler compiles goals/constraints/budgets into an
*organization*: instance count, specializations, body/substrate assignments,
communication topology, delegation chains and decision cadence. It consumes
the kernel strictly as a **stable verb set + reducer**:

1. **Compilation output = an operation script.** A compiled `TeamPolicy`
   lowers to a deterministic sequence of `SPAWN` operations (instance ids +
   opaque `bodyVersionRef`/`substrateRef` + `KernelAuthority` scopes +
   `managerId` graph) and `SUBSCRIBE` operations (communication topology).
   Feed the script through `new AgentRuntime().drive(new ScriptedSource(ops))`
   — no kernel extension is needed or allowed.
2. **Delegation policy = authority scopes + chain discipline.** T016 sets
   `maxDelegationDepth` per instance (within the body's declared policy) and
   emits `DELEGATE` operations whose `managerChain` the kernel validates
   (acyclicity, membership, per-member depth). The kernel REJECTS illegal
   chains; T016 never reimplements chain checks.
3. **Decision cadence = PROPOSE / CHALLENGE / APPROVE transport.** The kernel
   moves proposals between counterparts as opaque refs + verdicts; WHO
   approves WHAT and WHEN is adaptive policy owned by T016 (with the T002
   decision contracts). The kernel never adjudicates.
4. **Supervision is free.** Manager-chain enforcement on TERMINATE, ESCALATE
   routing to the nearest manager, and the termination cascade
   (re-parenting + cascade escalations) are kernel invariants — T016's
   compiled topology gets them without any code of its own.
5. **Evaluation/ablation = replay.** Organization ablation studies re-drive
   modified scripts; determinism makes comparisons sound
   (`verifyDeterminism()` before every measurement).

## How T011 (trajectory protocol) consumes this kernel

The trajectory protocol records what each agent observed, decided and did,
with full lineage (spec/LEARNING-LOOP.md, spec/EVALUATION-PROTOCOL.md):

1. **Causality spine.** Every `MessageEnvelope` carries `causalityId` — the
   id of the kernel operation that produced it — and every `KernelEffect`
   carries `causalityId` too. A trajectory segment is therefore a JOIN over
   `{operation log, mailbox delivery effects, transport effects}` keyed by
   op id: observation sources (`observation-transported`), message flows
   (`message-delivered`), execution intents (`execution-transported`) and
   learning events (`learning-transported`) all cite the same op.
2. **Per-sender total order.** Envelope `sequence` is strictly increasing
   per sender id (never reset — even across instance lives), so trajectory
   ordering within an agent is total without any external clock.
3. **Replay = trajectory reconstruction.** `replayOperationLog(state)` (or
   re-driving the recorded log through a fresh `AgentRuntime`) reproduces
   state and effects bit-identically — the foundation for offline RL and
   evaluation over recorded trajectories (L9, L11).
4. **Tenant isolation.** Every log record, envelope and effect is
   tenant-scoped; trajectory harvesting per tenant can never observe another
   tenant's traffic (L12).

## The execution boundary (L8/L20)

The kernel performs exactly ONE authority check: the declarative whitelist
("is this verb in the actor's allowedActions?"). `EXECUTE` transports an
opaque `intentRef` + opaque `authorityTokenRef` to the execution gate
(`execution-transported` effect) and NEVER evaluates them. Authorization,
limits, kill-switch and credential semantics live in the gate lane
(T019/T020/T034). Consumers of this runtime must forward
`execution-transported` effects to that lane — never back into prompts.

## Usage sketch

```ts
import { AgentRuntime, ScriptedSource } from '@tradrl/agent-runtime';

const runtime = new AgentRuntime();
const result = runtime.drive(new ScriptedSource(compiledOrganizationOps));
if (!result.ok) {
  // result.error.code — e.g. 'circular-delegation-chain'
}

const mailbox = runtime.mailbox(tenant, instanceId);
const live = runtime.liveInstances(tenant);
const determinism = runtime.verifyDeterminism(); // { replayClean: true, ... }
```

## Testing

`pnpm verify` runs typecheck + vitest across the workspace. This service's
suite (`src/scripted.test.ts`) drives the canonical end-to-end script —
spawn hierarchy, delegate, publish/subscribe, challenge/propose/approve,
escalate, observe, learn, report, execute, terminate — and asserts the full
log replays to the identical final state, plus double-runtime determinism,
rejection-as-data semantics, and forensic log adoption.
