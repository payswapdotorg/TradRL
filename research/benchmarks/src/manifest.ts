/**
 * @tradrl/research-benchmarks — the BENCHMARK MANIFEST (Work Order T032):
 * the binding that turns compiled benchmark results into reproducible
 * evaluation evidence.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Every release candidate
 * defines objective success criteria ... evidence volume ..."; "Simulation
 * evidence and live evidence are never conflated"), ARCHITECTURE-LOCK L9
 * ("Reproducible lineage: results bind data, code, body, substrate,
 * environment, runtime, evaluator and config" — here: every entry binds
 * its split plan, its data/regime source, its evaluator and its result
 * records), L15 ("Project continuity: goal, research, decision, execution
 * and outcome share lineage" — the manifest is the project-scoped outcome
 * binding), L12 (tenant/project scoping on every bound record).
 *
 * THE MANIFEST BINDS, for each benchmark entry (each law typed):
 * - its split plan: the plan id AND the plan content digest
 *   (`manifest_binding_mismatch` when a bound result's lineage names a
 *   different plan or digest — results cannot be re-attached to designs
 *   they did not run under);
 * - its data/regime source: the source id, digest, kind and origin;
 * - its evaluator ref;
 * - its result records with their EXACT DECIMAL scores
 *   (`result_binding_mismatch` when a result is bound under the wrong
 *   benchmark; `scale_mismatch` when a result's score is not at its
 *   benchmark's declared scale);
 * - its evidence class: the manifest declares ONE class and every bound
 *   definition and result must agree (`evidence_conflated`); a live
 *   manifest binding simulation-origin material fails
 *   `live_claim_on_simulation`).
 *
 * The manifest id is content-addressed (`bmfm:<digest>` over the canonical
 * manifest content) — identical manifests address identically (L9).
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue, TimestampMs } from './primitives';
import { isBenchmarkManifestId, isProjectId, isTenantId } from './ids';
import type { BenchmarkId, BenchmarkManifestId, EvaluatorVersionRef, ProjectId, TenantId } from './ids';
import { decimalScale, isDecimalAtScale, isSignedDecimal } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkErrorCode, type BenchmarkResult } from './errors';
import { validateBenchmarkDefinition, definitionDigest, dataSourceDigest, dataSourceKind, dataSourceOrigin } from './definition';
import type { BenchmarkDefinition } from './definition';
import { verifyBenchmarkResult } from './driver';
import type { BenchmarkResultRecord } from './driver';
import { splitPlanDigest } from './split-mirror';
import { isEvidenceClass } from './evidence';
import type { EvidenceClass } from './evidence';

/** Local constructor: a single typed error (the manifest's binding laws). */
const errorOf = (code: BenchmarkErrorCode, message: string, path: string): BenchmarkError => ({ code, message, path });

// ---------------------------------------------------------------------------
// The manifest shapes
// ---------------------------------------------------------------------------

/** One bound result: its content-addressed id and its exact decimal aggregate score. */
export interface ManifestResultBinding {
  readonly result_id: string;
  readonly aggregate_score: DecimalString;
}

/** One manifest entry: the benchmark, its plan, its source, its evaluator and its results. */
export interface BenchmarkManifestEntry {
  readonly benchmark: BenchmarkId;
  readonly split_plan: { readonly plan_id: string; readonly plan_digest: string };
  readonly data_source: { readonly source_id: string; readonly source_digest: string; readonly kind: string; readonly origin: string };
  readonly evaluator: EvaluatorVersionRef;
  readonly results: readonly ManifestResultBinding[];
}

/** The compiled benchmark manifest: the reproducible evidence binding. */
export interface BenchmarkManifest {
  /** Derived identity: `bmfm:<digest over the canonical manifest content>`. */
  readonly manifest_id: BenchmarkManifestId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The manifest's ONE evidence class — simulation or live, never conflated. */
  readonly evidence_class: EvidenceClass;
  readonly entries: readonly BenchmarkManifestEntry[];
  /** The INJECTED compilation instant (L4). */
  readonly created_at: TimestampMs;
}

/** The canonical manifest JSON (the content-addressing input; no `manifest_id`). */
export function manifestContentJson(manifest: Omit<BenchmarkManifest, 'manifest_id'>): JsonObject {
  return {
    tenant: manifest.tenant,
    project: manifest.project,
    evidence_class: manifest.evidence_class,
    entries: manifest.entries as unknown as readonly JsonValue[],
    created_at: manifest.created_at,
  };
}

/** Compute the content address of a manifest: `bmfm:<digest>`. */
export function benchmarkManifestId(content: Omit<BenchmarkManifest, 'manifest_id'>): BenchmarkManifestId {
  return `bmfm:${stableDigestJson(manifestContentJson(content))}` as BenchmarkManifestId;
}

/** The canonical JSON bytes of a manifest (the determinism anchor). */
export function canonicalBenchmarkManifest(manifest: BenchmarkManifest): string {
  return canonicalJson(manifest as unknown as JsonObject);
}

// ---------------------------------------------------------------------------
// The manifest compiler
// ---------------------------------------------------------------------------

/**
 * Compile the benchmark manifest from untrusted inputs: the scope, the
 * declared evidence class, the injected compilation instant and the
 * benchmark entries (each an untrusted definition plus its untrusted
 * result records). Enforces every binding law (see the module header):
 * scope agreement (`tenant_mismatch`), evidence-class agreement
 * (`evidence_conflated` / `live_claim_on_simulation`), result-to-benchmark
 * binding (`result_binding_mismatch`), result lineage-to-entry binding
 * (`manifest_binding_mismatch`) and score-scale conformance
 * (`scale_mismatch`). On success the manifest is returned narrowed, deeply
 * frozen, with the DERIVED content address (`bmfm:<digest>`).
 */
export function compileBenchmarkManifest(input: unknown): BenchmarkResult<BenchmarkManifest> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('manifest input must be an object')] };
  }
  const errors: BenchmarkError[] = [];
  if (input.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(input.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (input.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(input.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (input.evidence_class === undefined) errors.push(missingField('evidence_class'));
  else if (!isEvidenceClass(input.evidence_class)) errors.push(invalidField('evidence_class', "must be 'simulation' or 'live'"));
  if (input.created_at === undefined) errors.push(missingField('created_at'));
  else if (!isTimestampMs(input.created_at)) errors.push(invalidField('created_at', 'must be a valid TimestampMs (the injected compilation instant, L4)'));
  if (input.benchmarks === undefined) errors.push(missingField('benchmarks'));
  else if (!Array.isArray(input.benchmarks) || input.benchmarks.length === 0) {
    errors.push(invalidField('benchmarks', 'must be a non-empty array of { definition, results } entries'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const tenant = input.tenant as TenantId;
  const project = input.project as ProjectId;
  const evidenceClass = input.evidence_class as EvidenceClass;
  const createdAt = input.created_at as TimestampMs;

  const entries: BenchmarkManifestEntry[] = [];
  const seenBenchmarks = new Set<string>();
  const seenResults = new Set<string>();
  (input.benchmarks as readonly unknown[]).forEach((candidate, entryIndex) => {
    const entryPath = `benchmarks[${entryIndex}]`;
    if (errors.length > 0) return;
    if (!isRecord(candidate)) {
      errors.push(invalidField(entryPath, 'must be { definition, results }'));
      return;
    }
    if (candidate.definition === undefined) {
      errors.push(missingField(`${entryPath}.definition`));
      return;
    }
    const definitionResult = validateBenchmarkDefinition(candidate.definition, `${entryPath}.definition`);
    if (!definitionResult.ok) {
      errors.push(...definitionResult.errors);
      return;
    }
    const definition = definitionResult.value;

    if (definition.tenant !== tenant || definition.project !== project) {
      errors.push(
        invalidField(`${entryPath}.definition`, `definition "${definition.benchmark_id}" is scoped to tenant "${definition.tenant}"/project "${definition.project}" — the manifest's scope is "${tenant}"/"${project}" (L12)`),
      );
      return;
    }
    if (definition.evidence_class !== evidenceClass) {
      if (evidenceClass === 'live' && definition.data_source.origin === 'generated') {
        errors.push(errorOf('live_claim_on_simulation', `live manifest binds benchmark "${definition.benchmark_id}" over a GENERATIVE population (origin 'generated') — synthetic worlds are exploration instruments, never live execution evidence (L5/L6)`, `${entryPath}.definition`));
        return;
      }
      errors.push(
        invalidField(`${entryPath}.definition.evidence_class`, `definition "${definition.benchmark_id}" declares evidence class '${definition.evidence_class}' but the manifest declares '${evidenceClass}' — simulation evidence and live evidence are never conflated`),
      );
      return;
    }
    if (seenBenchmarks.has(definition.benchmark_id)) {
      errors.push(invalidField(`${entryPath}.definition.benchmark_id`, `benchmark "${definition.benchmark_id}" is bound twice — one benchmark, one entry`));
      return;
    }
    seenBenchmarks.add(definition.benchmark_id);

    if (candidate.results === undefined) {
      errors.push(missingField(`${entryPath}.results`));
      return;
    }
    if (!Array.isArray(candidate.results) || candidate.results.length === 0) {
      errors.push(invalidField(`${entryPath}.results`, 'must be a non-empty array of compiled result records'));
      return;
    }
    const bound: ManifestResultBinding[] = [];
    for (let resultIndex = 0; resultIndex < (candidate.results as readonly unknown[]).length; resultIndex++) {
      const resultCandidate = (candidate.results as readonly unknown[])[resultIndex];
      const verification = verifyBenchmarkResult(resultCandidate, `${entryPath}.results[${resultIndex}]`);
      if (!verification.ok) {
        errors.push(...verification.errors);
        return;
      }
      const result = verification.value;

      if (result.benchmark !== definition.benchmark_id) {
        errors.push(errorOf('result_binding_mismatch', `result "${result.result_id}" names benchmark "${result.benchmark}" but is bound under "${definition.benchmark_id}" — results cannot be re-attached to benchmarks they did not run under`, `${entryPath}.results[${resultIndex}]`));
        return;
      }
      if (result.tenant !== tenant || result.project !== project) {
        errors.push(invalidField(`${entryPath}.results[${resultIndex}]`, `result "${result.result_id}" is scoped to tenant "${result.tenant}"/project "${result.project}" — the manifest's scope is "${tenant}"/"${project}" (L12)`));
        return;
      }
      if (result.evidence_class !== evidenceClass) {
        if (evidenceClass === 'live') {
          errors.push(errorOf('live_claim_on_simulation', `live manifest binds result "${result.result_id}" of evidence class '${result.evidence_class}' — simulation results are never live evidence (spec/EVALUATION-PROTOCOL.md)`, `${entryPath}.results[${resultIndex}]`));
          return;
        }
        errors.push(errorOf('evidence_conflated', `simulation manifest binds result "${result.result_id}" of evidence class '${result.evidence_class}' — live results are never simulation evidence (spec/EVALUATION-PROTOCOL.md)`, `${entryPath}.results[${resultIndex}]`));
        return;
      }
      if (result.lineage.split_plan !== definition.split_plan.plan_id || result.lineage.plan_digest !== splitPlanDigest(definition.split_plan)) {
        errors.push(errorOf('manifest_binding_mismatch', `result "${result.result_id}" lineage names split plan "${result.lineage.split_plan}" (digest ${result.lineage.plan_digest}) but the entry binds plan "${definition.split_plan.plan_id}" — results cannot be re-attached to designs they did not run under (L9)`, `${entryPath}.results[${resultIndex}]`));
        return;
      }
      if (result.lineage.data_source !== definition.data_source.source_id || result.lineage.source_digest !== dataSourceDigest(definition.data_source)) {
        errors.push(errorOf('manifest_binding_mismatch', `result "${result.result_id}" lineage names source "${result.lineage.data_source}" (digest ${result.lineage.source_digest}) but the entry binds source "${definition.data_source.source_id}" — results cannot be re-attached to data they did not evaluate over (L9)`, `${entryPath}.results[${resultIndex}]`));
        return;
      }
      if (!isDecimalAtScale(result.aggregate_score, definition.score_scale)) {
        errors.push(errorOf('scale_mismatch', `result "${result.result_id}" aggregate score "${result.aggregate_score}" is not at benchmark "${definition.benchmark_id}"'s declared scale ${definition.score_scale} — recorded scores are exact decimals at the declared scale`, `${entryPath}.results[${resultIndex}]`));
        return;
      }
      if (seenResults.has(result.result_id)) {
        errors.push(invalidField(`${entryPath}.results[${resultIndex}]`, `result "${result.result_id}" is bound twice — one result, one binding`));
        return;
      }
      seenResults.add(result.result_id);
      bound.push({ result_id: result.result_id, aggregate_score: result.aggregate_score });
    }

    entries.push(
      deepFreeze({
        benchmark: definition.benchmark_id,
        split_plan: { plan_id: definition.split_plan.plan_id, plan_digest: splitPlanDigest(definition.split_plan) },
        data_source: {
          source_id: definition.data_source.source_id,
          source_digest: dataSourceDigest(definition.data_source),
          kind: dataSourceKind(definition.data_source),
          origin: dataSourceOrigin(definition.data_source),
        },
        evaluator: definition.evaluator,
        results: bound,
      } satisfies BenchmarkManifestEntry),
    );
  });
  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<BenchmarkManifest, 'manifest_id'> = {
    tenant,
    project,
    evidence_class: evidenceClass,
    entries,
    created_at: createdAt,
  };
  const derivedId = benchmarkManifestId(content);
  if (input.manifest_id !== undefined && input.manifest_id !== derivedId) {
    return fail('invalid_field', `manifest id "${input.manifest_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, 'manifest_id');
  }
  return ok(deepFreeze({ manifest_id: derivedId, ...content } satisfies BenchmarkManifest));
}

// ---------------------------------------------------------------------------
// Untrusted manifest verification (the id law, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Verify an untrusted manifest: the structural laws (scope, class,
 * entries, decimals) and the CONTENT-ADDRESS law (the recorded
 * `manifest_id` must equal the digest of the canonical manifest content —
 * `invalid_field` with an explicit L9 message). On success the manifest is
 * returned narrowed, deeply frozen.
 */
export function verifyBenchmarkManifest(value: unknown, path = 'manifest'): BenchmarkResult<BenchmarkManifest> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];
  if (value.manifest_id === undefined) errors.push(missingField(`${path}.manifest_id`));
  else if (!isBenchmarkManifestId(value.manifest_id)) errors.push(invalidField(`${path}.manifest_id`, 'must be a manifest id ("bmfm:<digest>")'));
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  if (value.evidence_class === undefined) errors.push(missingField(`${path}.evidence_class`));
  else if (!isEvidenceClass(value.evidence_class)) errors.push(invalidField(`${path}.evidence_class`, "must be 'simulation' or 'live'"));
  if (value.created_at === undefined) errors.push(missingField(`${path}.created_at`));
  else if (!isTimestampMs(value.created_at)) errors.push(invalidField(`${path}.created_at`, 'must be a valid TimestampMs (L4)'));
  if (value.entries === undefined) errors.push(missingField(`${path}.entries`));
  else if (!Array.isArray(value.entries) || value.entries.length === 0) {
    errors.push(invalidField(`${path}.entries`, 'must be a non-empty array of manifest entries'));
  } else {
    (value.entries as readonly unknown[]).forEach((candidate, index) => {
      const entryPath = `${path}.entries[${index}]`;
      if (!isRecord(candidate)) {
        errors.push(invalidField(entryPath, 'must be an object'));
        return;
      }
      if (typeof candidate.benchmark !== 'string' || !candidate.benchmark.startsWith('bmk:')) {
        errors.push(invalidField(`${entryPath}.benchmark`, 'must be a benchmark id ("bmk:<digest>")'));
      }
      const plan = candidate.split_plan;
      if (!isRecord(plan) || typeof plan.plan_id !== 'string' || !plan.plan_id.startsWith('splan:') || typeof plan.plan_digest !== 'string' || !/^[0-9a-f]{16}$/.test(plan.plan_digest)) {
        errors.push(invalidField(`${entryPath}.split_plan`, 'must be { plan_id, plan_digest }'));
      }
      const source = candidate.data_source;
      if (!isRecord(source) || typeof source.source_id !== 'string' || source.source_id.length === 0 || typeof source.source_digest !== 'string' || !/^[0-9a-f]{16}$/.test(source.source_digest)) {
        errors.push(invalidField(`${entryPath}.data_source`, 'must be { source_id, source_digest, kind, origin }'));
      }
      if (typeof candidate.evaluator !== 'string' || candidate.evaluator.length === 0) {
        errors.push(invalidField(`${entryPath}.evaluator`, 'must be a versioned evaluator ref (L9)'));
      }
      if (!Array.isArray(candidate.results) || candidate.results.length === 0) {
        errors.push(invalidField(`${entryPath}.results`, 'must be a non-empty array of result bindings'));
      } else {
        (candidate.results as readonly unknown[]).forEach((bound, resultIndex) => {
          const boundPath = `${entryPath}.results[${resultIndex}]`;
          if (!isRecord(bound) || typeof bound.result_id !== 'string' || !bound.result_id.startsWith('bres:') || typeof bound.aggregate_score !== 'string' || !isSignedDecimal(bound.aggregate_score)) {
            errors.push(invalidField(boundPath, 'must be { result_id: "bres:<digest>", aggregate_score: exact decimal }'));
          } else if (decimalScale(bound.aggregate_score) > 18) {
            errors.push(invalidField(`${boundPath}.aggregate_score`, 'carries a scale wider than the representable bound 18'));
          }
        });
      }
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<BenchmarkManifest, 'manifest_id'> = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
    evidence_class: value.evidence_class as EvidenceClass,
    entries: value.entries as readonly BenchmarkManifestEntry[],
    created_at: value.created_at as TimestampMs,
  };
  const derivedId = benchmarkManifestId(content);
  if (value.manifest_id !== derivedId) {
    return fail('invalid_field', `manifest id "${value.manifest_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.manifest_id`);
  }
  return ok(deepFreeze({ manifest_id: derivedId, ...content } satisfies BenchmarkManifest));
}
