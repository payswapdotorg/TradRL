/**
 * @tradrl/trajectory — the L9 lineage block (trajectory metadata).
 *
 * ARCHITECTURE-LOCK L9 (reproducible lineage): "results bind data, code,
 * body, substrate, environment, runtime, evaluator and config." A trajectory
 * is the EXPERIENCE half of a result — every trajectory therefore binds its
 * full lineage as opaque versioned references BEFORE any evaluation exists.
 * Reproducibility is a record property, not an afterthought.
 *
 * Mandatory lineage (each guarded; absence or emptiness fails the guard —
 * see metadata.test.ts for the negative paths):
 * - `episodeRef` — the executed episode (T005 environment-protocol).
 * - `environmentConfigRef` — the environment configuration (typically a
 *   content hash) the episode ran under.
 * - `bodyVersionRefs` — the immutable body versions that acted (>= 1).
 * - `substrateRefs` — the cognitive substrates that possessed them (>= 1).
 * - `runtimeRef` — the runtime instance that executed the episode.
 * - `dataRefs` — the input datasets the run consumed (>= 1; a generative
 *   run references its seed/scenario dataset — lineage is never implicit).
 * - `tenantRef` / `projectRef` — tenancy (L12) and project continuity (L15).
 * - `fidelity` — the world fidelity mode (L5): a generative trajectory is
 *   evidence of a different epistemic kind than an exact replay.
 */

import { duplicatesOf, isRecord } from './primitives';
import {
  isBodyVersionRef,
  isDataRef,
  isEnvironmentConfigRef,
  isEpisodeRef,
  isProjectRef,
  isRuntimeRef,
  isSubstrateRef,
  isTenantRef,
  type BodyVersionRef,
  type DataRef,
  type EnvironmentConfigRef,
  type EpisodeRef,
  type ProjectRef,
  type RuntimeRef,
  type SubstrateRef,
  type TenantRef,
} from './ids';
import { FIDELITY_MODES, isFidelityMode, type FidelityMode } from './clock';

/**
 * The full L9 lineage block of a trajectory. Every field is required and
 * guard-validated; list fields must be non-empty and duplicate-free
 * (a lineage that names the same body version twice is corruption).
 */
export interface TrajectoryMetadata {
  /** The executed episode this trajectory records (T005 lane). */
  readonly episodeRef: EpisodeRef;
  /** Environment configuration reference — typically a content hash (T005 lane). */
  readonly environmentConfigRef: EnvironmentConfigRef;
  /** Immutable body versions that acted during the episode (>= 1, unique). */
  readonly bodyVersionRefs: readonly BodyVersionRef[];
  /** Cognitive substrates that possessed the bodies (>= 1, unique). */
  readonly substrateRefs: readonly SubstrateRef[];
  /** The runtime instance that executed the episode. */
  readonly runtimeRef: RuntimeRef;
  /** Input datasets consumed by the run (>= 1, unique; T008 owns referents). */
  readonly dataRefs: readonly DataRef[];
  /** Owning tenant (L12 isolation). */
  readonly tenantRef: TenantRef;
  /** Owning project (L15 project continuity). */
  readonly projectRef: ProjectRef;
  /** World fidelity mode the episode ran under (L5). */
  readonly fidelity: FidelityMode;
}

/** Names of the mandatory lineage lists, for guard diagnostics and tests. */
export const LINEAGE_LIST_FIELDS: readonly ('bodyVersionRefs' | 'substrateRefs' | 'dataRefs')[] = [
  'bodyVersionRefs',
  'substrateRefs',
  'dataRefs',
];

/** Guard: a complete, valid trajectory lineage block. */
export function isTrajectoryMetadata(value: unknown): value is TrajectoryMetadata {
  if (!isRecord(value)) return false;
  if (!isEpisodeRef(value.episodeRef)) return false;
  if (!isEnvironmentConfigRef(value.environmentConfigRef)) return false;
  if (!Array.isArray(value.bodyVersionRefs)) return false;
  if (!value.bodyVersionRefs.every(isBodyVersionRef)) return false;
  if (value.bodyVersionRefs.length === 0) return false;
  if (duplicatesOf([...value.bodyVersionRefs]).length > 0) return false;
  if (!Array.isArray(value.substrateRefs)) return false;
  if (!value.substrateRefs.every(isSubstrateRef)) return false;
  if (value.substrateRefs.length === 0) return false;
  if (duplicatesOf([...value.substrateRefs]).length > 0) return false;
  if (!Array.isArray(value.dataRefs)) return false;
  if (!value.dataRefs.every(isDataRef)) return false;
  if (value.dataRefs.length === 0) return false;
  if (duplicatesOf([...value.dataRefs]).length > 0) return false;
  if (!isRuntimeRef(value.runtimeRef)) return false;
  if (!isTenantRef(value.tenantRef)) return false;
  if (!isProjectRef(value.projectRef)) return false;
  return isFidelityMode(value.fidelity);
}

/** Exposed for doc/guard parity tests (vocabulary completeness). */
export const TRAJECTORY_FIDELITY_MODES: readonly FidelityMode[] = FIDELITY_MODES;
