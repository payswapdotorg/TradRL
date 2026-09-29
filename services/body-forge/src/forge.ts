/**
 * @tradrl/body-forge (service) — the reference forge.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017, section 5 — "The reference
 * forge: (parent BodyVersion mirror, SkillDelta set, gap records,
 * evidence, seed) -> ForgedCandidate (a full BodyVersion-shaped mirror
 * with parent lineage + delta manifest); the compatibility gate
 * (substrate-compatibility refs validated against the agent-body mirror);
 * the certification path (candidate + verdict refs -> certified or
 * rejected with reasons)".
 *
 * THE EXISTENTIAL LAW (L3, ARCHITECTURE-LOCK: "certified/versioned bodies
 * do not mutate in place"): the forge MINTS new versions — it never
 * mutates. `forgeBodyVersion` always returns a NEW object (the parent is
 * cloned deeply, never touched); `certifyCandidate` refuses an
 * already-certified candidate with the typed error
 * `certified_version_mutation`; a certified version exists only as the
 * fresh object minted by the certification path. A forged candidate is a
 * DISTINCT RECORD KIND (`kind: 'forged-candidate'`) until certified.
 *
 * DETERMINISM (the determinism law): same (parent body version, skill
 * delta records, gap records, evidence, seed, forge version, target
 * version, createdAt) -> BYTE-IDENTICAL forged candidate. The forge is a
 * pure function: no ambient clock (`Date.now()` never appears — the
 * creation instant is an explicit input), no ambient randomness (the seed
 * is the only entropy input, and it only keys derived identity), and the
 * DELTA APPLICATION ORDER is canonical (deltas sorted by their canonical
 * JSON, so the input array order cannot leak into the output).
 *
 * Spec anchors: spec/LEARNING-LOOP.md ("skill extraction -> Body Version
 * -> compatibility -> shadow"); spec/ARCHITECTURE-LOCK.md L2 (a model
 * upgrade triggers compatibility testing, NOT body redevelopment — the
 * candidate carries substrate compatibility requirements, never a model
 * identity as suitability evidence), L3, L9, L11, L12, L16a;
 * spec/CAPABILITY-DISCOVERY.md (Reproducibility — "Record candidate
 * roles, bodies, ... and rejected candidates").
 */

import {
  type CapabilityGapMirror,
  type CertificationRecord,
  type CertificationRecordId,
  type CompatibilityVerdictRef,
  type ForgeVersionRef,
  type SkillDelta,
  type SkillError,
  type SkillResult,
  type TimestampMs,
  type TrialId,
  type TrajectoryId,
  type VerdictId,
  appendCertificationRecord,
  bodyVersionInvariantsMirror,
  canonicalJson,
  createCertificationRecord,
  decideCertification,
  deepCloneJson,
  deepFreeze,
  isBodyVersionMirror,
  isCapabilityGapMirror,
  isCertificationRecordId,
  isCompatibilityVerdictRef,
  isNonEmptyString,
  isProjectId,
  isRecord,
  isSkillDelta,
  isTenantId,
  isTimestampMs,
  isVerdictId,
  mirrorCanonicalJson,
  mirrorStableDigest,
  type BodyCompositionMirror,
  type BodyVersionMirror,
  type CertificationEvidenceMirror,
  type ForgeScope,
  type SemVerMirror,
  isSemVerMirror,
  semVerMirrorToString,
  isIso8601Mirror,
  isBodyVersionIdMirror,
} from './imports';

// ---------------------------------------------------------------------------
// Forge input / output shapes
// ---------------------------------------------------------------------------

/**
 * Deep-writable view of a mirror shape — the WORKING COPY the forge
 * patches (deep-cloned from the parent, never the parent itself). The
 * mint freezes it back into the readonly mirror shape (L3).
 */
type DeepWritable<T> = T extends readonly (infer U)[]
  ? DeepWritable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
    : T;

/**
 * The evidence block of a forge run: the recorded streams the minted
 * candidate's lineage cites (opaque refs into the trajectory/experiments/
 * evaluation lanes — the same ref-minting discipline the extraction
 * protocol uses).
 */
export interface ForgeEvidence {
  readonly trajectoryRefs: readonly TrajectoryId[];
  readonly trialRefs: readonly TrialId[];
  readonly verdictRefs: readonly VerdictId[];
}

/** Guard: `ForgeEvidence`. */
export function isForgeEvidence(v: unknown): v is ForgeEvidence {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.trajectoryRefs) &&
    v.trajectoryRefs.every((r) => isNonEmptyString(r)) &&
    Array.isArray(v.trialRefs) &&
    v.trialRefs.every((r) => isNonEmptyString(r)) &&
    Array.isArray(v.verdictRefs) &&
    v.verdictRefs.every((r) => isNonEmptyString(r))
  );
}

/**
 * The forge input: the parent BodyVersion mirror, the composable skill
 * deltas, the typed gap records that commissioned the forge, the evidence
 * refs, the seed, the forge version, the target version for the NEW
 * candidate, and the explicit creation instant. Everything is caller
 * data; nothing is read from a clock or an environment.
 */
export interface ForgeInput {
  readonly parent: BodyVersionMirror;
  readonly deltas: readonly SkillDelta[];
  readonly gaps: readonly CapabilityGapMirror[];
  readonly evidence: ForgeEvidence;
  readonly seed: string;
  readonly forgeVersion: ForgeVersionRef;
  readonly targetVersion: SemVerMirror;
  readonly createdAt: string;
  readonly tenantId: string;
  readonly projectId: string;
}

/**
 * One DECLARED capability removal as recorded in the delta manifest: the
 * removed capability id plus its breaking-change declaration — "a
 * structured record, not a surprise".
 */
export interface DeclaredRemoval {
  readonly capabilityId: string;
  readonly rationale: string;
  readonly addressesGapIds: readonly string[];
}

/** The delta manifest: EXACTLY what was applied to the parent, structured. */
export interface DeltaManifest {
  /** Delta ids in canonical application order. */
  readonly appliedDeltaIds: readonly string[];
  /** Capability ids added. */
  readonly capabilityAdditions: readonly string[];
  /** Capability ids refined. */
  readonly capabilityRefinements: readonly string[];
  /** DECLARED capability removals (each with its breaking-change record). */
  readonly capabilityRemovals: readonly DeclaredRemoval[];
  /** Procedure ids added. */
  readonly procedureAdditions: readonly string[];
  /** Procedure ids removed. */
  readonly procedureRemovals: readonly string[];
  /** Knowledge/tool policy amendment count. */
  readonly policyAmendmentCount: number;
}

/**
 * The L9 lineage block of a forged candidate: the parent version ref, the
 * evidence refs, the gap refs, the forge version, the seed, the
 * tenant/project scope (L12) and the explicit forge instant.
 */
export interface ForgeLineage {
  readonly parentVersionRef: string;
  readonly evidenceRefs: readonly string[];
  readonly gapRefs: readonly string[];
  readonly forgeVersion: string;
  readonly seed: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly forgedAt: string;
}

/**
 * The forged candidate — a DISTINCT RECORD KIND until certified: the full
 * BodyVersion-shaped mirror (uncertified: `certified: false`, evidence
 * null), the delta manifest, and the L9 lineage. Deeply frozen on mint.
 */
export interface ForgedCandidate {
  readonly kind: 'forged-candidate';
  readonly candidate: BodyVersionMirror;
  readonly manifest: DeltaManifest;
  readonly lineage: ForgeLineage;
}

/** Guard: `ForgedCandidate` (structural; the `kind` discriminates candidates from versions). */
export function isForgedCandidate(v: unknown): v is ForgedCandidate {
  if (!isRecord(v)) return false;
  if (v.kind !== 'forged-candidate') return false;
  if (!isBodyVersionMirror(v.candidate)) return false;
  if ((v.candidate as BodyVersionMirror).certified !== false) return false;
  return isRecord(v.manifest) && isRecord(v.lineage);
}

/**
 * The full forge result: the minted candidate on success, or the
 * structured typed reasons for the refusal (minting gates: compatibility,
 * breaking-change declaration, scope, version monotonicity) — the
 * refusal is DATA, retained by the caller's attempt log (L11).
 */
export interface ForgeResultValue {
  readonly minted: boolean;
  readonly candidate: ForgedCandidate | null;
  readonly reasons: readonly SkillError[];
  /** Digest over the canonical JSON of the forge input (L9; chain input). */
  readonly inputDigest: string;
}

/** Serializes a forged candidate to canonical JSON bytes (byte-determinism, L9). */
export function serializeForgedCandidate(candidate: ForgedCandidate): string {
  return mirrorCanonicalJson(candidate);
}

// ---------------------------------------------------------------------------
// Input validation (collect-all)
// ---------------------------------------------------------------------------

/**
 * Validates the forge input against the typed laws (collect-all):
 * parent mirror + semantic invariants; delta guards (the evidence and
 * breaking-change laws travel with each delta); gap mirrors; scope
 * coherence (every delta and gap carries the input's tenant/project —
 * L12); seed presence (the determinism law); target-version validity and
 * STRICT monotonicity over the parent (agent-body's lineage law); the
 * compatibility gate on the parent's manifest (a parent with a broken
 * substrate-compatibility record cannot be forged from — minting is
 * gated, not post-hoc).
 */
export function validateForgeInput(v: unknown, path = 'forgeInput'): SkillResult<ForgeInput> {
  if (!isRecord(v)) {
    return { ok: false, errors: [{ code: 'invalid_type', path, message: `${path} must be an object` }] };
  }
  const errors: SkillError[] = [];

  if (v.parent === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.parent`, message: 'required field "forgeInput.parent" is missing' });
  } else if (!isBodyVersionMirror(v.parent)) {
    // THE COMPATIBILITY GATE is the FIRST named refusal: when the parent's
    // substrate-compatibility manifest specifically fails the agent-body
    // mirror shapes, the refusal is `compatibility_fail` (the typed error),
    // not a generic guard failure — the law is named, never laundered.
    const manifest =
      isRecord(v.parent) && isRecord(v.parent.composition)
        ? v.parent.composition.substrateCompatibility
        : undefined;
    const gate = manifest === undefined ? null : validateCompatibilityGate(manifest);
    if (gate !== null && !gate.ok) {
      for (const error of gate.errors) {
        errors.push({ ...error, path: `${path}.parent.composition.${error.path}` });
      }
    } else {
      errors.push({ code: 'invalid_field', path: `${path}.parent`, message: 'parent failed the BodyVersionMirror guard (agent-body structural mirror)' });
    }
  } else {
    for (const problem of bodyVersionInvariantsMirror(v.parent)) {
      errors.push({ code: 'invalid_field', path: `${path}.parent.composition`, message: problem });
    }
  }

  if (!Array.isArray(v.deltas)) {
    errors.push({ code: 'invalid_field', path: `${path}.deltas`, message: 'must be an array of skill deltas' });
  } else {
    v.deltas.forEach((delta: unknown, index: number) => {
      if (!isSkillDelta(delta)) {
        // Named refusal first: a capability removal without its
        // declared-breaking-change record is the typed error
        // `undeclared_breaking_change` — the law is named, never laundered
        // into a generic guard failure.
        if (isUndeclaredRemovalDelta(delta)) {
          errors.push({
            code: 'undeclared_breaking_change',
            path: `${path}.deltas[${index}].changes`,
            message: 'a delta removing a capability without the declared-breaking-change record is a typed error — a body that drops a capability vs its parent is a DECLARED breaking change (Work Order T017, breaking-change law)',
          });
          return;
        }
        errors.push({ code: 'invalid_field', path: `${path}.deltas[${index}]`, message: 'failed the SkillDelta guard (the evidence and breaking-change laws travel with the delta)' });
      }
    });
  }

  if (!Array.isArray(v.gaps)) {
    errors.push({ code: 'invalid_field', path: `${path}.gaps`, message: 'must be an array of typed capability gaps (may be empty)' });
  } else {
    v.gaps.forEach((gap: unknown, index: number) => {
      if (!isCapabilityGapMirror(gap)) {
        errors.push({ code: 'invalid_field', path: `${path}.gaps[${index}]`, message: 'failed the CapabilityGapMirror guard (organization-lane mirror)' });
      }
    });
  }

  if (!isForgeEvidence(v.evidence)) {
    errors.push({ code: 'invalid_field', path: `${path}.evidence`, message: 'invalid ForgeEvidence (trajectory/trial/verdict refs)' });
  }
  if (typeof v.seed !== 'string' || v.seed.trim().length === 0) {
    errors.push({
      code: 'unseeded_forge',
      path: `${path}.seed`,
      message: 'the forge must be seeded — there is no ambient randomness; forging without a seed cannot run (the determinism law)',
    });
  }
  if (typeof v.forgeVersion !== 'string' || v.forgeVersion.trim().length === 0) {
    errors.push({ code: 'invalid_field', path: `${path}.forgeVersion`, message: 'invalid ForgeVersionRef (L9: the forge version is a lineage participant)' });
  }
  if (v.targetVersion === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.targetVersion`, message: 'required field "forgeInput.targetVersion" is missing' });
  } else if (!isSemVerMirror(v.targetVersion)) {
    errors.push({ code: 'invalid_field', path: `${path}.targetVersion`, message: 'invalid SemVer mirror' });
  }
  if (v.createdAt === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.createdAt`, message: 'required field "forgeInput.createdAt" is missing (explicit instant — never a wall clock)' });
  } else if (!isIso8601Mirror(v.createdAt)) {
    errors.push({ code: 'invalid_field', path: `${path}.createdAt`, message: 'invalid ISO 8601 timestamp (timezone-qualified)' });
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'the forge input carries its owning tenant (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'the forge input carries its owning project (L12)' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const input = v as unknown as ForgeInput;
  // L12 scope coherence: every delta and every gap shares the input's scope.
  for (const delta of input.deltas) {
    if (delta.tenantId !== input.tenantId || delta.projectId !== input.projectId) {
      return {
        ok: false,
        errors: [
          {
            code: 'tenant_mismatch',
            path: `${path}.deltas.deltaId:${delta.deltaId}`,
            message: `delta "${delta.deltaId}" carries tenant "${delta.tenantId}"/project "${delta.projectId}" but the forge scope is "${input.tenantId}"/"${input.projectId}" — one tenant per lineage chain (L12)`,
          },
        ],
      };
    }
  }
  for (const gap of input.gaps) {
    if (gap.tenantId !== input.tenantId || gap.projectId !== input.projectId) {
      return {
        ok: false,
        errors: [
          {
            code: 'tenant_mismatch',
            path: `${path}.gaps.gapId:${gap.gapId}`,
            message: `gap "${gap.gapId}" carries tenant "${gap.tenantId}"/project "${gap.projectId}" but the forge scope is "${input.tenantId}"/"${input.projectId}" — one tenant per lineage chain (L12)`,
          },
        ],
      };
    }
  }

  // Lineage laws: the candidate stays in the parent's body, and its
  // version is STRICTLY greater (agent-body's lineage monotonicity).
  const parent = input.parent;
  if (compareSemVerMirror(input.targetVersion, parent.version) <= 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid_field',
          path: `${path}.targetVersion`,
          message: `target version ${semVerMirrorToString(input.targetVersion)} must be STRICTLY greater than the parent's ${semVerMirrorToString(parent.version)} (agent-body lineage monotonicity)`,
        },
      ],
    };
  }

  // THE COMPATIBILITY GATE (minting gate — the parent's manifest must
  // satisfy the agent-body mirror; the candidate inherits it, and a
  // broken manifest is not mintable).
  const gate = validateCompatibilityGate(parent.composition.substrateCompatibility);
  if (!gate.ok) return gate;

  return { ok: true, value: input };
}

/**
 * `true` when the delta-shaped value carries a `remove-capability` change
 * WITHOUT its declared-breaking-change record (the named negative path).
 */
function isUndeclaredRemovalDelta(delta: unknown): boolean {
  if (!isRecord(delta) || !Array.isArray(delta.changes)) return false;
  for (const change of delta.changes) {
    if (
      isRecord(change) &&
      change.change === 'remove-capability' &&
      isNonEmptyString(change.capabilityId) &&
      !isRecord(change.declaredBreakingChange)
    ) {
      return true;
    }
  }
  return false;
}

/** Compares two semver mirrors by precedence (build metadata ignored). */
export function compareSemVerMirror(a: SemVerMirror, b: SemVerMirror): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrereleaseMirror(a.prerelease, b.prerelease);
}

function comparePrereleaseMirror(a: readonly string[], b: readonly string[]): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease > any prerelease
  if (b.length === 0) return -1;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const ai = a[i] as string;
    const bi = b[i] as string;
    const aNumeric = /^\d+$/.test(ai);
    const bNumeric = /^\d+$/.test(bi);
    let result: -1 | 0 | 1;
    if (aNumeric && bNumeric) {
      const an = Number(ai);
      const bn = Number(bi);
      result = an < bn ? -1 : an > bn ? 1 : 0;
    } else if (aNumeric) result = -1;
    else if (bNumeric) result = 1;
    else result = ai < bi ? -1 : ai > bi ? 1 : 0;
    if (result !== 0) return result;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The compatibility gate
// ---------------------------------------------------------------------------

/**
 * THE COMPATIBILITY GATE: validates a substrate-compatibility manifest
 * against the agent-body mirror shapes (requirements, constraints, tested
 * substrate records — each with canonical substrate refs, timezone-quoted
 * instants and evidence refs). A manifest that fails is NOT mintable:
 * `compatibility_fail` (typed error; negative-tested). This is the L2
 * discipline enforced at the mint: the forged body references substrate
 * COMPATIBILITY requirements — never a specific model identity as
 * suitability evidence (L16a: measured evidence only).
 */
export function validateCompatibilityGate(
  manifest: unknown,
): SkillResult<unknown> {
  if (!isRecord(manifest)) {
    return {
      ok: false,
      errors: [
        {
          code: 'compatibility_fail',
          path: 'substrateCompatibility',
          message: 'the substrate-compatibility manifest failed the agent-body mirror shapes — a body whose compatibility record is broken is not mintable (L2: a model upgrade triggers compatibility testing, not body redevelopment)',
        },
      ],
    };
  }
  const errors: SkillError[] = [];
  const requirements = manifest.requirements;
  if (!isRecord(requirements)) {
    errors.push({ code: 'compatibility_fail', path: 'substrateCompatibility.requirements', message: 'invalid SubstrateRequirementsMirror' });
  } else {
    const nonNegInt = (x: unknown): boolean =>
      typeof x === 'number' && Number.isInteger(x) && x >= 0;
    if (!nonNegInt(requirements.minContextWindowTokens)) {
      errors.push({ code: 'compatibility_fail', path: 'substrateCompatibility.requirements.minContextWindowTokens', message: 'must be a non-negative integer token count' });
    }
    if (!nonNegInt(requirements.minMaxOutputTokens)) {
      errors.push({ code: 'compatibility_fail', path: 'substrateCompatibility.requirements.minMaxOutputTokens', message: 'must be a non-negative integer token count' });
    }
  }
  if (!isRecord(manifest.constraints)) {
    errors.push({ code: 'compatibility_fail', path: 'substrateCompatibility.constraints', message: 'invalid SubstrateConstraintsMirror' });
  }
  if (!Array.isArray(manifest.testedSubstrates)) {
    errors.push({ code: 'compatibility_fail', path: 'substrateCompatibility.testedSubstrates', message: 'must be an array of tested-substrate records' });
  } else {
    manifest.testedSubstrates.forEach((record: unknown, index: number) => {
      if (!isRecord(record)) {
        errors.push({ code: 'compatibility_fail', path: `substrateCompatibility.testedSubstrates[${index}]`, message: 'must be an object (agent-body TestedSubstrateRecord mirror)' });
        return;
      }
      if (typeof record.substrate !== 'string' || !/^[^\s/@]{1,128}\/[^\s/@]{1,128}@[^\s/@]{1,128}$/.test(record.substrate)) {
        errors.push({ code: 'compatibility_fail', path: `substrateCompatibility.testedSubstrates[${index}].substrate`, message: 'must be a canonical provider/modelId@modelVersion substrate ref (agent-body law)' });
      }
      if (typeof record.evidence !== 'string' || record.evidence.trim().length === 0) {
        errors.push({ code: 'compatibility_fail', path: `substrateCompatibility.testedSubstrates[${index}].evidence`, message: 'must cite an evidence-capsule reference (L9 — substitution tests bind evidence)' });
      }
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: manifest };
}

// ---------------------------------------------------------------------------
// The deterministic forge
// ---------------------------------------------------------------------------

/**
 * THE REFERENCE FORGE: (parent BodyVersion mirror, SkillDelta set, gap
 * records, evidence, seed, forge version, target version, createdAt) ->
 * ForgedCandidate. PURE and DETERMINISTIC — same inputs, byte-identical
 * candidate (deep-equal + identical canonical bytes).
 *
 * Laws enforced on the mint path (typed reasons on refusal — DATA, never
 * exceptions, never a silently cleaner result):
 * - L3: the parent is NEVER mutated — the composition is deep-cloned
 *   before the first patch, and the parent reference stays deeply frozen
 *   (the caller's record, untouched).
 * - The breaking-change law: every capability removal carries its
 *   declaration; the manifest records each removal as a structured
 *   record; and the declared-vs-actual drop check verifies no capability
 *   silently disappeared (`undeclared_breaking_change`).
 * - The compatibility gate (see {@link validateCompatibilityGate}).
 * - Composition invariants (agent-body's own laws, mirrored): unique ids,
 *   no allowed/forbidden overlap, EXECUTE/external-gateway-only coupling.
 * - Delta application order is CANONICAL (deltas sorted by canonical
 *   JSON) so the input array order cannot leak into the output bytes.
 */
export function forgeBodyVersion(input: unknown): ForgeResultValue {
  const validated = validateForgeInput(input);
  const inputDigest = stableDigestOfInput(input);
  if (!validated.ok) {
    return { minted: false, candidate: null, reasons: validated.errors, inputDigest };
  }
  const forgeInput = validated.value;

  // L3: clone the composition — the parent record is never touched.
  const composition = deepCloneJson(forgeInput.parent.composition) as DeepWritable<BodyCompositionMirror>;

  // Canonical application order (the determinism law): deltas sorted by
  // their canonical JSON — a total, input-order-independent order.
  const orderedDeltas = [...forgeInput.deltas].sort((a, b) => {
    const ca = canonicalJson(JSON.parse(JSON.stringify(a)) as never);
    const cb = canonicalJson(JSON.parse(JSON.stringify(b)) as never);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  const manifest: {
    appliedDeltaIds: string[];
    capabilityAdditions: string[];
    capabilityRefinements: string[];
    capabilityRemovals: DeclaredRemoval[];
    procedureAdditions: string[];
    procedureRemovals: string[];
    policyAmendmentCount: number;
  } = {
    appliedDeltaIds: [],
    capabilityAdditions: [],
    capabilityRefinements: [],
    capabilityRemovals: [],
    procedureAdditions: [],
    procedureRemovals: [],
    policyAmendmentCount: 0,
  };
  const reasons: SkillError[] = [];

  for (const delta of orderedDeltas) {
    manifest.appliedDeltaIds.push(delta.deltaId);
    for (const change of delta.changes) {
      switch (change.change) {
        case 'add-capability': {
          if (composition.capabilities.some((c) => c.id === change.capabilityId)) {
            reasons.push({
              code: 'invalid_field',
              path: `deltas.deltaId:${delta.deltaId}.changes`,
              message: `add-capability "${change.capabilityId}": the capability id already exists in the composition (agent-body uniqueness law)`,
            });
            continue;
          }
          composition.capabilities.push({
            id: change.capabilityId,
            name: change.name,
            description: change.description,
            category: change.category,
            critical: change.critical,
            skillArtifactRefs: [...change.skillArtifactRefs],
          });
          manifest.capabilityAdditions.push(change.capabilityId);
          break;
        }
        case 'refine-capability': {
          const target = composition.capabilities.find((c) => c.id === change.capabilityId);
          if (target === undefined) {
            reasons.push({
              code: 'invalid_field',
              path: `deltas.deltaId:${delta.deltaId}.changes`,
              message: `refine-capability "${change.capabilityId}": the capability does not exist in the parent composition`,
            });
            continue;
          }
          target.description = change.description;
          const merged = [...target.skillArtifactRefs];
          for (const ref of change.additionalSkillArtifactRefs) {
            if (!merged.includes(ref)) merged.push(ref);
          }
          target.skillArtifactRefs = merged;
          manifest.capabilityRefinements.push(change.capabilityId);
          break;
        }
        case 'remove-capability': {
          const index = composition.capabilities.findIndex((c) => c.id === change.capabilityId);
          if (index < 0) {
            reasons.push({
              code: 'invalid_field',
              path: `deltas.deltaId:${delta.deltaId}.changes`,
              message: `remove-capability "${change.capabilityId}": the capability does not exist in the parent composition`,
            });
            continue;
          }
          composition.capabilities.splice(index, 1);
          // THE BREAKING-CHANGE LAW: every removal is a DECLARED, structured record.
          manifest.capabilityRemovals.push({
            capabilityId: change.capabilityId,
            rationale: change.declaredBreakingChange.rationale,
            addressesGapIds: [...change.declaredBreakingChange.addressesGapIds],
          });
          break;
        }
        case 'amend-knowledge-tool-policy': {
          const policy = composition.knowledgeToolPolicy;
          const mergeRefs = (current: readonly string[], added: readonly string[]): string[] => {
            const merged = [...current];
            for (const ref of added) {
              if (!merged.includes(ref)) merged.push(ref);
            }
            return merged;
          };
          composition.knowledgeToolPolicy = {
            ...policy,
            allowedTools: mergeRefs(policy.allowedTools, change.allowTools),
            forbiddenTools: mergeRefs(policy.forbiddenTools, change.forbidTools),
            allowedKnowledgeSources: mergeRefs(policy.allowedKnowledgeSources, change.allowKnowledgeSources),
            forbiddenKnowledgeSources: mergeRefs(policy.forbiddenKnowledgeSources, change.forbidKnowledgeSources),
            ...(change.toolCallBudgetPerDecision !== undefined
              ? { toolCallBudgetPerDecision: change.toolCallBudgetPerDecision }
              : {}),
          };
          manifest.policyAmendmentCount += 1;
          break;
        }
        case 'amend-procedures': {
          for (const procedureId of change.removeProcedureIds) {
            const index = composition.procedures.findIndex((p) => p.id === procedureId);
            if (index < 0) {
              reasons.push({
                code: 'invalid_field',
                path: `deltas.deltaId:${delta.deltaId}.changes`,
                message: `procedure removal "${procedureId}": the procedure does not exist in the parent composition`,
              });
              continue;
            }
            composition.procedures.splice(index, 1);
            manifest.procedureRemovals.push(procedureId);
          }
          for (const procedure of change.addProcedures) {
            if (composition.procedures.some((p) => p.id === procedure.id)) {
              reasons.push({
                code: 'invalid_field',
                path: `deltas.deltaId:${delta.deltaId}.changes`,
                message: `procedure addition "${procedure.id}": the procedure id already exists in the composition`,
              });
              continue;
            }
            composition.procedures.push({
              id: procedure.id,
              name: procedure.name,
              trigger: procedure.trigger,
              steps: procedure.steps.map((step) => ({
                id: step.id,
                description: step.description,
                toolRefs: [...step.toolRefs],
                approvalRequired: step.approvalRequired,
              })),
            });
            manifest.procedureAdditions.push(procedure.id);
          }
          break;
        }
        default:
          reasons.push({
            code: 'invalid_field',
            path: `deltas.deltaId:${delta.deltaId}.changes`,
            message: 'unknown change kind (closed SkillChange union violated)',
          });
      }
    }
  }

  if (reasons.length > 0) {
    return { minted: false, candidate: null, reasons, inputDigest };
  }

  // A body composes at least one capability (agent-body law).
  if (composition.capabilities.length === 0) {
    return {
      minted: false,
      candidate: null,
      reasons: [
        {
          code: 'invalid_field',
          path: 'composition.capabilities',
          message: 'the forged composition must retain at least one capability (a body with no capabilities is not a body)',
        },
      ],
      inputDigest,
    };
  }

  // THE DECLARED-VS-ACTUAL DROP CHECK (the breaking-change law's trip
  // wire): every capability the result DROPPED vs its parent must appear
  // in the manifest as a DECLARED removal — "a structured record, not a
  // surprise".
  const parentCapabilityIds = new Set(forgeInput.parent.composition.capabilities.map((c) => c.id));
  const resultCapabilityIds = new Set(composition.capabilities.map((c) => c.id));
  const declaredRemovalIds = new Set(manifest.capabilityRemovals.map((r) => r.capabilityId));
  for (const dropped of parentCapabilityIds) {
    if (!resultCapabilityIds.has(dropped) && !declaredRemovalIds.has(dropped)) {
      return {
        minted: false,
        candidate: null,
        reasons: [
          {
            code: 'undeclared_breaking_change',
            path: 'composition.capabilities',
            message: `capability "${dropped}" was dropped vs the parent without a declared breaking-change record — a body that drops a capability vs its parent is a DECLARED breaking change (Work Order T017, breaking-change law)`,
          },
        ],
        inputDigest,
      };
    }
  }

  // Composition invariants (agent-body's own laws, mirrored) — probed
  // with the DERIVED canonical identity so the id law is checked as it
  // will hold on the minted record.
  const derivedCandidateId = `${forgeInput.parent.bodyId}@${semVerMirrorToString(forgeInput.targetVersion)}`;
  const invariantProblems = bodyVersionInvariantsMirror({
    id: derivedCandidateId,
    bodyId: forgeInput.parent.bodyId,
    version: forgeInput.targetVersion,
    parentId: forgeInput.parent.id,
    composition,
    createdAt: forgeInput.createdAt,
    certified: false,
    certificationEvidence: null,
  });
  if (invariantProblems.length > 0) {
    return {
      minted: false,
      candidate: null,
      reasons: invariantProblems.map((problem) => ({
        code: 'invalid_field' as const,
        path: 'composition',
        message: problem,
      })),
      inputDigest,
    };
  }

  // THE COMPATIBILITY GATE on the RESULT (inherited from the parent; a
  // broken manifest is not mintable).
  const gate = validateCompatibilityGate(composition.substrateCompatibility);
  if (!gate.ok) {
    return { minted: false, candidate: null, reasons: gate.errors, inputDigest };
  }

  const candidateId = derivedCandidateId;
  if (!isBodyVersionIdMirror(candidateId)) {
    return {
      minted: false,
      candidate: null,
      reasons: [
        {
          code: 'invalid_field',
          path: 'targetVersion',
          message: `the derived candidate id "${candidateId}" is not a canonical BodyVersionId`,
        },
      ],
      inputDigest,
    };
  }

  const candidate: ForgedCandidate = deepFreeze({
    kind: 'forged-candidate' as const,
    candidate: deepFreeze({
      id: candidateId,
      bodyId: forgeInput.parent.bodyId,
      version: forgeInput.targetVersion,
      parentId: forgeInput.parent.id,
      composition: deepFreeze(composition as unknown as BodyCompositionMirror),
      createdAt: forgeInput.createdAt,
      certified: false,
      certificationEvidence: null,
    }),
    manifest: deepFreeze(manifest),
    lineage: deepFreeze({
      parentVersionRef: forgeInput.parent.id,
      evidenceRefs: [
        ...forgeInput.evidence.trajectoryRefs.map((ref) => `trajectory:${ref}`),
        ...forgeInput.evidence.trialRefs.map((ref) => `trial:${ref}`),
        ...forgeInput.evidence.verdictRefs.map((ref) => `verdict:${ref}`),
      ],
      gapRefs: forgeInput.gaps.map((gap) => gap.gapId),
      forgeVersion: forgeInput.forgeVersion,
      seed: forgeInput.seed,
      tenantId: forgeInput.tenantId,
      projectId: forgeInput.projectId,
      forgedAt: forgeInput.createdAt,
    }),
  });
  return { minted: true, candidate, reasons: [], inputDigest };
}

/** Stable digest of the forge input's canonical JSON (L9; the chain input). */
function stableDigestOfInput(input: unknown): string {
  return mirrorStableDigest(input);
}

// ---------------------------------------------------------------------------
// The certification path
// ---------------------------------------------------------------------------

/**
 * The certification path input: the forged candidate plus the two verdict
 * references the decision cites (evaluation attainment + substrate
 * compatibility) with their outcomes, and the certification bookkeeping
 * (id, authority, instant).
 */
export interface CertifyCandidateInput {
  readonly candidate: ForgedCandidate;
  readonly certificationId: CertificationRecordId;
  readonly evaluationVerdictRef: VerdictId;
  readonly evaluationAttained: boolean;
  readonly compatibilityVerdictRef: CompatibilityVerdictRef;
  readonly compatibilitySatisfied: boolean;
  readonly certifiedBy: string;
  readonly certifiedAt: TimestampMs;
}

/**
 * THE CERTIFICATION PATH (L3 + L11 + fail-closed):
 *
 * 1. L3 (the existential law): an ALREADY-CERTIFIED version cannot be
 *    certified again — `certified_version_mutation`, the typed error that
 *    makes mutating a certified version impossible through this API. A
 *    certified candidate moves forward ONLY by minting a NEW version
 *    through the forge.
 * 2. The decision is COMPILED from the verdict outcomes
 *    (`decideCertification` — pure, fail-closed) plus the candidate's own
 *    substitution-test record (a certified body must be possessable —
 *    agent-body's certification precondition, mirrored).
 * 3. The decision record is APPENDED to the certification log (append-only,
 *    terminal per candidate — `appendCertificationRecord` enforces the law).
 * 4. On `certified`, a NEW certified BodyVersion mirror is minted (a
 *    fresh object with `certified: true` + evidence — L3: mint, never
 *    mutate); on `rejected`, the structured reasons are retained and the
 *    certified version is `null`. The REFUSED certification is DATA.
 */
export function certifyCandidate(
  input: unknown,
  log: readonly CertificationRecord[],
): SkillResult<{
  readonly record: CertificationRecord;
  readonly certifiedVersion: BodyVersionMirror | null;
  readonly log: readonly CertificationRecord[];
}> {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'certifyInput', message: 'certification path input must be an object' }] };
  }

  // L3 (THE EXISTENTIAL LAW) FIRST: an already-certified record entering
  // the certification path IS the mutation attempt — name it before any
  // structural nit. A certified version NEVER mutates; the only forward
  // path is minting a NEW BodyVersion through the forge.
  const candidateShaped = input.candidate;
  if (
    isRecord(candidateShaped) &&
    candidateShaped.kind === 'forged-candidate' &&
    isRecord(candidateShaped.candidate) &&
    candidateShaped.candidate.certified === true
  ) {
    return {
      ok: false,
      errors: [
        {
          code: 'certified_version_mutation',
          path: 'certifyInput.candidate',
          message: `candidate "${String(candidateShaped.candidate.id)}" is already certified — certification is terminal and certified versions never mutate (L3); the only forward path is minting a NEW BodyVersion through the forge`,
        },
      ],
    };
  }
  const errors: SkillError[] = [];
  if (!isForgedCandidate(input.candidate)) {
    errors.push({ code: 'invalid_field', path: 'certifyInput.candidate', message: 'not a ForgedCandidate — only forged candidates enter the certification path (a forged candidate is a distinct record kind until certified)' });
  }
  if (!isCertificationRecordId(input.certificationId)) {
    errors.push({ code: 'invalid_field', path: 'certifyInput.certificationId', message: 'invalid CertificationRecordId' });
  }
  if (input.evaluationVerdictRef === undefined || !isVerdictId(input.evaluationVerdictRef)) {
    errors.push({ code: 'evidence_missing', path: 'certifyInput.evaluationVerdictRef', message: 'the certification decision must cite an evaluation verdict reference (T012 lane)' });
  }
  if (input.compatibilityVerdictRef === undefined || !isCompatibilityVerdictRef(input.compatibilityVerdictRef)) {
    errors.push({ code: 'evidence_missing', path: 'certifyInput.compatibilityVerdictRef', message: 'the certification decision must cite a compatibility verdict reference' });
  }
  if (input.certifiedBy === undefined || !isNonEmptyString(input.certifiedBy)) {
    errors.push({ code: 'invalid_field', path: 'certifyInput.certifiedBy', message: 'must be a non-empty certifying authority' });
  }
  if (input.certifiedAt === undefined || !isTimestampMs(input.certifiedAt)) {
    errors.push({ code: 'invalid_field', path: 'certifyInput.certifiedAt', message: 'invalid TimestampMs (explicit instant — never a wall clock)' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const candidate = input.candidate as ForgedCandidate;

  // L3: THE EXISTENTIAL LAW. A certified version NEVER mutates; any API
  // that could mutate one is a typed error. Re-certifying a certified
  // version is exactly that mutation attempt.
  if (candidate.candidate.certified) {
    return {
      ok: false,
      errors: [
        {
          code: 'certified_version_mutation',
          path: 'certifyInput.candidate',
          message: `candidate "${candidate.candidate.id}" is already certified — certification is terminal and certified versions never mutate (L3); the only forward path is minting a NEW BodyVersion through the forge`,
        },
      ],
    };
  }

  // A certified body must be possessable: at least one PASSING
  // substitution test (agent-body's certification precondition, mirrored).
  const hasPassingSubstitutionTest = candidate.candidate.composition.substrateCompatibility.testedSubstrates.some(
    (record) => record.result === 'pass',
  );

  const decision = decideCertification({
    candidateRef: candidate.candidate.id as never,
    evaluationVerdictRef: (input.evaluationVerdictRef as string) as never,
    evaluationAttained: input.evaluationAttained === true,
    compatibilityVerdictRef: (input.compatibilityVerdictRef as string) as never,
    compatibilitySatisfied: input.compatibilitySatisfied === true,
    hasPassingSubstitutionTest,
  });

  let record: CertificationRecord;
  try {
    record = createCertificationRecord(
      {
        certificationId: input.certificationId,
        candidateRef: candidate.candidate.id,
        evaluationVerdictRef: input.evaluationVerdictRef,
        compatibilityVerdictRef: input.compatibilityVerdictRef,
        certifiedBy: input.certifiedBy,
        certifiedAt: input.certifiedAt,
        lineage: {
          parentVersionRef: candidate.lineage.parentVersionRef,
          evidenceRefs: candidate.lineage.evidenceRefs.map((ref) => ref as never),
          gapRefs: candidate.lineage.gapRefs.map((ref) => ref as never),
          forgeVersion: candidate.lineage.forgeVersion,
          seed: candidate.lineage.seed,
          tenantId: candidate.lineage.tenantId,
          projectId: candidate.lineage.projectId,
        },
      },
      {
        candidateRef: candidate.candidate.id,
        evaluationVerdictRef: input.evaluationVerdictRef,
        evaluationAttained: input.evaluationAttained === true,
        compatibilityVerdictRef: input.compatibilityVerdictRef,
        compatibilitySatisfied: input.compatibilitySatisfied === true,
        hasPassingSubstitutionTest,
      },
    );
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid_field',
          path: 'certifyInput',
          message: error instanceof Error ? error.message : 'the certification record failed validation',
        },
      ],
    };
  }

  // Append-only certification log (terminal per candidate; re-certifying
  // a certified candidate is certified_version_mutation — enforced again
  // here, defense in depth).
  const appended = appendCertificationRecord(log, record);
  if (!appended.ok) return appended;

  // On 'certified': mint the NEW certified version (L3 — a fresh object,
  // never a mutation of the candidate).
  let certifiedVersion: BodyVersionMirror | null = null;
  if (decision.decision === 'certified') {
    const evidence: CertificationEvidenceMirror = deepFreeze({
      evidenceRefs: record.lineage.evidenceRefs,
      evaluationRefs: [record.evaluationVerdictRef as string],
      certifiedBy: record.certifiedBy,
      certifiedAt: new Date(record.certifiedAt).toISOString(),
      summary: `Certified by the body forge: evaluation verdict attained and compatibility satisfied (${decision.reasons.map((r) => r.code).join(', ')}).`,
    });
    certifiedVersion = deepFreeze({
      ...deepCloneJson(candidate.candidate),
      certified: true,
      certificationEvidence: evidence,
    });
  }
  return { ok: true, value: { record, certifiedVersion, log: appended.value } };
}
