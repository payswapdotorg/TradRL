// @tradrl/web-console — the console's own typed error taxonomy: the
// UX laws as CODE (Work Order T042: "a render path that could surface
// reasoning text is a typed error", "rendering a fact whose
// availability instant is after the selected view time is a typed
// error — enforce in code", "the console carries the tenant context
// on every read; a cross-tenant render is a typed error", "a
// wall-clock read in a render path is a typed error").
//
// Every law the console enforces at the interface throws one of
// THESE classes — never a bare Error, never a silent wrong render.
// The tests pin each one by name.
//
// Spec anchors: R37 (watchable, no hidden chain-of-thought), R36,
// R38, L4 (point-in-time truth at the interface), L12 (tenant
// scoping), L20 (render, never enforce), ARCHITECTURE.md Experience
// plane.

/** The console-law error codes (the closed vocabulary; every violation names its law). */
export const CONSOLE_ERROR_CODES = [
  'chain_of_thought_exposure',
  'availability_violation',
  'cross_tenant_render',
  'wall_clock_read',
  'policy_enforcement_attempt',
  'invalid_launch_draft',
  'invalid_research_submission',
  'loader_failure',
] as const;

/** One console-law error code. */
export type ConsoleErrorCode = (typeof CONSOLE_ERROR_CODES)[number];

/** The base of the console's typed error hierarchy. */
export class ConsoleLawError extends Error {
  readonly code: ConsoleErrorCode;

  constructor(code: ConsoleErrorCode, message: string) {
    super(message);
    this.name = 'ConsoleLawError';
    this.code = code;
  }
}

/**
 * R37 / UX.md watch mode: "Do not expose hidden chain-of-thought."
 * Thrown by any watch-record builder or render path that could
 * surface reasoning text — a reasoning-shaped key anywhere in a
 * payload about to be rendered, a free-text rationale in a decision
 * position, or an opaque payload the watch model would have carried
 * verbatim. The watch surface renders agents, capabilities,
 * evidence, proposals, challenges, risk checks and decisions —
 * never reasoning.
 */
export class ChainOfThoughtExposureError extends ConsoleLawError {
  constructor(message: string) {
    super('chain_of_thought_exposure', message);
    this.name = 'ChainOfThoughtExposureError';
  }
}

/**
 * L4 at the interface: rendering a fact whose availability instant
 * is after the selected Time Machine view time is a typed error.
 * The availability projection filters what MAY be shown; this error
 * fires when a violating datum reaches a render path anyway (a bug
 * or a bypass — both surface loudly, never as a wrong render).
 */
export class AvailabilityViolationError extends ConsoleLawError {
  /** The offending datum's availability instant (epoch ms). */
  readonly availableAt: number;
  /** The selected view instant (epoch ms). */
  readonly viewAt: number;

  constructor(message: string, availableAt: number, viewAt: number) {
    super('availability_violation', message);
    this.name = 'AvailabilityViolationError';
    this.availableAt = availableAt;
    this.viewAt = viewAt;
  }
}

/**
 * L12 at the interface: the console carries the tenant context on
 * every read and every record; a record from another tenant
 * entering the workspace state or a render path is a typed error —
 * a cross-tenant render can never happen silently.
 */
export class CrossTenantRenderError extends ConsoleLawError {
  /** The workspace's tenant context. */
  readonly expectedTenant: string;
  /** The offending record's tenant. */
  readonly actualTenant: string;

  constructor(message: string, expectedTenant: string, actualTenant: string) {
    super('cross_tenant_render', message);
    this.name = 'CrossTenantRenderError';
    this.expectedTenant = expectedTenant;
    this.actualTenant = actualTenant;
  }
}

/**
 * The injected-instants law: the console receives time from the
 * API/adapter; a wall-clock read inside a render path is a typed
 * error (identical inputs -> identical bytes would otherwise be
 * impossible). The render guard arms this error for the duration of
 * every render/model pass.
 */
export class WallClockReadError extends ConsoleLawError {
  constructor(message: string) {
    super('wall_clock_read', message);
    this.name = 'WallClockReadError';
  }
}

/**
 * L20 at the interface: the console renders; it NEVER enforces —
 * policy lives in the API/gateway. Thrown when a console path
 * attempts a policy decision: fabricating/altering an authorization
 * verdict (a gateway refusal rendered as routed, an approval badge
 * without the gateway's record), or reaching for an enforcement
 * operation the console does not own.
 */
export class PolicyEnforcementError extends ConsoleLawError {
  constructor(message: string) {
    super('policy_enforcement_attempt', message);
    this.name = 'PolicyEnforcementError';
  }
}

/** The launch form's validation failures (UX.md primary flow — the draft is validated BEFORE any API call). */
export class InvalidLaunchDraftError extends ConsoleLawError {
  /** The dotted path of the offending draft field. */
  readonly path: string;

  constructor(path: string, message: string) {
    super('invalid_launch_draft', `${path}: ${message}`);
    this.name = 'InvalidLaunchDraftError';
    this.path = path;
  }
}

/**
 * The standalone research submission's validation failures (D-12, W-29
 * wave 2 — the Research section's own submit affordance). Same law as
 * the launch draft: the input is validated LOCALLY, typed, BEFORE any
 * API call — never an unhandled rejection, never a wrong submission.
 */
export class InvalidResearchSubmissionError extends ConsoleLawError {
  /** The offending field name. */
  readonly field: string;

  constructor(field: string, message: string) {
    super('invalid_research_submission', `${field}: ${message}`);
    this.name = 'InvalidResearchSubmissionError';
    this.field = field;
  }
}

/** The no-build loader's typed failures (module-graph cycles, unresolved modules, non-erasable syntax). */
export class LoaderError extends ConsoleLawError {
  constructor(message: string) {
    super('loader_failure', message);
    this.name = 'LoaderError';
  }
}
