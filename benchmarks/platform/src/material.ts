/**
 * @tradrl/benchmarks-platform — the MATERIAL SOURCES + the EVIDENCE-CLASS
 * LAW (Work Order T049; canonical owners: research/benchmarks T032 for the
 * source mirrors, services/market-world/generative T028 for the population
 * semantics, spec/EVALUATION-PROTOCOL.md for the class law).
 *
 * WHAT A MEASUREMENT RUNS OVER: the material block names the data/regime
 * source the measured subject ran on — a REPLAY DATASET (T009 historical
 * streams), a GENERATIVE REGIME POPULATION (T028's declared seeded
 * processes — the counterfactual/exploration instrument), or a LIVE
 * SESSION (captured consequential execution). Every source is
 * content-addressed (`rsrc:` / `gsrc:` / `lsrc:`) over its canonical
 * content, so identical sources address identically (L9).
 *
 * THE EVIDENCE-CLASS LAW (the EVALUATION-PROTOCOL's closing line:
 * "Simulation evidence and live evidence are never conflated"):
 * - a suite declares ONE class; a measurement's material must agree
 *   (`evidence_conflated`);
 * - a LIVE-class suite binding simulation-origin material fails
 *   `live_claim_on_simulation` (L5/L6);
 * - a material source claiming a fidelity its kind cannot honestly claim
 *   fails `fidelity_claim_dishonest` (the T028 mirror: a generative
 *   population's origin is 'generated', never 'historical').
 *
 * THE SYNTHETIC-HOLDOUT LAW (the T031 mirror, the T028 complementary
 * half): generative material is EXPLORATION material — a holdout-phase
 * measurement may never draw its unseen material from a generative
 * population (`synthetic_holdout`): synthetic data does not serve as
 * unseen holdout evidence, whatever the declaration says.
 */

import { deepFreeze, isDigest, isNonEmptyString, isPositiveInteger, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';

// ---------------------------------------------------------------------------
// The evidence class (the closed vocabulary)
// ---------------------------------------------------------------------------

/** Simulation vs live — the evidence classes (MIRROR of research/benchmarks T032). */
export const EVIDENCE_CLASSES = ['simulation', 'live'] as const;

/** One evidence class. */
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Guard: an evidence class. */
export function isEvidenceClass(v: unknown): v is EvidenceClass {
  return typeof v === 'string' && (EVIDENCE_CLASSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The replay data source (T009 mirror)
// ---------------------------------------------------------------------------

/** `rsrc:` — the replay data source identity prefix (MIRROR of research/benchmarks). */
export const REPLAY_SOURCE_ID_PREFIX = 'rsrc:' as const;

/** The replay data source — MIRROR of research/benchmarks' `ReplayDataSource` (T009/T032). */
export interface ReplayDataSource {
  readonly source_id: string;
  readonly kind: 'replay-dataset';
  readonly origin: 'historical';
  /** Opaque refs of the recorded event stream batches (non-empty, unique). */
  readonly stream_refs: readonly string[];
  /** The deterministic digest of the replay world config (T009 `configHash` mirror). */
  readonly config_digest: string;
  /** The stream's coverage window [start, end). */
  readonly coverage: { readonly start: number; readonly end: number };
}

/** Guard: `ReplayDataSource`. */
export function isReplayDataSource(v: unknown): v is ReplayDataSource {
  if (!isRecord(v)) return false;
  if (typeof v.source_id !== 'string' || !v.source_id.startsWith(REPLAY_SOURCE_ID_PREFIX)) return false;
  if (v.kind !== 'replay-dataset' || v.origin !== 'historical') return false;
  if (!Array.isArray(v.stream_refs) || v.stream_refs.length === 0) return false;
  if (!(v.stream_refs as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  if (new Set(v.stream_refs as readonly string[]).size !== (v.stream_refs as readonly unknown[]).length) return false;
  if (!isNonEmptyString(v.config_digest)) return false;
  // The T032 owner's law: a source's config digest is the deterministic digest
  // of the (replay/generative/live) world config — 16-hex, never a free label.
  if (!isDigest(v.config_digest)) return false;
  const coverage: unknown = v.coverage;
  if (!isRecord(coverage) || !isTimestampMs(coverage.start) || !isTimestampMs(coverage.end)) return false;
  return (coverage as { start: number; end: number }).end > (coverage as { start: number; end: number }).start;
}

/** The canonical replay-source JSON (the content-addressing input; no `source_id`). */
export function replaySourceJson(content: Omit<ReplayDataSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    stream_refs: content.stream_refs,
    config_digest: content.config_digest,
    coverage: content.coverage as unknown as JsonObject,
  };
}

/** Compute the content address of a replay source: `rsrc:<digest>`. */
export function replaySourceId(content: Omit<ReplayDataSource, 'source_id'>): string {
  return `${REPLAY_SOURCE_ID_PREFIX}${stableDigestJson(replaySourceJson(content))}`;
}

/** The content digest of a replay source (measurement lineage binding). */
export function replaySourceDigest(source: ReplayDataSource): string {
  return stableDigestJson(replaySourceJson(source));
}

// ---------------------------------------------------------------------------
// The generative regime population (T028 mirror)
// ---------------------------------------------------------------------------

/** `gsrc:` — the generative population identity prefix (MIRROR of research/benchmarks). */
export const GENERATIVE_SOURCE_ID_PREFIX = 'gsrc:' as const;

/** The declared stochastic process kinds — MIRROR of T028's process vocabulary (via research/benchmarks). */
export const PROCESS_KINDS_MIRROR = [
  'reference_price_walk',
  'market_maker',
  'momentum_taker',
  'mean_reverter',
  'noise_trader',
] as const;

/** One declared process kind. */
export type ProcessKindMirror = (typeof PROCESS_KINDS_MIRROR)[number];

/** Guard: a process kind (mirror). */
export function isProcessKindMirror(v: unknown): v is ProcessKindMirror {
  return typeof v === 'string' && (PROCESS_KINDS_MIRROR as readonly string[]).includes(v);
}

/** One declared seeded stochastic process — MIRROR of T028's process declarations. */
export interface ProcessDeclarationMirror {
  readonly process_id: string;
  readonly version: string;
  readonly kind: ProcessKindMirror;
  readonly seed: string;
  readonly step_ms: number;
  readonly params: JsonObject;
}

/** Guard: `ProcessDeclarationMirror`. */
export function isProcessDeclarationMirror(value: unknown): value is ProcessDeclarationMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.process_id)) return false;
  if (!isNonEmptyString(value.version)) return false;
  if (!isProcessKindMirror(value.kind)) return false;
  if (!isNonEmptyString(value.seed)) return false;
  if (!isPositiveInteger(value.step_ms)) return false;
  const params: unknown = value.params;
  return isRecord(params) && Object.values(params).every((element) => {
    if (element === null || typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean') return true;
    if (Array.isArray(element)) return element.every((item) => item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
    return false;
  });
}

/** The generative regime population source — MIRROR of research/benchmarks' `RegimePopulationSource` (T028/T032). */
export interface RegimePopulationSource {
  readonly source_id: string;
  readonly kind: 'generative-population';
  readonly origin: 'generated';
  /** Regime labels the population generates for SEARCH material (non-empty, unique). */
  readonly regimes: readonly string[];
  /** Regime labels held OUT of the search population (unique; disjoint from `regimes`). */
  readonly unseen_regimes: readonly string[];
  /** The declared seeded stochastic processes (non-empty; unique process ids). */
  readonly processes: readonly ProcessDeclarationMirror[];
  /** The population's opaque deterministic seed (T028 mirror). */
  readonly seed: string;
  /** The deterministic digest of the generative world config (T028 config-hash mirror). */
  readonly config_digest: string;
}

/** Guard: `RegimePopulationSource`. */
export function isRegimePopulationSource(v: unknown): v is RegimePopulationSource {
  if (!isRecord(v)) return false;
  if (typeof v.source_id !== 'string' || !v.source_id.startsWith(GENERATIVE_SOURCE_ID_PREFIX)) return false;
  if (v.kind !== 'generative-population') return false;
  // The T028 synthetic-provenance law: a generative population's origin is
  // 'generated'; anything else is a fidelity claim the kind cannot make.
  if (v.origin !== 'generated') return false;
  if (!Array.isArray(v.regimes) || v.regimes.length === 0) return false;
  if (!(v.regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  if (new Set(v.regimes as readonly string[]).size !== (v.regimes as readonly unknown[]).length) return false;
  if (!Array.isArray(v.unseen_regimes)) return false;
  if (!(v.unseen_regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  if (new Set(v.unseen_regimes as readonly string[]).size !== (v.unseen_regimes as readonly unknown[]).length) return false;
  const seen = new Set<string>([...(v.regimes as readonly string[]), ...(v.unseen_regimes as readonly string[])]);
  if (seen.size !== (v.regimes as readonly unknown[]).length + (v.unseen_regimes as readonly unknown[]).length) return false;
  if (!Array.isArray(v.processes) || v.processes.length === 0) return false;
  if (!(v.processes as readonly unknown[]).every((process) => isProcessDeclarationMirror(process))) return false;
  const processIds = (v.processes as readonly ProcessDeclarationMirror[]).map((process) => process.process_id);
  if (new Set(processIds).size !== processIds.length) return false;
  if (!isNonEmptyString(v.seed)) return false;
  // The T032 owner's law (generative-mirror): the config digest is 16-hex.
  if (!isDigest(v.config_digest)) return false;
  return true;
}

/** The canonical generative-source JSON (the content-addressing input; no `source_id`). */
export function generativeSourceJson(content: Omit<RegimePopulationSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    regimes: content.regimes,
    unseen_regimes: content.unseen_regimes,
    processes: content.processes as unknown as readonly JsonObject[],
    seed: content.seed,
    config_digest: content.config_digest,
  };
}

/** Compute the content address of a generative source: `gsrc:<digest>`. */
export function generativeSourceId(content: Omit<RegimePopulationSource, 'source_id'>): string {
  return `${GENERATIVE_SOURCE_ID_PREFIX}${stableDigestJson(generativeSourceJson(content))}`;
}

/** The content digest of a generative source (measurement lineage binding). */
export function generativeSourceDigest(source: RegimePopulationSource): string {
  return stableDigestJson(generativeSourceJson(source));
}

// ---------------------------------------------------------------------------
// The live session source (the live evidence class)
// ---------------------------------------------------------------------------

/** `lsrc:` — the live-session identity prefix (MIRROR of research/benchmarks). */
export const LIVE_SOURCE_ID_PREFIX = 'lsrc:' as const;

/** The live-session source — MIRROR of research/benchmarks' `LiveSessionSource` (T032). */
export interface LiveSessionSource {
  readonly source_id: string;
  readonly kind: 'live-session';
  readonly origin: 'historical';
  /** The venue the session executed on (non-empty). */
  readonly venue: string;
  /** Opaque refs of the recorded live-session streams (non-empty, unique). */
  readonly session_refs: readonly string[];
  /** The digest of the capture configuration. */
  readonly config_digest: string;
  /** The session's captured window [start, end). */
  readonly captured: { readonly start: number; readonly end: number };
}

/** Guard: `LiveSessionSource`. */
export function isLiveSessionSource(v: unknown): v is LiveSessionSource {
  if (!isRecord(v)) return false;
  if (typeof v.source_id !== 'string' || !v.source_id.startsWith(LIVE_SOURCE_ID_PREFIX)) return false;
  if (v.kind !== 'live-session' || v.origin !== 'historical') return false;
  if (!isNonEmptyString(v.venue)) return false;
  if (!Array.isArray(v.session_refs) || v.session_refs.length === 0) return false;
  if (!(v.session_refs as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  if (new Set(v.session_refs as readonly string[]).size !== (v.session_refs as readonly unknown[]).length) return false;
  if (!isNonEmptyString(v.config_digest)) return false;
  // The T032 owner's law (evidence.ts): the capture config digest is 16-hex.
  if (!isDigest(v.config_digest)) return false;
  const captured: unknown = v.captured;
  if (!isRecord(captured) || !isTimestampMs(captured.start) || !isTimestampMs(captured.end)) return false;
  return (captured as { start: number; end: number }).end > (captured as { start: number; end: number }).start;
}

/** The canonical live-source JSON (the content-addressing input; no `source_id`). */
export function liveSourceJson(content: Omit<LiveSessionSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    venue: content.venue,
    session_refs: content.session_refs,
    config_digest: content.config_digest,
    captured: content.captured as unknown as JsonObject,
  };
}

/** Compute the content address of a live source: `lsrc:<digest>`. */
export function liveSourceId(content: Omit<LiveSessionSource, 'source_id'>): string {
  return `${LIVE_SOURCE_ID_PREFIX}${stableDigestJson(liveSourceJson(content))}`;
}

/** The content digest of a live source (measurement lineage binding). */
export function liveSourceDigest(source: LiveSessionSource): string {
  return stableDigestJson(liveSourceJson(source));
}

// ---------------------------------------------------------------------------
// The source union + the class laws
// ---------------------------------------------------------------------------

/** The material source kinds (MIRROR of research/benchmarks' `SOURCE_KINDS`). */
export const SOURCE_KINDS = ['replay-dataset', 'generative-population', 'live-session'] as const;

/** One material source kind. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Guard: a source kind. */
export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);
}

/** Any material source (the union). */
export type MaterialSource = ReplayDataSource | RegimePopulationSource | LiveSessionSource;

/** Guard: any material source. */
export function isMaterialSource(v: unknown): v is MaterialSource {
  return isReplayDataSource(v) || isRegimePopulationSource(v) || isLiveSessionSource(v);
}

/** The data-origin vocabulary of material sources ('historical' | 'generated'). */
export type SourceOrigin = 'historical' | 'generated';

/** The origin of a material source ('historical' for replay/live capture; 'generated' for populations). */
export function materialOrigin(source: MaterialSource): SourceOrigin {
  return source.origin;
}

/** The kind of a material source. */
export function materialKind(source: MaterialSource): SourceKind {
  return source.kind;
}

/** The content digest of any material source. */
export function materialDigest(source: MaterialSource): string {
  if (isReplayDataSource(source)) return replaySourceDigest(source);
  if (isRegimePopulationSource(source)) return generativeSourceDigest(source);
  return liveSourceDigest(source);
}

/**
 * THE EVIDENCE-CLASS CHECK (the class law, fail-closed): a suite's declared
 * class vs the material's origin.
 * - A 'live'-class suite over a generative population or a replay dataset
 *   is `live_claim_on_simulation`: simulation evidence never passes as
 *   live evidence (L5/L6).
 * - A 'simulation'-class suite over a live-session capture is
 *   `evidence_conflated`: live evidence is its own class (it may be
 *   PUBLISHED as live, but a simulation suite never claims it).
 */
export function checkEvidenceClass(suiteClass: EvidenceClass, source: MaterialSource): { ok: true } | { ok: false; code: 'live_claim_on_simulation' | 'evidence_conflated'; message: string } {
  const origin = materialOrigin(source);
  if (suiteClass === 'live' && origin === 'generated') {
    return {
      ok: false,
      code: 'live_claim_on_simulation',
      message: `a live-class suite cannot measure over generated material "${source.source_id}" — simulation evidence and live evidence are never conflated (L5/L6)`,
    };
  }
  if (suiteClass === 'live' && source.kind === 'replay-dataset') {
    return {
      ok: false,
      code: 'live_claim_on_simulation',
      message: `a live-class suite cannot measure over replay material "${source.source_id}" — a replay is simulation, not consequential execution (L5)`,
    };
  }
  if (suiteClass === 'simulation' && source.kind === 'live-session') {
    return {
      ok: false,
      code: 'evidence_conflated',
      message: `a simulation-class suite cannot measure over live session "${source.source_id}" — live evidence is its own class and never feeds a simulation claim`,
    };
  }
  return { ok: true };
}

