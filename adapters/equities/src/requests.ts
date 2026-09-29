/**
 * @tradrl/adapter-equities — documented subscription request construction.
 *
 * The SDK's neutrality contract pins HOW requests travel: the session
 * passes the raw subscription request through the transport UNMANGLED
 * (contract case: "the raw subscription request passes through
 * unmangled"). Therefore the CONSTRUCTION lives here, as pure exported
 * helpers: callers build the documented feed SUBSCRIBE frame and the
 * matching canonical SubscriptionSpec, and the session carries both
 * verbatim.
 *
 * The documented shapes (the licensed index feed's stream API):
 *   - feed names: the channel names themselves ("indexLevel",
 *     "constituentWeights", "corporateActions");
 *   - subjects: the feed documents record subjects in the canonical
 *     uppercase instrument form ("TEST-LARGECAP", "TEST-AAA") — the
 *     identity translation is validated HERE (the canonical instrument
 *     form is checked; provider vocabulary translation lives in the
 *     adapter, never in the canonical events);
 *   - the SUBSCRIBE frame: `{ action: "SUBSCRIBE", feed: <feed>,
 *     subject: <subject> }`.
 *
 * Per-channel asset classes (the declared capability envelope): the
 * index product channels (indexLevel, constituentWeights) bind INDEX
 * instruments; the corporate action channel binds EQUITY instruments.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { EQUITIES_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { EQUITIES_CHANNEL_TABLE_IDS } from './mapping-tables';
import { EQUITIES_VENUE } from './descriptor';
import type { AssetClass } from './contract/taxonomy';

/** The adapter's raw channel ids (documented feed record kinds). */
export type EquitiesChannel = 'indexLevel' | 'constituentWeights' | 'corporateActions';

/** The declared asset class each channel's instruments belong to. */
export const EQUITIES_CHANNEL_ASSET_CLASSES: Readonly<Record<EquitiesChannel, AssetClass>> = {
  indexLevel: 'index',
  constituentWeights: 'index',
  corporateActions: 'equity',
};

/**
 * Translate a canonical instrument id into the documented feed subject.
 * Total: the input must be the canonical uppercase form (uppercase
 * alphanumeric parts joined by single dashes) — the feed documents
 * subjects in exactly that form.
 */
export function equitiesFeedSubject(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not a canonical subject form (uppercase alphanumeric parts joined by single dashes, e.g. "TEST-LARGECAP")`,
      ),
    );
  }
  return success(instrument);
}

/** Build the documented SUBSCRIBE frame for one feed over one subject. */
export function equitiesSubscribeRequest(feed: EquitiesChannel, subject: string): SdkResult<JsonObject> {
  if (!isNonEmptyString(subject)) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE subject must be a non-empty feed subject'));
  }
  if (!/^[a-zA-Z]+$/.test(feed)) {
    return failure(protocolError('invalid_configuration', `the SUBSCRIBE feed name "${feed}" must be the documented feed name`));
  }
  return success({ action: 'SUBSCRIBE', feed, subject });
}

/**
 * Build a complete canonical subscription for one equities feed channel
 * over one declared instrument: the documented feed subject, the
 * documented SUBSCRIBE frame, and the canonical stream identity (venue,
 * instrument, asset class, mapping table). The instrument must be
 * declared in the source descriptor's universes of the channel's asset
 * class (declared-capability envelope).
 */
export function equitiesSubscription(args: {
  readonly channel: EquitiesChannel;
  readonly instrument: InstrumentId;
}): SdkResult<SubscriptionSpec> {
  const subject = equitiesFeedSubject(args.instrument);
  if (!subject.ok) return subject;
  const request = equitiesSubscribeRequest(args.channel, subject.value);
  if (!request.ok) return request;
  const assetClass = EQUITIES_CHANNEL_ASSET_CLASSES[args.channel];
  if (!isDeclaredInstrument(EQUITIES_SOURCE_DESCRIPTOR, args.instrument, assetClass)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the equities source descriptor's ${assetClass} symbol universes`,
      ),
    );
  }
  const tableId = EQUITIES_CHANNEL_TABLE_IDS[args.channel];
  return success({
    channel: args.channel,
    request: request.value,
    venue: EQUITIES_VENUE,
    instrument: args.instrument,
    asset_class: assetClass,
    mapping_table_id: tableId,
  });
}
