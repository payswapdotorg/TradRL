/**
 * @tradrl/adapter-arena — the declared source descriptor.
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the contract layer knows NO
 * provider; THIS declaration is where the Arena identity lives — "the
 * provider id (an opaque string carrying the provider name)". Every
 * wire semantic in this package (channels, message schemas, mapping
 * tables, entitlement tiers, quotas) is declared HERE or in the sibling
 * declaration modules, never in the contract mirrors, never in the
 * minted canonical envelopes.
 *
 * Declared capability card (Work Order T046 — spec/ADAPTERS.md "Human
 * expertise": "Arena is one optional capability provider. Supported
 * operations: request, expert evidence, demonstration, annotation,
 * evaluation and capability artifact"):
 *   - provider: "arena" (opaque id carrying the provider name);
 *   - category: human (the source family of the capability-provider
 *     domain — this adapter emits capability-provider envelopes, never
 *     market events);
 *   - channels: the documented Arena wire channels this adapter
 *     consumes — "arenaCatalog" (the published capability catalog),
 *     "arenaQuotes" (the quote responses) and "arenaDeliveries" (the
 *     submitted work);
 *   - capability contracts: the declared catalog's capability keys
 *     (declared in {@link ARENA_CATALOG} — the routing cross-check
 *     envelope);
 *   - deliverable kinds: the full ADAPTERS operation list minus
 *     `request` (lifted to the request envelope);
 *   - verification kinds: benchmark | measurement | local-evaluation;
 *   - latency class: delayed (human experts answer in hours, not
 *     milliseconds — the honest declaration).
 *
 * THE OPTIONAL-PATH LAW (L1/L17): Arena is NEVER in the critical native
 * learning loop — nothing outside this package imports it (zero
 * workspace edges), and the descriptor documents the optional path it
 * serves. The declaration is validated (collect-all) and deep-frozen
 * at module load — an immutable capability card; a construction
 * failure is a programming error that fails loudly.
 */

import { validateSourceDescriptor, type SourceDescriptor } from './contract/descriptors';
import type { AdapterRef } from './contract/session';
import type { MeasuredEvidenceMirror } from './contract/provider';
import type { VerificationRequirement } from './contract/provider-envelopes';

/** The provider id — an opaque string carrying the Arena name (Work Order T046). */
export const ARENA_PROVIDER_ID = 'arena';

/** The concrete adapter's identity — the lineage producer on every emitted envelope (L9). */
export const ARENA_ADAPTER: AdapterRef = { id: 'adapter-arena', version: '0.0.0' };

/** The declared raw channels (documented Arena wire channels). */
export const ARENA_CHANNELS: readonly string[] = ['arenaCatalog', 'arenaQuotes', 'arenaDeliveries'];

/**
 * The declared capability contracts the Arena catalog serves (the
 * routing cross-check envelope — a request outside this set is the
 * typed `arena_catalog_mismatch` refusal, never a silent route). The
 * keys are capability CONTRACTS in the T017 language, never profession
 * labels (L16a).
 */
export const ARENA_CAPABILITY_KEYS: readonly string[] = [
  'liquidity-regime-analysis',
  'microstructure-stress-replay',
];

/** The wire deliverable-type code -> canonical DeliverableKind map (the declared enum translation). */
export const ARENA_DELIVERABLE_KIND_MAP: Readonly<Record<string, string>> = Object.freeze({
  EVIDENCE: 'expert-evidence',
  DEMONSTRATION: 'demonstration',
  ANNOTATION: 'annotation',
  ASSESSMENT: 'evaluation',
  ARTIFACT: 'capability-artifact',
});

/** The wire verification-type code -> canonical VerificationKind map. */
export const ARENA_VERIFICATION_KIND_MAP: Readonly<Record<string, string>> = Object.freeze({
  BENCHMARK: 'benchmark',
  MEASUREMENT: 'measurement',
  LOCAL_EVAL: 'local-evaluation',
});

/**
 * The declared Arena catalog: the fixed, SYNTHETIC capability card the
 * adapter declares on the platform's exchange — ONE offer per declared
 * capability contract, each with NON-EMPTY MEASURED evidence (L16a —
 * the Arena's own benchmark record; synthetic opaque refs, no licensed
 * content per spec/ADAPTERS.md Licensing). The host registers this as
 * the arena provider's declaration (version 1, the supersede-history
 * root) within its tenant scope.
 */
export interface ArenaCatalogOffer {
  readonly offerId: string;
  readonly capability: string;
  readonly summary: string;
  readonly evidence: readonly MeasuredEvidenceMirror[];
  readonly scope: { readonly environments: readonly string[]; readonly instruments: readonly string[] };
  readonly deliverableTypes: readonly string[];
  readonly verificationTypes: readonly string[];
}

/** The declared catalog (deterministic, frozen at module load). */
export const ARENA_CATALOG: readonly ArenaCatalogOffer[] = Object.freeze([
  Object.freeze({
    offerId: 'offer-liquidity-regime-analysis',
    capability: 'liquidity-regime-analysis',
    summary: 'Human liquidity-regime analysis under exchange stress windows',
    evidence: Object.freeze([
      Object.freeze({ kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'arena://bench-run-0091' }),
      Object.freeze({ kind: 'measurement-record', recordRef: 'arena://measure-77', metric: 'benchmark-score', value: 0.91 }),
    ] as readonly MeasuredEvidenceMirror[]),
    scope: Object.freeze({
      environments: Object.freeze(['env://stress-windows']),
      instruments: Object.freeze(['class://us-equities', 'class://spot-majors']),
    }),
    deliverableTypes: Object.freeze(['ARTIFACT', 'EVIDENCE']),
    verificationTypes: Object.freeze(['BENCHMARK', 'MEASUREMENT', 'LOCAL_EVAL']),
  }),
  Object.freeze({
    offerId: 'offer-microstructure-stress-replay',
    capability: 'microstructure-stress-replay',
    summary: 'Human-annotated microstructure stress replay scenarios',
    evidence: Object.freeze([
      Object.freeze({ kind: 'benchmark', benchmarkId: 'bench-stress-replay-7', resultRef: 'arena://bench-run-0143' }),
    ] as readonly MeasuredEvidenceMirror[]),
    scope: Object.freeze({
      environments: Object.freeze(['env://stress-windows', 'env://flash-events']),
      instruments: Object.freeze(['class://us-equities']),
    }),
    deliverableTypes: Object.freeze(['DEMONSTRATION', 'ANNOTATION', 'ASSESSMENT']),
    verificationTypes: Object.freeze(['BENCHMARK', 'LOCAL_EVAL']),
  }),
] as readonly ArenaCatalogOffer[]);

/** The declared deliverable kinds (derived from the catalog's wire codes through the declared enum map). */
export const ARENA_DELIVERABLE_KINDS: readonly string[] = Object.freeze(
  [...new Set(ARENA_CATALOG.flatMap((offer) => offer.deliverableTypes.map((code) => ARENA_DELIVERABLE_KIND_MAP[code])))].sort(),
);

/** The declared verification kinds (derived from the catalog's wire codes). */
export const ARENA_VERIFICATION_KINDS: readonly string[] = Object.freeze(
  [...new Set(ARENA_CATALOG.flatMap((offer) => offer.verificationTypes.map((code) => ARENA_VERIFICATION_KIND_MAP[code])))].sort(),
);

const construction = validateSourceDescriptor({
  provider: ARENA_PROVIDER_ID,
  category: 'human',
  capabilities: {
    channels: ARENA_CHANNELS,
    capability_keys: ARENA_CAPABILITY_KEYS,
    deliverable_kinds: ARENA_DELIVERABLE_KINDS,
    verification_kinds: ARENA_VERIFICATION_KINDS,
    latency_class: 'delayed',
  },
});

if (!construction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`ARENA_SOURCE_DESCRIPTOR is invalid: ${construction.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen source descriptor of the Arena adapter. */
export const ARENA_SOURCE_DESCRIPTOR: SourceDescriptor = construction.value;

/**
 * The default verification-contract PROJECTION the Arena catalog
 * accepts — the fixed goalpost vocabulary (per offer: the requirement
 * kinds its evidence discharges). Declared for documentation and tests;
 * the actual contract always arrives FROZEN on the platform's request
 * (goalposts are set by the platform, never by the provider).
 */
export function arenaCatalogAccepts(requirement: VerificationRequirement): boolean {
  const kind = requirement.kind;
  return ARENA_VERIFICATION_KINDS.includes(kind);
}
