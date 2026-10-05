/**
 * T048 — STATION 4: THE TRADING DIRECTOR (T024).
 *
 * The REAL `composeDirectorDecision` — the declared synthesis
 * method's pure interpreter — over the four-lane research intake.
 *
 * THE HONEST SEAM (documented limitation): the research bodies
 * (T021 sentiment, T022 regime, T023 fundamental/cross-market) are
 * NOT in this slice's dependency set. Their product — the research
 * report mirrors — arrives here as the DIRECTOR LANE'S OWN PUBLISHED
 * FIXTURE RECORDS (the director package's exported fixture reports:
 * the exact records the director lane's own suite proves against, in
 * its fixture scope tenant-director/project-portfolio). The upstream
 * observation surface those bodies consume includes this slice's news
 * station (station 1's canonical news events are the sentiment lane's
 * observation surface) — but the transformation news -> report is the
 * research lanes' lane, outside this slice. The L4 research gate, the
 * quorum, the conflict policy, the coverage accounting and the
 * escalation records are ALL exercised for real below.
 */

import {
  composeDirectorDecision,
  FIXTURE_CROSS_MARKET_REPORT,
  FIXTURE_FUNDAMENTAL_REPORT,
  FIXTURE_REGIME_REPORT,
  FIXTURE_SENTIMENT_REPORT,
  DIRECTOR_METHOD_REGISTRY,
  DIRECTOR_SYNTHESIS_METHOD,
  DIRECTOR_FIXTURE_BODY_VERSION,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  FIXTURE_CONSTRAINT_SETS,
  FIXTURE_DECISION_AS_OF,
  FIXTURE_FULL_INTAKE,
  FIXTURE_GOAL,
  FIXTURE_SEED,
  type DirectorCompositionInput,
  type DirectorOutcome,
  type ResearchIntake,
} from '../../../bodies/trading-director/src/index';

import { DIRECTOR_DECISION_AT } from './scope';

// ---------------------------------------------------------------------------
// The composition inputs
// ---------------------------------------------------------------------------

/** The director lane's fixture scope re-exported (the station's documented scope). */
export const DIRECTOR_SCOPE = {
  tenant: FIXTURE_TENANT,
  project: FIXTURE_PROJECT,
  decisionAsOf: FIXTURE_DECISION_AS_OF,
} as const;

/**
 * The slice's PRIMARY composition input: the full four-lane intake
 * (all lanes present and aligned — the quorum-met path).
 */
export function sliceDirectorInput(): DirectorCompositionInput {
  return {
    asOf: DIRECTOR_DECISION_AT as never,
    goal: FIXTURE_GOAL,
    constraintSets: FIXTURE_CONSTRAINT_SETS,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    seed: FIXTURE_SEED,
    methodId: DIRECTOR_SYNTHESIS_METHOD.methodId,
    registry: DIRECTOR_METHOD_REGISTRY,
    bodyVersion: DIRECTOR_FIXTURE_BODY_VERSION as never,
    intake: FIXTURE_FULL_INTAKE,
  };
}

/** The QUORUM-UNMET input: two lanes absent under the quorum-3 canonical method. */
export function sliceQuorumUnmetInput(): DirectorCompositionInput {
  const intake: ResearchIntake = {
    sentiment: FIXTURE_SENTIMENT_REPORT,
    regime: null,
    fundamental: FIXTURE_FUNDAMENTAL_REPORT,
    crossMarket: null,
  };
  return { ...sliceDirectorInput(), intake };
}

/** The RESEARCH-FROM-THE-FUTURE input: the sentiment report's asOf moved past the decision instant (the L4 gate). */
export function sliceFutureResearchInput(): DirectorCompositionInput {
  const future = { ...FIXTURE_SENTIMENT_REPORT, asOf: (DIRECTOR_DECISION_AT + 1) as never } as typeof FIXTURE_SENTIMENT_REPORT;
  const intake: ResearchIntake = {
    sentiment: future,
    regime: FIXTURE_REGIME_REPORT,
    fundamental: FIXTURE_FUNDAMENTAL_REPORT,
    crossMarket: FIXTURE_CROSS_MARKET_REPORT,
  };
  return { ...sliceDirectorInput(), intake };
}

// ---------------------------------------------------------------------------
// The composition (the decision or the escalation — records, never exceptions)
// ---------------------------------------------------------------------------

/** Compose the primary decision (the quorum-met path: a real DirectorDecision). */
export function composeSliceDecision(): DirectorOutcome {
  const outcome = composeDirectorDecision(sliceDirectorInput());
  if (!outcome.ok) {
    throw new Error(`the slice's director decision must compose: ${outcome.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  }
  return outcome.value;
}

/** Compose the quorum-unmet outcome (an EscalationRecord — a record, never an exception). */
export function composeSliceEscalation(): DirectorOutcome {
  const outcome = composeDirectorDecision(sliceQuorumUnmetInput());
  if (!outcome.ok) {
    throw new Error(`the quorum-unmet composition must compose: ${outcome.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  }
  return outcome.value;
}

/**
 * The L4 gate probe: composing over research from the future is the
 * typed `research_from_the_future` error (the collect-all refusal —
 * the director NEVER consumes research past the decision instant).
 */
export function futureResearchRefusal(): readonly { readonly code: string; readonly path: string }[] {
  const outcome = composeDirectorDecision(sliceFutureResearchInput());
  if (outcome.ok) {
    throw new Error('research from the future must NOT compose — the L4 gate is broken');
  }
  return outcome.errors.map((error) => ({ code: error.code, path: error.path }));
}
