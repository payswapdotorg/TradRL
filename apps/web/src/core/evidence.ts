// @tradrl/web-console — evidence capsules (R38).
//
// THE LAW (Work Order T042): "Evidence capsules (R38): typed,
// content-addressed evidence bundles (refs to the API's outcome/
// evidence reads) renderable inside the workspace sections."
//
// A capsule is a TYPED BUNDLE over one served record: the record's
// identity, its evidence refs, its typed facts (decimal strings
// verbatim — the exact-decimal law) and its availability instant
// (L4 — capsules render only at view instants at/after it). The id
// is CONTENT-ADDRESSED: identical record -> identical capsule ->
// identical id (determinism tests pin this byte-for-byte).
//
// Spec anchors: R38, R45 (provenance — every fact names its source
// route), L4, L9, L12 (capsules carry the scope; cross-scope never
// renders).

import type {
  GatewaySubmissionRecord,
  OutcomeRecord,
  PostMortemRecord,
  ServedKnowledge,
} from '../api/contracts';
import { digestOf } from './digest';
import { assertProjectScope, type WorkspaceScope } from './tenant';
import { availabilityOfKnowledge, availabilityOfOutcome, availabilityOfPostMortem, availabilityOfSubmission } from './availability';

/** The capsule sources (the API's outcome/evidence read families). */
export type CapsuleSourceKind = 'outcome' | 'post-mortem' | 'knowledge' | 'submission';

/** One typed fact inside a capsule (closed vocabulary labels; decimal values verbatim). */
export interface CapsuleFact {
  readonly label: string;
  readonly value: string;
}

/** One evidence reference (the record's own evidence refs — typed, never free text). */
export interface CapsuleRef {
  readonly kind: string;
  readonly ref: string;
}

/** THE EVIDENCE CAPSULE — a typed, content-addressed evidence bundle. */
export interface EvidenceCapsule {
  /** Content-addressed: 'evc:' + digest of the capsule's content (identical record -> identical id). */
  readonly capsuleId: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** Which read family the capsule bundles. */
  readonly sourceKind: CapsuleSourceKind;
  /** The bundled record's own id. */
  readonly sourceRef: string;
  /** The API route the record was read from (provenance). */
  readonly sourceRoute: string;
  /** The record's evidence refs. */
  readonly refs: readonly CapsuleRef[];
  /** The typed facts (labels closed per source kind; decimals verbatim). */
  readonly facts: readonly CapsuleFact[];
  /** The availability instant (L4) — the capsule renders only at view instants at/after it. */
  readonly availableAt: number;
}

/** Guard: a well-formed capsule fact value (string; decimals rendered verbatim elsewhere). */
function fact(label: string, value: string | null | number | boolean): CapsuleFact {
  const text = value === null ? 'none' : String(value);
  return { label, value: text };
}

/** Build a capsule's content-addressed id over its identity + content (pure). */
function capsuleIdOf(kind: CapsuleSourceKind, sourceRef: string, facts: readonly CapsuleFact[], refs: readonly CapsuleRef[]): string {
  return `evc:${digestOf({ kind, sourceRef, facts, refs })}`;
}

/** Capsule from an outcome record (the /v1/outcomes/query read). */
export function capsuleFromOutcome(scope: WorkspaceScope, outcome: OutcomeRecord): EvidenceCapsule {
  assertProjectScope(scope, outcome);
  const facts: readonly CapsuleFact[] = [
    fact('disposition', outcome.decision.disposition),
    fact('outcome-class', outcome.outcomeClass),
    fact('expected-quantity', outcome.expectation.expectedQuantity),
    fact('filled-quantity', outcome.realization.filledQuantity),
    fact('realized-outcome', outcome.realization.realizedOutcome),
    fact('fee-total', outcome.realization.feeTotal),
    fact('notional-total', outcome.realization.notionalTotal),
    fact('within-tolerance', outcome.deviation.withinTolerance),
  ];
  return {
    capsuleId: capsuleIdOf('outcome', outcome.outcomeId, facts, outcome.evidence),
    tenantId: outcome.tenant,
    projectId: outcome.project,
    sourceKind: 'outcome',
    sourceRef: outcome.outcomeId,
    sourceRoute: '/v1/outcomes/query',
    refs: outcome.evidence,
    facts,
    availableAt: availabilityOfOutcome(outcome),
  };
}

/** Capsule from a post-mortem record (the /v1/post-mortems/query read). */
export function capsuleFromPostMortem(scope: WorkspaceScope, postMortem: PostMortemRecord): EvidenceCapsule {
  assertProjectScope(scope, { tenant: postMortem.lineage.tenant, project: postMortem.lineage.project });
  const facts: readonly CapsuleFact[] = [
    fact('disposition', postMortem.happened.disposition),
    fact('outcome-class', postMortem.subject.outcomeClass),
    fact('realized-outcome', postMortem.happened.realizedOutcome),
    fact('realized-gap', postMortem.gap.realizedGap),
    fact('within-tolerance', postMortem.gap.withinTolerance),
    fact('hypotheses', postMortem.hypotheses.length),
  ];
  return {
    capsuleId: capsuleIdOf('post-mortem', postMortem.postMortemId, facts, postMortem.evidence),
    tenantId: postMortem.lineage.tenant,
    projectId: postMortem.lineage.project,
    sourceKind: 'post-mortem',
    sourceRef: postMortem.postMortemId,
    sourceRoute: '/v1/post-mortems/query',
    refs: postMortem.evidence,
    facts,
    availableAt: availabilityOfPostMortem(postMortem),
  };
}

/** Capsule from a served knowledge entry (the /v1/knowledge/query read). */
export function capsuleFromKnowledge(scope: WorkspaceScope, knowledge: ServedKnowledge): EvidenceCapsule {
  assertProjectScope(scope, knowledge.record);
  const facts: readonly CapsuleFact[] = [
    fact('claim-kind', knowledge.record.claim.kind),
    fact('polarity', knowledge.record.claim.polarity),
    fact('dimension', knowledge.record.claim.dimension),
    fact('confidence', knowledge.record.confidence),
    fact('evidence-count', knowledge.record.evidenceCount),
    fact('status', knowledge.status),
  ];
  const refs: readonly CapsuleRef[] = [
    { kind: 'post-mortem', ref: knowledge.record.provenance.postMortemRefs.join(' ') },
    { kind: 'outcome', ref: knowledge.record.provenance.outcomeRefs.join(' ') },
    { kind: 'experiment', ref: knowledge.record.provenance.experimentRefs.join(' ') },
  ].filter((entry) => entry.ref.length > 0);
  return {
    capsuleId: capsuleIdOf('knowledge', knowledge.record.knowledgeId, facts, refs),
    tenantId: knowledge.record.tenant,
    projectId: knowledge.record.project,
    sourceKind: 'knowledge',
    sourceRef: knowledge.record.knowledgeId,
    sourceRoute: '/v1/knowledge/query',
    refs,
    facts,
    availableAt: availabilityOfKnowledge(knowledge),
  };
}

/** Capsule from a gateway submission record (the /v1/execution/requests read of the console's own request). */
export function capsuleFromSubmission(scope: WorkspaceScope, submission: GatewaySubmissionRecord): EvidenceCapsule {
  const routed = submission.kind === 'routed';
  const facts: readonly CapsuleFact[] = routed
    ? [
        fact('verdict', 'routed'),
        fact('venue', (submission as { readonly venue: string }).venue),
        fact('request-ref', (submission as { readonly requestRef: string }).requestRef),
      ]
    : [
        fact('verdict', 'refused'),
        fact('stage', submission.refusal.stage),
        fact('decision-id', submission.decisionId),
      ];
  return {
    capsuleId: capsuleIdOf('submission', submission.submissionId, facts, [{ kind: 'gateway-audit', ref: submission.auditId }]),
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    sourceKind: 'submission',
    sourceRef: submission.submissionId,
    sourceRoute: '/v1/execution/requests',
    refs: [{ kind: 'gateway-audit', ref: submission.auditId }],
    facts,
    availableAt: availabilityOfSubmission(submission),
  };
}

/** The capsule list of a whole outcome listing (deterministic — input order preserved). */
export function capsulesFromOutcomes(scope: WorkspaceScope, outcomes: readonly OutcomeRecord[]): readonly EvidenceCapsule[] {
  return outcomes.map((outcome) => capsuleFromOutcome(scope, outcome));
}

/** The capsule list of a whole post-mortem listing. */
export function capsulesFromPostMortems(scope: WorkspaceScope, postMortems: readonly PostMortemRecord[]): readonly EvidenceCapsule[] {
  return postMortems.map((postMortem) => capsuleFromPostMortem(scope, postMortem));
}

/** The capsule list of a whole knowledge page. */
export function capsulesFromKnowledge(scope: WorkspaceScope, knowledge: readonly ServedKnowledge[]): readonly EvidenceCapsule[] {
  return knowledge.map((entry) => capsuleFromKnowledge(scope, entry));
}
