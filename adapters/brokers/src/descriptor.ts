/**
 * @tradrl/adapter-brokers — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the broker gateway identity lives — "the provider
 * id (an opaque string carrying the broker name)". Every broker-gateway
 * semantic in this package (channels, raw field vocabularies, documented
 * enum code sets) is declared HERE or in the sibling declaration modules,
 * never in the contract mirror, never in the emitted canonical events.
 *
 * Declared capability card (Work Order T039 — spec/ADAPTERS.md Execution:
 * "Broker, exchange-native API, paper venue and OMS/EMS integrations.
 * Every consequential order passes through internal execution
 * authority/risk gates."):
 *   - provider: "fix-broker-gateway" (opaque id carrying the broker
 *     protocol name — the documented FIX-dictionary field vocabulary);
 *   - category: execution (the SDK's execution family — this adapter
 *     routes APPROVED orders and translates execution reports);
 *   - channels: "newOrderSingle" (OUTBOUND order entry — the documented
 *     NewOrderSingle message fields) and "executionReport" (INBOUND
 *     execution reporting — the documented ExecutionReport message
 *     fields);
 *   - canonical event types: other (execution reports enter through the
 *     typed escape hatch, kind "execution_report" — the canonical
 *     taxonomy has no execution-report member, and adding one is not this
 *     adapter's to do);
 *   - latency class: realtime (the gateway's report stream is a push
 *     stream);
 *   - symbol universes: canonical crypto spot instruments (the repo's
 *     established example universe — the execution lane's reference
 *     simulation venue trades exactly these).
 *
 * The declaration is validated (collect-all) and deep-frozen at module
 * load — an immutable capability card; a construction failure is a
 * programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/provenance';

/** The provider id — an opaque string carrying the broker protocol name (Work Order T039). */
export const BROKER_PROVIDER_ID = 'fix-broker-gateway';

/** The canonical venue id carried on emitted events. */
export const BROKER_VENUE = 'BROKER-FIX';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const BROKER_ADAPTER: AdapterRef = { id: 'adapter-brokers', version: '0.0.0' };

/** The declared raw channels (the gateway's documented message kinds). */
export const BROKER_CHANNELS: readonly string[] = ['newOrderSingle', 'executionReport'];

/** The declared canonical event types the adapter emits into. */
export const BROKER_EVENT_TYPES: readonly string[] = ['other'];

/** The declared symbol universes (canonical, venue-canonical instrument ids). */
export const BROKER_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USDT', 'ETH-USDT'] },
  { universe_id: 'spot-liquid', asset_class: 'crypto', instruments: ['SOL-USDT', 'BNB-USDT', 'XRP-USDT'] },
];

const construction = validateSourceDescriptor({
  provider: BROKER_PROVIDER_ID,
  category: 'execution',
  capabilities: {
    channels: BROKER_CHANNELS,
    symbol_universes: BROKER_SYMBOL_UNIVERSES,
    event_types: BROKER_EVENT_TYPES,
    latency_class: 'realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`BROKER_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the broker gateway adapter. */
export const BROKER_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
