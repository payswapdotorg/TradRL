/**
 * @tradrl/adapter-binance — documented subscription request construction.
 *
 * Work Order T037: "BinanceAdapterSession — ... open (subscribe message
 * construction) ...". The SDK's neutrality contract pins HOW requests
 * travel: the session passes the raw subscription request through the
 * transport UNMANGLED (contract case: "the raw subscription request
 * passes through unmangled"). Therefore the CONSTRUCTION lives here, as
 * pure exported helpers: callers build the documented Binance SUBSCRIBE
 * message and the matching canonical SubscriptionSpec, and the session
 * carries both verbatim.
 *
 * The documented shapes (Binance spot WebSocket):
 *   - stream names: `<symbol>@trade`, `<symbol>@bookTicker`,
 *     `<symbol>@depth@100ms` (diff), `<symbol>@depth20@100ms` (partial);
 *     symbols are lowercase concatenated pairs (e.g. "btcusdt");
 *   - the SUBSCRIBE frame: `{ "method": "SUBSCRIBE", "params":
 *     ["btcusdt@trade"], "id": 1 }` — id is an arbitrary integer echoed
 *     on the (runtime) acknowledgment, outside this contract package.
 *
 * The canonical instrument form ("BTC-USDT") is translated to the
 * documented raw stream symbol ("btcusdt") HERE — provider vocabulary
 * translation lives in the adapter, never in the canonical events.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { BINANCE_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { BINANCE_CHANNEL_TABLE_IDS } from './mapping-tables';
import { BINANCE_VENUE } from './descriptor';

/** The adapter's raw channel ids (documented stream kinds). */
export type BinanceChannel = 'depth' | 'depthDiff' | 'bookTicker' | 'trade';

/**
 * Translate a canonical instrument id ("BTC-USDT") into the documented raw
 * stream symbol ("btcusdt"): lowercase, pair separator removed. Total:
 * the input must be a canonical pair form (uppercase alphanumeric parts
 * joined by exactly one dash).
 */
export function binanceRawSymbol(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not a canonical pair form (two uppercase alphanumeric parts joined by one dash, e.g. "BTC-USDT")`,
      ),
    );
  }
  return success(instrument.replace('-', '').toLowerCase());
}

/**
 * Build the documented stream name for one channel over one raw symbol:
 * trade -> `<symbol>@trade`; bookTicker -> `<symbol>@bookTicker`;
 * depthDiff -> `<symbol>@depth@100ms` (the documented diff stream with
 * the 100 ms speed); depth -> `<symbol>@depth20@100ms` (the documented
 * partial stream, 20 levels, 100 ms speed).
 */
export function binanceStreamName(channel: BinanceChannel, rawSymbol: string): SdkResult<string> {
  if (!isNonEmptyString(rawSymbol) || !/^[a-z0-9]+$/.test(rawSymbol)) {
    return failure(
      protocolError('invalid_configuration', `raw symbol "${rawSymbol}" must be lowercase alphanumeric (e.g. "btcusdt")`),
    );
  }
  switch (channel) {
    case 'trade':
      return success(`${rawSymbol}@trade`);
    case 'bookTicker':
      return success(`${rawSymbol}@bookTicker`);
    case 'depthDiff':
      return success(`${rawSymbol}@depth@100ms`);
    case 'depth':
      return success(`${rawSymbol}@depth20@100ms`);
  }
}

/** Build the documented SUBSCRIBE frame for a list of stream names. */
export function binanceSubscribeRequest(streams: readonly string[], id: number): SdkResult<JsonObject> {
  if (streams.length === 0) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE params list must not be empty'));
  }
  for (const stream of streams) {
    if (!isNonEmptyString(stream)) {
      return failure(protocolError('invalid_configuration', 'every SUBSCRIBE param must be a non-empty stream name'));
    }
  }
  if (!isPositiveSafeInteger(id)) {
    return failure(protocolError('invalid_configuration', `the SUBSCRIBE id must be a positive integer (got ${String(id)})`));
  }
  return success({ method: 'SUBSCRIBE', params: [...streams], id });
}

/**
 * Build a complete canonical subscription for one Binance channel over
 * one declared instrument: the documented stream name, the documented
 * SUBSCRIBE frame, and the canonical stream identity (venue, instrument,
 * asset class, mapping table). The instrument must be declared in the
 * source descriptor's universes (declared-capability envelope).
 */
export function binanceSubscription(args: {
  readonly channel: BinanceChannel;
  readonly instrument: InstrumentId;
  readonly request_id: number;
}): SdkResult<SubscriptionSpec> {
  const rawSymbol = binanceRawSymbol(args.instrument);
  if (!rawSymbol.ok) return rawSymbol;
  const stream = binanceStreamName(args.channel, rawSymbol.value);
  if (!stream.ok) return stream;
  const request = binanceSubscribeRequest([stream.value], args.request_id);
  if (!request.ok) return request;
  if (!isDeclaredInstrument(BINANCE_SOURCE_DESCRIPTOR, args.instrument, 'crypto')) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the Binance source descriptor's crypto symbol universes`,
      ),
    );
  }
  const tableId = BINANCE_CHANNEL_TABLE_IDS[args.channel];
  return success({
    channel: args.channel,
    request: request.value,
    venue: BINANCE_VENUE,
    instrument: args.instrument,
    asset_class: 'crypto',
    mapping_table_id: tableId,
  });
}
