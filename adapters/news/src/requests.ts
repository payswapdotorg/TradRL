/**
 * @tradrl/adapter-news — documented subscription request construction.
 *
 * The SDK's neutrality contract pins HOW requests travel: the session
 * passes the raw subscription request through the transport UNMANGLED
 * (contract case: "the raw subscription request passes through
 * unmangled"). Therefore the CONSTRUCTION lives here, as pure exported
 * helpers: callers build the documented wire SUBSCRIBE frame and the
 * matching canonical SubscriptionSpec, and the session carries both
 * verbatim.
 *
 * The documented shapes (the news wire's stream API):
 *   - stream names: the channel names themselves ("publicHeadlines",
 *     "licensedWire");
 *   - symbols: the wire documents stream symbols in the canonical
 *     uppercase ticker form ("TEST-AAA") — the identity translation is
 *     validated HERE (the canonical instrument form is checked; provider
 *     vocabulary translation lives in the adapter, never in the
 *     canonical events);
 *   - the SUBSCRIBE frame: `{ action: "SUBSCRIBE", stream: <stream>,
 *     symbol: <symbol> }` — the stream delivers items tagged with that
 *     ticker (the item's full ticker set rides in the canonical
 *     payload's symbols).
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { NEWS_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { NEWS_CHANNEL_TABLE_IDS } from './mapping-tables';
import { NEWS_VENUE } from './descriptor';

/** The adapter's raw channel ids (documented wire channels). */
export type NewsChannel = 'publicHeadlines' | 'licensedWire';

/**
 * Translate a canonical instrument id into the documented wire stream
 * symbol. Total: the input must be the canonical uppercase ticker form
 * (uppercase alphanumeric parts joined by single dashes) — the wire
 * documents stream symbols in exactly that form.
 */
export function newsStreamSymbol(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not a canonical ticker form (uppercase alphanumeric parts joined by single dashes, e.g. "TEST-AAA")`,
      ),
    );
  }
  return success(instrument);
}

/** Build the documented SUBSCRIBE frame for one stream over one symbol. */
export function newsSubscribeRequest(stream: NewsChannel, symbol: string): SdkResult<JsonObject> {
  if (!isNonEmptyString(symbol)) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE symbol must be a non-empty stream symbol'));
  }
  if (!/^[a-zA-Z]+$/.test(stream)) {
    return failure(protocolError('invalid_configuration', `the SUBSCRIBE stream name "${stream}" must be the documented stream name`));
  }
  return success({ action: 'SUBSCRIBE', stream, symbol });
}

/**
 * Build a complete canonical subscription for one wire channel over one
 * declared instrument: the documented stream symbol, the documented
 * SUBSCRIBE frame, and the canonical stream identity (venue, instrument,
 * asset class, mapping table). The instrument must be declared in the
 * source descriptor's universes (declared-capability envelope).
 */
export function newsSubscription(args: {
  readonly channel: NewsChannel;
  readonly instrument: InstrumentId;
}): SdkResult<SubscriptionSpec> {
  const symbol = newsStreamSymbol(args.instrument);
  if (!symbol.ok) return symbol;
  const request = newsSubscribeRequest(args.channel, symbol.value);
  if (!request.ok) return request;
  if (!isDeclaredInstrument(NEWS_SOURCE_DESCRIPTOR, args.instrument, 'equity')) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the news source descriptor's equity symbol universes`,
      ),
    );
  }
  const tableId = NEWS_CHANNEL_TABLE_IDS[args.channel];
  return success({
    channel: args.channel,
    request: request.value,
    venue: NEWS_VENUE,
    instrument: args.instrument,
    asset_class: 'equity',
    mapping_table_id: tableId,
  });
}
