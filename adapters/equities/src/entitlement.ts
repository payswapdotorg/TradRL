/**
 * @tradrl/adapter-equities — the licensed-data entitlement declaration
 * (FULL STRICTNESS).
 *
 * Work Order T038: "entitlement envelope at FULL strictness (licensed-data
 * refs with terms)", and the law: "Entitlement: ... undeclared emission is
 * a typed error." spec/ADAPTERS.md (Licensing): "Commercially licensed
 * data remains access-controlled and is not copied into artifacts
 * contrary to provider terms", and "Adapters preserve provenance and
 * entitlement constraints."
 *
 * THIS ADAPTER IS THE LICENSING LAW'S HARDEST CASE: the equities/index
 * reference data of spec/ADAPTERS.md is "licensed S&P/index data". The
 * feed this adapter models is a COMMERCIALLY LICENSED index data source:
 *
 *   - the entitlement is access_class RESTRICTED — licensed index data is
 *     access-controlled by definition (there is no public tier in this
 *     adapter's declared channels; every documented record kind is a
 *     licensed product);
 *   - the constraints are OPAQUE refs to the licensing regime
 *     (licensed redistribution controls, professional-user tier) — the
 *     SDK never interprets them, it carries them (L2 substrate
 *     neutrality: vendor licensing regimes differ);
 *   - the terms_ref points at the full license terms document;
 *   - licensed CONTENT is never embedded: every fixture value in this
 *     package is synthetic (opaque TEST-* identifiers, synthetic levels
 *     and weights) — the data is referenced by opaque refs, never copied
 *     contrary to provider terms.
 *
 * Every emitted record carries the entitlement ref verbatim (L9
 * self-describing records), and emission with NO declared envelope is a
 * typed EntitlementError (there is no code path that emits an
 * entitlement-less record).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

const declaration: EntitlementEnvelope = {
  entitlement_id: 'ent-equities-index-licensed',
  access_class: 'restricted',
  constraints: ['licensed-index-data', 'licensed-redistribution-controls', 'professional-user-tier'],
  terms_ref: 'licensed-index-a-terms',
};

const errors = validateEntitlementEnvelope(declaration);
if (errors.length > 0) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`EQUITIES_ENTITLEMENT is invalid: ${errors.map((error) => error.message).join('; ')}`);
}

/** The declared, deep-frozen licensed-data entitlement of the equities/index adapter (full strictness). */
export const EQUITIES_ENTITLEMENT: EntitlementEnvelope = deepFreeze(declaration) as EntitlementEnvelope;
