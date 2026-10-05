# @tradrl/marketplace-service

The commercial capability marketplace (Work Order T047): the layer where
capability offerings are **listed, discovered, engaged commercially and
consumed under entitlements**. Together with its contract package
`@tradrl/entitlements` it owns the commercial semantics T045's
capability-provider interface deliberately left opaque.

## What this service is

- **The consideration** (T047's core ownership): the typed commercial
  terms for the opaque JSON slot T045's exchange carries (`consideration`
  on the capability request and the provider terms — "T047 owns the
  semantics"): the closed pricing-model vocabulary (`fixed-fee` |
  `usage-metered`), exact canonical-decimal money, the collect-all
  validator, the exact charge computation (`rate x units`), and the
  negotiation laws — the **budget law** (the provider's counter never
  exceeds the platform's offered budget, in the same commercial language
  and currency) and the **listing-price law** (the counter never exceeds
  the listing's published pricing).
- **The listings**: provider offers published from T045 declarations as
  immutable, versioned, offer-SNAPSHOTTED catalog entries (a later
  declaration supersession never rewrites what was listed) with typed
  pricing, plus the terminal retirement.
- **The discovery**: the point-in-time active-listing fold (L4) with
  deterministic ordering (model, then exact price, then slot) and
  exact-decimal price bounds.
- **The commission**: the T045-shaped capability-request draft minter —
  recorded capability gaps (the T017 language) + the frozen verification
  contract + the offered consideration (the T017 + T045 + T047
  composition; a request with no evidence citation is invented, not
  requested).
- **The purchase** (the engagement lifecycle's commercial half): the
  purchase binding (listing, request, quote) under the agreed
  consideration, the closed lifecycle (`open -> engaged -> settled |
  voided`), and **the settlement — the payment gate**: verified
  engagements charge the tenant's spend allowance through
  `@tradrl/entitlements` (exact decimals; the entitlements lane's typed
  refusals surface here), rejected and withdrawn engagements NEVER
  charge, and verified capability-artifacts mint the artifact-license
  entitlements that license the local L18 import — the license names the
  SAME `cpa:` artifact reference T045's `importAsSkillRecordDraft`
  carries, byte-for-byte.

## Service laws (mirroring the merged sibling services)

- Zero runtime dependencies; `package.json` carries no dependencies.
- Zero workspace imports in src beyond the OWN contract package
  (`packages/entitlements`, imported via a relative source path exactly
  as `services/firm-memory` imports `packages/firm-memory`); every other
  lane (T045, T017, T041) is consumed through STRUCTURAL MIRRORS
  (D-003/D-004) — `src/interop.test.ts` loads the REAL lanes statically
  and pins every mirror member-for-member.
- No ambient clock, no ambient randomness: every operation carries an
  explicit instant; every identity is content-addressed; identical
  inputs mint byte-identical serializations (`src/determinism.test.ts`).
- Tenant isolation on every record (L12): one tenant per marketplace;
  the settlement additionally gates the SUPPLIED entitlements ledger's
  tenant (a foreign ledger can never be billed).
- The append-only, chain-verified per-tenant commercial log
  (`verifyMarketplaceChain`): listings, retirements, purchases and
  settlements are all retained and tamper-evident — no-charge
  settlements included (the commercial accounting truth).
- Money is EXACT: canonical decimal strings + BigInt fixed-point
  arithmetic (never floats, never coerced — a number amount is the typed
  `invalid_decimal`).

## Module map

| Module | Purpose |
|---|---|
| `src/consideration.ts` | The typed commercial terms + the negotiation laws |
| `src/listing.ts` | The listing record (the offer snapshot + pricing) + the retirement |
| `src/state.ts` | The marketplace state + the chain-verified log |
| `src/catalog.ts` | Publish / revise / retire + the point-in-time discovery fold |
| `src/commission.ts` | The T045-shaped capability-request draft minter |
| `src/purchase.ts` | The purchase lifecycle + THE PAYMENT GATE + the license law |
| `src/mirrors.ts` | The T045 + T017 + T041 structural mirrors (D-003/D-004) |
| `src/imports.ts` | The single import surface (the OWN contract package) |
| `src/errors.ts` | The typed error taxonomy |
| `src/fixtures.ts` | Deterministic test/interop fixtures |
