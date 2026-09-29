/**
 * @tradrl/adapter-oms-ems — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the SDK knows NO provider; THIS
 * declaration is where the OMS/EMS gateway identity lives — "the provider
 * id (an opaque string carrying the system name)". Every OMS/EMS
 * semantic in this package (channels, raw field vocabularies, documented
 * status domains) is declared HERE or in the sibling declaration modules,
 * never in the contract mirror, never in the emitted canonical events.
 *
 * Declared capability card (Work Order T039 — spec/ADAPTERS.md Execution:
 * "Broker, exchange-native API, paper venue and OMS/EMS integrations.
 * Every consequential order passes through internal execution
 * authority/risk gates."):
 *   - provider: "oms-ems-gateway" (opaque id carrying the system name —
 *     the documented camelCase JSON API of a headless OMS/EMS);
 *   - category: execution (the SDK's execution family — this adapter
 *     routes APPROVED orders as routing instructions and reconciles
 *     order state);
 *   - channels: "routingInstruction" (OUTBOUND order entry — the
 *     documented ROUTE_ORDER instruction) and "orderState" (INBOUND —
 *     the documented ORDER_STATE records the OMS pushes);
 *   - canonical event types: other (order-state records enter through
 *     the typed escape hatch, kind "order_state" — the canonical
 *     taxonomy has no order-state member, and adding one is not this
 *     adapter's to do);
 *   - latency class: realtime (the OMS's state stream is a push stream);
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

/** The provider id — an opaque string carrying the system name (Work Order T039). */
export const OMS_EMS_PROVIDER_ID = 'oms-ems-gateway';

/** The canonical venue id carried on emitted events. */
export const OMS_EMS_VENUE = 'OMS-EMS';

/** The concrete adapter's identity — the lineage producer on every emitted event (L9). */
export const OMS_EMS_ADAPTER: AdapterRef = { id: 'adapter-oms-ems', version: '0.0.0' };

/** The declared raw channels (the gateway's documented message kinds). */
export const OMS_EMS_CHANNELS: readonly string[] = ['routingInstruction', 'orderState'];

/** The declared canonical event types the adapter emits into. */
export const OMS_EMS_EVENT_TYPES: readonly string[] = ['other'];

/** The declared symbol universes (canonical, venue-canonical instrument ids). */
export const OMS_EMS_SYMBOL_UNIVERSES: readonly object[] = [
  { universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USDT', 'ETH-USDT'] },
  { universe_id: 'spot-liquid', asset_class: 'crypto', instruments: ['SOL-USDT', 'BNB-USDT', 'XRP-USDT'] },
];

const construction = validateSourceDescriptor({
  provider: OMS_EMS_PROVIDER_ID,
  category: 'execution',
  capabilities: {
    channels: OMS_EMS_CHANNELS,
    symbol_universes: OMS_EMS_SYMBOL_UNIVERSES,
    event_types: OMS_EMS_EVENT_TYPES,
    latency_class: 'realtime',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`OMS_EMS_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the OMS/EMS gateway adapter. */
export const OMS_EMS_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;
