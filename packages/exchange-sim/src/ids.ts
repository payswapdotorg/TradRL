// @tradrl/exchange-sim — branded identity references.
//
// Id discipline:
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T010): ExchangeOrderId (venue-assigned order
//   identity), FillId (execution report identity) and the two policy
//   references the environment lane reserves for THIS lane: LatencyPolicyId
//   and FeePolicyId (see environment-protocol ids.ts — "T010 exchange
//   simulation lane").
// - OPAQUE cross-lane references follow the same rule: the referent entity
//   is owned by another Work Order (T002 trading domain, T003 agent lane,
//   T004 market/time lane, T005 environment lane). This package never
//   imports those packages — it only mirrors the reference types here.
//   VenueId, InstrumentId and AgentInstanceId mirror the EXACT brand tags
//   declared by @tradrl/domain-core; Seed mirrors @tradrl/environment-
//   protocol's opaque seed token, so the two declarations stay mutually
//   assignable without a package dependency (same structural-mirror law as
//   TimestampMs).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by exchange-sim (T010) ---------------------------------------

/**
 * Venue-assigned identity of one order known to the exchange simulator.
 * Minted deterministically by the engine from the arrival ordinal
 * (`xo-<8-digit-ordinal>`); unique within one engine instance.
 */
export type ExchangeOrderId = Brand<string, 'ExchangeOrderId'>;

/** Venue-assigned identity of one execution report (fill). Deterministically minted (`xf-<8-digit-ordinal>`). */
export type FillId = Brand<string, 'FillId'>;

/** Reference to a fee policy record owned by this lane (T010). Mirror of environment-protocol's reservation. */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;

/** Reference to a latency policy record owned by this lane (T010). Mirror of environment-protocol's reservation. */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Venue reference (T002/T004 market lanes). Mirror of domain-core's brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** Instrument reference (T002/T004 market lanes). Mirror of domain-core's brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Agent instance (T003 agent lane). Mirror of domain-core's brand. */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/**
 * The deterministic seed of an exchange configuration. Opaque non-empty
 * string whose interpretation (latency draws, fixture streams, ...) belongs
 * to this lane. Mirrors environment-protocol's Seed tag so an exchange
 * spec's seed and an environment profile's seed are mutually assignable.
 */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Guards ------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time.

export const isExchangeOrderId = (v: unknown): v is ExchangeOrderId => isNonEmptyString(v);
export const isFillId = (v: unknown): v is FillId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);

// --- Deterministic id minting ------------------------------------------------

/**
 * Mint a venue order id from an arrival ordinal: `xo-` + zero-padded
 * 8-digit ordinal. Pure and deterministic — same ordinal, same id (L9).
 */
export function mintOrderId(ordinal: number): ExchangeOrderId {
  return `xo-${String(ordinal).padStart(8, '0')}` as ExchangeOrderId;
}

/**
 * Mint a fill id from a fill ordinal: `xf-` + zero-padded 8-digit ordinal.
 * Pure and deterministic — same ordinal, same id (L9).
 */
export function mintFillId(ordinal: number): FillId {
  return `xf-${String(ordinal).padStart(8, '0')}` as FillId;
}
