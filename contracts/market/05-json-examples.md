# 05 — JSON Examples

Every complete event example below is machine-verified against
`@tradrl/market-protocol`'s `validateMarketEvent` by
`packages/market-protocol/src/examples.test.ts` — this document cannot drift
from the implementation. Timestamps are UTC epoch milliseconds
(2024-06-03T14:00:00Z = `1717423200000`).

## 1. Historical trade (live adapter, ordinary latency)

```json
{
  "__example__": "trade-historical",
  "event_id": "evt-000000042",
  "venue": "BINANCE",
  "instrument": "BTC-USDT",
  "asset_class": "crypto",
  "event_type": "trade",
  "event_time": 1717423199750,
  "source_time": 1717423199750,
  "available_time": 1717423199950,
  "ingestion_time": 1717423200500,
  "sequence": 4177,
  "provider": "binance",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "binance-adapter", "version": "1.4.0" },
    "derived_from": [],
    "transform": null
  },
  "payload": {
    "price": "43125.10",
    "size": "0.017",
    "side": "buy",
    "trade_id": "998877"
  }
}
```

## 2. Embargoed macro release (ingestion BEFORE availability)

Received over an entitled feed at 13:50 (`ingestion_time`), publicly
observable at 14:00 (`available_time`). The envelope is VALID; agents are
withheld until 14:00 by the firewall, not by the validator.

```json
{
  "__example__": "macro-embargoed",
  "event_id": "evt-000000043",
  "venue": "US-BLS",
  "instrument": "US_CPI_YOY",
  "asset_class": "macro",
  "event_type": "macro_release",
  "event_time": 1717423200000,
  "source_time": 1717423200000,
  "available_time": 1717423200000,
  "ingestion_time": 1717422600000,
  "sequence": 1,
  "provider": "entitled-macro-feed",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "macro-adapter", "version": "0.9.1" },
    "derived_from": [],
    "transform": null
  },
  "payload": {
    "indicator": "US_CPI_YOY",
    "region": "US",
    "period": "2024-05",
    "actual": "3.3",
    "forecast": "3.4",
    "prior": "3.4",
    "unit": "%"
  }
}
```

## 3. Simulated, derived book delta (lineage + syntheticity)

Produced inside a reactive-replay Market World by an endogenous participant;
lineage names the two historical parent events and the transform. Note
`origin: "simulated"` — distinguishable from history forever, even though a
producer component is referenced.

```json
{
  "__example__": "book-delta-simulated",
  "event_id": "evt-000000044",
  "venue": "BINANCE",
  "instrument": "BTC-USDT",
  "asset_class": "crypto",
  "event_type": "book_delta",
  "event_time": 1717423200100,
  "source_time": null,
  "available_time": 1717423200100,
  "ingestion_time": 1717423200101,
  "sequence": 2,
  "provider": "tradrl-world",
  "provenance": {
    "origin": "simulated",
    "adapter": { "id": "market-world-reactive", "version": "2.0.0" },
    "derived_from": ["evt-000000042", "evt-000000041"],
    "transform": "reactive-participant-orderflow"
  },
  "payload": {
    "action": "add",
    "levels": [{ "price": "43125.20", "size": "1.100" }],
    "last_update_id": "8731"
  }
}
```

## 4. Equity news

```json
{
  "__example__": "news-equity",
  "event_id": "evt-000000045",
  "venue": "NEWSWIRE",
  "instrument": "AAPL",
  "asset_class": "equity",
  "event_type": "news",
  "event_time": 1717416000000,
  "source_time": 1717415999000,
  "available_time": 1717416001000,
  "ingestion_time": 1717416002500,
  "sequence": 88,
  "provider": "newswire",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "news-adapter", "version": "1.0.3" },
    "derived_from": [],
    "transform": null
  },
  "payload": {
    "headline": "Apple announces on-device AI at WWDC",
    "source": "newswire",
    "symbols": ["AAPL"],
    "url": "https://example.com/apple-wwdc",
    "tags": ["technology", "product"]
  }
}
```

## 5. Option chain mark

```json
{
  "__example__": "option-chain-mark",
  "event_id": "evt-000000046",
  "venue": "CBOE",
  "instrument": "SPX-20240621-5500C",
  "asset_class": "option",
  "event_type": "option_chain_mark",
  "event_time": 1717423200000,
  "source_time": 1717423200000,
  "available_time": 1717423200500,
  "ingestion_time": 1717423201400,
  "sequence": 12,
  "provider": "cboe",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "cboe-adapter", "version": "0.6.0" },
    "derived_from": [],
    "transform": null
  },
  "payload": {
    "underlying": "SPX",
    "expiry": 1718952000000,
    "strike": "5500",
    "right": "call",
    "mark_price": "42.10",
    "implied_vol": "0.13",
    "greeks": { "delta": "0.51", "gamma": "0.0021", "vega": "5.4", "theta": "-1.2" }
  }
}
```

## 6. `other` escape hatch (kind is REQUIRED)

```json
{
  "__example__": "other-funding-rate",
  "event_id": "evt-000000047",
  "venue": "BINANCE",
  "instrument": "BTC-USDT",
  "asset_class": "crypto",
  "event_type": "other",
  "event_time": 1717423200000,
  "source_time": null,
  "available_time": 1717423200000,
  "ingestion_time": 1717423200200,
  "sequence": 1,
  "provider": "binance",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "binance-adapter", "version": "1.4.0" },
    "derived_from": [],
    "transform": null
  },
  "payload": {
    "kind": "funding_rate",
    "data": { "rate": "0.00010000", "interval": "8h", "next_apply": 1717459200000 }
  }
}
```

## 7. Derived-state artifact (feature carrying the availability contract)

Not an event — the timestamp contract every derived artifact (feature,
aggregate, label, cache entry) must carry so the firewall polices it
uniformly. `available_time` = latest input availability (12:00:00.500) +
250 ms aggregation delay. Input ids are opaque strings (cross-lane rule).

```json
{
  "artifact_id": "feat-vwap-1m-120000",
  "available_time": 1717416000750,
  "derived_from": ["evt-000000048", "evt-000000049", "evt-000000050"],
  "computation": {
    "transform_id": "vwap-1m-aggregator",
    "delay": { "milliseconds": 250 }
  },
  "value": "191.0742"
}
```

The `value` field is payload-specific (here a decimal string) and outside the
time contract; the four availability fields above are the contract.

## 8. Trajectory sample and leakage report

A recorded trajectory of (clock, observed) samples — one leaking, one clean:

```json
[
  {
    "clock": {
      "now": 1717416000000,
      "asOf": 1717423200000,
      "playbackSpeed": 1,
      "paused": false,
      "fidelity": "exact_replay",
      "informationPolicy": "point-in-time"
    },
    "observed": [
      { "event_id": "evt-000000051", "available_time": 1717416000000 }
    ],
    "label": "step-1"
  },
  {
    "clock": {
      "now": 1717416001000,
      "asOf": 1717423200000,
      "playbackSpeed": 1,
      "paused": false,
      "fidelity": "exact_replay",
      "informationPolicy": "point-in-time"
    },
    "observed": [
      { "event_id": "evt-000000052", "available_time": 1717416005000 }
    ],
    "label": "step-2"
  }
]
```

`leakageCheck` over this trajectory reports (sample 2 observed an event 4
seconds before its availability):

```json
{
  "clean": false,
  "findings": [
    {
      "kind": "future_observation",
      "sampleIndex": 1,
      "observationIndex": 0,
      "label": "step-2",
      "clockNow": 1717416001000,
      "available_time": 1717416005000,
      "leadMs": 4000
    }
  ],
  "samplesChecked": 2,
  "observationsChecked": 2
}
```

## 9. Rejected envelopes (for adapter authors — these FAIL validation)

```json
{
  "__example__": "rejected-available-before-event",
  "event_id": "evt-000000053",
  "venue": "BINANCE",
  "instrument": "BTC-USDT",
  "asset_class": "crypto",
  "event_type": "trade",
  "event_time": 1717423200000,
  "source_time": null,
  "available_time": 1717423199000,
  "ingestion_time": 1717423200500,
  "sequence": 1,
  "provider": "binance",
  "provenance": {
    "origin": "historical",
    "adapter": { "id": "binance-adapter", "version": "1.4.0" },
    "derived_from": [],
    "transform": null
  },
  "payload": { "price": "43125.10", "size": "0.017", "side": "buy" }
}
```

Rejected with `timestamp_order` at `available_time`: information about an
event cannot be observable before the event occurred. The adapter must clamp
vendor clock skew (`available_time = max(feed_available, event_time)`).

```json
{
  "__example__": "rejected-historical-without-adapter",
  "event_id": "evt-000000054",
  "venue": "BINANCE",
  "instrument": "BTC-USDT",
  "asset_class": "crypto",
  "event_type": "trade",
  "event_time": 1717423200000,
  "source_time": null,
  "available_time": 1717423200100,
  "ingestion_time": 1717423200500,
  "sequence": 1,
  "provider": "binance",
  "provenance": {
    "origin": "historical",
    "adapter": null,
    "derived_from": [],
    "transform": null
  },
  "payload": { "price": "43125.10", "size": "0.017", "side": "buy" }
}
```

Rejected with `provenance_adapter_required`: no orphan history.
