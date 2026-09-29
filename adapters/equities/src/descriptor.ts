/**
 * @tradrl/adapter-equities — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the licensed equities/index feed identity lives —
 * "the provider id (an opaque string carrying the feed name)". Every
 * feed semantic in this package (channels, record schemas, calendar,
 * entitlement terms) is declared HERE or in the sibling declaration
 * modules, never in the contract mirror, never in the emitted canonical
 * events.
 *
 * Declared capability card (Work Order T038 — equities/index):
 *   - provider: "licensed-index-a" (opaque id carrying the feed name);
 *   - category: market-data, sub-domain equities/index (the SDK's
 *     category set has no equities member — the specialization is the
 *     index/equity asset classes of the declared symbol universes);
 *   - channels: the documented feed record kinds this adapter consumes —
 *     "indexLevel" (index level disseminations), "constituentWeights"
 *     (index constituent weight records) and "corporateActions"
 *     (corporate action announcements);
 *   - canonical event types: fundamental (index levels are reported
 *     data) and other (constituent weights and corporate actions name
 *     their kind — the typed escape hatch);
 *   - latency class: near-realtime (intraday index dissemination).
 *
 * THE LICENSING BOUNDARY (spec/ADAPTERS.md — full force here): the feed
 * is a COMMERCIALLY LICENSED index data source. The descriptor's
 * instruments are SYNTHETIC ids ("TEST-LARGECAP", "TEST-AAA") — licensed
 * content is referenced by opaque entitlement refs and never embedded in
 * fixtures beyond documented public metadata (Work Order T038 scope).
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the licensed feed name (Work Order T038). */
export const EQUITIES_PROVIDER_ID = 'licensed-index-a';

/** The canonical venue id carried on emitted events (the repo's canonical example convention). */
export const EQUITIES_VENUE = 'LICENSED-INDEX-A';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const EQUITIES_ADAPTER: AdapterRef = { id: 'adapter-equities', version: '0.0.0' };

/** The declared raw channels (documented licensed index feed record kinds). */
export const EQUITIES_CHANNELS: readonly string[] = ['indexLevel', 'constituentWeights', 'corporateActions'];

/** The declared canonical event types the adapter emits into. */
export const EQUITIES_EVENT_TYPES: readonly string[] = ['fundamental', 'other'];

/**
 * The declared symbol universes (canonical, venue-canonical instrument
 * ids). SYNTHETIC ids throughout: licensed index content is referenced by
 * entitlement refs, never copied (spec/ADAPTERS.md Licensing).
 */
export const EQUITIES_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'index-series', asset_class: 'index', instruments: ['TEST-LARGECAP', 'TEST-MIDCAP'] },
  { universe_id: 'equity-listings', asset_class: 'equity', instruments: ['TEST-AAA', 'TEST-BBB'] },
];

const construction = validateSourceDescriptor({
  provider: EQUITIES_PROVIDER_ID,
  category: 'market-data',
  capabilities: {
    channels: EQUITIES_CHANNELS,
    symbol_universes: EQUITIES_SYMBOL_UNIVERSES,
    event_types: EQUITIES_EVENT_TYPES,
    latency_class: 'near-realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`EQUITIES_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the licensed equities/index feed adapter. */
export const EQUITIES_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
