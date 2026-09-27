# 02 — Event Type Taxonomy and Typed Payloads

`event_type` is the discriminant of the `MarketEvent` union: it selects both
the payload TYPE (compile time) and the payload VALIDATOR (runtime) from the
payload registry (`payloadRegistry`). The mapping is compiler-enforced — a
taxonomy entry without a registered validator cannot typecheck.

## Taxonomy

| `event_type` | Meaning | Payload |
|---|---|---|
| `trade` | One executed trade print | `TradePayload` |
| `quote` | Top-of-book bid/ask quotation | `QuotePayload` |
| `book_snapshot` | Full visible order-book state (replaces prior state) | `BookSnapshotPayload` |
| `book_delta` | Incremental order-book change | `BookDeltaPayload` |
| `ohlcv` | Candlestick/bar over a fixed interval | `OhlcvPayload` |
| `news` | News item | `NewsPayload` |
| `macro_release` | Scheduled macroeconomic release | `MacroReleasePayload` |
| `social_signal` | Social/alternative platform signal | `SocialSignalPayload` |
| `fundamental` | Reported fundamental datum | `FundamentalPayload` |
| `option_chain_mark` | Derivative/option mark (one option per event; a chain is a series) | `OptionChainMarkPayload` |
| `other` | Escape hatch — REQUIRES a free-form `kind` | `OtherPayload` |

## Numeric representation

All prices, sizes and quantities are **decimal strings** (`"43125.10"`), never
JSON numbers: binary floating point cannot represent exchange ticks exactly.
Forms: unsigned `/^\d+(\.\d+)?$/` and signed `/^[+-]?\d+(\.\d+)?$/` for
quantities that may be negative (greeks, sentiment). Comparisons are exact
(lexical), never float-mediated.

## Payload field tables

### TradePayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `price` | positive decimal string | yes | execution price |
| `size` | positive decimal string | yes | executed quantity |
| `side` | `buy` \| `sell` | yes | aggressor side |
| `trade_id` | string | no | venue trade id |

### QuotePayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `bid_price`, `bid_size`, `ask_price`, `ask_size` | positive decimal strings | yes | top of book |

`bid < ask` is NOT enforced: crossed/locked quotes are microstructure facts,
not protocol violations. Adapters normalize; book builders handle.

### BookLevel (shared)
| Field | Type | Notes |
|---|---|---|
| `price` | positive decimal string | |
| `size` | decimal string | absolute quantity at the price |

### BookSnapshotPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `bids`, `asks` | `BookLevel[]` | yes | full sides; may be empty; level sizes must be > 0 |
| `depth` | integer ≥ 0 | no | levels the venue exposes |
| `last_update_id` | string | no | book-state continuity token |

Level ordering (bids descending, asks ascending) is NOT enforced — vendors
differ; the world engine sorts.

### BookDeltaPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | `add` \| `update` \| `remove` \| `clear` | yes | `clear` empties the whole book |
| `levels` | `BookLevel[]` | yes | `add`/`update`: non-empty, size > 0. `remove`: non-empty, size ≥ 0 (`0` = delete-by-price). `clear`: MUST be empty |
| `last_update_id` | string | no | book-state continuity token |

### OhlcvPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `interval` | `/^\d+[smhdwM]$/` | yes | e.g. `1m`, `5s`, `1h`, `1d` (`M` = month) |
| `open`, `high`, `low`, `close` | positive decimal strings | yes | cross-field consistency ENFORCED: `high >= max(open, close)`, `low <= min(open, close)`, `high >= low` |
| `volume` | decimal string ≥ 0 | yes | zero-volume bars are legitimate |
| `closed` | boolean | no | bar finalized? |
| `trade_count` | integer ≥ 0 | no | |

### NewsPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `headline` | string (non-empty) | yes | |
| `body` | string | no | |
| `source` | string | no | editorial label (e.g. `reuters`) |
| `symbols` | string[] | yes | related instruments; may be empty |
| `url` | `http(s)://…` string | no | |
| `tags` | string[] | no | |

Content is UNTRUSTED INPUT by the security model (spec/SECURITY.md) — data, never instructions.

### MacroReleasePayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `indicator` | string | yes | e.g. `US_CPI_YOY` |
| `region` | string | yes | e.g. `US` |
| `period` | string | yes | e.g. `2024-05` |
| `actual` | string | yes | free-form (`3.3`, `+0.4%`, `N/A`) |
| `forecast`, `prior`, `unit` | string | no | |

### SocialSignalPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | e.g. `x`, `reddit` |
| `metric` | string | yes | e.g. `mention_count`, `sentiment_score` |
| `value` | signed decimal string | yes | sentiment may be negative |
| `author`, `url` | string | no | |

### FundamentalPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `field` | string | yes | e.g. `EPS_DILUTED` |
| `period` | string | yes | e.g. `2024-Q2` |
| `value` | string | yes | free-form (`1.23`, `6.7B`, `N/A`) |
| `unit`, `source` | string | no | |

### OptionChainMarkPayload
| Field | Type | Required | Notes |
|---|---|---|---|
| `underlying` | string | yes | e.g. `SPX` |
| `expiry` | `TimestampMs` | yes | expiration instant |
| `strike` | positive decimal string | yes | |
| `right` | `call` \| `put` | yes | |
| `mark_price` | positive decimal string | yes | |
| `implied_vol` | positive decimal string | no | |
| `greeks` | `{ delta?, gamma?, vega?, theta? }` | no | each a signed decimal string |

### OtherPayload (the escape hatch)
| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | string (non-empty) | **YES** | the escape hatch MUST name its sub-type (e.g. `liquidation`, `funding_rate`) |
| `data` | JSON object | yes | closed JSON model (finite numbers, no `undefined`); may be empty |

`other` events are scoped as their own sequence stream per `kind`:
`sequenceStream(event) === "other:" + payload.kind`.

## Sequence streams

The sequence discipline (doc 01, law 9) is scoped per
`(venue, instrument, stream)` where the stream is:

- the `event_type` for the ten canonical types;
- `other:<kind>` for escape-hatch events — two different `other` kinds on the
  same venue+instrument are INDEPENDENT streams.

Sequence numbers must be strictly increasing in arrival order per stream:
equal = duplicate, lower = regression. Gaps are permitted.
