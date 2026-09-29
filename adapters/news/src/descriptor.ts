/**
 * @tradrl/adapter-news — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the licensed news wire identity lives — "the
 * provider id (an opaque string carrying the feed name)". Every wire
 * semantic in this package (channels, item schemas, embargo policy,
 * entitlement tiers) is declared HERE or in the sibling declaration
 * modules, never in the contract mirror, never in the emitted canonical
 * events.
 *
 * Declared capability card (Work Order T038 — news):
 *   - provider: "news-wire-a" (opaque id carrying the wire name);
 *   - category: market-data, sub-domain news (the SDK's category set has
 *     no news member — the specialization is the equity asset class of
 *     the declared symbol universes plus the declared news event type);
 *   - channels: the documented wire channels this adapter consumes —
 *     "publicHeadlines" (the public headline metadata channel) and
 *     "licensedWire" (the licensed full wire channel: bodies, tagging,
 *     tags, urls and embargoed pre-release items);
 *   - canonical event types: news (news payloads are NOT market-protocol
 *     book/trade shapes — they enter the pipeline through the typed
 *     canonical news contract with quartet + provenance + entitlement
 *     discipline);
 *   - latency class: near-realtime (a wire pushes items as published).
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the licensed wire name (Work Order T038). */
export const NEWS_PROVIDER_ID = 'news-wire-a';

/** The canonical venue id carried on emitted events (the repo's canonical example convention). */
export const NEWS_VENUE = 'NEWS-WIRE-A';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const NEWS_ADAPTER: AdapterRef = { id: 'adapter-news', version: '0.0.0' };

/** The declared raw channels (documented wire channels). */
export const NEWS_CHANNELS: readonly string[] = ['publicHeadlines', 'licensedWire'];

/** The declared canonical event types the adapter emits into. */
export const NEWS_EVENT_TYPES: readonly string[] = ['news'];

/**
 * The declared symbol universes (canonical, venue-canonical instrument
 * ids — the tickers the wire tags items with). SYNTHETIC ids throughout:
 * wire content is referenced by opaque entitlement refs, never copied
 * (spec/ADAPTERS.md Licensing).
 */
export const NEWS_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'equity-majors', asset_class: 'equity', instruments: ['TEST-AAA', 'TEST-BBB'] },
];

const construction = validateSourceDescriptor({
  provider: NEWS_PROVIDER_ID,
  category: 'market-data',
  capabilities: {
    channels: NEWS_CHANNELS,
    symbol_universes: NEWS_SYMBOL_UNIVERSES,
    event_types: NEWS_EVENT_TYPES,
    latency_class: 'near-realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`NEWS_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the news wire adapter. */
export const NEWS_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
