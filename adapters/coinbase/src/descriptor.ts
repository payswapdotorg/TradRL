/**
 * @tradrl/adapter-coinbase — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the Coinbase identity lives — "the provider id (an
 * opaque string carrying the exchange name)". Every Coinbase semantic in
 * this package (channels, product universes, ISO timestamp semantics) is
 * declared HERE or in the sibling declaration modules, never in the
 * contract mirror, never in the emitted canonical events.
 *
 * Declared capability card (Work Order T037: "the same contract shape for
 * Coinbase Exchange spot channels (level2_batch top-of-book snapshots,
 * ticker, match)"):
 *   - provider: "coinbase" (opaque id carrying the exchange name);
 *   - category: market-data (the crypto specialization is the crypto
 *     asset class of the declared symbol universes);
 *   - channels: level2_batch (documented book snapshots), ticker
 *     (top-of-book quotations) and match (trade prints);
 *   - canonical event types: trade, quote, book_snapshot;
 *   - latency class: realtime (the documented channels are push channels).
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the exchange name (Work Order T037). */
export const COINBASE_PROVIDER_ID = 'coinbase';

/** The canonical venue id carried on emitted events. */
export const COINBASE_VENUE = 'COINBASE';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const COINBASE_ADAPTER: AdapterRef = { id: 'adapter-coinbase', version: '0.0.0' };

/** The declared raw channels (documented Coinbase Exchange channel kinds). */
export const COINBASE_DECLARED_CHANNELS: readonly string[] = ['level2_batch', 'ticker', 'match'];

/** The declared canonical event types the adapter emits into. */
export const COINBASE_EVENT_TYPES: readonly string[] = ['trade', 'quote', 'book_snapshot'];

/** The declared symbol universes (canonical, venue-canonical product ids). */
export const COINBASE_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USD', 'ETH-USD'] },
  { universe_id: 'spot-liquid', asset_class: 'crypto', instruments: ['SOL-USD', 'XRP-USD'] },
];

const construction = validateSourceDescriptor({
  provider: COINBASE_PROVIDER_ID,
  category: 'market-data',
  capabilities: {
    channels: COINBASE_DECLARED_CHANNELS,
    symbol_universes: COINBASE_SYMBOL_UNIVERSES,
    event_types: COINBASE_EVENT_TYPES,
    latency_class: 'realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`COINBASE_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the Coinbase spot market-data adapter. */
export const COINBASE_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
