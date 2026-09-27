# Market Reference — Venue and Instrument

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`venue.ts`, `instrument.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md`, `spec/ADAPTERS.md`, L13/L14.

Venue and Instrument are the canonical, provider-neutral **reference data**
of the trading domain. Vendor-specific symbology, venue flags and entitlement
quirks live in adapters — every adapter must resolve its vendor world into
these records. (Market *events* and the *time protocol* are T004's lane;
these records are the static reference dimension.)

## Venue

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `VenueId` | yes | Opaque identity. |
| `name` | `string` | yes | Human name. |
| `description` | `string` | no | Human context. |
| `assetClasses` | `readonly AssetClass[]` | yes | Non-empty, no duplicates. |
| `capabilities` | `VenueCapabilities` | yes | Order-entry capability statement (below). |

### VenueCapabilities

| Field | Type | Required | Semantics |
|---|---|---|---|
| `orderKinds` | `readonly OrderKind[]` | yes | Order kinds accepted (core + registered extensions). Non-empty, no duplicates. |
| `timeInForce` | `readonly TimeInForce[]` | yes | Time-in-force values honored. Non-empty, no duplicates. |
| `supportsShort` | `boolean` | no | Whether short selling is supported. |
| `supportsMargin` | `boolean` | no | Whether margin trading is supported. |

Capabilities are **declarations used for validation and routing** — they are
not execution semantics. Live enforcement (venue permissions, limits) is the
execution gateway's job (T040).

### AssetClass (closed vocabulary)

`crypto` · `equity` · `index` · `future` · `option` · `fx` · `commodity` · `bond`

## Instrument

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `InstrumentId` | yes | Opaque identity. |
| `symbol` | `string` | yes | Canonical TradRL symbol (e.g. `BTC-USDT`, `AAPL`). Vendor symbology translation is adapter work. |
| `name` | `string` | no | Human name. |
| `assetClass` | `AssetClass` | yes | Single class from the closed vocabulary. |
| `venueIds` | `readonly VenueId[]` | yes | Venues where the instrument trades. Non-empty, no duplicates. |
| `tickSize` | `DecimalString` | no | Minimum price increment. Strictly positive when present. |
| `lotSize` | `DecimalString` | no | Minimum quantity increment (lot step). Strictly positive when present. |
| `contractSize` | `DecimalString` | no | Units per contract (derivatives). Strictly positive when present. |
| `baseAsset` | `string` | no | Base asset symbol for pair instruments (fx/crypto). |
| `quoteAsset` | `string` | no | Quote (counter) asset symbol. |
| `expiresAt` | `Timestamp` | no | Expiry for derivative instruments. |

## Invariants

1. A Venue declares at least one asset class; an Instrument lists at least
   one venue; both lists are duplicate-free.
2. Tick/lot/contract conventions are strictly positive canonical decimals
   where present; their absence means "not applicable" (e.g. an index), not
   "zero".
3. Pair fields (`baseAsset`/`quoteAsset`) are optional but must be non-empty
   when present; pair semantics (which classes are pairs) are producer
   discipline, not guard-enforced.
4. **Documented obligation:** every `VenueId` in `Instrument.venueIds`
   resolves to a Venue whose `assetClasses` includes the instrument's class
   — the reference-data store (ingestion lane, T008) must maintain this.

## Versioning rules

- Reference records are replaced, not mutated: a symbol re-denomination or
  tick change is a **new Instrument record** (new id), with the store
  keeping the mapping history for point-in-time correctness (L4 applies to
  reference data too).
- Venue capability changes are likewise new Venue records; adapters
  re-synchronize and the store versions the timeline.
- The `AssetClass` vocabulary is closed: extensions are a contract version
  bump recorded in this document.

## JSON examples (machine-validated)

A crypto spot venue:

```json
{
  "id": "venue_binance",
  "name": "Binance (reference venue record)",
  "description": "Crypto spot venue record for canonical reference.",
  "assetClasses": ["crypto"],
  "capabilities": {
    "orderKinds": ["market", "limit", "stop-limit"],
    "timeInForce": ["gtc", "ioc", "fok"],
    "supportsShort": false,
    "supportsMargin": true
  }
}
```

A crypto pair instrument with microstructure conventions:

```json
{
  "id": "instr_btc_usdt",
  "symbol": "BTC-USDT",
  "name": "Bitcoin / Tether",
  "assetClass": "crypto",
  "venueIds": ["venue_binance", "venue_coinbase"],
  "tickSize": "0.01",
  "lotSize": "0.00001",
  "baseAsset": "BTC",
  "quoteAsset": "USDT"
}
```
