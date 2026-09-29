/**
 * @tradrl/adapter-coinbase — documented subscription request construction.
 *
 * Work Order T037 (the session law: "open (subscribe message
 * construction)"). The SDK's neutrality contract pins HOW requests
 * travel: the session passes the raw subscription request through the
 * transport UNMANGLED (contract case: "the raw subscription request
 * passes through unmangled"). Therefore the CONSTRUCTION lives here, as
 * pure exported helpers: callers build the documented Coinbase subscribe
 * message and the matching canonical SubscriptionSpec, and the session
 * carries both verbatim.
 *
 * The documented shape (Coinbase Exchange WebSocket): the subscribe
 * frame `{ "type": "subscribe", "product_ids": ["BTC-USD"],
 * "channels": ["ticker"] }` — the product ids are the venue's documented
 * canonical product identifiers (the SAME strings the adapter declares
 * as its canonical instrument ids: no translation, the documented form
 * IS the canonical venue form).
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { COINBASE_SOURCE_DESCRIPTOR, COINBASE_VENUE } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { COINBASE_CHANNEL_TABLE_IDS } from './mapping-tables';

/** The adapter's raw channel ids (documented Coinbase Exchange channel kinds). */
export type CoinbaseChannel = 'level2_batch' | 'ticker' | 'match';

/**
 * Validate a documented product id / canonical instrument id: the Coinbase
 * documented form ("BTC-USD" — uppercase parts joined by exactly one
 * dash) IS the canonical venue-canonical instrument id; no translation
 * happens (the guard's tolerated product_id field is the same string).
 */
export function coinbaseProductId(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not the documented product id form (two uppercase alphanumeric parts joined by one dash, e.g. "BTC-USD")`,
      ),
    );
  }
  return success(instrument);
}

/** Build the documented subscribe frame for one channel over one product. */
export function coinbaseSubscribeRequest(channel: CoinbaseChannel, productId: string): SdkResult<JsonObject> {
  const channelOk: SdkResult<null> =
    channel === 'level2_batch' || channel === 'ticker' || channel === 'match'
      ? success(null)
      : failure(protocolError('invalid_configuration', `channel "${channel}" is not a documented Coinbase channel`));
  if (!channelOk.ok) return channelOk;
  if (!isNonEmptyString(productId)) {
    return failure(protocolError('invalid_configuration', `the product id "${productId}" must be a non-empty string`));
  }
  return success({ type: 'subscribe', product_ids: [productId], channels: [channel] });
}

/**
 * Build a complete canonical subscription for one Coinbase channel over
 * one declared instrument: the documented subscribe frame and the
 * canonical stream identity (venue, instrument, asset class, mapping
 * table). The instrument must be declared in the source descriptor's
 * universes (declared-capability envelope).
 */
export function coinbaseSubscription(args: {
  readonly channel: CoinbaseChannel;
  readonly instrument: InstrumentId;
  readonly request_id?: number;
}): SdkResult<SubscriptionSpec> {
  const productId = coinbaseProductId(args.instrument);
  if (!productId.ok) return productId;
  const request = coinbaseSubscribeRequest(args.channel, productId.value);
  if (!request.ok) return request;
  if (!isDeclaredInstrument(COINBASE_SOURCE_DESCRIPTOR, args.instrument, 'crypto')) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the Coinbase source descriptor's crypto symbol universes`,
      ),
    );
  }
  // The documented subscribe frame carries no request id; the optional
  // argument is validated anyway so callers cannot silently smuggle an
  // invalid one into adjacent tooling.
  if (args.request_id !== undefined && !isPositiveSafeInteger(args.request_id)) {
    return failure(protocolError('invalid_configuration', `the request id ${String(args.request_id)} must be a positive integer when present`));
  }
  const tableId = COINBASE_CHANNEL_TABLE_IDS[args.channel];
  return success({
    channel: args.channel,
    request: request.value,
    venue: COINBASE_VENUE,
    instrument: args.instrument,
    asset_class: 'crypto',
    mapping_table_id: tableId,
  });
}
