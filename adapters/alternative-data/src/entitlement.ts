/**
 * @tradrl/adapter-alternative-data — the entitlement declarations
 * (public + vendor-licensed tiers, as opaque refs).
 *
 * Work Order T038 (scope): "entitlement (vendor-licensed tiers)"; the
 * law: "Entitlement: public market data is DECLARED as an entitlement
 * record (opaque ref with public-data terms); undeclared emission is a
 * typed error." spec/ADAPTERS.md (Licensing): "Commercially licensed
 * data remains access-controlled and is not copied into artifacts
 * contrary to provider terms", and "Adapters preserve provenance and
 * entitlement constraints."
 *
 * TWO TIERS are declared, matching the alternative-data landscape:
 *
 *   - the PUBLIC tier: the vendor's open series (open alt series —
 *     public on-chain and open research series; access_class public,
 *     attribution-required constraint) — the alt-domain instance of the
 *     "public market data is DECLARED as an entitlement record" law;
 *   - the VENDOR-LICENSED tier (the DEFAULT): the licensed series
 *     (sentiment, economic and satellite series; access_class
 *     restricted, vendor licensing constraint refs carrying the tier
 *     and redistribution terms, plus a full terms ref).
 *
 * The constraints and terms refs are OPAQUE strings: the SDK never
 * interprets them, it carries them (L2 substrate neutrality). Every
 * emitted record carries its entitlement ref verbatim (L9
 * self-describing records), and emission with NO declared envelope is a
 * typed EntitlementError (there is no code path that emits an
 * entitlement-less record). Vendor-licensed series CONTENT is never
 * embedded in this package's fixtures (synthetic observations on
 * opaque TEST-* identifiers).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

/** Declare (validate + deep-freeze) one entitlement — our own declarations fail loudly. */
function declareEntitlement(value: EntitlementEnvelope): EntitlementEnvelope {
  const errors = validateEntitlementEnvelope(value);
  if (errors.length > 0) {
    throw new Error(`the alternative-data entitlement declaration is invalid: ${errors.map((error) => error.message).join('; ')}`);
  }
  return deepFreeze(value) as EntitlementEnvelope;
}

/** The declared public tier: the vendor's open alt series. */
export const ALTDATA_PUBLIC_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-altdata-open-series',
  access_class: 'public',
  constraints: ['open-alt-series', 'attribution-required'],
  terms_ref: 'alt-vendor-a-open-terms',
});

/** The declared vendor-licensed tier: the licensed observation series. */
export const ALTDATA_VENDOR_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-altdata-vendor-licensed',
  access_class: 'restricted',
  constraints: ['vendor-licensed-data', 'tier-professional', 'no-redistribution'],
  terms_ref: 'alt-vendor-a-licensed-terms',
});

/**
 * The adapter's DEFAULT entitlement declaration: the vendor-licensed
 * tier (the primary product). Runtime hosts serving the public tier
 * declare {@link ALTDATA_PUBLIC_ENTITLEMENT} instead — the session
 * factory accepts any declared envelope.
 */
export const ALTDATA_ENTITLEMENT: EntitlementEnvelope = ALTDATA_VENDOR_ENTITLEMENT;
