/**
 * @tradrl/adapter-news — the entitlement declarations (public + wire
 * service tiers, as opaque refs).
 *
 * Work Order T038 (scope): "entitlement (public + wire-service tiers as
 * opaque refs)"; the law: "Entitlement: public market data is DECLARED
 * as an entitlement record (opaque ref with public-data terms);
 * undeclared emission is a typed error." spec/ADAPTERS.md (Licensing):
 * "Commercially licensed data remains access-controlled and is not
 * copied into artifacts contrary to provider terms", and "Adapters
 * preserve provenance and entitlement constraints."
 *
 * TWO TIERS are declared, matching the two documented channels:
 *
 *   - the PUBLIC tier: the publicHeadlines channel's headline metadata
 *     (access_class public, public-data terms constraint refs) — the
 *     news-domain instance of the "public market data is DECLARED as an
 *     entitlement record" law;
 *   - the WIRE SERVICE tier: the licensedWire channel's full wire items
 *     (access_class restricted, licensed wire-service constraint refs
 *     and a full terms ref). This is the adapter's DEFAULT declaration
 *     — the primary product is the licensed wire.
 *
 * The constraints and terms refs are OPAQUE strings: the SDK never
 * interprets them, it carries them (L2 substrate neutrality). Every
 * emitted record carries its entitlement ref verbatim (L9
 * self-describing records), and emission with NO declared envelope is a
 * typed EntitlementError (there is no code path that emits an
 * entitlement-less record). Licensed wire CONTENT is never embedded in
 * this package's fixtures beyond documented public metadata (synthetic
 * headlines, bodies and urls on opaque TEST-* tickers).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

/** Declare (validate + deep-freeze) one entitlement — our own declarations fail loudly. */
function declareEntitlement(value: EntitlementEnvelope): EntitlementEnvelope {
  const errors = validateEntitlementEnvelope(value);
  if (errors.length > 0) {
    throw new Error(`the news entitlement declaration is invalid: ${errors.map((error) => error.message).join('; ')}`);
  }
  return deepFreeze(value) as EntitlementEnvelope;
}

/** The declared public tier: the publicHeadlines channel's headline metadata. */
export const NEWS_PUBLIC_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-news-public-headlines',
  access_class: 'public',
  constraints: ['public-headline-metadata', 'verify-provider-terms-before-redistribution'],
  terms_ref: 'news-wire-a-public-terms',
});

/** The declared wire-service tier: the licensedWire channel's full wire items. */
export const NEWS_WIRE_SERVICE_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-news-licensed-wire',
  access_class: 'restricted',
  constraints: ['licensed-wire-service', 'wire-tier-1', 'no-redistribution-without-license'],
  terms_ref: 'news-wire-a-wire-terms',
});

/**
 * The adapter's DEFAULT entitlement declaration: the licensed
 * wire-service tier (the primary product). Runtime hosts serving the
 * public tier declare {@link NEWS_PUBLIC_ENTITLEMENT} instead — the
 * session factory accepts any declared envelope.
 */
export const NEWS_ENTITLEMENT: EntitlementEnvelope = NEWS_WIRE_SERVICE_ENTITLEMENT;
