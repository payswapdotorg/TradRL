/**
 * @tradrl/adapter-binance — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the Binance identity lives — "the provider id (an
 * opaque string carrying the exchange name)". Every Binance semantic in
 * this package (channels, raw symbol universes, stream latency) is
 * declared HERE or in the sibling declaration modules, never in the
 * contract mirror, never in the emitted canonical events.
 *
 * Declared capability card (Work Order T037):
 *   - provider: "binance" (opaque id carrying the exchange name);
 *   - category: market-data (the SDK's category set has no crypto-exchange
 *     member — the crypto specialization is the crypto asset class of the
 *     declared symbol universes);
 *   - channels: the documented spot streams this adapter consumes — the
 *     partial book depth stream ("depth", snapshots), the order book
 *     depth diff stream ("depthDiff", deltas — required for the
 *     documented update-id sequencing laws), the individual symbol book
 *     ticker stream ("bookTicker") and the trade stream ("trade");
 *   - canonical event types: trade, quote, book_snapshot, book_delta;
 *   - latency class: realtime (the documented streams are push streams).
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the exchange name (Work Order T037). */
export const BINANCE_PROVIDER_ID = 'binance';

/** The canonical venue id carried on emitted events (the repo's canonical example convention). */
export const BINANCE_VENUE = 'BINANCE';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const BINANCE_ADAPTER: AdapterRef = { id: 'adapter-binance', version: '0.0.0' };

/** The declared raw channels (documented Binance spot stream kinds). */
export const BINANCE_CHANNELS: readonly string[] = ['depth', 'depthDiff', 'bookTicker', 'trade'];

/** The declared canonical event types the adapter emits into. */
export const BINANCE_EVENT_TYPES: readonly string[] = ['trade', 'quote', 'book_snapshot', 'book_delta'];

/** The declared symbol universes (canonical, venue-canonical instrument ids). */
export const BINANCE_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USDT', 'ETH-USDT'] },
  { universe_id: 'spot-liquid', asset_class: 'crypto', instruments: ['SOL-USDT', 'BNB-USDT', 'XRP-USDT'] },
];

const construction = validateSourceDescriptor({
  provider: BINANCE_PROVIDER_ID,
  category: 'market-data',
  capabilities: {
    channels: BINANCE_CHANNELS,
    symbol_universes: BINANCE_SYMBOL_UNIVERSES,
    event_types: BINANCE_EVENT_TYPES,
    latency_class: 'realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`BINANCE_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the Binance spot market-data adapter. */
export const BINANCE_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
