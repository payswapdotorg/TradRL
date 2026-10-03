/**
 * @tradrl/firm-memory-service — THE INGESTION PIPELINE: how validated
 * learning becomes durable, point-in-time-servable firm knowledge
 * (Work Order T034: "ingest from T033's query surface … reconcile +
 * dedupe against existing knowledge … apply promotion policies with
 * injected instants").
 *
 * THE INGESTION LAW ({@link ingestFirmLearning}): a snapshot is the
 * T033 query surface's output — outcome records + the latest post-
 * mortem drafts — consumed through the STRUCTURAL MIRRORS (never
 * imports; the interop test drives the REAL T033 pipeline through
 * them). The snapshot is ATOMIC: every law passes and every append
 * succeeds, or nothing changes.
 *
 * THE COHERENCE LAWS (fail-closed, typed):
 *   - the snapshot's records pass the mirrors (invalid_field with the
 *     index path);
 *   - ONE scope per batch: every record carries the same tenant/
 *     project — a mixed-scope batch is the typed `tenant_mismatch`
 *     (L12: cross-scope evidence is inexpressible);
 *   - every post-mortem's subject binds (batch ∪ the consumed-outcome
 *     ledger) with agreeing decision/intent/class — a dangling or
 *     disagreeing subject is the typed `lineage_gap`;
 *   - the injected instant is at/after every record's instant (L4 —
 *     `l4_boundary_violation`: the brain never learns from the future);
 *   - no post-mortem is consumed twice (the typed `duplicate_evidence`
 *     — evidence contributes EXACTLY ONCE; detect re-ingestion via the
 *     receipts' batch digests, never by silent double-counting).
 *
 * THE PROMOTION (deterministic, the declared interpretations):
 *   - CANDIDATES: every post-mortem hypothesis lifts into a typed
 *     claim candidate (vocabulary.ts's derivation laws): decision
 *     hypotheses -> decision_pattern (dimension-keyed, polarity from
 *     the subject outcome's class); market_move -> market_behavior
 *     (the payload's direction; `flat` grounds no claim); model_error
 *     -> model_calibration (the EXACT projected-vs-realized bias);
 *     data_lag -> data_latency (the derived lag band, polarity from
 *     the subject outcome's class). A neutral outcome grounds no
 *     polarity, so its hypotheses lift no decision/latency claim.
 *     Candidates accumulate per (family, polarity): distinct outcome
 *     refs, the hypothesis confidences, the distinct outcome instants,
 *     the sessions and the T011 bindings.
 *   - THE BAR ({@link meetsPromotionBar}): distinct outcomes >=
 *     minEvidenceCount; the aggregate confidence (the EXACT MIN over
 *     the supporting confidences — the weakest evidence bounds the
 *     firm's claim) >= minAggregateConfidence; distinct instants >=
 *     windowStabilityCount (the anti-cluster law).
 *   - THE RECONCILE (per family, AT MOST ONE knowledge append per
 *     batch — the per-family strictly-forward append law's
 *     consequence):
 *       * no existing entries + one promotable polarity -> FRESH
 *         promotion;
 *       * no existing entries + both polarities promotable -> the
 *         internal domination rule: the strictly-larger evidence
 *         count promotes (equal counts promote NEITHER — ambiguous
 *         evidence is a contest, not knowledge); the pair is recorded
 *         in the contradiction register either way;
 *       * an existing family + a same-polarity candidate -> the REVISION
 *         (the dedupe fold: ANY new supporting evidence accumulates —
 *         union outcome refs, MIN-fold confidence — min is associative,
 *         so revisions fold exactly; the validity window re-opens at
 *         the batch instant — reinforced knowledge stays fresh; the
 *         standalone bar gates BIRTH, not accumulation). A revision
 *         whose family holds OPPOSING entries must also dominate them
 *         (the chain's flip law) or it waits for a later batch;
 *       * an existing family + an opposite-polarity candidate -> the
 *         DOMINATION rule: the challenger promotes ONLY with a
 *         strictly greater evidence count than every opposing entry
 *         (never a silent overwrite — the contest is recorded in the
 *         contradiction register FIRST, whatever the outcome);
 *       * the declared PRECEDENCE: the revision is judged first
 *         (evidence-first: the incumbent accumulates before the
 *         contest is decided); a challenger only takes the batch slot
 *         when no revision appended — its contest is still recorded,
 *         and fresh evidence (never re-supplied evidence — see the
 *         duplicate-evidence law) can flip the family in a later
 *         batch.
 *   - EVERY contest — internal pair or incumbent-vs-challenger — is
 *     appended to the chain-verified contradiction register as a
 *     typed contradiction record (never a silent overwrite, never an
 *     error: a contest is a legitimate learning outcome).
 */

import {
  canonicalJson,
  claimFamilyKey,
  claimOrder,
  deepFreeze,
  deriveLagBand,
  fail,
  fnv1a32Hex,
  harmPolarityOfOutcome,
  isPostMortemRecordMirror,
  isOutcomeRecordMirror,
  isRecord,
  isTimestampMs,
  meetsPromotionBar,
  ok,
  signedCompare,
  sortedUniqueRefs,
  unitIntervalCompare,
  validatePromotionPolicy,
  type AttributionHypothesisMirror,
  type ContradictionRecord,
  type ContradictionSide,
  type DataLagAttributionMirror,
  type DecisionAttributionMirror,
  type FirmMemoryResult,
  type KnowledgeClaim,
  type MarketMoveAttributionMirror,
  type ModelErrorAttributionMirror,
  type OutcomeClassMirror,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type PromotionPolicy,
  type TimestampMs,
} from './imports';
import { appendContradiction, appendFirmKnowledge } from './imports';
import type { ContradictionLog, FirmKnowledgeLog, FirmKnowledgeRecord } from './imports';
import {
  isFirmMemoryState,
  mintReceipt,
  type FirmIngestionReceipt,
  type FirmMemoryState,
} from './state';

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** One ingestion snapshot: the T033 query surface's output, consumed through the mirrors. */
export interface FirmLearningSnapshot {
  /** The learned outcomes (T033's `queryOutcomeRecords` output — the mirror guards validate every record). */
  readonly outcomes: readonly unknown[];
  /** The post-mortem drafts (T033's `queryPostMortems` output — latest-per-outcome by default; the Firm Brain's primary source). */
  readonly postMortems: readonly unknown[];
}

/** The ingestion inputs: the injected instant (no ambient clock). */
export interface FirmIngestInputs {
  readonly at: TimestampMs;
}

/** The product of one ingestion. */
export interface FirmIngestResult {
  readonly state: FirmMemoryState;
  readonly receipt: FirmIngestionReceipt;
}

// ---------------------------------------------------------------------------
// The candidate accumulator (the promotion pipeline's working set)
// ---------------------------------------------------------------------------

/** One accumulated candidate: a (family, polarity) claim with its evidence. */
interface Candidate {
  readonly claim: KnowledgeClaim;
  readonly tenant: string;
  readonly project: string;
  readonly outcomeRefs: Set<string>;
  readonly postMortemRefs: Set<string>;
  readonly confidences: string[];
  readonly outcomeInstants: Set<number>;
  readonly sessionRefs: Set<string>;
  readonly experimentRefs: Set<string>;
  readonly trialRefs: Set<string>;
  readonly trajectoryRefs: Set<string>;
}

/** The candidate's aggregate confidence: the EXACT MIN over the supporting confidences (the weakest evidence bounds the claim). */
function aggregateConfidence(confidences: readonly string[]): string {
  let minimum = confidences[0] as string;
  for (let index = 1; index < confidences.length; index++) {
    if (unitIntervalCompare(confidences[index] as string, minimum) < 0) minimum = confidences[index] as string;
  }
  return minimum;
}

// ---------------------------------------------------------------------------
// The ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest ONE snapshot of T033's query output: validate through the
 * mirrors, enforce the coherence laws (scope, subject binding, L4,
 * duplicate evidence), lift the hypotheses into candidates, apply the
 * promotion policy, reconcile against the existing knowledge (the
 * dedupe fold, the contradiction register, the domination rule) and
 * append ATOMICALLY (any law violation fails the whole batch —
 * nothing partially appends). Returns the threaded state + the
 * content-addressed receipt.
 */
export function ingestFirmLearning(state: unknown, snapshot: FirmLearningSnapshot, policy: unknown, inputs: FirmIngestInputs): FirmMemoryResult<FirmIngestResult> {
  if (!isFirmMemoryState(state)) {
    return fail('invalid_type', 'ingestFirmLearning requires a valid firm-memory state');
  }
  const brain = state as FirmMemoryState;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.outcomes) || !Array.isArray(snapshot.postMortems)) {
    return fail('invalid_type', 'the snapshot must be an object { outcomes, postMortems } (the T033 query surface\'s output)');
  }
  const policyResult = validatePromotionPolicy(policy);
  if (!policyResult.ok) return policyResult;
  const promotionPolicy = policyResult.value;
  if (!isRecord(inputs) || !isTimestampMs(inputs.at)) {
    return fail('invalid_field', 'the ingestion inputs carry their injected instant (at) — no ambient clock', 'at');
  }
  const at = inputs.at;

  // --- The mirror gates (every record structurally valid) ---------------------------
  const outcomes: OutcomeRecordMirror[] = [];
  for (let index = 0; index < snapshot.outcomes.length; index++) {
    const one = snapshot.outcomes[index];
    if (!isOutcomeRecordMirror(one)) {
      return fail('invalid_field', `outcomes[${index}] fails the mirrored outcome-record guard (T033-shaped records required — the REAL query surface's output satisfies it)`, `outcomes[${index}]`);
    }
    outcomes.push(one);
  }
  const postMortems: PostMortemRecordMirror[] = [];
  for (let index = 0; index < snapshot.postMortems.length; index++) {
    const one = snapshot.postMortems[index];
    if (!isPostMortemRecordMirror(one)) {
      return fail('invalid_field', `postMortems[${index}] fails the mirrored post-mortem guard (T033-shaped drafts required)`, `postMortems[${index}]`);
    }
    postMortems.push(one);
  }
  if (postMortems.length === 0) {
    return fail('invalid_field', 'the snapshot carries no post-mortems — there is nothing to promote from (query the post-mortem surface, not only the outcome surface)', 'postMortems');
  }

  // --- The L12 scope law (ONE scope per batch) ----------------------------------------
  const scopeSeed = outcomes.length > 0 ? { tenant: outcomes[0]!.tenant, project: outcomes[0]!.project } : { tenant: postMortems[0]!.lineage.tenant, project: postMortems[0]!.lineage.project };
  const tenant = scopeSeed.tenant;
  const project = scopeSeed.project;
  for (const outcome of outcomes) {
    if (outcome.tenant !== tenant || outcome.project !== project) {
      return fail(
        'tenant_mismatch',
        `the snapshot mixes scopes — ${outcome.tenant}/${outcome.project} against ${tenant}/${project} — cross-scope evidence is inexpressible (L12: ingest per scope)`,
        'outcomes',
      );
    }
  }
  for (const postMortem of postMortems) {
    if (postMortem.lineage.tenant !== tenant || postMortem.lineage.project !== project) {
      return fail(
        'tenant_mismatch',
        `the snapshot mixes scopes — ${postMortem.lineage.tenant}/${postMortem.lineage.project} against ${tenant}/${project} — cross-scope evidence is inexpressible (L12: ingest per scope)`,
        'postMortems',
      );
    }
  }

  // --- The subject-binding law (batch ∪ ledger, agreeing fields) ------------------------
  const ledgerByRef = new Map<string, OutcomeRecordMirror>();
  for (const consumed of brain.consumedOutcomes) ledgerByRef.set(consumed.outcomeId, consumed);
  for (const outcome of outcomes) ledgerByRef.set(outcome.outcomeId, outcome);
  for (const postMortem of postMortems) {
    const subject = ledgerByRef.get(postMortem.subject.outcomeRecordRef);
    if (subject === undefined) {
      return fail(
        'lineage_gap',
        `post-mortem ${postMortem.postMortemId} subjects outcome ${postMortem.subject.outcomeRecordRef}, which neither the snapshot nor the consumed-outcome ledger carries — a post-mortem about an unlearned outcome dangles (widen the outcome query window or ingest its subject first)`,
        'postMortems',
      );
    }
    if (subject.decision.decisionRef !== postMortem.subject.decisionRef || subject.decision.intentRef !== postMortem.subject.intentRef || subject.outcomeClass !== postMortem.subject.outcomeClass) {
      return fail(
        'lineage_gap',
        `post-mortem ${postMortem.postMortemId}'s subject disagrees with outcome ${subject.outcomeId}'s own decision/intent/class — the subject binding is exact`,
        'postMortems',
      );
    }
    if (subject.tenant !== postMortem.lineage.tenant || subject.project !== postMortem.lineage.project) {
      return fail(
        'tenant_mismatch',
        `post-mortem ${postMortem.postMortemId} declares ${postMortem.lineage.tenant}/${postMortem.lineage.project} but its subject outcome carries ${subject.tenant}/${subject.project} — a cross-scope post-mortem is inexpressible (L12)`,
        'postMortems',
      );
    }
  }

  // --- The L4 law (no learning from the future) -------------------------------------------
  let latestEvidenceAt = 0;
  for (const outcome of outcomes) latestEvidenceAt = Math.max(latestEvidenceAt, outcome.asOf as number);
  for (const postMortem of postMortems) latestEvidenceAt = Math.max(latestEvidenceAt, postMortem.asOf as number);
  if ((at as number) < latestEvidenceAt) {
    return fail(
      'l4_boundary_violation',
      `the ingestion instant ${String(at)} precedes the snapshot's latest evidence instant ${String(latestEvidenceAt)} — learning from the future is the typed point-in-time crime (L4)`,
      'at',
    );
  }

  // --- The duplicate-evidence law (idempotence) ----------------------------------------------
  const consumedRefs = new Set(brain.consumedPostMortems.map((entry) => entry.postMortemRef));
  const batchRefs = new Set<string>();
  for (const postMortem of postMortems) {
    if (consumedRefs.has(postMortem.postMortemId) || batchRefs.has(postMortem.postMortemId)) {
      return fail(
        'duplicate_evidence',
        `post-mortem ${postMortem.postMortemId} was already consumed by the brain — evidence contributes EXACTLY ONCE (detect re-ingestion via the receipts' batch digests, never by silent double-counting)`,
        'postMortems',
      );
    }
    batchRefs.add(postMortem.postMortemId);
  }

  // --- The candidate accumulation ------------------------------------------------------------
  const candidates = new Map<string, Candidate>();
  for (const postMortem of postMortems) {
    const subject = ledgerByRef.get(postMortem.subject.outcomeRecordRef) as OutcomeRecordMirror;
    for (const hypothesis of postMortem.hypotheses) {
      const claim = liftHypothesis(hypothesis, subject.outcomeClass as OutcomeClassMirror);
      if (claim === null) continue; // the hypothesis grounds no claim (flat move / exact projection / neutral outcome)
      const key = `${claimFamilyKey(claim, { tenant, project })}|${claim.polarity}`;
      let candidate = candidates.get(key);
      if (candidate === undefined) {
        candidate = {
          claim,
          tenant,
          project,
          outcomeRefs: new Set(),
          postMortemRefs: new Set(),
          confidences: [],
          outcomeInstants: new Set(),
          sessionRefs: new Set(),
          experimentRefs: new Set(),
          trialRefs: new Set(),
          trajectoryRefs: new Set(),
        };
        candidates.set(key, candidate);
      }
      candidate.outcomeRefs.add(subject.outcomeId);
      candidate.postMortemRefs.add(postMortem.postMortemId);
      candidate.confidences.push(hypothesis.confidence);
      // Window stability is the EVIDENCE spread, not the learning-record stamp: T033 mints every
      // learned record at the ingestion instant, so the honest anti-cluster dimension is the
      // underlying shadow evidence's availability instant (lineage.shadowAsOf) — distinct per decision.
      candidate.outcomeInstants.add(subject.lineage.shadowAsOf as number);
      candidate.sessionRefs.add(postMortem.lineage.shadowSessionRef);
      if (postMortem.lineage.experiment !== null) {
        candidate.experimentRefs.add(postMortem.lineage.experiment.experimentRef);
        candidate.trialRefs.add(postMortem.lineage.experiment.trialRef);
      }
      if (postMortem.lineage.trajectoryRef !== null) candidate.trajectoryRefs.add(postMortem.lineage.trajectoryRef);
    }
  }

  // --- The promotion bar (the birth gate) + the reconcile grouping --------------------------------
  const promotableKeys = new Set(
    [...candidates.values()]
      .filter((candidate) => meetsPromotionBar(promotionPolicy, {
        distinctOutcomes: candidate.outcomeRefs.size,
        aggregateConfidence: aggregateConfidence(candidate.confidences),
        distinctInstants: candidate.outcomeInstants.size,
      }))
      .map((candidate) => `${claimFamilyKey(candidate.claim, { tenant: candidate.tenant, project: candidate.project })}|${candidate.claim.polarity}`),
  );
  const isPromotable = (candidate: Candidate): boolean =>
    promotableKeys.has(`${claimFamilyKey(candidate.claim, { tenant: candidate.tenant, project: candidate.project })}|${candidate.claim.polarity}`);

  // --- The reconcile + the appends (ATOMIC: shadow logs, threaded only on full success) -------------
  let knowledgeLog = brain.knowledgeLog;
  let contradictionLog = brain.contradictionLog;
  const fresh: string[] = [];
  const revisions: string[] = [];
  const supersessions: string[] = [];
  const contradictions: string[] = [];

  // Group ALL candidates by family (deterministic order: family key ascending) —
  // revisions accumulate regardless of the standalone bar; only fresh births,
  // contests and challengers demand it.
  const byFamily = new Map<string, Candidate[]>();
  for (const candidate of [...candidates.values()].sort((a, b) => claimOrder(a.claim, b.claim))) {
    const family = claimFamilyKey(candidate.claim, { tenant: candidate.tenant, project: candidate.project });
    const list = byFamily.get(family) ?? [];
    list.push(candidate);
    byFamily.set(family, list);
  }
  const families = [...byFamily.keys()].sort();

  const familyOf = (record: FirmKnowledgeRecord): string => claimFamilyKey(record.claim, { tenant: record.tenant, project: record.project });

  for (const family of families) {
    const familyCandidates = byFamily.get(family) as Candidate[];
    const existing = knowledgeLog.records.filter((record) => familyOf(record) === family);

    if (existing.length === 0) {
      // FRESH promotion (or the internal domination rule) — the bar gates BIRTH.
      const familyPromotable = familyCandidates.filter((candidate) => isPromotable(candidate));
      if (familyPromotable.length === 1) {
        const promoted = appendCandidate(knowledgeLog, familyPromotable[0] as Candidate, at, promotionPolicy);
        if (!promoted.ok) return promoted;
        knowledgeLog = promoted.value.log;
        fresh.push(promoted.value.knowledgeId);
        continue;
      }
      // Both polarities promotable: the internal domination rule (equal counts promote NEITHER).
      if (familyPromotable.length >= 2) {
        const pair = pairByPolarityOrder(familyPromotable);
        const contest = appendContest(contradictionLog, {
          ordinal: contradictionLog.records.length + 1,
          priorChainHead: contradictionLog.head,
          tenant,
          project,
          claimKey: family,
          sides: [sideOfCandidate(pair[0]), sideOfCandidate(pair[1])],
          asOf: at,
        });
        if (!contest.ok) return contest;
        contradictionLog = contest.value.log;
        contradictions.push(contest.value.contradictionId);
        const dominant = pair[0]!.outcomeRefs.size > pair[1]!.outcomeRefs.size
          ? pair[0]
          : pair[1]!.outcomeRefs.size > pair[0]!.outcomeRefs.size
            ? pair[1]
            : null;
        if (dominant !== null) {
          const promoted = appendCandidate(knowledgeLog, dominant, at, promotionPolicy);
          if (!promoted.ok) return promoted;
          knowledgeLog = promoted.value.log;
          fresh.push(promoted.value.knowledgeId);
        }
      }
      continue;
    }

    // An existing family: the revision (evidence-first, ANY bar) and/or the promotable challenger.
    const winnerPolarity = familyWinnerPolarity(existing);
    const revisionCandidate = familyCandidates.find((candidate) => candidate.claim.polarity === winnerPolarity) ?? null;
    const challenger = familyCandidates.find((candidate) => candidate.claim.polarity !== winnerPolarity && isPromotable(candidate)) ?? null;
    const incumbent = latestOfPolarity(existing, winnerPolarity) as FirmKnowledgeRecord;

    let revisionAppended: FirmKnowledgeRecord | null = null;
    if (revisionCandidate !== null) {
      // The dedupe fold: union refs, MIN-fold confidence, window re-opens at the batch instant.
      const unionOutcomes = sortedUniqueRefs([...incumbent.provenance.outcomeRefs, ...revisionCandidate.outcomeRefs]);
      const unionConfidence = unitIntervalCompare(aggregateConfidence(revisionCandidate.confidences), incumbent.confidence) < 0
        ? aggregateConfidence(revisionCandidate.confidences)
        : incumbent.confidence;
      const opposingMax = Math.max(0, ...existing.filter((record) => record.claim.polarity !== winnerPolarity).map((record) => record.evidenceCount));
      if (opposingMax === 0 || unionOutcomes.length > opposingMax) {
        const appended = appendFirmKnowledge(knowledgeLog, {
          ordinal: knowledgeLog.records.length + 1,
          tenant,
          project,
          claim: revisionCandidate.claim,
          confidence: unionConfidence,
          evidenceCount: unionOutcomes.length,
          provenance: {
            postMortemRefs: sortedUniqueRefs([...incumbent.provenance.postMortemRefs, ...revisionCandidate.postMortemRefs]),
            outcomeRefs: unionOutcomes,
            experimentRefs: sortedUniqueRefs([...incumbent.provenance.experimentRefs, ...revisionCandidate.experimentRefs]),
            trialRefs: sortedUniqueRefs([...incumbent.provenance.trialRefs, ...revisionCandidate.trialRefs]),
            trajectoryRefs: sortedUniqueRefs([...incumbent.provenance.trajectoryRefs, ...revisionCandidate.trajectoryRefs]),
            sessionRefs: sortedUniqueRefs([...incumbent.provenance.sessionRefs, ...revisionCandidate.sessionRefs]),
          },
          validity: { from: at, to: (at + promotionPolicy.validityWindowMs) as TimestampMs },
          asOf: at,
          priorChainHead: knowledgeLog.head,
        });
        if (!appended.ok) return appended;
        knowledgeLog = appended.value;
        revisionAppended = knowledgeLog.records[knowledgeLog.records.length - 1] as FirmKnowledgeRecord;
        revisions.push(revisionAppended.knowledgeId);
      }
    }

    // The challenger: the contest is recorded FIRST; the promotion only when dominating
    // (and only when no revision took the batch slot — the declared precedence).
    if (challenger !== null) {
      const incumbentRecord = revisionAppended ?? incumbent;
      const opposingCounts = knowledgeLog.records
        .filter((record) => familyOf(record) === family && record.claim.polarity !== challenger.claim.polarity)
        .map((record) => record.evidenceCount);
      const opposingMax = opposingCounts.length === 0 ? 0 : Math.max(...opposingCounts);
      const dominating = revisionAppended === null && challenger.outcomeRefs.size > opposingMax;
      const contest = appendContest(contradictionLog, {
        ordinal: contradictionLog.records.length + 1,
        priorChainHead: contradictionLog.head,
        tenant,
        project,
        claimKey: family,
        sides: [
          {
            knowledgeRef: incumbentRecord.knowledgeId,
            polarity: incumbentRecord.claim.polarity,
            confidence: incumbentRecord.confidence,
            evidenceCount: incumbentRecord.evidenceCount,
            outcomeRefs: incumbentRecord.provenance.outcomeRefs,
          },
          sideOfCandidate(challenger),
        ],
        asOf: at,
      });
      if (!contest.ok) return contest;
      contradictionLog = contest.value.log;
      contradictions.push(contest.value.contradictionId);
      if (dominating) {
        const promoted = appendCandidate(knowledgeLog, challenger, at, promotionPolicy);
        if (!promoted.ok) return promoted;
        knowledgeLog = promoted.value.log;
        supersessions.push(promoted.value.knowledgeId);
      }
    }
  }

  // --- The receipt + the ledgers (append-only by construction) ------------------------------------
  const batchDigest = fnv1a32Hex(canonicalJson({
    outcomes: outcomes.map((outcome) => outcome.outcomeId),
    postMortems: postMortems.map((postMortem) => postMortem.postMortemId),
    at,
  }));
  const receipt = mintReceipt(deepFreeze({
    batchDigest,
    tenant,
    project,
    fresh: Object.freeze(fresh),
    revisions: Object.freeze(revisions),
    supersessions: Object.freeze(supersessions),
    contradictions: Object.freeze(contradictions),
    ingestedAt: at,
  }));
  const newConsumedPostMortems = postMortems.map((postMortem) => deepFreeze({ postMortemRef: postMortem.postMortemId, consumedAt: at }));
  const knownOutcomeRefs = new Set(brain.consumedOutcomes.map((record) => record.outcomeId));
  const newConsumedOutcomes = outcomes.filter((outcome) => !knownOutcomeRefs.has(outcome.outcomeId));

  return ok(deepFreeze({
    state: deepFreeze({
      knowledgeLog,
      contradictionLog,
      ingestions: [...brain.ingestions, receipt],
      consumedPostMortems: [...brain.consumedPostMortems, ...newConsumedPostMortems],
      consumedOutcomes: [...brain.consumedOutcomes, ...newConsumedOutcomes],
    }),
    receipt,
  }));
}

// ---------------------------------------------------------------------------
// The helpers (the pipeline's deterministic derivations)
// ---------------------------------------------------------------------------

/**
 * Lift ONE post-mortem hypothesis into a claim candidate (the
 * vocabulary's derivation laws); `null` when the hypothesis grounds
 * no claim (a flat market move, an exactly-on projection, a neutral
 * outcome class on a polarity-from-outcome kind).
 */
function liftHypothesis(hypothesis: AttributionHypothesisMirror, subjectClass: OutcomeClassMirror): KnowledgeClaim | null {
  switch (hypothesis.class) {
    case 'decision': {
      const polarity = harmPolarityOfOutcome(subjectClass);
      if (polarity === null) return null; // a neutral outcome grounds no polarity claim
      return { kind: 'decision_pattern', polarity, dimension: (hypothesis.detail as DecisionAttributionMirror).dimension, lagBand: null };
    }
    case 'market_move': {
      const direction = (hypothesis.detail as MarketMoveAttributionMirror).direction;
      if (direction === 'flat') return null; // a flat move grounds no market-behavior claim
      return { kind: 'market_behavior', polarity: direction, dimension: null, lagBand: null };
    }
    case 'model_error': {
      const detail = hypothesis.detail as ModelErrorAttributionMirror;
      const comparison = signedCompare(detail.projected, detail.realized);
      if (comparison === 0) return null; // an exact projection grounds no calibration claim
      return { kind: 'model_calibration', polarity: comparison > 0 ? 'over_projection' : 'under_projection', dimension: null, lagBand: null };
    }
    case 'data_lag': {
      const polarity = harmPolarityOfOutcome(subjectClass);
      if (polarity === null) return null; // a neutral outcome grounds no polarity claim
      return { kind: 'data_latency', polarity, dimension: null, lagBand: deriveLagBand((hypothesis.detail as DataLagAttributionMirror).lagMs) };
    }
  }
}

/** Append one candidate as a knowledge entry (the mint + the chain laws). */
function appendCandidate(log: FirmKnowledgeLog, candidate: Candidate, at: TimestampMs, policy: PromotionPolicy): FirmMemoryResult<{ readonly log: FirmKnowledgeLog; readonly knowledgeId: string }> {
  const appended = appendFirmKnowledge(log, {
    ordinal: log.records.length + 1,
    tenant: candidate.tenant,
    project: candidate.project,
    claim: candidate.claim,
    confidence: aggregateConfidence(candidate.confidences),
    evidenceCount: candidate.outcomeRefs.size,
    provenance: {
      postMortemRefs: sortedUniqueRefs([...candidate.postMortemRefs]),
      outcomeRefs: sortedUniqueRefs([...candidate.outcomeRefs]),
      experimentRefs: sortedUniqueRefs([...candidate.experimentRefs]),
      trialRefs: sortedUniqueRefs([...candidate.trialRefs]),
      trajectoryRefs: sortedUniqueRefs([...candidate.trajectoryRefs]),
      sessionRefs: sortedUniqueRefs([...candidate.sessionRefs]),
    },
    validity: { from: at, to: (at + policy.validityWindowMs) as TimestampMs },
    asOf: at,
    priorChainHead: log.head,
  });
  if (!appended.ok) return appended;
  const record = appended.value.records[appended.value.records.length - 1] as FirmKnowledgeRecord;
  return ok({ log: appended.value, knowledgeId: record.knowledgeId });
}

/** Append one contradiction record (the mint + the register laws). */
function appendContest(log: ContradictionLog, record: Omit<ContradictionRecord, 'contradictionId'>): FirmMemoryResult<{ readonly log: ContradictionLog; readonly contradictionId: string }> {
  const appended = appendContradiction(log, record);
  if (!appended.ok) return appended;
  const minted = appended.value.records[appended.value.records.length - 1] as ContradictionRecord;
  return ok({ log: appended.value, contradictionId: minted.contradictionId });
}

/** The family's CURRENT winning polarity (the serving projection's basis: max evidenceCount, then asOf, then ordinal). */
function familyWinnerPolarity(existing: readonly FirmKnowledgeRecord[]): string {
  let winner = existing[0] as FirmKnowledgeRecord;
  for (const entry of existing) {
    if (entry.evidenceCount > winner.evidenceCount) {
      winner = entry;
      continue;
    }
    if (entry.evidenceCount < winner.evidenceCount) continue;
    if ((entry.asOf as number) > (winner.asOf as number)) {
      winner = entry;
      continue;
    }
    if ((entry.asOf as number) < (winner.asOf as number)) continue;
    if (entry.ordinal > winner.ordinal) winner = entry;
  }
  return winner.claim.polarity;
}

/** The LATEST entry of one polarity (max ordinal — the accumulated revision line). */
function latestOfPolarity(existing: readonly FirmKnowledgeRecord[], polarity: string): FirmKnowledgeRecord {
  let latest = existing[0] as FirmKnowledgeRecord;
  for (const entry of existing) {
    if (entry.claim.polarity === polarity && entry.ordinal > latest.ordinal) latest = entry;
  }
  return latest;
}

/** Order an internal pair deterministically (polarity lexicographic ascending — the register's ordering law). */
function pairByPolarityOrder(candidates: readonly Candidate[]): [Candidate, Candidate] {
  const sorted = [...candidates].sort((a, b) => (a.claim.polarity < b.claim.polarity ? -1 : a.claim.polarity > b.claim.polarity ? 1 : 0));
  return [sorted[0] as Candidate, sorted[1] as Candidate];
}

/** The candidate's contest side snapshot (no fkr: ref — a batch candidate). */
function sideOfCandidate(candidate: Candidate): ContradictionSide {
  return {
    knowledgeRef: null,
    polarity: candidate.claim.polarity,
    confidence: aggregateConfidence(candidate.confidences),
    evidenceCount: candidate.outcomeRefs.size,
    outcomeRefs: sortedUniqueRefs([...candidate.outcomeRefs]),
  };
}
