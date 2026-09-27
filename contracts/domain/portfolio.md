# Position and Portfolio

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`position.ts`, `portfolio.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md`, L4.

Positions and portfolios are **point-in-time data snapshots**. This lane
records them; it does NOT compute them: PnL, exposure and summary metrics
are produced by the strategy domain (T018) and evaluation (T012) and
recorded here as data. Every snapshot carries `asOf` (L4 — point-in-time
truth), making a Portfolio's history replayable without recomputation
ambiguity.

## Position

| Field | Type | Required | Semantics |
|---|---|---|---|
| `instrumentId` | `InstrumentId` | yes | Instrument held. |
| `venueId` | `VenueId` | no | Venue when the position is venue-scoped; absent = aggregated across venues. |
| `quantity` | `DecimalString` | yes | Signed quantity: positive = long, negative = short, `0` = flat. |
| `averageEntryPrice` | `DecimalString` | yes | Volume-weighted average entry price of the current quantity. Non-negative. |
| `realizedPnl` | `DecimalString` | no | Realized PnL closed out so far. Signed. Absent = not yet available. |
| `unrealizedPnl` | `DecimalString` | no | Mark-to-market PnL at `asOf`. Signed. Absent = not yet available. |
| `openedAt` | `Timestamp` | no | When the position was opened. |
| `asOf` | `Timestamp` | yes | Snapshot instant. |

## Portfolio

| Field | Type | Required | Semantics |
|---|---|---|---|
| `projectId` | `ProjectId` | yes | The project this portfolio belongs to. |
| `name` | `string` | no | Human label. |
| `baseCurrency` | `string` | no | Reporting currency symbol (e.g. `USD`). |
| `positions` | `readonly Position[]` | yes | Snapshot positions; at most one position per `(instrumentId, venueId)` key (venue-absent is its own key). |
| `summary` | `PortfolioSummaryMetrics` | yes | Recorded summary data (below). May be empty. |
| `asOf` | `Timestamp` | yes | Snapshot instant (all positions in one snapshot share it). |

### PortfolioSummaryMetrics (recorded data — never computed here)

| Field | Type | Required | Semantics |
|---|---|---|---|
| `grossExposure` | `DecimalString` | no | Gross notional exposure. |
| `netExposure` | `DecimalString` | no | Net notional exposure. |
| `marketValue` | `DecimalString` | no | Marked market value. |
| `realizedPnl` | `DecimalString` | no | Portfolio-level realized PnL. |
| `unrealizedPnl` | `DecimalString` | no | Portfolio-level unrealized PnL. |
| `totalPnl` | `DecimalString` | no | Realized + unrealized. |

All metrics are optional, signed, canonical decimals. Their definitions
(what counts as exposure, marks used, netting conventions) are owned by the
producing lanes (T018 strategy / T012 evaluation); this contract carries the
recorded values so consumers can reason without re-deriving them.

## Invariants

1. `asOf` is mandatory on both records (L4). Position history is a sequence
   of snapshots, never a mutable row.
2. `averageEntryPrice ≥ 0`; flat positions may carry `"0"`.
3. Realized/unrealized PnL is optional data — absent means "not yet
   available", not zero.
4. Netting discipline inside a portfolio snapshot: one position per
   `(instrument, venue)` key; venue-scoped and venue-aggregated entries for
   the same instrument are distinct keys.
5. **No computation rule:** nothing in this package sums, nets or marks.
   Producers own numeric correctness; consumers trust recorded data.

## Versioning rules

- Snapshots are immutable; the current state is the latest snapshot at or
  before the reading instant (the store serves point-in-time reads).
- Metric definitions belong to producers: if a producer changes a metric
  definition, it records a new snapshot lineage and documents the change —
  it must NOT retroactively rewrite historical snapshots.

## JSON examples (machine-validated)

A long position snapshot with PnL split:

```json
{
  "instrumentId": "instr_btc_usdt",
  "venueId": "venue_binance",
  "quantity": "1.25",
  "averageEntryPrice": "41850.10",
  "realizedPnl": "-12.40",
  "unrealizedPnl": "318.75",
  "openedAt": "2027-01-10T09:00:00Z",
  "asOf": "2027-01-20T17:00:00Z"
}
```

The project portfolio snapshot containing it:

```json
{
  "projectId": "prj_1",
  "name": "Crypto Majors book",
  "baseCurrency": "USD",
  "positions": [
    {
      "instrumentId": "instr_btc_usdt",
      "venueId": "venue_binance",
      "quantity": "1.25",
      "averageEntryPrice": "41850.10",
      "realizedPnl": "-12.40",
      "unrealizedPnl": "318.75",
      "openedAt": "2027-01-10T09:00:00Z",
      "asOf": "2027-01-20T17:00:00Z"
    },
    {
      "instrumentId": "instr_eth_usdt",
      "quantity": "-30",
      "averageEntryPrice": "2510.55",
      "asOf": "2027-01-20T17:00:00Z"
    }
  ],
  "summary": {
    "grossExposure": "100871.65",
    "netExposure": "100586.35",
    "marketValue": "100871.65",
    "realizedPnl": "-12.40",
    "unrealizedPnl": "318.75",
    "totalPnl": "306.35"
  },
  "asOf": "2027-01-20T17:00:00Z"
}
```
