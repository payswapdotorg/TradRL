/**
 * @tradrl/evaluation-integrity — shared test fixtures (Work Order T031).
 *
 * Builders for mirror-shaped search records used across the leakage,
 * quarantine and selection test suites. Pure, deterministic, and shaped
 * EXACTLY like records the real @tradrl/search-lineage package builds
 * (the interop trip-wires prove that separately).
 */

import { computeChainHeadMirror, configSnapshotIdMirror, searchRecordIdMirror } from './search-mirror';
import type { SearchBindingMirror, SearchRecordMirror, SearchTrialEntryMirror } from './search-mirror';
import type { ConfigSnapshotId, TrialId } from './ids';

/** The fixture epoch (2023-11-14T22:13:20Z). */
export const T0 = 1_700_000_000_000;
/** One day of epoch milliseconds. */
export const DAY = 86_400_000;

/** The fixture binding block (tenant-1/project-1, experiment exp-1). */
export const BINDING: SearchBindingMirror = {
  experiment: 'exp-1' as never,
  evaluator: 'evaluator@1',
  tenant: 'tenant-1' as never,
  project: 'project-1' as never,
};

/** One trial fixture of the builder. */
export interface TrialFixture {
  readonly trial: string;
  readonly classification?: 'in-search' | 'holdout';
  readonly parents?: readonly string[];
  readonly config?: Record<string, unknown>;
  readonly recordedAt?: number;
  readonly window?: { readonly start: number; readonly end: number } | null;
  readonly datasets?: readonly string[];
}

function entryOf(f: TrialFixture, snapshotId: string, instant: number): SearchTrialEntryMirror {
  const isHoldout = (f.classification ?? 'in-search') === 'holdout';
  return {
    trial: f.trial as TrialId,
    arm: null,
    classification: f.classification ?? 'in-search',
    config: snapshotId as ConfigSnapshotId,
    parents: (f.parents ?? []) as never,
    splits: (isHoldout ? ['split.holdout-1'] : ['split.train-1']) as never,
    datasets: (f.datasets ?? ['dataset-europe']) as never,
    window: (f.window ?? { start: T0, end: T0 + DAY }) as never,
    evaluation_policy: (isHoldout ? 'split.holdout-1' : 'split.eval-a') as never,
    recorded_at: instant as never,
    tenant: 'tenant-1' as never,
    project: 'project-1' as never,
  };
}

/**
 * Build a mirror-shaped search record the way the real package would:
 * content-addressed snapshots (deduped), ordered injected instants, and
 * the recomputed chain head.
 */
export function buildRecord(fixtures: readonly TrialFixture[]): SearchRecordMirror {
  const entries: SearchTrialEntryMirror[] = [];
  const snapshots: { snapshot_id: string; config: Record<string, unknown> }[] = [];
  let instant = T0 + 100;
  for (const f of fixtures) {
    const config = f.config ?? { point: f.trial };
    let snapshotId = snapshots.find((s) => configSnapshotIdMirror(config as never) === s.snapshot_id)?.snapshot_id;
    if (snapshotId === undefined) {
      snapshotId = configSnapshotIdMirror(config as never);
      snapshots.push({ snapshot_id: snapshotId, config });
    }
    entries.push(entryOf(f, snapshotId, f.recordedAt ?? instant));
    instant += 1;
  }
  return {
    search_id: searchRecordIdMirror(BINDING),
    experiment: BINDING.experiment,
    evaluator: BINDING.evaluator,
    tenant: BINDING.tenant,
    project: BINDING.project,
    entries,
    snapshots: snapshots as unknown as SearchRecordMirror['snapshots'],
    chain_head: computeChainHeadMirror(BINDING, entries),
  };
}

/**
 * The attacker's mutable view of a serialized record (tamper tests):
 * everything mutable, nothing branded.
 */
export interface LooseRecord {
  search_id: string;
  experiment: string;
  evaluator: string;
  tenant: string;
  project: string;
  entries: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  chain_head: string;
}

/** Parse-and-cast a record into the attacker's mutable view. */
export function thawRecord(record: SearchRecordMirror): LooseRecord {
  return JSON.parse(JSON.stringify(record)) as LooseRecord;
}

/**
 * The canonical search fixture: four in-search trials (two configs
 * searched, a parent chain t1 -> t2 and t3 -> t4) plus one holdout
 * evaluation of the SELECTED config ({ lr: '0.3' }, t4's config) over a
 * well-separated window.
 */
export const SEARCH_FIXTURES: readonly TrialFixture[] = [
  { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't2', parents: ['t1'], config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't3', config: { lr: '0.2' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't4', parents: ['t3'], config: { lr: '0.3' }, window: { start: T0, end: T0 + DAY } },
  { trial: 'h1', classification: 'holdout', config: { lr: '0.3' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
];
