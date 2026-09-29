/**
 * @tradrl/adapter-oms-ems — the execution-access entitlement declaration.
 *
 * Work Order law (the T039 discipline): "Entitlement: ... is DECLARED as
 * an entitlement record (opaque ref ...); undeclared emission is a typed
 * error." spec/ADAPTERS.md (Licensing): "Commercially licensed data
 * remains access-controlled and is not copied into artifacts contrary to
 * provider terms", and "Adapters preserve provenance and entitlement
 * constraints."
 *
 * Like the broker lane, the OMS/EMS gateway's order-state stream is
 * TENANT-SCOPED, access-controlled data: it exists only under the OMS
 * tenant's own order-management terms (L12 — tenant isolation). The
 * declaration records exactly that — access class `restricted`, opaque
 * constraint refs, an opaque terms ref — while the package itself ships
 * NO credentials and NO tenant-specific data (every fixture value in the
 * tests is synthetic). Every emitted record carries the entitlement ref
 * verbatim (L9 self-describing records), and emission with NO declared
 * envelope is a typed EntitlementError (there is no code path that emits
 * an entitlement-less record).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

const declaration: EntitlementEnvelope = {
  entitlement_id: 'ent-oms-ems-order-state-restricted',
  access_class: 'restricted',
  constraints: ['order-session-access', 'tenant-scoped-order-data', 'tenant-isolated-no-redistribution'],
  terms_ref: 'oms-ems-order-session-terms',
};

const errors = validateEntitlementEnvelope(declaration);
if (errors.length > 0) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`OMS_EMS_ENTITLEMENT is invalid: ${errors.map((error) => error.message).join('; ')}`);
}

/** The declared, deep-frozen restricted order-state entitlement of the OMS/EMS adapter. */
export const OMS_EMS_ENTITLEMENT: EntitlementEnvelope = deepFreeze(declaration) as EntitlementEnvelope;
