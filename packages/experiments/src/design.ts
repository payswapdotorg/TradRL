/**
 * @tradrl/experiments — the experiment design.
 *
 * spec/DOMAIN-MODEL.md (Experiment): "Hypothesis, intervention, comparison,
 * splits, candidate organization, bodies/substrates, datasets, environment
 * configuration and evaluator version." Every field of
 * {@link ExperimentDesign} maps one-to-one onto that sentence, as opaque
 * versioned references wherever the referent is owned by another lane (L9 —
 * reproducible lineage: an experiment binds data, code, body, substrate,
 * environment, runtime AND evaluator before its first trial runs).
 *
 * The design is the FIXED half of an experiment: it is set at creation and
 * never edited (the record it lives in is append-only — see record.ts). The
 * MOVABLE half is the trial log, and its append-only discipline is what
 * preserves the search history (L11).
 */

import { deepFreeze, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExpError, type ExpResult } from './errors';
import type {
  ArmId,
  BodyVersionRef,
  DataRef,
  EnvironmentConfigRef,
  EvaluatorVersionRef,
  OrganizationId,
  SplitPolicyRef,
  SubstrateRef,
} from './ids';
import {
  isArmId,
  isBodyVersionRef,
  isDataRef,
  isEnvironmentConfigRef,
  isEvaluatorVersionRef,
  isOrganizationId,
  isSplitPolicyRef,
  isSubstrateRef,
} from './ids';

/**
 * The role of a comparison arm. `control` is the baseline the intervention is
 * measured against; `treatment` carries the intervention. Multiple treatment
 * arms are legal (multi-candidate comparisons); multiple controls are legal
 * but unusual — the guard only requires at least one treatment arm.
 */
export type ArmRole = 'control' | 'treatment';

/** Runtime-checkable list of arm roles. */
export const ARM_ROLES: readonly ArmRole[] = ['control', 'treatment'];

/** One comparison arm of the design (opaque: what distinguishes it belongs to the evaluator). */
export interface ArmDescriptor {
  readonly arm: ArmId;
  readonly role: ArmRole;
  /** Human-readable statement of what this arm runs. */
  readonly description: string;
}

/**
 * The intervention under study — WHAT is being manipulated. Opaque to this
 * package: `kind` names the intervention taxonomy entry (owned by the
 * learning/organization lanes), `parameters` carries its JSON configuration.
 */
export interface InterventionDescriptor {
  /** Opaque intervention kind (e.g. 'body-swap', 'topology-change', 'reward-shaping'). */
  readonly kind: string;
  /** Human-readable statement of the intervention. */
  readonly description: string;
  /** The intervention's configuration (JSON object; may be empty). */
  readonly parameters: JsonObject;
}

/** The experiment design (see module header for the DOMAIN-MODEL mapping). */
export interface ExperimentDesign {
  /** The falsifiable statement under test. Non-empty. */
  readonly hypothesis: string;
  /** What is being manipulated. */
  readonly intervention: InterventionDescriptor;
  /** The comparison arms. Non-empty; at least one `treatment` arm; unique arm ids. */
  readonly comparison: readonly ArmDescriptor[];
  /** Split policy refs (arm assignment, walk-forward, holdout — L11's in-search vs holdout discriminator). Non-empty. */
  readonly splits: readonly SplitPolicyRef[];
  /** The candidate organization under study (opaque; T002/T016). */
  readonly candidate_organization: OrganizationId;
  /** Body versions in play (non-empty — the experiment has producers). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Substrates those bodies run on (non-empty). */
  readonly substrates: readonly SubstrateRef[];
  /** Datasets the design consumes (may be empty for generative-world experiments). */
  readonly datasets: readonly DataRef[];
  /** Versioned environment configuration (same identity space as trajectory's ref). */
  readonly environment_config: EnvironmentConfigRef;
  /** Versioned evaluator that will score the trials (L9 — evaluation is part of lineage). */
  readonly evaluator_version: EvaluatorVersionRef;
}

/** Runtime guard for an arm role. */
export function isArmRole(value: unknown): value is ArmRole {
  return typeof value === 'string' && (ARM_ROLES as readonly string[]).includes(value);
}

/** Runtime guard for an arm descriptor. */
export function isArmDescriptor(value: unknown): value is ArmDescriptor {
  if (!isRecord(value)) return false;
  return isArmId(value.arm) && isArmRole(value.role) && isNonEmptyString(value.description);
}

/** Runtime guard for an intervention descriptor. */
export function isInterventionDescriptor(value: unknown): value is InterventionDescriptor {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.kind) && isNonEmptyString(value.description) && isJsonObject(value.parameters);
}

/** Runtime guard for a structurally valid, invariant-abiding experiment design. */
export function isExperimentDesign(value: unknown): value is ExperimentDesign {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.hypothesis)) return false;
  if (!isInterventionDescriptor(value.intervention)) return false;
  if (!Array.isArray(value.comparison) || value.comparison.length === 0) return false;
  const comparison = value.comparison as readonly unknown[];
  if (!comparison.every((arm) => isArmDescriptor(arm))) return false;
  const arms = comparison.every(isArmDescriptor) ? (comparison as readonly ArmDescriptor[]) : [];
  if (!arms.some((arm) => arm.role === 'treatment')) return false;
  const armIds = arms.map((arm) => arm.arm);
  if (armIds.some((arm, index) => armIds.indexOf(arm) !== index)) return false;
  if (!Array.isArray(value.splits) || value.splits.length === 0) return false;
  if (!(value.splits as readonly unknown[]).every((ref) => isSplitPolicyRef(ref))) return false;
  if (!isOrganizationId(value.candidate_organization)) return false;
  if (!Array.isArray(value.body_versions) || value.body_versions.length === 0) return false;
  if (!(value.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(value.substrates) || value.substrates.length === 0) return false;
  if (!(value.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  if (!Array.isArray(value.datasets)) return false;
  if (!(value.datasets as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  if (!isEnvironmentConfigRef(value.environment_config)) return false;
  if (!isEvaluatorVersionRef(value.evaluator_version)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted experiment design. Enforces the
 * comparison invariants (non-empty, at least one treatment arm, unique arm
 * ids) and the lineage floor (non-empty producer sets and split refs). On
 * success the value is returned narrowed, deeply frozen.
 */
export function validateExperimentDesign(value: unknown, path = 'design'): ExpResult<ExperimentDesign> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExpError[] = [];

  if (value.hypothesis === undefined) {
    errors.push(missingField(`${path}.hypothesis`));
  } else if (!isNonEmptyString(value.hypothesis)) {
    errors.push(invalidField(`${path}.hypothesis`, 'must be a non-empty falsifiable statement'));
  }

  let intervention: InterventionDescriptor | undefined;
  if (value.intervention === undefined) {
    errors.push(missingField(`${path}.intervention`));
  } else if (!isInterventionDescriptor(value.intervention)) {
    if (!isRecord(value.intervention)) {
      errors.push(invalidField(`${path}.intervention`, 'must be an object { kind, description, parameters }'));
    } else if (!isNonEmptyString(value.intervention.kind)) {
      errors.push(invalidField(`${path}.intervention.kind`, 'must be a non-empty intervention kind'));
    } else if (!isNonEmptyString(value.intervention.description)) {
      errors.push(invalidField(`${path}.intervention.description`, 'must be a non-empty description'));
    } else {
      errors.push(invalidField(`${path}.intervention.parameters`, 'must be a JSON object'));
    }
  } else {
    intervention = value.intervention;
  }

  let comparison: ArmDescriptor[] | undefined;
  if (value.comparison === undefined) {
    errors.push(missingField(`${path}.comparison`));
  } else if (!Array.isArray(value.comparison)) {
    errors.push(invalidField(`${path}.comparison`, 'must be an array of arm descriptors'));
  } else if (value.comparison.length === 0) {
    errors.push(invalidField(`${path}.comparison`, 'must be non-empty — an experiment compares'));
  } else {
    const arms: ArmDescriptor[] = [];
    const seen = new Set<string>();
    (value.comparison as readonly unknown[]).forEach((arm, index) => {
      if (!isArmDescriptor(arm)) {
        errors.push(invalidField(`${path}.comparison[${index}]`, 'must be { arm, role, description }'));
        return;
      }
      if (seen.has(arm.arm)) {
        errors.push(invalidField(`${path}.comparison[${index}]`, `duplicate arm id "${arm.arm}"`));
        return;
      }
      seen.add(arm.arm);
      arms.push(arm);
    });
    if (errors.length === 0 && !arms.some((arm) => arm.role === 'treatment')) {
      errors.push(invalidField(`${path}.comparison`, 'must contain at least one treatment arm'));
    }
    comparison = arms;
  }

  if (value.splits === undefined) {
    errors.push(missingField(`${path}.splits`));
  } else if (!Array.isArray(value.splits) || value.splits.length === 0) {
    errors.push(
      invalidField(`${path}.splits`, 'must be a non-empty array of split policy refs (L11: in-search vs holdout must be decidable)'),
    );
  } else {
    (value.splits as readonly unknown[]).forEach((ref, index) => {
      if (!isSplitPolicyRef(ref)) {
        errors.push(invalidField(`${path}.splits[${index}]`, 'must be a non-empty split policy ref'));
      }
    });
  }

  if (value.candidate_organization === undefined) {
    errors.push(missingField(`${path}.candidate_organization`));
  } else if (!isOrganizationId(value.candidate_organization)) {
    errors.push(invalidField(`${path}.candidate_organization`, 'must be a non-empty organization ref'));
  }

  if (value.body_versions === undefined) {
    errors.push(missingField(`${path}.body_versions`));
  } else if (!Array.isArray(value.body_versions) || value.body_versions.length === 0) {
    errors.push(invalidField(`${path}.body_versions`, 'must be non-empty — an experiment has producers (L9)'));
  } else {
    (value.body_versions as readonly unknown[]).forEach((ref, index) => {
      if (!isBodyVersionRef(ref)) {
        errors.push(invalidField(`${path}.body_versions[${index}]`, 'must be a non-empty body version ref'));
      }
    });
  }

  if (value.substrates === undefined) {
    errors.push(missingField(`${path}.substrates`));
  } else if (!Array.isArray(value.substrates) || value.substrates.length === 0) {
    errors.push(invalidField(`${path}.substrates`, 'must be non-empty — bodies run on substrates (L9)'));
  } else {
    (value.substrates as readonly unknown[]).forEach((ref, index) => {
      if (!isSubstrateRef(ref)) {
        errors.push(invalidField(`${path}.substrates[${index}]`, 'must be a non-empty substrate ref'));
      }
    });
  }

  if (value.datasets === undefined) {
    errors.push(missingField(`${path}.datasets`));
  } else if (!Array.isArray(value.datasets)) {
    errors.push(invalidField(`${path}.datasets`, 'must be an array of dataset refs (may be empty for generative worlds)'));
  } else {
    (value.datasets as readonly unknown[]).forEach((ref, index) => {
      if (!isDataRef(ref)) {
        errors.push(invalidField(`${path}.datasets[${index}]`, 'must be a non-empty dataset ref'));
      }
    });
  }

  if (value.environment_config === undefined) {
    errors.push(missingField(`${path}.environment_config`));
  } else if (!isEnvironmentConfigRef(value.environment_config)) {
    errors.push(invalidField(`${path}.environment_config`, 'must be a non-empty versioned environment config ref'));
  }

  if (value.evaluator_version === undefined) {
    errors.push(missingField(`${path}.evaluator_version`));
  } else if (!isEvaluatorVersionRef(value.evaluator_version)) {
    errors.push(invalidField(`${path}.evaluator_version`, 'must be a non-empty versioned evaluator ref (L9)'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      hypothesis: value.hypothesis as string,
      intervention: intervention as InterventionDescriptor,
      comparison: comparison as readonly ArmDescriptor[],
      splits: (value.splits as readonly SplitPolicyRef[]).slice(),
      candidate_organization: value.candidate_organization as OrganizationId,
      body_versions: (value.body_versions as readonly BodyVersionRef[]).slice(),
      substrates: (value.substrates as readonly SubstrateRef[]).slice(),
      datasets: (value.datasets as readonly DataRef[]).slice(),
      environment_config: value.environment_config as EnvironmentConfigRef,
      evaluator_version: value.evaluator_version as EvaluatorVersionRef,
    }),
  );
}

/** All arm ids of a design (order preserved). */
export function designArmIds(design: ExperimentDesign): readonly ArmId[] {
  return design.comparison.map((arm) => arm.arm);
}

/** The arm descriptor with the given id, or `undefined`. */
export function findArm(design: ExperimentDesign, arm: ArmId): ArmDescriptor | undefined {
  return design.comparison.find((candidate) => candidate.arm === arm);
}
