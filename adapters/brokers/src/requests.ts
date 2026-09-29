/**
 * @tradrl/adapter-brokers — documented subscription request construction.
 *
 * The SDK's neutrality contract pins HOW requests travel: the session
 * passes the raw subscription request through the transport UNMANGLED
 * (contract case: "the raw subscription request passes through
 * unmangled"). Therefore the CONSTRUCTION lives here, as pure exported
 * helpers: callers build the gateway's documented report-stream
 * registration frame and the matching canonical SubscriptionSpec, and the
 * session carries both verbatim.
 *
 * The documented shapes (the broker gateway's public session API):
 *   - streams: the channel names themselves ("executionReport" — the
 *     gateway pushes documented ExecutionReport messages for the
 *     subscribing session's account scope);
 *   - subjects: the gateway documents report-stream subjects in the
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
import { BROKER_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { BROKER_CHANNEL_TABLE_IDS } from './mapping-tables';
import { BROKER_VENUE } from './descriptor';

/** The adapter's raw channel ids (the gateway's documented message kinds). */
export type BrokerChannel = 'newOrderSingle' | 'executionReport';

/**
 * Translate a canonical instrument id into the documented report-stream
 * subject. Total: the input must be the canonical uppercase form
 * (uppercase alphanumeric parts joined by single dashes) — the gateway
 * documents subjects in exactly that form.
 */
export function brokerReportSubject(instrument: InstrumentId): SdkResult<string> {
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

/** Build the documented report-stream SUBSCRIBE frame for one subject. */
export function brokerSubscribeRequest(subject: string): SdkResult<JsonObject> {
  if (!isNonEmptyString(subject)) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE subject must be a non-empty report-stream subject'));
  }
  return success({ action: 'SUBSCRIBE', stream: 'executionReport', subject });
}

/**
 * Build a complete canonical subscription for the broker gateway's
 * execution-report stream over one declared instrument: the documented
 * subject, the documented SUBSCRIBE frame, and the canonical stream
 * identity (venue, instrument, asset class, mapping table). The
 * instrument must be declared in the source descriptor's universes
 * (declared-capability envelope).
 */
export function brokerExecutionReportSubscription(args: {
  readonly instrument: InstrumentId;
}): SdkResult<SubscriptionSpec> {
  const subject = brokerReportSubject(args.instrument);
  if (!subject.ok) return subject;
  const request = brokerSubscribeRequest(subject.value);
  if (!request.ok) return request;
  if (!isDeclaredInstrument(BROKER_SOURCE_DESCRIPTOR, args.instrument, 'crypto')) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the broker source descriptor's crypto symbol universes`,
      ),
    );
  }
  return success({
    channel: 'executionReport',
    request: request.value,
    venue: BROKER_VENUE,
    instrument: args.instrument,
    asset_class: 'crypto',
    mapping_table_id: BROKER_CHANNEL_TABLE_IDS['executionReport'],
  });
}
