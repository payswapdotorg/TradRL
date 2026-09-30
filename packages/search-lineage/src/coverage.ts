/**
 * @tradrl/search-lineage — the platform hidden-trials law (Work Order T031).
 *
 * Spec anchors: ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to expose selection effects"); spec/EVALUATION-
 * PROTOCOL.md ("Retain search histories"); the work order's own law —
 * "Hiding a trial is a typed error (mirror T012's hidden_trials law at the
 * platform level)".
 *
 * THE LAW: T012's in-package report (packages/evaluation/src/integrity.ts)
 * fires `hidden_trials` when per-trial STATISTICS do not cover the caller's
 * trial log. This package is the PLATFORM layer above it: the search record
 * IS the log (append-only, chain-verified — see record.ts), and any
 * downstream consumer that CLAIMS a view of the search must claim exactly
 * the record's trials:
 *
 * - a claim that MISSES logged trials fails `hidden_trials` (the platform
 *   mirror of T012's law — the caller that drops its worst attempts from
 *   the claimed view gets a typed rejection, never a rosier one);
 * - a claim that names trials the record never contained fails
 *   `unknown_trial` (fabricated search history is not search history);
 * - a claim that repeats a trial fails `invalid_field` (a view is a set).
 *
 * {@link searchInventory} is the assert-and-project API: it verifies the
 * record's chain FIRST (an unverified record cannot support any view — the
 * log itself must be honest before its projections are), checks the claimed
 * coverage, and returns the inventory facts (in-search vs holdout counts,
 * distinct configs, DAG shape) computed FROM THE RECORD — never from the
 * claim. The claim only names trials; it cannot alter what is counted.
 */

import { deepFreeze, isRecord } from './primitives';
import { isTrialId } from './ids';
import type { TrialId } from './ids';
import { invalidField, fail, ok, type SearchResult } from './errors';
import { searchDag, verifySearchRecord } from './record';
import type { SearchRecord } from './record';

/**
 * The asserted inventory of one search record: the facts computed from the
 * record itself (never from the claim) once the claimed coverage is proven
 * total. All facts; no narrative.
 */
export interface SearchInventory {
  /** The verified record the inventory was computed from. */
  readonly search_id: string;
  /** Every logged trial (the claim had to name exactly these). */
  readonly trials: readonly TrialId[];
  /** Trials classified in-search (the optimization material — best-of-N candidates live here). */
  readonly inSearch: number;
  /** Trials classified holdout (the unseen checks). */
  readonly holdout: number;
  /** Distinct content-addressed config snapshots referenced by entries. */
  readonly distinctConfigs: number;
  /** Distinct data-split ids consumed across all entries. */
  readonly distinctSplits: number;
  /** The DAG's maximal depth (chain-of-derivations length). */
  readonly maxDepth: number;
  /** Raw entry count (== trials: a search trial is one entry). */
  readonly entries: number;
}

/**
 * Assert the claimed trial coverage against the search record and project
 * the inventory.
 *
 * Inputs:
 * - `record` — an (untrusted) search record value; the chain is VERIFIED
 *   first (`chain_mismatch` and every log-law failure propagate);
 * - `claimed` — the trial ids the consumer claims constitute the search.
 *
 * Typed error laws: `chain_mismatch` (unverified record), `hidden_trials`
 * (the claim misses logged trials — the platform mirror of T012's law),
 * `unknown_trial` (the claim names unlogged trials), `invalid_field` (the
 * claim is not a set of trial ids).
 *
 * Determinism: a pure function of (record, claimed); the inventory is
 * computed from the verified record alone.
 */
export function searchInventory(record: unknown, claimed: readonly unknown[]): SearchResult<SearchInventory> {
  const verified = verifySearchRecord(record);
  if (!verified.ok) return verified;
  const value = verified.value;

  if (!Array.isArray(claimed)) {
    return { ok: false, errors: [invalidField('claimed', 'must be an array of trial ids')] };
  }
  const claimedSet = new Set<TrialId>();
  for (let index = 0; index < claimed.length; index++) {
    const candidate = claimed[index];
    if (!isTrialId(candidate)) {
      return { ok: false, errors: [invalidField(`claimed[${index}]`, 'must be a non-empty trial id')] };
    }
    if (claimedSet.has(candidate)) {
      return { ok: false, errors: [invalidField(`claimed[${index}]`, `trial "${candidate}" is claimed twice — a coverage claim is a set`)] };
    }
    claimedSet.add(candidate);
  }

  const logged = value.entries.map((entry) => entry.trial);
  const hidden = logged.filter((trial) => !claimedSet.has(trial));
  if (hidden.length > 0) {
    return fail(
      'hidden_trials',
      `claim covers ${claimedSet.size} of ${logged.length} logged trial(s); missing: ${hidden.map((id) => `"${id}"`).join(', ')} — hiding trials is a typed error (L11, platform mirror of T012's hidden_trials)`,
      'claimed',
    );
  }
  const unknown = [...claimedSet].filter((trial) => !logged.includes(trial));
  if (unknown.length > 0) {
    return fail('unknown_trial', `claim names trial(s) the record does not contain: ${unknown.map((id) => `"${id}"`).join(', ')}`, 'claimed');
  }

  const dag = searchDag(value);
  const configs = new Set(value.entries.map((entry) => entry.config));
  const splits = new Set<string>();
  for (const entry of value.entries) {
    for (const split of entry.splits) splits.add(split);
  }
  const inSearch = value.entries.filter((entry) => entry.classification === 'in-search').length;

  return ok(
    deepFreeze({
      search_id: value.search_id,
      trials: logged,
      inSearch,
      holdout: logged.length - inSearch,
      distinctConfigs: configs.size,
      distinctSplits: splits.size,
      maxDepth: dag.maxDepth,
      entries: logged.length,
    } satisfies SearchInventory),
  );
}

/**
 * The in-search trial ids of a verified record, in append order — the
 * best-of-N candidate identity list downstream audits (T031
 * evaluation-integrity) must provide statistics for. The record is verified
 * first; an unverified record supports no projection.
 */
export function inSearchTrials(record: unknown): SearchResult<readonly TrialId[]> {
  const verified = verifySearchRecord(record);
  if (!verified.ok) return verified;
  return ok(deepFreeze(verified.value.entries.filter((entry) => entry.classification === 'in-search').map((entry) => entry.trial)));
}

/** Guard re-exported for inventory consumers. */
export { isRecord };
export type { SearchRecord };
