/**
 * @tradrl/control-domain — execution mode mirror of @tradrl/domain-core.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `ExecutionMode` definition lives in `@tradrl/domain-core`
 * (packages/domain-core/src/project.ts). The frozen workspace lockfile
 * forbids a package dependency between the two contract packages, so this
 * package re-declares the IDENTICAL closed vocabulary. TypeScript's
 * structural typing makes the two declarations mutually assignable (a
 * string union with the same members); the cross-package test
 * `packages/control-domain/src/interop.test.ts` fails to compile (and
 * fails at runtime on vocabulary and guard parity) if the declarations
 * ever drift.
 *
 * Any change here MUST be mirrored in domain-core and vice versa.
 */

import { isNonEmptyString } from './primitives';

/**
 * Consequentiality of project execution. Hard separation of simulated vs
 * consequential execution (R23). Mode is a project-level property fixed at
 * creation; escalation to `live` is a control-plane decision with its own
 * authorization path (T040) — never a data patch.
 *
 * Mirror of domain-core's `ExecutionMode`.
 */
export type ExecutionMode = 'simulation' | 'shadow' | 'live';

/** The closed vocabulary. Mirror of domain-core's `EXECUTION_MODES`. */
export const EXECUTION_MODES: readonly ExecutionMode[] = ['simulation', 'shadow', 'live'] as const;

/** Guard — mirrors `isExecutionMode` from @tradrl/domain-core. */
export function isExecutionMode(v: unknown): v is ExecutionMode {
  return isNonEmptyString(v) && (EXECUTION_MODES as readonly string[]).includes(v);
}
