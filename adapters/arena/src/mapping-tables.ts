/**
 * @tradrl/adapter-arena — the declared mapping tables.
 *
 * Every consumed raw Arena wire field -> canonical capability-provider
 * envelope field, with the declared instant policy per table (L4 — the
 * wire's own instant fields feed the envelope's principal instants;
 * the receive instant is the availability clock). The enum maps (wire
 * deliverable/verification type codes -> the ADAPTERS vocabulary) are
 * DECLARED DATA here, carried into the structured offers transform.
 *
 * The tables are validated (collect-all) and deep-frozen at module
 * load — immutable declarations; a construction failure is a
 * programming error that fails loudly.
 */

import { validateMappingTable, type MappingTable } from './contract/mapping';
import { ARENA_DELIVERABLE_KIND_MAP, ARENA_VERIFICATION_KIND_MAP, ARENA_PROVIDER_ID } from './descriptor';

/** The declared table ids, one per consumed wire channel. */
export const ARENA_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = Object.freeze({
  arenaCatalog: 'arena-catalog-publication',
  arenaQuotes: 'arena-quote-response',
  arenaDeliveries: 'arena-delivery-submission',
});

/** Declare (validate + deep-freeze) one mapping table — our own declarations fail loudly. */
function declareTable(value: unknown): MappingTable {
  const validation = validateMappingTable(value);
  if (!validation.ok) {
    throw new Error(`the arena mapping table declaration is invalid: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  }
  return validation.value;
}

/**
 * The catalog table: one wire catalog publication -> one provider
 * DECLARATION draft. The wire's `catalogRevision` IS the declaration
 * version (monotonic; the exchange's supersede law owns the history);
 * `supersedes` is the constant null at the root — the exchange refuses
 * a broken supersede chain, the adapter never invents one.
 */
export const ARENA_CATALOG_TABLE: MappingTable = declareTable({
  table_id: ARENA_CHANNEL_TABLE_IDS.arenaCatalog,
  envelope_kind: 'declaration',
  fields: [
    { raw_field: 'providerName', canonical_field: 'displayName', transform: { kind: 'identity' }, required: true },
    { raw_field: 'catalogRevision', canonical_field: 'version', transform: { kind: 'identity' }, required: true },
  ],
  structured: [
    {
      raw_field: 'offers',
      canonical_field: 'offers',
      structure: 'offers',
      deliverable_kind_map: ARENA_DELIVERABLE_KIND_MAP,
      verification_kind_map: ARENA_VERIFICATION_KIND_MAP,
    },
  ],
  constants: [
    { canonical_field: 'providerRef', value: ARENA_PROVIDER_ID },
    { canonical_field: 'supersedes', value: null },
  ],
  computed: [],
  tolerated: ['messageKind', 'messageId'],
  instant_policy: { instant_basis: 'raw-field', instant_field: 'publishedAtMs', canonical_field: 'declaredAt' },
});

/**
 * The quotes table: one wire quote response -> one provider QUOTE
 * draft. The `verificationEcho` is carried VERBATIM into
 * `terms.verification` — the guard pins it against the routed request's
 * frozen contract by canonical bytes (goalposts never move); the wire's
 * `deliverableType` translates through the declared enum map.
 */
export const ARENA_QUOTE_TABLE: MappingTable = declareTable({
  table_id: ARENA_CHANNEL_TABLE_IDS.arenaQuotes,
  envelope_kind: 'quote',
  fields: [
    { raw_field: 'requestRef', canonical_field: 'requestId', transform: { kind: 'identity' }, required: true },
    { raw_field: 'offerRef', canonical_field: 'offerRef', transform: { kind: 'identity' }, required: true },
    { raw_field: 'deliverableType', canonical_field: 'terms.deliverableKind', transform: { kind: 'enum', map: ARENA_DELIVERABLE_KIND_MAP }, required: true },
    { raw_field: 'counterTerms', canonical_field: 'terms.consideration', transform: { kind: 'identity' }, required: true },
    { raw_field: 'estimatedDeliveryMs', canonical_field: 'terms.estimatedDeliveryAt', transform: { kind: 'instant' }, required: true },
  ],
  structured: [
    { raw_field: 'verificationEcho', canonical_field: 'terms.verification', structure: 'verification' },
  ],
  constants: [
    { canonical_field: 'providerRef', value: ARENA_PROVIDER_ID },
  ],
  computed: [],
  tolerated: ['messageKind', 'messageId'],
  instant_policy: { instant_basis: 'raw-field', instant_field: 'respondedAtMs', canonical_field: 'quotedAt' },
});

/**
 * The deliveries table: one wire delivery submission -> one DELIVERABLE
 * draft. The opaque `content` carries verbatim into `payload`, pinned
 * by the COMPUTED `payloadDigest` (the payload law — the digest is
 * computed by the adapter over the canonical bytes, never trusted from
 * the wire).
 */
export const ARENA_DELIVERY_TABLE: MappingTable = declareTable({
  table_id: ARENA_CHANNEL_TABLE_IDS.arenaDeliveries,
  envelope_kind: 'deliverable',
  fields: [
    { raw_field: 'engagementRef', canonical_field: 'engagementId', transform: { kind: 'identity' }, required: true },
    { raw_field: 'deliverableType', canonical_field: 'kind', transform: { kind: 'enum', map: ARENA_DELIVERABLE_KIND_MAP }, required: true },
  ],
  structured: [
    { raw_field: 'claims', canonical_field: 'claims', structure: 'claims' },
    { raw_field: 'content', canonical_field: 'payload', structure: 'payload' },
  ],
  constants: [],
  computed: [{ canonical_field: 'payloadDigest', kind: 'payload-digest' }],
  tolerated: ['messageKind', 'messageId'],
  instant_policy: { instant_basis: 'raw-field', instant_field: 'deliveredAtMs', canonical_field: 'submittedAt' },
});

/** The full declared table set. */
export const ARENA_MAPPING_TABLES: readonly MappingTable[] = Object.freeze([
  ARENA_CATALOG_TABLE,
  ARENA_QUOTE_TABLE,
  ARENA_DELIVERY_TABLE,
]);
