/**
 * @tradrl/adapter-arena — the public API.
 *
 * The T046 Arena provider adapter — the OPTIONAL human-expertise path
 * (spec/ADAPTERS.md "Human expertise": "Arena is one optional
 * capability provider"; spec/ARCHITECTURE-LOCK.md L1/L17: the native
 * loop works without it). This adapter is the consumption side of
 * T045's capability-provider interface: it MINTS the provider-neutral
 * envelopes (declarations, quotes, deliverables) the platform's
 * exchange registers, and it ROUTES the platform's requests onto the
 * documented Arena wire. Public API:
 *
 *   - `ARENA_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "arena", category human, the documented wire channels,
 *     the declared capability contracts, the full deliverable and
 *     verification vocabularies, the honest delayed latency class).
 *   - `ARENA_CATALOG` — the declared capability catalog in T045's
 *     measured-evidence language (L16a — never profession labels).
 *   - Documented wire SCHEMAS (./schemas.ts) — total guards over the
 *     three Arena wire channels (catalog, quotes, deliveries); unknown
 *     discriminators and malformed fields are typed failures.
 *   - `ARENA_MAPPING_TABLES` — every consumed raw wire field ->
 *     canonical T045 envelope field, with the declared instant
 *     policies and the declared wire-vocabulary enum maps (L4, L13).
 *   - `buildArenaCapabilityRequest` — the L17 optional-path routing:
 *     the PURE translation of a platform capability request onto the
 *     documented wire frame (catalog-envelope cross-check, goalposts
 *     VERBATIM, typed refusals).
 *   - `createArenaAdapterSession` — the session lifecycle
 *     (open/subscribe/nextEnvelope/onEnvelope/pump/close) over an
 *     INJECTED transport port, with the provider guard pipeline
 *     (schema validation, dedup, correlation + goalpost pre-checks)
 *     and the optional-path seam (routeRequest/announceEngagement).
 *   - `ARENA_ENGAGEMENT_ENTITLEMENT` / `ARENA_CATALOG_ENTITLEMENT` /
 *     `ARENA_ENTITLEMENT` — the declared entitlement tiers; every
 *     emission carries the entitlement ref, and emission without the
 *     declaration is a typed EntitlementError.
 *   - `ARENA_RATE_QUOTA` / `ARENA_RATE_QUOTA_SET` /
 *     `enforceArenaRateQuota` — the documented wire limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `ARENA_HEALTH_THRESHOLDS` — the declared liveness envelope.
 *   - The T041 job projection — `arenaRequestJobPayload` /
 *     `narrowArenaRequestJobPayload` / `arenaRequestJobIdempotencyKey`:
 *     a routed request rides the public jobs routes as an opaque spec,
 *     with the SDK-parity idempotency key.
 *   - The full contract mirror (./contract) — the T045
 *     capability-provider interface shapes (the consumption surface)
 *     plus the provider-sdk session/transport contracts, re-declared
 *     and implemented here (law D-003/D-004: structural mirrors,
 *     never imports), drift-checked against the REAL lanes in the
 *     interop test (which also drives the REAL T045 exchange
 *     end-to-end with adapter-minted envelopes).
 *
 * LAWS HELD (violations = rejection):
 *   - ZERO runtime dependencies; no `any`; total hand-rolled guards.
 *   - NO NETWORK: the transport is an injected port; all tests run over
 *     scripted fakes. No secrets, no API keys, no account-specific data.
 *   - NO IMPORTS of @tradrl/capability-provider, @tradrl/provider-sdk
 *     or any other package in the sources (cross-package imports
 *     happen ONLY in tests, via relative paths — the repo's
 *     established pattern).
 *   - deepFreeze everything public; no ambient wall-clock reads and no
 *     ambient randomness; byte-determinism.
 *   - L1/L17 (the optional path): Arena is NEVER in the critical
 *     native learning loop — nothing outside this package imports it
 *     (zero workspace edges), and the adapter only ever TRANSLATES
 *     (the platform's exchange decides; the platform's machinery
 *     verifies — the provider never verifies its own deliverable,
 *     L20).
 *   - L12: the session operates within exactly one tenant/project
 *     scope; the wire never carries tenant identity.
 *   - L13: the minted envelopes are provider-neutral T045 shapes; the
 *     Arena wire vocabulary lives ONLY in this package's declaration
 *     layers (the neutrality trip-wire test walks every emitted
 *     envelope).
 */

// The provider-neutral contract layer (the consumed lanes' shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { ArenaProtocolErrorCode } from './protocol';
export {
  ARENA_PROTOCOL_CODES,
  arenaProtocolError,
  arenaProtocolCodeOf,
  isArenaProtocolError,
} from './protocol';

// The declared source descriptor, identity and capability catalog.
export {
  ARENA_PROVIDER_ID,
  ARENA_ADAPTER,
  ARENA_CHANNELS,
  ARENA_CAPABILITY_KEYS,
  ARENA_DELIVERABLE_KIND_MAP,
  ARENA_VERIFICATION_KIND_MAP,
  ARENA_DELIVERABLE_KINDS,
  ARENA_VERIFICATION_KINDS,
  ARENA_CATALOG,
  ARENA_SOURCE_DESCRIPTOR,
  arenaCatalogAccepts,
} from './descriptor';
export type { ArenaCatalogOffer } from './descriptor';

// The documented wire schemas (guards + the raw field vocabulary).
export {
  ARENA_WIRE_FIELD_NAMES,
  ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL,
  ARENA_MESSAGE_KINDS,
  guardArenaCatalogPayload,
  guardArenaQuotePayload,
  guardArenaDeliveryPayload,
} from './schemas';
export type { ArenaCatalogMessage, ArenaQuoteMessage, ArenaDeliveryMessage } from './schemas';

// The declared mapping tables.
export {
  ARENA_CHANNEL_TABLE_IDS,
  ARENA_CATALOG_TABLE,
  ARENA_QUOTE_TABLE,
  ARENA_DELIVERY_TABLE,
  ARENA_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement tiers.
export {
  ARENA_ENGAGEMENT_ENTITLEMENT,
  ARENA_CATALOG_ENTITLEMENT,
  ARENA_ENTITLEMENT,
} from './entitlement';

// The declarative rate quotas + enforcement.
export {
  ARENA_RATE_QUOTA,
  ARENA_RATE_QUOTA_SET,
  enforceArenaRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { ARENA_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { ArenaChannel } from './requests';
export {
  arenaSubscribeRequest,
  arenaSubscription,
} from './requests';

// The L17 optional-path outbound routing.
export {
  ARENA_REQUEST_CHANNEL,
  buildArenaCapabilityRequest,
  goalpostBytes,
} from './routing';
export type { ArenaRequestRouting, ArenaRoutedRequest } from './routing';

// The guard transport (the provider inbound pipeline).
export type { ArenaGuardTransport, ArenaConversationState } from './guard-transport';
export {
  createArenaGuardTransport,
  createArenaConversationState,
} from './guard-transport';

// The adapter session.
export type { ArenaSessionConfig, ArenaAdapterSession, EmittedEnvelope as ArenaEmittedEnvelope } from './session';
export {
  createArenaAdapterSession,
  createArenaSessionWithoutEntitlement,
} from './session';

// The T041 job projection (the localization boundary), renamed to the arena namespace.
export {
  CAPABILITY_REQUEST_JOB_OPERATION as ARENA_REQUEST_JOB_OPERATION,
  capabilityRequestJobPayload as arenaRequestJobPayload,
  narrowCapabilityRequestJobPayload as narrowArenaRequestJobPayload,
  capabilityRequestJobIdempotencyKey as arenaRequestJobIdempotencyKey,
} from './contract/provider-jobs';
export type { CapabilityRequestJobPayload as ArenaRequestJobPayload } from './contract/provider-jobs';

/** Package identity and ownership (Work Order T046). */
export const packageInfo = {
  name: '@tradrl/adapter-arena',
  owner: 'T046',
  status: 'implemented',
  concepts: [
    'ArenaSourceDescriptor',
    'ArenaCatalog',
    'ArenaWireSchemas',
    'ArenaMappingTables',
    'ArenaCapabilityRequestRouting',
    'ArenaGuardTransport',
    'ArenaAdapterSession',
    'ArenaEntitlementTiers',
  ],
} as const;
