# 01 — The MarketEvent Envelope

Every external market observation enters TradRL as exactly this shape
(`@tradrl/market-protocol`, `MarketEvent`). It is provider-neutral: vendor
specifics are translated by adapters (L13) and never cross this boundary.

## Field table

| Field | Type | Required | Semantics |
|---|---|---|---|
| `event_id` | string (non-empty) | yes | Opaque unique event identifier within the event store. Stable forever; derived events get their own id and reference parents via provenance. |
| `venue` | string (non-empty) | yes | Venue identifier, canonical uppercase (e.g. `BINANCE`, `XNAS`). Opaque — no venue-specific semantics may attach here. |
| `instrument` | string (non-empty) | yes | Instrument identifier, venue-canonical (e.g. `BTC-USDT`, `AAPL`). Opaque. |
| `asset_class` | enum | yes | One of `crypto`, `equity`, `index`, `future`, `option`, `forex`, `commodity`, `macro`, `other`. Events that are not about a traded instrument (news, macro) still declare the closest class (`macro`, or the related instrument's class). |
| `event_type` | enum | yes | The taxonomy discriminant (see doc 02). Selects the payload validator. Unknown values are rejected. |
| `event_time` | `TimestampMs` | yes | **When it happened in the world.** The occurrence instant, normalized to UTC epoch milliseconds. |
| `source_time` | `TimestampMs \| null` | yes (nullable) | **When the source says it happened.** The upstream feed's own timestamp, when it provides one; `null` when it does not. ADVISORY: source clocks disagree with ours — that disagreement is precisely why this field exists. No ordering is enforced against any other timestamp. |
| `available_time` | `TimestampMs` | yes | **The earliest an agent may legitimately observe it.** THE information-boundary input (L4). This is what the visibility predicate compares against, and it is the ONLY timestamp the firewall consults. |
| `ingestion_time` | `TimestampMs` | yes | **When TradRL actually received it.** INFORMATIONAL/audit only. The visibility predicate NEVER consults it. |
| `sequence` | integer ≥ 0 (safe) | yes | Per-stream ordinal; strictly increasing within `(venue, instrument, event stream)` in arrival order. Sub-millisecond ordering is expressed here, never in timestamps. |
| `provider` | string (non-empty) | yes | Data provider identifier (e.g. `binance`, `snp-licensed`, `tradrl-world`). |
| `provenance` | object | yes | Origin, adapter reference, lineage and transform (see doc 03). |
| `payload` | typed by `event_type` | yes | The typed payload selected by the taxonomy (see doc 02). |

Type notes:

- `TimestampMs` = epoch milliseconds, integer, within `[0, 8_639_999_999_999_999]`
  (the ECMAScript `Date` representable range; every valid timestamp is ISO-renderable).
  JSON-safe plain numbers.
- Unknown/extra fields on the envelope are TOLERATED — the contract is a
  forward-compatible floor. Required fields must still be present and valid.

## The availability quartet contract

The four timestamps answer four different questions. Conflating any two of
them is a point-in-time correctness bug.

| Timestamp | Question it answers | Who sets it |
|---|---|---|
| `event_time` | When did it happen in the world? | Adapter, from the vendor's occurrence semantics |
| `source_time` | When does the source claim it happened? | Adapter, verbatim from the feed (or `null`) |
| `available_time` | When may an agent legitimately first see it? | Adapter, from the vendor's distribution/entitlement semantics — this is the anti-leakage input |
| `ingestion_time` | When did TradRL actually receive it? | Ingestion (T008), never the adapter |

### Ordering rules (exactly one is enforced)

**ENFORCED: `available_time >= event_time`.**
Information about an event cannot be legitimately observable before the event
occurred. Vendor clock skew that violates this MUST be clamped by the adapter
(e.g. `available_time = max(feed_available, event_time)`) before emission —
downstream ordering depends on this invariant and the envelope guard rejects
violations with code `timestamp_order`.

**DELIBERATELY UNORDERED: `ingestion_time` vs `available_time`.** Both orderings
are legitimate and meaningful:

- *Embargo* (`ingestion_time < available_time`): an entitled feed delivers data
  before it becomes publicly observable (e.g. received 13:50, public 14:00).
  The event sits in the store; the firewall withholds it from agents until
  14:00. This is the case where the firewall earns its keep.
- *Backfill* (`ingestion_time > available_time`): data that was publicly
  available at 10:00 is ingested at 18:00. A replay at simulated time 12:00
  STILL shows it to the agent — the agent standing at 12:00 in the world being
  reconstructed could have known it. Our ingestion lateness must not falsify
  what was knowable then.

**DELIBERATELY UNORDERED: `source_time` vs everything.** It is recorded
verbatim for audit and skew analysis, nothing more.

### Timelessness of validation

Envelope validation NEVER compares timestamps against "now". A future-dated
`available_time` (e.g. a scheduled macro release that will become public at
14:00, ingested at 13:50) is a VALID envelope. Withholding it until 14:00 is
the firewall's job (doc 04) — the validator refusing it would make embargoed
data unrepresentable.

## Validation summary

`validateMarketEvent(value)` collects ALL violations (never fail-fast) and
returns typed errors `{ code, path, message }` with dotted paths
(`payload.bids[0].size`). Codes:

| Code | Meaning |
|---|---|
| `invalid_type` | root value is not an object |
| `missing_field` | required field absent (including an absent `source_time` — explicit `null` is required) |
| `invalid_field` | field present but invalid (empty string, bad decimal form, non-safe-integer, out-of-range timestamp, ...) |
| `unknown_event_type` | `event_type` not in the taxonomy |
| `timestamp_order` | `available_time < event_time` |
| `provenance_adapter_required` | historical event without an adapter reference |
| `provenance_transform_required` | derived event (non-empty lineage) without a transform |
| `provenance_transform_without_parents` | transform present with empty lineage |
| `provenance_self_reference` | event lists its own id in its lineage |
| `provenance_duplicate_parent` | duplicate parent id in lineage |

On success the validator returns the value narrowed to the `MarketEvent`
discriminated union — `unknown` never leaks past the API surface.
