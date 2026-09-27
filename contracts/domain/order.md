# Order

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`order.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md`, L13/L14, L16, R23.

An Order is the canonical **order-intent** record: what the strategic plane
asks the execution plane to do. Side, kind, time-in-force, quantity, prices,
instrument + venue reference and a client order id for idempotency.
**Execution semantics do NOT live here** — lifecycle status, acks, partial
fills and rejections belong to the exchange simulation (T010) and execution
lanes (T019/T040). This record is the intent those lanes receive, enforce
against and audit.

## Order

| Field | Type | Required | Semantics |
|---|---|---|---|
| `clientOrderId` | `string` | yes | Caller-assigned idempotency key. Unique within the issuing project scope (store-enforced). |
| `instrumentId` | `InstrumentId` | yes | Instrument to trade. |
| `venueId` | `VenueId` | yes | Venue to route to. |
| `side` | `'buy' \| 'sell'` | yes | Direction. |
| `kind` | `OrderKind` | yes | Core kind or registered extension (below). |
| `quantity` | `DecimalString` | yes | Order quantity in instrument units. Strictly positive. |
| `price` | `DecimalString` | no | Limit price. Strictly positive when present. Matrix-enforced per kind. |
| `stopPrice` | `DecimalString` | no | Trigger price. Strictly positive when present. Matrix-enforced per kind. |
| `timeInForce` | `TimeInForce` | yes | Core value or registered extension (below). |
| `expiresAt` | `Timestamp` | no | Expiry instant. Required for `gtt`; rejected for other core values. |
| `createdAt` | `Timestamp` | yes | Intent-creation instant (point-in-time audit, L4). |
| `notes` | `string` | no | Free-form annotation for humans/audit. Never interpreted. |

### OrderSide (closed)

`buy` · `sell`

### OrderKind (open vocabulary, core published here)

Core: `market` · `limit` · `stop` · `stop-limit`.
**Price/stop-price matrix for core kinds** (guard-enforced):

| Kind | `price` | `stopPrice` |
|---|---|---|
| `market` | must be absent | must be absent |
| `limit` | required | must be absent |
| `stop` | must be absent | required |
| `stop-limit` | required | required |

**Registration:** extension kinds (e.g. `iceberg`) may be registered in this
document by later Work Orders; for extension kinds the guard enforces no
price matrix and consumers MUST NOT assume one. Unregistered values are
tolerated structurally but carry no semantics.

### TimeInForce (open vocabulary, core published here)

Core: `day` · `gtc` · `ioc` · `fok` · `gtt`.

| Value | `expiresAt` |
|---|---|
| `gtt` | required |
| `day`, `gtc`, `ioc`, `fok` | must be absent |
| extension values | optional (semantics defined at registration) |

## Invariants

1. `quantity > 0`, `price > 0` and `stopPrice > 0` when present (canonical
   decimals).
2. The core-kind price matrix and the TIF/expiry matrix above are
   guard-enforced.
3. `instrumentId`/`venueId` resolve to reference records
   (market-reference.md) — the store and execution gateway must verify the
   venue actually lists the instrument.
4. **No execution semantics**: there is deliberately no `status`, no fill
   and no account field on this record. Order lifecycle is owned by T010/
   T019/T040; conflating intent with execution here would break L16
   separation and shadow/live separation (R23).

## Versioning rules

- The Order record is immutable once submitted: amendments are modeled by
  the execution plane as cancel + new intent (`order.modify` permission
  governs whether that is allowed at the project level).
- The core-kind matrix is part of the contract: changing a cell is a
  **contract version bump**. New core kinds are added with their matrix row
  in the same release.
- Extension registration must specify price/TIF matrix treatment and venue
  capability advertisement (`VenueCapabilities.orderKinds`).

## JSON example (machine-validated)

```json
{
  "clientOrderId": "prj_1-co-0001",
  "instrumentId": "instr_btc_usdt",
  "venueId": "venue_binance",
  "side": "buy",
  "kind": "limit",
  "quantity": "0.5",
  "price": "42000.01",
  "timeInForce": "gtc",
  "createdAt": "2027-01-15T09:30:00.250Z",
  "notes": "Entry tranche 1 of 3."
}
```
