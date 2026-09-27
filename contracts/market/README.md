# Market Contracts

**Owning Work Order: T004** · Status: authoritative · Implementation: `packages/market-protocol`, `packages/time-engine`

These documents are the human-readable AUTHORITY for the market event protocol and the
point-in-time information boundary. They bind three downstream consumers:

| Consumer | What it takes from here |
|---|---|
| **T008** — data ingestion / event store | the envelope contract, validation rules, error codes, provenance rules |
| **T036** — provider-neutral adapter SDK | the envelope field semantics, the taxonomy, the provenance/syntheticity rules, the quartet discipline |
| **T026** — point-in-time knowledge firewall | the Time Machine/visibility contract, the derived-state rule, the leakage contract |

Reading order:

1. [01-market-event-envelope.md](01-market-event-envelope.md) — the canonical event shape, field-by-field semantics, and the **availability quartet contract**.
2. [02-event-type-taxonomy.md](02-event-type-taxonomy.md) — the event-type discriminants and the typed payloads.
3. [03-provenance-and-syntheticity.md](03-provenance-and-syntheticity.md) — origins, adapter references, lineage and the syntheticity rule.
4. [04-time-machine-visibility.md](04-time-machine-visibility.md) — the SimulationClock, the information firewall, the derived-state rule and the leakage contract.
5. [05-json-examples.md](05-json-examples.md) — complete JSON examples for every concept above.

## Normative summary (the ten laws of this contract)

1. Every external market observation enters TradRL as exactly one canonical envelope.
2. All four availability timestamps are REQUIRED and carry distinct semantics (quartet contract).
3. `available_time >= event_time` — enforced at validation. Information about an event cannot be observable before the event occurred. Adapters clamp vendor clock skew.
4. `ingestion_time` is deliberately UNORDERED against `available_time` (embargo and backfill are both legitimate and meaningful).
5. Envelope validation is timeless — a future-dated `available_time` is VALID. Withholding it is the firewall's job, never the validator's.
6. An agent may observe an event iff `event.available_time <= clock.now` — inclusive, no exceptions, same rule for raw events, derived features, aggregates, labels and caches.
7. Events are synthetic iff `provenance.origin !== 'historical'`. Simulated and generated events are always distinguishable from historical ones.
8. Derived events carry their full lineage (`derived_from` + `transform`) and are available no earlier than their latest input plus computation delay.
9. `sequence` is strictly increasing per `(venue, instrument, event stream)`; sub-millisecond order lives here, never in the timestamps.
10. Vendor specifics never cross this boundary (L13) — the escape hatch is `other`, and it must name its `kind`.
