/**
 * @tradrl/adapter-alternative-data — documented subscription request
 * construction.
 *
 * The SDK's neutrality contract pins HOW requests travel: the session
 * passes the raw subscription request through the transport UNMANGLED
 * (contract case: "the raw subscription request passes through
 * unmangled"). Therefore the CONSTRUCTION lives here, as pure exported
 * helpers: callers build the documented vendor SUBSCRIBE frame and the
 * matching canonical SubscriptionSpec, and the session carries both
 * verbatim.
 *
 * The documented shapes (the alternative-data vendor's stream API):
 *   - series names: the channel names themselves ("sentiment",
 *     "onChain", "economicSeries", "satelliteSeries");
 *   - subjects: the vendor documents series subjects in the canonical
 *     uppercase instrument form ("TEST-AAA", "TEST-CHAIN-A",
 *     "TEST-ECON-GDP", "TEST-SAT-OIL") — the identity translation is
 *     validated HERE (the canonical instrument form is checked; provider
 *     vocabulary translation lives in the adapter, never in the
 *     canonical events);
 *   - the SUBSCRIBE frame: `{ action: "SUBSCRIBE", series: <series>,
 *     subject: <subject> }` — the stream delivers the series'
 *     observations for that instrument.
 *
 * Per-channel asset classes (the declared capability envelope): the
 * sentiment channel binds EQUITY instruments; the on-chain channel
 * binds CRYPTO chain assets; the economic series channel binds MACRO
 * series; the satellite channel binds COMMODITY series.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, type InstrumentId } from './contract/fields';
import type { JsonObject } from './contract/json';
import type { SubscriptionSpec } from './contract/session';
import { ALTDATA_SOURCE_DESCRIPTOR } from './descriptor';
import { isDeclaredInstrument } from './contract/descriptors';
import { ALTDATA_CHANNEL_TABLE_IDS } from './mapping-tables';
import { ALTDATA_VENUE } from './descriptor';
import type { AssetClass } from './contract/taxonomy';

/** The adapter's raw channel ids (documented observation channels). */
export type AltDataChannel = 'sentiment' | 'onChain' | 'economicSeries' | 'satelliteSeries';

/** The declared asset class each channel's instruments belong to. */
export const ALTDATA_CHANNEL_ASSET_CLASSES: Readonly<Record<AltDataChannel, AssetClass>> = {
  sentiment: 'equity',
  onChain: 'crypto',
  economicSeries: 'macro',
  satelliteSeries: 'commodity',
};

/**
 * Translate a canonical instrument id into the documented vendor series
 * subject. Total: the input must be the canonical uppercase form
 * (uppercase alphanumeric parts joined by single dashes) — the vendor
 * documents subjects in exactly that form.
 */
export function altDataSeriesSubject(instrument: InstrumentId): SdkResult<string> {
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(instrument)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${instrument}" is not a canonical subject form (uppercase alphanumeric parts joined by single dashes, e.g. "TEST-SAT-OIL")`,
      ),
    );
  }
  return success(instrument);
}

/** Build the documented SUBSCRIBE frame for one series over one subject. */
export function altDataSubscribeRequest(series: AltDataChannel, subject: string): SdkResult<JsonObject> {
  if (!isNonEmptyString(subject)) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE subject must be a non-empty series subject'));
  }
  if (!/^[a-zA-Z]+$/.test(series)) {
    return failure(protocolError('invalid_configuration', `the SUBSCRIBE series name "${series}" must be the documented series name`));
  }
  return success({ action: 'SUBSCRIBE', series, subject });
}

/**
 * Build a complete canonical subscription for one observation channel
 * over one declared instrument: the documented series subject, the
 * documented SUBSCRIBE frame, and the canonical stream identity (venue,
 * instrument, asset class, mapping table). The instrument must be
 * declared in the source descriptor's universes of the channel's asset
 * class (declared-capability envelope).
 */
export function altDataSubscription(args: {
  readonly channel: AltDataChannel;
  readonly instrument: InstrumentId;
}): SdkResult<SubscriptionSpec> {
  const subject = altDataSeriesSubject(args.instrument);
  if (!subject.ok) return subject;
  const request = altDataSubscribeRequest(args.channel, subject.value);
  if (!request.ok) return request;
  const assetClass = ALTDATA_CHANNEL_ASSET_CLASSES[args.channel];
  if (!isDeclaredInstrument(ALTDATA_SOURCE_DESCRIPTOR, args.instrument, assetClass)) {
    return failure(
      protocolError(
        'invalid_configuration',
        `instrument "${args.instrument}" is not declared in the alternative-data source descriptor's ${assetClass} symbol universes`,
      ),
    );
  }
  const tableId = ALTDATA_CHANNEL_TABLE_IDS[args.channel];
  return success({
    channel: args.channel,
    request: request.value,
    venue: ALTDATA_VENUE,
    instrument: args.instrument,
    asset_class: assetClass,
    mapping_table_id: tableId,
  });
}
