/**
 * @tradrl/adapter-oms-ems — documented subscription request construction.
 *
 * The SDK's neutrality contract pins HOW requests travel: the session
 * passes the raw subscription request through the transport UNMANGLED
 * (contract case: "the raw subscription request passes through
 * unmangled"). Therefore the CONSTRUCTION lives here, as pure exported
 * helpers: callers build the gateway's documented state-stream
 * registration frame and the matching canonical SubscriptionSpec, and the
 * session carries both verbatim.
 *
 * The documented shapes (the OMS/EMS gateway's public session API):
 *   - streams: the channel names themselves ("orderState" — the gateway
 *     pushes documented ORDER_STATE records for the subscribing
 *     session's tenant scope);
 *   - subjects: the gateway documents state-stream subjects in the
 *     canonical uppercase instrument form ("BTC-USDT") — the identity
 *     translation is validated HERE (provider vocabulary translation
 *     lives in the adapter, never in the canonical events);
 *   - the SUBSCRIBE frame: `{ action: "SUBSCRIBE", stream: <stream>,
 *     subject: <subject> }`.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { OMS_EMS_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { OMS_EMS_CHANNEL_TABLE_IDS } from './mapping-tables';
import { OMS_EMS_VENUE } from './descriptor';

/** The adapter's raw channel ids (the gateway's documented message kinds). */
export type OmsEmsChannel = 'routingInstruction' | 'orderState';

/**
 * Translate a canonical instrument id into the documented state-stream
 * subject. Total: the input must be the canonical uppercase form
 * (uppercase alphanumeric parts joined by single dashes) — the gateway
 * documents subjects in exactly that form.
 */
export function omsEmsStateSubject(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not a canonical subject form (uppercase alphanumeric parts joined by single dashes, e.g. "BTC-USDT")`,
      ),
    );
  }
  return success(instrument);
}

/** Build the documented state-stream SUBSCRIBE frame for one subject. */
export function omsEmsSubscribeRequest(subject: string): SdkResult<JsonObject> {
  if (!isNonEmptyString(subject)) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE subject must be a non-empty state-stream subject'));
  }
  return success({ action: 'SUBSCRIBE', stream: 'orderState', subject });
}

/**
 * Build a complete canonical subscription for the OMS/EMS gateway's
 * order-state stream over one declared instrument: the documented
 * subject, the documented SUBSCRIBE frame, and the canonical stream
 * identity (venue, instrument, asset class, mapping table). The
 * instrument must be declared in the source descriptor's universes
 * (declared-capability envelope).
 */
export function omsEmsOrderStateSubscription(args: {
  readonly instrument: InstrumentId;
}): SdkResult<SubscriptionSpec> {
  const subject = omsEmsStateSubject(args.instrument);
  if (!subject.ok) return subject;
  const request = omsEmsSubscribeRequest(subject.value);
  if (!request.ok) return request;
  if (!isDeclaredInstrument(OMS_EMS_SOURCE_DESCRIPTOR, args.instrument, 'crypto')) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the OMS/EMS source descriptor's crypto symbol universes`,
      ),
    );
  }
  return success({
    channel: 'orderState',
    request: request.value,
    venue: OMS_EMS_VENUE,
    instrument: args.instrument,
    asset_class: 'crypto',
    mapping_table_id: OMS_EMS_CHANNEL_TABLE_IDS['orderState'],
  });
}
