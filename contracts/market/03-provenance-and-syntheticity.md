# 03 — Provenance and Syntheticity

Every event carries a `provenance` block. Provenance is the anti-poisoning
foundation: it makes every event's origin explicit, attributable and — for
anything synthetic — unmistakable.

## The origin trichotomy

| `provenance.origin` | Meaning | Adapter reference | Synthetic? |
|---|---|---|---|
| `historical` | A real-world observation delivered by a provider adapter (live feed, licensed archive, replayed file — files are replayed through an adapter too). | **REQUIRED** (`{ id, version }`, non-null) — no orphan history. | No |
| `simulated` | Produced inside a TradRL Market World: reactive-replay endogenous participants, synthetic order flow. | Optional — may name the producing world component (e.g. `{ id: "market-world-reactive", version: "2.0.0" }`). | **Yes** |
| `generated` | Produced by a generative/counterfactual model. A stress and exploration instrument — NEVER historical truth (L5). | Optional — may name the generator. | **Yes** |

## The syntheticity rule

> An event is synthetic iff `provenance.origin !== 'historical'`.

There is deliberately NO separate boolean flag: a redundant flag could drift
out of sync with the enum. The single derived predicate is
`isSyntheticEvent(event)`. Anything downstream that mixes real and synthetic
worlds (reactive replay is a MIX by construction) must segregate or label on
this predicate — e.g. evaluation (L10: friendly/synthetic replay alone never
releases a strategy) and reporting ("this outcome came from a generative
world").

An event with origin `simulated` or `generated` is synthetic EVEN IF it
carries an adapter-style producer reference — the origin field is the sole
authority.

## Lineage (derived events)

Derived events — aggregated bars built by TradRL, features emitted as events,
simulated trades triggered by an agent — reference their parents:

| Field | Type | Required | Semantics |
|---|---|---|---|
| `derived_from` | `string[]` | yes (empty array for primitive observations) | Ids of the parent events/artifacts. The lineage chain. |
| `transform` | string \| null | yes | REQUIRED non-empty iff `derived_from` is non-empty: the transform identity (e.g. `vwap-1m-aggregator`). Must be `null` when there is no lineage. |

Rules enforced by the guard:

- **No self-reference** — an event may not appear in its own lineage (`provenance_self_reference`).
- **No duplicates** — lineage is a set (`provenance_duplicate_parent`).
- **No orphan transforms** — `transform` without `derived_from` is rejected (`provenance_transform_without_parents`).
- **No anonymous derivations** — `derived_from` without `transform` is rejected (`provenance_transform_required`).

Derived events get their OWN `event_id`; the chain is reconstructable by
walking `derived_from` through the event store. Derived events must also obey
the availability rule for derived state (doc 04): their `available_time` must
not precede their latest input's availability.

## Adapter references

`provenance.adapter = { id, version } | null`:

- `id`: the adapter identity (e.g. `binance-adapter`, `replay-file-adapter`, `feature-adapter`).
- `version`: the adapter version that produced the event — lineage for
  reproducibility (L9: results bind code versions).

Historical events MUST carry one. Simulated/generated events MAY carry one to
name the producing component. Adapters preserve entitlement constraints of the
underlying provider (spec/ADAPTERS.md); licensed data remains access-controlled
and is never copied contrary to provider terms.
