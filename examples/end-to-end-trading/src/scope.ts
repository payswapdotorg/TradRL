/**
 * T048 — the reference end-to-end trading slice: the shared scope.
 *
 * THE SLICE'S ONE SCOPE (L12/L15): a single tenant/project over the
 * BINANCE venue (BTC-USDT + ETH-USDT) plus the NEWS-WIRE-A news feed,
 * with every instant an explicit literal anchored at T0 — the whole
 * slice is a deterministic function of the literals in this file plus
 * the fixture scripts each station declares. No ambient clock
 * (`Date.now()` never appears in this directory), no ambient
 * randomness, no network (every adapter rides an injected scripted
 * transport), zero npm dependencies.
 *
 * THE STATIONS (the data flow — see README.md for the diagram):
 *   1. MARKET DATA IN — the REAL T037/T038 adapter sessions over the
 *      slice's scripted transports (canonical events with honest L4
 *      quartets — the embargo law included).
 *   2. THE REACTIVE WORLD — the REAL T027 service, fed by the adapter
 *      events, matched by the REAL exchange-sim engine through the
 *      injected EngineDriver port (the T027 interop pattern).
 *   3. STRATEGY/RISK — the REAL T018 `compileStrategyRun` over the
 *      observation window the adapter events define.
 *   4. THE DIRECTOR — the REAL T024 `composeDirectorDecision` over the
 *      four-lane research intake (the research bodies T021–T023 are
 *      OUTSIDE this slice's dependency set; the director lane's own
 *      published fixture reports are the intake — documented honestly).
 *   5. THE EXECUTION BODY — the REAL T025 order-lifecycle records and
 *      gateway REQUEST records for everything the gateway routed.
 *   6. THE EXECUTION GATEWAY — the REAL T040 chokepoint over the REAL
 *      T019 gate + T020 risk engine + T040 authority (grants,
 *      entitlements, routing) — the L8 law: no path from an intent to
 *      an order that bypasses the pipeline.
 *   7. SHADOW TRADING + REALIZED OUTCOMES — the REAL T030 session
 *      paper-executing the BTC intent against the reactive world, the
 *      chain-verified outcome log out to the realized outcome summary.
 */

// ---------------------------------------------------------------------------
// The scope literals (every downstream station binds to these)
// ---------------------------------------------------------------------------

/** The slice's clock anchor: 2024-06-03T14:00:00.000Z (the director lane's fixture era). */
export const T0 = 1_717_423_200_000;

/** The slice's tenant (L12 — one tenant for every record the slice emits). */
export const TENANT = 'tenant-e2e-slice';

/** The slice's project (L15). */
export const PROJECT = 'project-e2e-slice';

/** The slice's deterministic seed. */
export const SEED = 't048-e2e-slice-seed';

/** The principal the control stack admits (the strategy spec id). */
export const PRINCIPAL = 'spec-e2e-eq-drift';

/** The live venue (the T037 Binance descriptor's declared venue label). */
export const VENUE = 'BINANCE';

/** The instruments (declared in the Binance source descriptor's spot-major universe). */
export const BTC = 'BTC-USDT';
export const ETH = 'ETH-USDT';

/** The news wire's venue label (the T038 news descriptor). */
export const NEWS_VENUE = 'NEWS-WIRE-A';

/** The news instruments (declared in the news descriptor's equity-majors universe). */
export const NEWS_INSTRUMENT = 'TEST-AAA';

/** The slice's opaque credential ref for the BINANCE venue (never a value — L8/SECURITY.md). */
export const CREDENTIAL_REF = 'cred:e2e-binance@1';

/** The routed adapter binding's opaque descriptor ref (the gateway's routing table entry). */
export const ADAPTER_REF = 'adapter:e2e-venue-binance@1';

/** The routed adapter binding's channel ref. */
export const CHANNEL_REF = 'chan:newOrderSingle';

/** The opaque cognitive-substrate ref the gateway's audit records cite. */
export const SUBSTRATE_REF = 'substrate:t048-reference-slice@1';

/** The research-lane scope the director station runs in (the T024 published fixture scope). */
export const DIRECTOR_TENANT = 'tenant-director';
export const DIRECTOR_PROJECT = 'project-portfolio';

// ---------------------------------------------------------------------------
// The decision timeline (the slice's market day, every instant a literal)
// ---------------------------------------------------------------------------

/**
 * The timeline of the slice's ONE market day (epoch-ms offsets from T0):
 *
 *   T0            the recorded history opens (the seeded book snapshot).
 *   T0+15_000     the adversary's crossing buy (the world fights back).
 *   T0+20_000     the BTC trade print that anchors the step-1 limit.
 *   T0+20_500     the ETH trade print (the step-1 ETH limit's anchor).
 *   T0+25_000     the news wire's embargoed headline lifts.
 *   T0+26_000     the public TEST-AAA headline.
 *   T0+60_000     the research reports' asOf (the T024 fixture reports).
 *   T0+300_000    the DIRECTOR decision instant (the T024 fixture asOf).
 *   T0+320_000    the STRATEGY step-1 decision instant (the allocation).
 *   T0+320_500..  the gateway submission instants (one per submission).
 *   T0+330_000    the BTC rally print @ 62000 (the step-2 trigger).
 *   T0+340_000    the STRATEGY step-2 decision instant (the drift sell).
 *   T0+400_000    the world's horizon (the resting orders expire).
 */
export const DIRECTOR_DECISION_AT = T0 + 300_000;
export const STRATEGY_DECISION_AT = T0 + 320_000;
export const GATEWAY_INSTANTS: readonly number[] = [
  T0 + 320_500,
  T0 + 320_600,
  T0 + 320_700,
  T0 + 320_800,
  T0 + 320_900,
  T0 + 321_000,
  T0 + 321_100,
  T0 + 321_200,
];

/** The genesis cash of the slice's portfolio (exact decimal string). */
export const GENESIS_CASH = '100000';

// ---------------------------------------------------------------------------
// Small shared helpers (the fixture discipline — fail loudly on drift)
// ---------------------------------------------------------------------------

/** Unwrap a collect-all result, throwing the collected errors (a construction failure is a slice bug). */
export function unwrap<T>(
  result: { readonly ok: boolean; readonly value?: T; readonly errors?: readonly { readonly message: string }[]; readonly error?: { readonly message: string } },
  what: string,
): T {
  if (result.ok) return result.value as T;
  const detail =
    'errors' in result && Array.isArray((result as { errors?: unknown }).errors)
      ? ((result as { errors: readonly { message: string }[] }).errors.map((error) => error.message).join('; '))
      : ((result as { error?: { message: string } }).error?.message ?? JSON.stringify(result));
  throw new Error(`${what}: ${detail}`);
}
