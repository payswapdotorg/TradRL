/**
 * @tradrl/data-ingestion — the provider-adapter interface.
 *
 * L13/L14 PROVIDER NEUTRALITY (spec/ADAPTERS.md): external systems are
 * substrates; vendor specifics stay in adapters. This interface is the
 * provider-NEUTRAL boundary every vendor adapter implements:
 *
 *   - `discover()` — what the provider can currently deliver (batches).
 *   - `fetch(batch)` — the raw records of one batch (opaque `Raw` — the
 *     adapter's own vendor shape; nothing else in the plane ever sees it).
 *   - `normalize(raw)` — translate ONE raw record into canonical
 *     event-shaped records plus typed normalization errors. THIS is where
 *     vendor specifics live and die.
 *
 * Adapters preserve provenance and entitlement constraints: every
 * normalized event carries its provenance block, and the adapter
 * descriptor (id + version + provider) is the custody origin the store
 * stamps at commit.
 *
 * Reference adapters are PURE AND DETERMINISTIC (no network, no clock):
 * the synthetic tick and synthetic news adapters produce deterministic
 * streams used by the behavioral suites.
 */

import type { CanonicalEvent } from './canonical-event';
import type { IngestionErrorCode } from './fields';

/** The provider-neutral identity of an adapter. */
export interface AdapterDescriptor {
  /** Adapter id (e.g. "synthetic-tick-adapter", "binance-adapter"). */
  readonly id: string;
  /** Adapter version (e.g. "1.0.0"). */
  readonly version: string;
  /** Provider label (e.g. "synthetic", "binance"). */
  readonly provider: string;
}

/** One ingestion batch as listed by {@link ProviderAdapter.discover}. */
export interface FetchBatch {
  readonly batch_id: string;
  readonly description?: string;
}

/** What the provider can currently deliver. */
export interface DiscoveryReport {
  readonly batches: readonly FetchBatch[];
}

/** Raw records of one fetched batch. `Raw` is the adapter's vendor shape. */
export interface FetchResult<Raw> {
  readonly records: readonly Raw[];
}

/** A typed normalization failure for one raw record. */
export interface NormalizationError {
  /** Adapter-defined code naming the failure (e.g. "missing_headline"). */
  readonly code: string;
  /** Identifies the offending raw record (the adapter's own raw id). */
  readonly raw_id: string;
  readonly message: string;
}

/** The outcome of normalizing one raw record. */
export interface NormalizeResult {
  /** Canonical event-shaped records (usually zero or one). */
  readonly events: readonly CanonicalEvent[];
  /** Typed errors for the parts of the raw record that could not be translated. */
  readonly errors: readonly NormalizationError[];
}

/**
 * The provider-neutral adapter contract. `Raw` is the adapter's own raw
 * record type — vendor specifics NEVER leak past this interface.
 */
export interface ProviderAdapter<Raw> {
  readonly descriptor: AdapterDescriptor;
  /** List the batches this provider can currently deliver. */
  discover(): DiscoveryReport;
  /** Fetch the raw records of one batch. Pure and deterministic in reference adapters. */
  fetch(batch: FetchBatch): FetchResult<Raw>;
  /** Translate one raw record into canonical event-shaped records + errors. */
  normalize(raw: Raw): NormalizeResult;
}

/** Typed normalization error code for the data plane's own helpers. */
export type { IngestionErrorCode };
