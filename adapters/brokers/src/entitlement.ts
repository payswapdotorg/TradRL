/**
 * @tradrl/adapter-brokers — the execution-access entitlement declaration.
 *
 * Work Order law (the T039 discipline): "Entitlement: ... is DECLARED as
 * an entitlement record (opaque ref ...); undeclared emission is a typed
 * error." spec/ADAPTERS.md (Licensing): "Commercially licensed data
 * remains access-controlled and is not copied into artifacts contrary to
 * provider terms", and "Adapters preserve provenance and entitlement
 * constraints."
 *
 * Unlike the public market-data lanes (T037/T038), the broker gateway's
 * execution-report stream is ACCOUNT-SCOPED, access-controlled data: it
 * exists only under the venue's execution-API terms, per account. The
 * declaration records exactly that — access class `restricted`, opaque
 * constraint refs, an opaque terms ref — while the package itself ships
 * NO credentials and NO account-specific data (the credential-opacity
 * law; every fixture value in the tests is synthetic). Every emitted
 * record carries the entitlement ref verbatim (L9 self-describing
 * records), and emission with NO declared envelope is a typed
 * EntitlementError (there is no code path that emits an
 * entitlement-less record).
 */

import { validateEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import { deepFreeze } from './contract/freeze';

const declaration: EntitlementEnvelope = {
  entitlement_id: 'ent-broker-execution-restricted',
  access_class: 'restricted',
  constraints: ['execution-api-access', 'account-scoped-order-data', 'tenant-isolated-no-redistribution'],
  terms_ref: 'broker-execution-api-terms',
};

const errors = validateEntitlementEnvelope(declaration);
if (errors.length > 0) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`BROKER_ENTITLEMENT is invalid: ${errors.map((error) => error.message).join('; ')}`);
}

/** The declared, deep-frozen restricted execution-data entitlement of the broker gateway adapter. */
export const BROKER_ENTITLEMENT: EntitlementEnvelope = deepFreeze(declaration) as EntitlementEnvelope;
