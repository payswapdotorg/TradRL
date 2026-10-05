/**
 * @tradrl/adapter-arena — the declared entitlement tiers.
 *
 * spec/ADAPTERS.md (Licensing): "Commercially licensed data remains
 * access-controlled and is not copied into artifacts contrary to
 * provider terms." The Arena expertise tiers: the ENGAGEMENT tier
 * (restricted — contracted human expertise; the terms ref carries the
 * provider agreement) and the DECLARED-CATALOG tier (public — the
 * published capability catalog itself carries no licensed content).
 * The default declaration the session emits under is the ENGAGEMENT
 * tier (the primary product); emission without ANY declared envelope
 * is the typed refusal path (the engine has no code path that emits an
 * entitlement-less record).
 */

import { isEntitlementEnvelope, validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

/** Declare (validate + deep-freeze) one entitlement envelope — our own declarations fail loudly. */
function declareEntitlement(value: EntitlementEnvelope): EntitlementEnvelope {
  const errors = validateEntitlementEnvelope(value);
  if (errors.length > 0) {
    throw new Error(`the arena entitlement declaration is invalid: ${errors.map((error) => error.message).join('; ')}`);
  }
  return deepFreeze(value) as EntitlementEnvelope;
}

/**
 * The ENGAGEMENT tier: contracted human expertise (restricted). The
 * constraints are opaque refs — the terms live in the referenced
 * agreement, never in this package (no licensed content is embedded).
 */
export const ARENA_ENGAGEMENT_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-arena-engagement',
  access_class: 'restricted',
  constraints: ['arena-engagement-terms', 'arena-tier-1'],
  terms_ref: 'arena-engagement-terms-v1',
});

/**
 * The DECLARED-CATALOG tier: the published capability catalog (public —
 * synthetic opaque refs; the catalog carries no licensed content).
 */
export const ARENA_CATALOG_ENTITLEMENT: EntitlementEnvelope = declareEntitlement({
  entitlement_id: 'ent-arena-catalog',
  access_class: 'public',
  constraints: [],
  terms_ref: null,
});

/** The default declaration the session emits under (the primary product: contracted expertise). */
export const ARENA_ENTITLEMENT: EntitlementEnvelope = ARENA_ENGAGEMENT_ENTITLEMENT;

/** Re-export the guard for tests. */
export { isEntitlementEnvelope };
