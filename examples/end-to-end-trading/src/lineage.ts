// @tradrl/example-e2e-trading — THE L15 LINEAGE LEDGER.
//
// Project continuity made mechanical: goal, organization, bodies, world,
// research, decision, strategy, risk, execution and outcome records all
// enter ONE append-only, chain-verified ledger. Every entry cites its
// parents (the records it was computed FROM), so an outcome record traces
// back to the goal by a pure graph walk — the `traceToGoal` proof. Tampering
// with any entry breaks the chain (the fnv fold); reordering is a typed
// error. L12: every entry carries tenant/project; a cross-scope parent is
// inexpressible.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';

/** The chain seed of the ledger (mirrors the outcome-log discipline). */
export const LINEAGE_CHAIN_SEED = 'e2e-genesis';

/** The canonical pipeline stages (in declared order). */
export const PIPELINE_STAGES = [
  'scenario',
  'organization',
  'bodies',
  'market-world',
  'research',
  'director',
  'strategy',
  'risk-gateway',
  'execution',
  'outcomes',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** One ledger entry: a record's identity, its stage, its parents. */
export interface LineageEntry {
  readonly entryId: string; // 'e2el-' + 16-hex content digest
  readonly stage: PipelineStage;
  readonly recordKind: string;
  readonly recordId: string;
  readonly tenant: string;
  readonly project: string;
  readonly asOf: number;
  readonly parents: readonly string[]; // parent entry ids (empty = roots)
  readonly chainHead: string; // fnv(prev + canonical(content))
}

export interface LineageLedger {
  readonly tenant: string;
  readonly project: string;
  readonly entries: readonly LineageEntry[];
  readonly head: string;
}

/** The typed ledger error codes. */
export type LineageErrorCode =
  | 'lineage_scope_mismatch'
  | 'lineage_unknown_parent'
  | 'lineage_rewrite'
  | 'lineage_chain';

export interface LineageError {
  readonly code: LineageErrorCode;
  readonly message: string;
}

export type LineageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly LineageError[] };

/** Starts a ledger for a tenant/project scope. */
export function startLedger(tenant: string, project: string): LineageLedger {
  return deepFreeze({
    tenant,
    project,
    entries: [],
    head: fnv1a32Hex(canonicalJson({ tenant, project, entries: 0 } as unknown as JsonValue)),
  });
}

/** The entry content tree (everything except entryId/chainHead). */
function entryContent(entry: Omit<LineageEntry, 'entryId' | 'chainHead'>): JsonValue {
  return {
    stage: entry.stage,
    recordKind: entry.recordKind,
    recordId: entry.recordId,
    tenant: entry.tenant,
    project: entry.project,
    asOf: entry.asOf,
    parents: [...entry.parents],
  };
}

/** Derives the entry id: 'e2el-' + 16-hex stableDigest of the content. */
function deriveEntryId(entry: Omit<LineageEntry, 'entryId' | 'chainHead'>): string {
  return `e2el-${stableDigest(canonicalJson(entryContent(entry)))}`;
}

/** Appends one entry (append-only; scope-checked; chain-folded). */
export function appendEntry(
  ledger: LineageLedger,
  entry: Omit<LineageEntry, 'entryId' | 'chainHead'> & { entryId?: undefined },
): LineageResult<LineageLedger> {
  const errors: LineageError[] = [];
  if (entry.tenant !== ledger.tenant || entry.project !== ledger.project) {
    errors.push({ code: 'lineage_scope_mismatch', message: `entry scope ${entry.tenant}/${entry.project} does not match the ledger scope ${ledger.tenant}/${ledger.project} (L12)` });
  }
  const known = new Set(ledger.entries.map((existing) => existing.entryId));
  for (const parent of entry.parents) {
    if (!known.has(parent)) {
      errors.push({ code: 'lineage_unknown_parent', message: `parent entry ${parent} is not in the ledger (broken link)` });
    }
  }
  if (ledger.entries.some((existing) => existing.recordId === entry.recordId && existing.recordKind === entry.recordKind && existing.stage === entry.stage)) {
    errors.push({ code: 'lineage_rewrite', message: `record ${entry.recordKind}/${entry.recordId} is already in the ledger (append-only)` });
  }
  if (!isTimestampMs(entry.asOf)) {
    errors.push({ code: 'lineage_rewrite', message: 'entry asOf must be an epoch-ms instant' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const content = entryContent(entry);
  const chainHead = fnv1a32Hex(ledger.head + canonicalJson(content));
  const record: LineageEntry = deepFreeze({
    ...entry,
    entryId: deriveEntryId(entry),
    chainHead,
  });
  return {
    ok: true,
    value: deepFreeze({ ...ledger, entries: [...ledger.entries, record], head: chainHead }),
  };
}

/** Verifies the whole chain (a splice/edit/reorder breaks it). */
export function verifyLedger(ledger: LineageLedger): LineageResult<null> {
  const errors: LineageError[] = [];
  let previousHead = fnv1a32Hex(canonicalJson({ tenant: ledger.tenant, project: ledger.project, entries: 0 } as unknown as JsonValue));
  ledger.entries.forEach((entry, index) => {
    const expected = fnv1a32Hex(previousHead + canonicalJson(entryContent(entry)));
    if (entry.chainHead !== expected) {
      errors.push({ code: 'lineage_chain', message: `entry ${String(index + 1)} (${entry.entryId}) chain head does not verify` });
    }
    previousHead = entry.chainHead;
  });
  if (ledger.head !== previousHead) {
    errors.push({ code: 'lineage_chain', message: 'the ledger head does not match the last entry' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  return { ok: true, value: null };
}

/** The entry ids of one stage (in append order). */
export function entriesOfStage(ledger: LineageLedger, stage: PipelineStage): readonly LineageEntry[] {
  return ledger.entries.filter((entry) => entry.stage === stage);
}

/** Looks up an entry by its record id (first match). */
export function entryOfRecord(ledger: LineageLedger, recordId: string): LineageEntry | null {
  return ledger.entries.find((entry) => entry.recordId === recordId) ?? null;
}

/**
 * THE L15 PROOF: walk parents from any entry back to the goal root. Returns
 * the full ancestor path (entry ids, newest first) ending at the goal entry,
 * or a typed error when no goal root is reachable.
 */
export function traceToGoal(
  ledger: LineageLedger,
  entryId: string,
): LineageResult<{ readonly path: readonly string[]; readonly goalEntry: LineageEntry }> {
  const byId = new Map(ledger.entries.map((entry) => [entry.entryId, entry]));
  const visited = new Set<string>();
  const path: string[] = [];
  let cursor: LineageEntry | undefined = byId.get(entryId);
  while (cursor !== undefined) {
    if (visited.has(cursor.entryId)) {
      return { ok: false, errors: deepFreeze([{ code: 'lineage_chain', message: `cycle at ${cursor.entryId}` }]) };
    }
    visited.add(cursor.entryId);
    path.push(cursor.entryId);
    if (cursor.recordKind === 'goal-statement') {
      return { ok: true, value: deepFreeze({ path, goalEntry: cursor }) };
    }
    const parents = [...cursor.parents];
    if (parents.length === 0) {
      break;
    }
    // Deterministic walk: follow the first parent that leads to a goal root.
    let next: LineageEntry | undefined;
    for (const parent of parents) {
      const candidate = byId.get(parent);
      if (candidate !== undefined && reachesGoal(byId, candidate.entryId, new Set(visited))) {
        next = candidate;
        break;
      }
    }
    cursor = next;
  }
  return {
    ok: false,
    errors: deepFreeze([{ code: 'lineage_unknown_parent', message: `no goal root is reachable from ${entryId}` }]),
  };
}

/** Whether a goal root is reachable from an entry (memoized by the visited set). */
function reachesGoal(
  byId: Map<string, LineageEntry>,
  entryId: string,
  visited: Set<string>,
): boolean {
  if (visited.has(entryId)) return false;
  const entry = byId.get(entryId);
  if (entry === undefined) return false;
  if (entry.recordKind === 'goal-statement') return true;
  const nextVisited = new Set([...visited, entryId]);
  return entry.parents.some((parent) => reachesGoal(byId, parent, nextVisited));
}

/** Guard: a ledger entry. */
export function isLineageEntry(v: unknown): v is LineageEntry {
  return (
    isRecord(v) &&
    isNonEmptyString(v.entryId) &&
    (v.entryId as string).startsWith('e2el-') &&
    isNonEmptyString(v.recordId) &&
    isNonEmptyString(v.tenant) &&
    isNonEmptyString(v.project) &&
    Array.isArray(v.parents) &&
    typeof v.chainHead === 'string'
  );
}
