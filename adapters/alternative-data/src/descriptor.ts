/**
 * @tradrl/adapter-alternative-data — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the alternative-data vendor identity lives — "the
 * provider id (an opaque string carrying the feed name)". Every vendor
 * semantic in this package (channels, observation schemas, window->
 * release law, entitlement tiers) is declared HERE or in the sibling
 * declaration modules, never in the contract mirror, never in the
 * emitted canonical events.
 *
 * Declared capability card (Work Order T038 — alternative data):
 *   - provider: "alt-vendor-a" (opaque id carrying the vendor name);
 *   - category: market-data, sub-domain alternative data (the SDK's
 *     category set has no alternative-data member — the specialization
 *     is the four asset classes of the declared symbol universes plus
 *     the declared signal/release/fundamental event types);
 *   - channels: the documented observation channels this adapter
 *     consumes — "sentiment" (sentiment score series), "onChain"
 *     (blockchain on-chain metric series), "economicSeries" (economic
 *     series releases) and "satelliteSeries" (satellite-derived series
 *     observations);
 *   - canonical event types: social_signal (sentiment scores, on-chain
 *     metrics), macro_release (economic series) and fundamental
 *     (satellite observations — reported data);
 *   - latency class: batch — alternative data is released on schedules
 *     (daily/weekly windows with declared release instants), never
 *     pushed in realtime.
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the vendor name (Work Order T038). */
export const ALTDATA_PROVIDER_ID = 'alt-vendor-a';

/** The canonical venue id carried on emitted events (the repo's canonical example convention). */
export const ALTDATA_VENUE = 'ALT-VENDOR-A';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const ALTDATA_ADAPTER: AdapterRef = { id: 'adapter-alternative-data', version: '0.0.0' };

/** The declared raw channels (documented observation channels). */
export const ALTDATA_CHANNELS: readonly string[] = ['sentiment', 'onChain', 'economicSeries', 'satelliteSeries'];

/** The declared canonical event types the adapter emits into. */
export const ALTDATA_EVENT_TYPES: readonly string[] = ['social_signal', 'macro_release', 'fundamental'];

/**
 * The declared symbol universes (canonical, venue-canonical instrument
 * ids). SYNTHETIC ids throughout: vendor-licensed series content is
 * referenced by opaque entitlement refs, never copied (spec/ADAPTERS.md
 * Licensing).
 */
export const ALTDATA_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'equity-sentiment-symbols', asset_class: 'equity', instruments: ['TEST-AAA', 'TEST-BBB'] },
  { universe_id: 'chain-assets', asset_class: 'crypto', instruments: ['TEST-CHAIN-A', 'TEST-CHAIN-B'] },
  { universe_id: 'economic-series', asset_class: 'macro', instruments: ['TEST-ECON-GDP', 'TEST-ECON-CPI'] },
  { universe_id: 'satellite-series', asset_class: 'commodity', instruments: ['TEST-SAT-OIL'] },
];

const construction = validateSourceDescriptor({
  provider: ALTDATA_PROVIDER_ID,
  category: 'market-data',
  capabilities: {
    channels: ALTDATA_CHANNELS,
    symbol_universes: ALTDATA_SYMBOL_UNIVERSES,
    event_types: ALTDATA_EVENT_TYPES,
    latency_class: 'batch',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`ALTDATA_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the alternative-data adapter. */
export const ALTDATA_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
