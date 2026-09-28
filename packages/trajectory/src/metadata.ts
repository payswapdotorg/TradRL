/**
 * @tradrl/trajectory — the trajectory metadata: the L9 lineage block.
 *
 * ARCHITECTURE-LOCK L9 (reproducible lineage): "results bind data, code,
 * body, substrate, environment, runtime, evaluator and config." A trajectory
 * is the EXPERIENCE half of a result, so it binds everything the experience
 * was produced BY — every reference is an opaque, versioned string id:
 *
 *   - `tenant` — the isolation scope (L12; mirror of domain-core's TenantId).
 *   - `project` — the durable continuity root (L15; mirror of ProjectId).
 *   - `episode` — the T005 episode this stream records (mirror of EpisodeId).
 *   - `environment_config` — the versioned environment configuration ref
 *     (structural adapter derives it deterministically from the spec).
 *   - `runtime` — the versioned runtime that drove the episode (T014 runner
 *     or agent runtime).
 *   - `data` — the datasets the episode consumed (T008/T009 data lanes). May
 *     be empty: a purely generative world legitimately consumes no external
 *     dataset (L5 — generative worlds are exploration instruments).
 *   - `body_versions` — the immutable body versions of the producing agent
 *     organization (mirror of agent-os's BodyVersionRef). NON-EMPTY: an
 *     experience stream has producers; an empty producer set is a lineage
 *     hole (negative-tested).
 *   - `substrates` — the cognitive substrates those bodies ran on (mirror of
 *     agent-os's SubstrateRef). NON-EMPTY, same law.
 *
 * There is deliberately NO wall-clock "recorded_at": the trajectory's time
 * axis is the SIMULATED clock (each step carries its own sample), and a
 * wall-clock stamp would break byte-determinism of serialization (same
 * record, same bytes). Consumers needing recording provenance bind it in
 * their persistence layer (T034), not in the record.
 */

import { deepFreeze, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type TrajError, type TrajResult } from './errors';
import type {
  BodyVersionRef,
  DataRef,
  EnvironmentConfigRef,
  EpisodeId,
  ProjectId,
  RuntimeRef,
  SubstrateRef,
  TenantId,
  TrajectoryId,
} from './ids';
import {
  isBodyVersionRef,
  isDataRef,
  isEnvironmentConfigRef,
  isEpisodeId,
  isProjectId,
  isRuntimeRef,
  isSubstrateRef,
  isTenantId,
  isTrajectoryId,
} from './ids';

/**
 * The full L9 lineage block of a trajectory (see module header). Every field
 * is an opaque versioned reference; every field is guard-checked.
 */
export interface TrajectoryMetadata {
  readonly trajectory_id: TrajectoryId;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
  /** The episode this stream records (T005). */
  readonly episode: EpisodeId;
  /** Versioned environment configuration reference (L9). */
  readonly environment_config: EnvironmentConfigRef;
  /** Versioned runtime reference (L9). */
  readonly runtime: RuntimeRef;
  /** Dataset references the episode consumed (may be empty for generative worlds). */
  readonly data: readonly DataRef[];
  /** Body versions of the producing organization (non-empty — the stream's producers). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Cognitive substrates those bodies ran on (non-empty). */
  readonly substrates: readonly SubstrateRef[];
}

/** Runtime guard for a structurally valid, lineage-complete metadata block. */
export function isTrajectoryMetadata(value: unknown): value is TrajectoryMetadata {
  if (!isRecord(value)) return false;
  if (!isTrajectoryId(value.trajectory_id)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isEpisodeId(value.episode)) return false;
  if (!isEnvironmentConfigRef(value.environment_config)) return false;
  if (!isRuntimeRef(value.runtime)) return false;
  if (!Array.isArray(value.data)) return false;
  if (!(value.data as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  if (!Array.isArray(value.body_versions) || value.body_versions.length === 0) return false;
  if (!(value.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(value.substrates) || value.substrates.length === 0) return false;
  if (!(value.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted metadata block. Enforces lineage
 * COMPLETENESS (L9): every mandatory reference must be present and well
 * formed, and the producer sets must be non-empty. On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateTrajectoryMetadata(value: unknown, path = 'metadata'): TrajResult<TrajectoryMetadata> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: TrajError[] = [];

  if (value.trajectory_id === undefined) {
    errors.push(missingField(`${path}.trajectory_id`));
  } else if (!isTrajectoryId(value.trajectory_id)) {
    errors.push(invalidField(`${path}.trajectory_id`, 'must be a non-empty string'));
  }

  if (value.tenant === undefined) {
    errors.push(missingField(`${path}.tenant`));
  } else if (!isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }

  if (value.project === undefined) {
    errors.push(missingField(`${path}.project`));
  } else if (!isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }

  if (value.episode === undefined) {
    errors.push(missingField(`${path}.episode`));
  } else if (!isEpisodeId(value.episode)) {
    errors.push(invalidField(`${path}.episode`, 'must be a non-empty episode id (T005)'));
  }

  if (value.environment_config === undefined) {
    errors.push(missingField(`${path}.environment_config`));
  } else if (!isEnvironmentConfigRef(value.environment_config)) {
    errors.push(invalidField(`${path}.environment_config`, 'must be a non-empty versioned environment config ref (L9)'));
  }

  if (value.runtime === undefined) {
    errors.push(missingField(`${path}.runtime`));
  } else if (!isRuntimeRef(value.runtime)) {
    errors.push(invalidField(`${path}.runtime`, 'must be a non-empty versioned runtime ref (L9)'));
  }

  if (value.data === undefined) {
    errors.push(missingField(`${path}.data`));
  } else if (!Array.isArray(value.data)) {
    errors.push(invalidField(`${path}.data`, 'must be an array of dataset refs (may be empty for generative worlds)'));
  } else {
    (value.data as readonly unknown[]).forEach((ref, index) => {
      if (!isDataRef(ref)) {
        errors.push(invalidField(`${path}.data[${index}]`, 'must be a non-empty dataset ref'));
      }
    });
  }

  if (value.body_versions === undefined) {
    errors.push(missingField(`${path}.body_versions`));
  } else if (!Array.isArray(value.body_versions)) {
    errors.push(invalidField(`${path}.body_versions`, 'must be an array of body version refs'));
  } else if (value.body_versions.length === 0) {
    errors.push(invalidField(`${path}.body_versions`, 'must be non-empty — an experience stream has producers (L9 lineage completeness)'));
  } else {
    (value.body_versions as readonly unknown[]).forEach((ref, index) => {
      if (!isBodyVersionRef(ref)) {
        errors.push(invalidField(`${path}.body_versions[${index}]`, 'must be a non-empty body version ref'));
      }
    });
  }

  if (value.substrates === undefined) {
    errors.push(missingField(`${path}.substrates`));
  } else if (!Array.isArray(value.substrates)) {
    errors.push(invalidField(`${path}.substrates`, 'must be an array of substrate refs'));
  } else if (value.substrates.length === 0) {
    errors.push(invalidField(`${path}.substrates`, 'must be non-empty — bodies run on substrates (L9 lineage completeness)'));
  } else {
    (value.substrates as readonly unknown[]).forEach((ref, index) => {
      if (!isSubstrateRef(ref)) {
        errors.push(invalidField(`${path}.substrates[${index}]`, 'must be a non-empty substrate ref'));
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      trajectory_id: value.trajectory_id as TrajectoryId,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      episode: value.episode as EpisodeId,
      environment_config: value.environment_config as EnvironmentConfigRef,
      runtime: value.runtime as RuntimeRef,
      data: (value.data as readonly DataRef[]).slice(),
      body_versions: (value.body_versions as readonly BodyVersionRef[]).slice(),
      substrates: (value.substrates as readonly SubstrateRef[]).slice(),
    }),
  );
}
