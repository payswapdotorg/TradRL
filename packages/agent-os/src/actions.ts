// @tradrl/agent-os — the fourteen kernel actions.
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS: Stable kernel: SPAWN,
// TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE, CHALLENGE, PROPOSE,
// APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT. Higher-level
// organization is adaptive."); spec/ARCHITECTURE-LOCK.md L8 (execution
// authority outside prompts), L20 (safety outside prompts).
//
// STRUCTURAL MIRROR — DO NOT DIVERGE. `@tradrl/agent-body` (T003) declares
// the identical fourteen-name vocabulary as `AGENT_ACTION_NAMES` ("the stable
// Agent OS kernel verb set; semantics are owned by the Agent OS lane, T006").
// This module is the SEMANTICS-OWNING declaration; agent-body mirrors it for
// authority-boundary declarations. The two declarations are plain string
// literal unions, so TypeScript structural typing keeps them mutually
// assignable; the cross-package trip wire lives in
// packages/agent-os/src/interop.test.ts.
//
// Kernel smallness law: these fourteen operations ARE the kernel. Planners,
// markets for tasks, negotiation strategies and every other organizational
// concern are ADAPTIVE structure that lives in consumers (the T016
// organization compiler) — never here.

import { isEnum, type Brand } from './primitives';

/**
 * The fourteen Agent OS kernel operations, EXACTLY as frozen in
 * spec/ARCHITECTURE.md. This array is the machine-checkable enumeration of
 * the kernel's entire verb surface — anything not in this list is not a
 * kernel operation.
 */
export const KERNEL_ACTION_NAMES = [
  'SPAWN',
  'TERMINATE',
  'DELEGATE',
  'REQUEST',
  'PUBLISH',
  'SUBSCRIBE',
  'CHALLENGE',
  'PROPOSE',
  'APPROVE',
  'EXECUTE',
  'ESCALATE',
  'OBSERVE',
  'LEARN',
  'REPORT',
] as const;

/**
 * A kernel operation name. Structurally mirrored by
 * `@tradrl/agent-body`'s `AgentActionName` (mutually assignable literal
 * unions — verified by the interop trip wire).
 */
export type KernelActionName = (typeof KERNEL_ACTION_NAMES)[number];

/** Guard: `KernelActionName`. */
export const isKernelActionName = isEnum(KERNEL_ACTION_NAMES);

/**
 * The number of kernel operations — asserted by tests to be exactly 14 so
 * that an accidental vocabulary change cannot slip through review silently.
 */
export const KERNEL_ACTION_COUNT: number = KERNEL_ACTION_NAMES.length;

/**
 * Verdicts carried by the proposal-transport operations
 * (PROPOSE / CHALLENGE / APPROVE). The kernel records and transports
 * verdicts; it never adjudicates proposals (decision cadence is adaptive
 * structure owned by the organization compiler, T016, and the decision
 * contracts of T002).
 */
export const PROPOSAL_VERDICTS = ['proposed', 'challenged', 'approved', 'rejected'] as const;

/** A proposal verdict transported by PROPOSE / CHALLENGE / APPROVE. */
export type ProposalVerdict = (typeof PROPOSAL_VERDICTS)[number];

/** Guard: `ProposalVerdict`. */
export const isProposalVerdict = isEnum(PROPOSAL_VERDICTS);

/** Free-form reason string carried by TERMINATE and ESCALATE (bounded). */
export type ReasonText = Brand<string, 'ReasonText'>;

const REASON_MAX_LENGTH = 512;

/** Guard: `ReasonText` (non-empty, trimmed, bounded). */
export function isReasonText(v: unknown): v is ReasonText {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= REASON_MAX_LENGTH &&
    !/[\u0000-\u001f]/.test(v)
  );
}

/** Constructs a `ReasonText`, throwing on invalid input. */
export function reasonText(value: string): ReasonText {
  if (!isReasonText(value)) {
    throw new TypeError(
      `ReasonText: invalid reason ${JSON.stringify(value)} — must be 1..${REASON_MAX_LENGTH} chars, trimmed, no control characters`,
    );
  }
  return value as ReasonText;
}
