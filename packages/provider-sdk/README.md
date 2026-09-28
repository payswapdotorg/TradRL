# @tradrl/provider-sdk

The provider-neutral adapter SDK — the foundation every external integration
(Work Orders T037 crypto/exchange adapters, T038 equities/news/alternative-data
adapters, T039 broker/OMS adapters) builds on.

**spec/ADAPTERS.md**: "External systems are substrates. Canonical domain
contracts remain provider-neutral." The SDK knows NO provider (L2/L13/L14):
no vendor name, field or semantic appears in any SDK type. The provider
neutrality trip-wire (`src/neutrality.test.ts`) greps the package sources for
a broad provider vocabulary and fails on any hit.

## Laws held by this package

| Law | How |
| --- | --- |
| Zero runtime deps | Types, guards and pure functions only; no imports outside `src/` at runtime |
| No `any` | Hand-rolled total guards; `unknown` at every untrusted boundary |
| D-003/D-004 mirrors | Timestamp, taxonomy, payload and provenance shapes are STRUCTURAL MIRRORS of `@tradrl/market-protocol` (and the T008 ingestion plane); never imports — trip-wired by `src/interop.test.ts` |
| L2/L13/L14 substrate neutrality | Provider-neutral descriptors; raw request pass-through; the neutrality grep trip-wire |
| L4 honest quartets | `MappingTable.source_time_policy` declares the quartet derivation; `available_time` is clamped to `>= event_time` |
| L9 lineage | Emitted events carry the ingestion provenance block (origin/adapter/derived_from/transform), structurally satisfying the T008 mirror |
| Licensing | `EntitlementEnvelope` declarations; emission without one is a typed `EntitlementError` — an entitlement-less record is unrepresentable |
| No network | `TransportPort` is an injected interface; the only implementation shipped is the scripted `FakeTransport` (test harness) |
| Determinism | No wall clock, no randomness: behavior is a pure function of the scripted transport; the same script emits a byte-identical stream |

## Public API (src/index.ts)

- **`SourceDescriptor`** — provider id (opaque), category
  (`market-data`/`execution`/`model`/`human`), capabilities (channels, symbol
  universes, canonical event types, latency class); `validateSourceDescriptor`
  (collect-all) → deep-frozen.
- **`MappingTable`** — the raw→canonical declaration: `FieldMapping[]`
  (raw field → canonical field with a declared `FieldTransform`:
  identity / enum / decimal-string / levels), `constants`, `tolerated`
  (explicit, auditable drops), and `source_time_policy`. Validation checks
  canonical coverage (every required payload field is fed), target vocabulary,
  and single disposition per raw field.
- **`CanonicalEmitter` / `createCanonicalEmitter`** — maps one inbound
  message + `StreamBinding` to one canonical `EmittedEvent`. Refusal order:
  entitlement → raw accounting → time conversion → transform/payload
  validation → floor re-validation. Deterministic event ids
  (`adapter:table:stream:sequence`) and per-stream sequences (burned only on
  success).
- **`AdapterSession` / `createAdapterSession`** — the normalized lifecycle
  `idle → open → subscribed → closed` over an injected `TransportPort`;
  subscriptions bind channels to tables + stream identity and are
  cross-checked against the declared capabilities. `nextEvent`/`onEvent`/
  `pump`; typed errors on double-close, use-after-close, unknown channel.
- **`EntitlementEnvelope` / `EntitlementRef`** — declared license/access
  constraints as opaque refs; every emitted record carries its ref.
- **`RateQuotaEnvelope` / `assessScheduleFeasibility`** — declarative,
  token-bucket-free limits+window+policy; feasibility is computed exactly
  (fixed epoch-aligned windows / rolling windows) over a scripted timeline.
- **`HealthThresholds` / `assessHealth`** — liveness/staleness against an
  injected instant (never a wall clock).
- **Error taxonomy** — `TransportError` / `MappingError` / `EntitlementError`
  / `ProtocolError` / `TimeoutError`, frozen, with `is*` guards.
- **Test harness** — `createFakeTransport` (scripted timeline, transient
  failures, timeout modeling, send logging) and `adapterContractCases`
  (the 11 contract cases every adapter MUST pass) with zero-dep assertion
  helpers.

## Tests

`src/*.test.ts` — behavioral suites: negative paths, boundaries,
immutability (deepFreeze + throw-on-mutation), determinism
(byte-identical emission streams), the neutrality grep trip-wire, the
market-protocol interop trip-wires (type-level assignability + runtime
validator parity + the emitted stream passing market-protocol's own
validators), and the contract factories dogfooded against a neutral
reference subject.
