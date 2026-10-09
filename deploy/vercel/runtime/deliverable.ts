// deploy/vercel/runtime/deliverable.ts — THE RESEARCH DELIVERABLE COMPOSER
// (FW-36-A, Round E register E-1 — the #1 Round E blocker, 9/9 personas).
//
// THE HOLE THIS CLOSES (phase2-roundE-report.md §3 E-1): every research
// job's completion payload was the FIXED stub
//   { kind: 'release-candidate', specId: 'spec-demo-director', version: 1,
//     project: <id> }
// — zero goal numbers ever rendered. The console's RESULT section projects
// the payload's own fields (apps/web jobResultSectionOf), so the stub could
// only ever render the one generic notice sentence. M3's maximally
// numbers-dense goal (2418 round trips, 63% hit rate, 8bps cost budget,
// z-scores, half-life) produced the IDENTICAL bytes to everyone else's —
// the deliverable proved nothing about the mandate it served.
//
// THE HONESTY LAW (this wave's core — THE WORK ORDER'S OWN WORDS): the fix
// is NOT to invent backtest statistics. A fabricated "63% hit rate" would
// be a WORSE defect than the stub. The deliverable is COMPOSED from the
// project's ACTUAL records — the goal statement + constraint set its
// create-project request carried (the W-25B/W-25D captures), the launch
// world its kickoff job's spec carried (the W-28 capture), and the
// promoted-decision lineage the promotion registry holds at composition
// time — every number verbatim-traceable to a record the system actually
// holds. Two launches with different mandates produce observably different
// deliverable text (pinned by test); NO fixed sentence remains.
//
// THE COMPOSITION (pure, deterministic — never a wall clock, never a
// random, never a throw; a malformed input degrades to its honest
// statements, R46):
//   - `summary`  — the composed sentence: the markets/venues the world
//                  actually served, the declared budgets (verbatim), the
//                  goal's horizon, EVERY declared constraint (id + domain
//                  + subject + kind + bound), the honest lineage
//                  statement, and the SIMULATED disclosure;
//   - `markets` / `venues` — the observed world state (a launched desk's
//                  captured world; the demo project's SEEDED blotTER's own
//                  instruments — never a fabricated world record);
//   - `capitalBudget` / `riskBudget` — the mandate's declared budget texts
//                  (the budget constraints' own `equals` values, verbatim);
//   - `horizon` / `objective` — the goal's own records, verbatim;
//   - `constraints` — every declared constraint as a structured row
//                  (id + domain + subject + predicate) — traceable;
//   - `lineage`   — the promoted decision this deliverable led to (by
//                  outcome id) when one exists AT COMPOSITION TIME, else
//                  the honest "pending promotion" statement (the job
//                  record is composed once, at the completion transition —
//                  the frozen truth of that instant);
//   - `disclosure` — the SIMULATED framing, stated (the research machinery
//                  is simulated substance under the console's badge).
//
// The payload is ADDITIVE on the pre-FW-36-A stub shape: `kind`, `specId`,
// `version` and `project` are preserved verbatim (the promotion route's
// releaseCandidateOf reads them; the frozen transitions route carries the
// result opaquely). The demo scope keeps its own director id
// (`spec-demo-director`); a launched desk's deliverable names the
// per-project launch director (`spec-launch-director` — the
// project-evidence convention).
//
// Zero-dep law: imports the frozen boundary's own types + primitives only.
// Spec anchors: R38 (evidence discipline), R45 (provenance), R46 (typed
// degradation), L4 (the lineage is the composition instant's own truth),
// L15 (project continuity), L20 (records, never re-decisions), UX-DESIGN
// §7 (anti-deception); phase2-roundE-report §3 E-1 + §6.1.

import {
  deepFreeze,
  type ConstraintSetStatement,
  type GoalStatement,
} from '../../../services/api/src/index';
import type { LaunchWorldRecord } from './demo';

// ---------------------------------------------------------------------------
// The composer's inputs (all explicit — never ambient, never a request value)
// ---------------------------------------------------------------------------

/** The project's mandate records on file: its captured goal + constraint set + launch world. */
export interface DeliverableMandate {
  /** The create-project input's goal statement, verbatim. */
  readonly goal: GoalStatement;
  /** The create-project input's constraint set, verbatim. */
  readonly constraintSet: ConstraintSetStatement;
  /** The kickoff job's captured launch world (null for the demo scope + pre-W-28/world-less launches). */
  readonly world: LaunchWorldRecord | null;
}

/** The observed world state the deliverable cites (what the world actually served for THIS project). */
export interface DeliverableObservedState {
  /** The market/instrument ids the world served (a launched desk's world; the demo project's seeded blotter). */
  readonly markets: readonly string[];
  /** The venue ids the world served. */
  readonly venues: readonly string[];
}

/** The promoted decision a deliverable led to, as the composition-time lineage holds it. */
export interface DeliverablePromotion {
  /** The promoted decision record's own outcome id (the decision→job backlink's other half). */
  readonly outcomeId: string;
}

/** One composed release-candidate result payload's construction inputs. */
export interface ResearchDeliverableInput {
  /** The launched project the research job belongs to. */
  readonly project: string;
  /** The composing machinery's director id (the demo director for the demo scope; the per-project launch director otherwise). */
  readonly director: string;
  /** The project's mandate records on file (null when nothing is on record for the project at this host). */
  readonly mandate: DeliverableMandate | null;
  /** The markets/venues the world actually served (null when nothing is on record). */
  readonly observed: DeliverableObservedState | null;
  /** The promoted decision this deliverable led to, when one exists at composition time (else null). */
  readonly promotion: DeliverablePromotion | null;
}

// ---------------------------------------------------------------------------
// The mandate readers (structural, never a throw — R46)
// ---------------------------------------------------------------------------

/** One declared constraint as the deliverable cites it (id + domain + subject + predicate, traceable). */
export interface DeclaredConstraintFact {
  readonly id: string;
  readonly domain: string;
  readonly subject: string;
  readonly kind: string;
  readonly bound: string;
}

/** Read the mandate's declared constraints as citable facts (a malformed row is skipped, never a crash — R46). */
export function declaredConstraintFacts(constraintSet: ConstraintSetStatement): readonly DeclaredConstraintFact[] {
  const constraints = Array.isArray(constraintSet.constraints) ? constraintSet.constraints : [];
  const facts: DeclaredConstraintFact[] = [];
  for (const constraint of constraints) {
    if (typeof constraint !== 'object' || constraint === null) continue;
    const record = constraint as { readonly id?: unknown; readonly domain?: unknown; readonly subject?: unknown; readonly predicate?: unknown };
    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (typeof record.domain !== 'string' || record.domain.length === 0) continue;
    if (typeof record.subject !== 'string' || record.subject.length === 0) continue;
    const predicate = record.predicate;
    if (typeof predicate !== 'object' || predicate === null) continue;
    const predicateRecord = predicate as { readonly kind?: unknown; readonly bound?: unknown; readonly value?: unknown };
    if (typeof predicateRecord.kind !== 'string' || predicateRecord.kind.length === 0) continue;
    let bound = 'unspecified';
    if (typeof predicateRecord.bound === 'number' && Number.isFinite(predicateRecord.bound)) bound = String(predicateRecord.bound);
    else if (typeof predicateRecord.value === 'number' && Number.isFinite(predicateRecord.value)) bound = String(predicateRecord.value);
    else if (typeof predicateRecord.bound === 'string' && predicateRecord.bound.length > 0) bound = predicateRecord.bound;
    else if (typeof predicateRecord.value === 'string' && predicateRecord.value.length > 0) bound = predicateRecord.value;
    facts.push({ id: record.id, domain: record.domain, subject: record.subject, kind: predicateRecord.kind, bound });
  }
  return Object.freeze(facts);
}

/** Read the mandate's declared budget of one subject family ('capital'+'budget' or 'risk'+'budget'), verbatim ('not declared' when absent). */
function declaredBudgetOf(facts: readonly DeclaredConstraintFact[], ...words: readonly string[]): string {
  const match = facts.find((fact) => words.every((word) => fact.subject.includes(word)) && fact.bound !== 'unspecified');
  return match === undefined ? 'not declared' : match.bound;
}

/** The goal's horizon as a readable, deterministic string (UTC ISO bounds + the optional label — the console's own instant discipline). */
function horizonTextOf(goal: GoalStatement): string {
  const horizon = goal.horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown; readonly label?: unknown } | null;
  if (horizon === null || typeof horizon !== 'object') return 'no horizon on record';
  if (typeof horizon.startsAt !== 'number' || !Number.isFinite(horizon.startsAt) || typeof horizon.endsAt !== 'number' || !Number.isFinite(horizon.endsAt)) return 'no horizon on record';
  const label = typeof horizon.label === 'string' && horizon.label.length > 0 ? ` (${horizon.label})` : '';
  return `${new Date(horizon.startsAt).toISOString()} to ${new Date(horizon.endsAt).toISOString()}${label}`;
}

// ---------------------------------------------------------------------------
// THE COMPOSER (pure, deterministic, never a throw)
// ---------------------------------------------------------------------------

/**
 * Compose ONE research job's release-candidate result payload from the
 * project's own records. Every rendered number is a VERBATIM citation of a
 * record the input carries — the composer fabricates nothing (THE HONESTY
 * LAW). A missing record degrades to its honest statement ("not declared",
 * "no launch world on record", "pending promotion"), never a placeholder
 * number.
 */
export function composeResearchDeliverableResult(input: ResearchDeliverableInput): Record<string, unknown> {
  const { project, director, mandate, observed, promotion } = input;
  const facts = mandate === null ? [] : declaredConstraintFacts(mandate.constraintSet);
  const markets = observed !== null && observed.markets.length > 0 ? [...observed.markets] : [];
  const venues = observed !== null && observed.venues.length > 0 ? [...observed.venues] : [];
  const capitalBudget = declaredBudgetOf(facts, 'capital', 'budget');
  const riskBudget = declaredBudgetOf(facts, 'risk', 'budget');

  // THE WORLD-STATE SENTENCE — what the world actually served for THIS
  // project (a captured launch world, or the demo scope's own seeded
  // blotter — never a fabricated world record; the honest statement when
  // nothing is on record).
  const worldSentence = markets.length > 0
    ? `Simulated research session over ${markets.join(' and ')} on ${venues.join(' and ')}${mandate !== null && mandate.world !== null ? ' (the world the launch actually served)' : ' (the seeded session\'s own instruments)'}`
    : `Simulated research session with no launch world on record for ${project}`;

  // THE MANDATE'S DECLARED ACTUALS — verbatim-traceable (the budgets, the
  // horizon, EVERY declared constraint with id + domain + subject + kind +
  // bound). These are CITATIONS of the project's own records, never
  // computed relations and never invented statistics.
  const constraintList = facts.map((fact) => `${fact.id} (${fact.domain}, ${fact.subject}, ${fact.kind}, bound ${fact.bound})`).join('; ');
  const mandateSentence = `The mandate declares a capital budget of ${capitalBudget} and a risk budget of ${riskBudget}, across the horizon ${mandate === null ? 'no goal on record' : horizonTextOf(mandate.goal)}, under ${facts.length === 0 ? 'no declared constraints on record' : `${facts.length} declared constraint${facts.length === 1 ? '' : 's'}: ${constraintList}`}`;

  // THE HONEST LINEAGE STATEMENT — what the deliverable produced
  // downstream, by id, at composition time (the frozen truth of the
  // completion instant; a promotion minted later carries its own
  // decision→job backlink, the other half of the lineage).
  const lineageStatement = promotion !== null
    ? `promoted as the decision record ${promotion.outcomeId} (the promotion cites this deliverable through its own job backlink)`
    : 'pending promotion — no decision record cites this deliverable yet at composition time (the deliverable awaits the desk\'s promote action)';

  // THE SIMULATED DISCLOSURE — preserved verbatim in spirit: this is
  // simulated research substance, and every number above is the project's
  // own declared record, never a fabricated research statistic.
  const disclosure = 'a SIMULATED research deliverable — composed from this project\'s own captured records (the goal, the constraint set, the launch world) at completion time; it is simulated substance under the console\'s SIMULATED badge and never a fabricated research statistic';

  const summary = `${worldSentence}. ${mandateSentence}. Downstream lineage: ${lineageStatement}. This is ${disclosure}.`;

  return deepFreeze({
    kind: 'release-candidate',
    specId: director,
    version: 1,
    project,
    title: `the research release candidate of ${project}`,
    summary,
    objective: mandate === null ? 'no goal statement on record for this project at this host' : mandate.goal.objective,
    markets: Object.freeze(markets),
    venues: Object.freeze(venues),
    capitalBudget,
    riskBudget,
    horizon: mandate === null
      ? Object.freeze({ statement: 'no goal statement on record for this project at this host' })
      : Object.freeze(mandate.goal.horizon),
    constraints: Object.freeze(facts.map((fact) => Object.freeze({ id: fact.id, domain: fact.domain, subject: fact.subject, kind: fact.kind, bound: fact.bound }))),
    lineage: Object.freeze({
      promotedDecision: promotion === null ? null : promotion.outcomeId,
      statement: lineageStatement,
    }),
    disclosure,
  });
}
