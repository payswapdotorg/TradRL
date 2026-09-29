/**
 * @tradrl/adapter-coinbase — the public market-data entitlement declaration.
 *
 * Work Order T037: "Entitlement: public market data is DECLARED as an
 * entitlement record (opaque ref with public-data terms); undeclared
 * emission is a typed error." spec/ADAPTERS.md (Licensing): "Commercially
 * licensed data remains access-controlled and is not copied into
 * artifacts contrary to provider terms", and "Adapters preserve
 * provenance and entitlement constraints."
 *
 * The Coinbase Exchange market-data channels this adapter consumes are
 * PUBLIC endpoints of the provider's documented API — no account, no
 * authenticated entitlement, no licensed redistribution feed (the adapter
 * ships NO credentials and NO account-specific data by law). The
 * declaration records exactly that, with opaque constraint refs pointing
 * at the provider's public terms; every emitted record carries the
 * entitlement ref verbatim (L9 self-describing records), and emission
 * with NO declared envelope is a typed EntitlementError (there is no code
 * path that emits an entitlement-less record).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

const declaration: EntitlementEnvelope = {
  entitlement_id: 'ent-coinbase-spot-public',
  access_class: 'public',
  constraints: ['public-market-data', 'verify-provider-terms-before-redistribution'],
  terms_ref: 'coinbase-api-terms',
};

const errors = validateEntitlementEnvelope(declaration);
if (errors.length > 0) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`COINBASE_ENTITLEMENT is invalid: ${errors.map((error) => error.message).join('; ')}`);
}

/** The declared, deep-frozen public market-data entitlement of the Coinbase spot adapter. */
export const COINBASE_ENTITLEMENT: EntitlementEnvelope = deepFreeze(declaration) as EntitlementEnvelope;
