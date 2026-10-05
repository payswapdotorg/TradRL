// ops/tooling/smoke.d.mts — the typed surface of the smoke probe (hand-
// authored; the .mjs is the implementation — the tests import this
// declaration, tsc stays strict with no `any`; the deploy/vercel
// build-console.d.mts precedent).

/** One probe request's init shape (the subset of RequestInit the probe uses). */
export interface SmokeFetchLikeInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** One probe response's read surface (the subset the probe reads). */
export interface SmokeFetchLikeResponse {
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
    entries(): IterableIterator<[string, string]>;
  };
  text(): Promise<string>;
}

/** The fetch adapter the probe uses (the tests inject a scripted fake). */
export type SmokeFetchLike = (url: string, init?: SmokeFetchLikeInit) => Promise<SmokeFetchLikeResponse>;

/** The probe's options. */
export interface SmokeProbeOptions {
  /** The deployment origin (e.g. https://tradrl-console.vercel.app). */
  readonly baseUrl: string;
  /** The API credential value (TRADRL_API_DEVELOPER_TOKEN); sent only in the Authorization header, never echoed. */
  readonly token: string;
  /** The fetch adapter (default: the platform fetch with a 15 s per-request timeout). */
  readonly fetchImpl?: SmokeFetchLike;
  /** The project the knowledge query probes (default: the seeded demo project). */
  readonly knowledgeProject?: string;
  /** The point-in-time instant the knowledge query probes (default: the runbook's documented instant). */
  readonly knowledgeAt?: number;
}

/** One check's verdict. */
export interface SmokeCheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The probe's result: the verdicts + the deterministic report text. */
export interface SmokeProbeResult {
  readonly baseUrl: string;
  readonly passed: number;
  readonly failed: number;
  readonly checks: readonly SmokeCheckResult[];
  readonly reportText: string;
}

/** Run the seven-point smoke sequence (pure over the injected fetch — no clock, no randomness). */
export function runSmokeProbe(options: SmokeProbeOptions): Promise<SmokeProbeResult>;

/** The number of checks the probe performs (the report's denominator). */
export const SMOKE_CHECK_COUNT: number;
