# @tradrl/market-protocol

**Owning Work Order: T004** (frozen write surface: `packages/market-protocol`)

Canonical provider-neutral market event, data and provenance contracts:
`MarketEvent`, the event-type taxonomy with typed payloads, provenance and
syntheticity, and per-stream sequence discipline
(spec/ADAPTERS.md, spec/DOMAIN-MODEL.md).

Human-readable contract authority: [`contracts/market/`](../../contracts/market/)
— especially the [envelope + availability quartet](../../contracts/market/01-market-event-envelope.md),
the [taxonomy](../../contracts/market/02-event-type-taxonomy.md) and
[provenance/syntheticity](../../contracts/market/03-provenance-and-syntheticity.md).

## Surface

- **Envelope** — `MarketEvent` (discriminated union over `event_type`),
  `validateMarketEvent` / `isMarketEvent` / `validateMarketEvents`: hand-rolled
  collect-all validation with typed errors (`{ code, path, message }`).
- **Availability quartet** — `event_time` / `source_time` / `available_time` /
  `ingestion_time`, all required, explicit semantics, one enforced order
  (`available_time >= event_time`); future-dated availability is VALID
  (validation is timeless — withholding is the firewall's job).
- **Taxonomy** — 11 event types (trade, quote, book_snapshot, book_delta,
  ohlcv, news, macro_release, social_signal, fundamental, option_chain_mark,
  other) each with a typed payload and a registered validator
  (`payloadRegistry`, compiler-enforced exhaustiveness). No `unknown` leaks.
- **Provenance** — `origin: historical | simulated | generated`
  (`isSyntheticEvent`), adapter reference required for historical events,
  lineage (`derived_from` + `transform`) with self-reference/duplicate/orphan
  rules.
- **Sequence discipline** — strictly-increasing per
  `(venue, instrument, event stream)`; `validateSequenceMonotonicity`,
  `createSequenceTracker`; `other` events scope by kind.
- **Decimal strings** — prices/sizes as precision-safe decimal strings with
  exact (non-float) comparison (`compareDecimal`).

## Dependencies

Zero runtime dependencies — types, schemas and pure functions only.
`TimestampMs` is a STRUCTURAL MIRROR of `@tradrl/time-engine` (the canonical
owner); `src/interop.test.ts` is the trip wire that fails if the declarations
drift. See `src/timestamp.ts` for the mirror discipline.
