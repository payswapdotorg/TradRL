/**
 * @tradrl/provenance — derivation chains (validated DAG walking).
 *
 * The lineage of a derived record is a directed acyclic graph: each node
 * (event or artifact) lists its parents (`derived_from`). This module
 * validates the graph and answers lineage queries:
 *
 *   - `validateDerivationChain` — collect-all validation mirroring
 *     market-protocol's validator discipline: no self-reference, no
 *     duplicate parents (per node), and ACYClicity (a cycle anywhere in the
 *     graph is reported with the exact cycle path).
 *   - `chainDepth` — the number of derivation edges on the longest path
 *     from a node down to a root (a primitive is depth 0; an event derived
 *     from one primitive is depth 1; a 3-deep chain resolves to depth 3).
 *   - `resolveRoots` — the root ids a node ultimately derives from. Roots
 *     are nodes with no parents; a parent id NOT present in the node set is
 *     an EXTERNAL root (dangling lineage) — reported, not rejected: the
 *     store may hold derived events whose parents live elsewhere.
 *   - `ancestorsOf` — the transitive parent set (including external ids).
 *
 * Queries are deterministic: result sets are sorted; violations are
 * reported in node order. Query functions detect cycles defensively and
 * fail with `chain_cycle` instead of looping forever.
 */

import { fail, ok, type ProvenanceResult } from './errors';
import { isNonEmptyString, isNonEmptyStringArray, isRecord } from './fields';
import type { LineageId } from './fields';

/** One node of a derivation graph: an id plus its parent list. */
export interface ChainNode {
  readonly id: LineageId;
  readonly derived_from: readonly LineageId[];
}

/** Runtime guard for a ChainNode. */
export function isChainNode(value: unknown): value is ChainNode {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyStringArray(value.derived_from);
}

/** A derivation-graph violation found by {@link validateDerivationChain}. */
export type ChainViolation =
  | { readonly kind: 'chain_self_reference'; readonly node: LineageId; readonly parent: LineageId }
  | { readonly kind: 'chain_duplicate_parent'; readonly node: LineageId; readonly parent: LineageId }
  | { readonly kind: 'chain_cycle'; readonly node: LineageId; readonly cycle: readonly LineageId[] };

/** Outcome of {@link validateDerivationChain}. */
export interface ChainValidation {
  readonly ok: boolean;
  readonly violations: readonly ChainViolation[];
}

/** Build an id -> derived_from map; the first node wins on duplicate ids. */
function nodeMap(nodes: readonly ChainNode[]): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const node of nodes) {
    if (!map.has(node.id)) map.set(node.id, node.derived_from);
  }
  return map;
}

/**
 * Validate a derivation graph: per-node self-reference and duplicate-parent
 * rules (mirroring market-protocol's provenance validator discipline), plus
 * whole-graph acyclicity. Local structural violations are reported first
 * (in node order); cycles are then detected on the locally-valid edges
 * (self-edges are excluded — the local rule already reports them).
 * Collects every violation; never throws.
 */
export function validateDerivationChain(nodes: readonly ChainNode[]): ChainValidation {
  const violations: ChainViolation[] = [];
  const map = nodeMap(nodes);

  // --- Local rules: self-reference, duplicate parents ------------------------
  for (const node of nodes) {
    const seen = new Set<string>();
    for (const parent of node.derived_from) {
      if (parent === node.id) {
        violations.push({ kind: 'chain_self_reference', node: node.id, parent });
        continue;
      }
      if (seen.has(parent)) {
        violations.push({ kind: 'chain_duplicate_parent', node: node.id, parent });
        continue;
      }
      seen.add(parent);
    }
  }

  // --- Global rule: acyclicity (iterative gray/black DFS) --------------------
  // color: 0 = white (unvisited), 1 = gray (on the current path), 2 = black (done)
  const color = new Map<string, 0 | 1 | 2>();
  for (const id of map.keys()) color.set(id, 0);

  for (const start of map.keys()) {
    if (color.get(start) === 2) continue;
    const frames: Array<{ id: string; parents: readonly string[]; next: number; path: string[] }> = [
      { id: start, parents: map.get(start) ?? [], next: 0, path: [start] },
    ];
    color.set(start, 1);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.next < frame.parents.length) {
        const parent = frame.parents[frame.next];
        frame.next += 1;
        if (!map.has(parent)) continue; // external root — no node to visit
        if (parent === frame.id) continue; // self-edge — reported by the local rule
        const parentColor = color.get(parent) ?? 0;
        if (parentColor === 1) {
          // Back-edge to a node on the current path: report the closed cycle.
          const cycle = frame.path.slice(frame.path.indexOf(parent));
          cycle.push(parent);
          violations.push({ kind: 'chain_cycle', node: start, cycle });
        } else if (parentColor === 0) {
          color.set(parent, 1);
          frames.push({ id: parent, parents: map.get(parent) ?? [], next: 0, path: [...frame.path, parent] });
        }
      } else {
        color.set(frame.id, 2);
        frames.pop();
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Internal outcome of a transitive ancestor walk. */
interface WalkOutcome {
  /** Transitive parent ids (external ids included; the query id itself excluded). */
  readonly ancestors: ReadonlySet<string>;
  /** Non-null when a cycle was encountered on the walk (the node that closed it). */
  readonly cycle_at: string | null;
}

/**
 * Walk the ancestors of `id` transitively with an explicit DFS stack. The
 * query id itself is never in the result. Nodes fully expanded once are
 * never re-expanded (diamonds are handled); the current path is tracked so
 * a back-edge is a genuine cycle.
 */
function walkAncestors(id: string, map: Map<string, readonly string[]>): WalkOutcome {
  const ancestors = new Set<string>();
  const visited = new Set<string>(); // fully expanded (black)
  const onPath = new Set<string>(); // on the current DFS path (gray)
  const frames: Array<{ id: string; parents: readonly string[]; next: number }> = [];

  // Seed: the query id is on the path but NOT in the ancestor set.
  onPath.add(id);
  frames.push({ id, parents: map.get(id) ?? [], next: 0 });

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.next < frame.parents.length) {
      const parent = frame.parents[frame.next];
      frame.next += 1;
      if (!map.has(parent)) {
        ancestors.add(parent); // external root — referenced lineage
        continue;
      }
      if (visited.has(parent)) continue;
      if (onPath.has(parent)) {
        return { ancestors, cycle_at: parent };
      }
      onPath.add(parent);
      ancestors.add(parent);
      frames.push({ id: parent, parents: map.get(parent) ?? [], next: 0 });
    } else {
      onPath.delete(frame.id);
      visited.add(frame.id);
      frames.pop();
    }
  }

  return { ancestors, cycle_at: null };
}

/**
 * The transitive ancestors of `id`: sorted unique parent ids reachable
 * through `derived_from` edges (external ids included, the query id
 * excluded). Fails with `chain_unknown_node` or `chain_cycle`.
 */
export function ancestorsOf(id: LineageId, nodes: readonly ChainNode[]): ProvenanceResult<readonly LineageId[]> {
  const map = nodeMap(nodes);
  if (!map.has(id)) {
    return fail('chain_unknown_node', `chain query for unknown node "${id}"`);
  }
  const walk = walkAncestors(id, map);
  if (walk.cycle_at !== null) {
    return fail('chain_cycle', `derivation chain through "${walk.cycle_at}" is cyclic`);
  }
  return ok([...walk.ancestors].sort());
}

/**
 * Resolve the ROOTS of `id`: the primitive ancestors it ultimately derives
 * from. A root is either a node with no parents, or a parent id outside the
 * node set (external/dangling lineage). A primitive resolves to itself.
 * Returns the sorted unique root ids.
 */
export function resolveRoots(id: LineageId, nodes: readonly ChainNode[]): ProvenanceResult<readonly LineageId[]> {
  const map = nodeMap(nodes);
  if (!map.has(id)) {
    return fail('chain_unknown_node', `chain query for unknown node "${id}"`);
  }
  const walk = walkAncestors(id, map);
  if (walk.cycle_at !== null) {
    return fail('chain_cycle', `derivation chain through "${walk.cycle_at}" is cyclic`);
  }
  const roots = new Set<string>();
  for (const ancestor of walk.ancestors) {
    const parents = map.get(ancestor);
    if (parents === undefined || parents.length === 0) roots.add(ancestor);
  }
  if ((map.get(id) ?? []).length === 0) roots.add(id);
  return ok([...roots].sort());
}

/**
 * The depth of `id`: the number of derivation edges on the LONGEST path
 * from `id` down to a root. Primitives (no parents) are depth 0; a parent
 * outside the node set is an external root (depth 0, one edge away).
 * Fails with `chain_unknown_node` or `chain_cycle`.
 */
export function chainDepth(id: LineageId, nodes: readonly ChainNode[]): ProvenanceResult<number> {
  const map = nodeMap(nodes);
  if (!map.has(id)) {
    return fail('chain_unknown_node', `chain query for unknown node "${id}"`);
  }
  const walk = walkAncestors(id, map);
  if (walk.cycle_at !== null) {
    return fail('chain_cycle', `derivation chain through "${walk.cycle_at}" is cyclic`);
  }
  // Longest-path depths over the reachable subgraph, resolved in dependency
  // order (a node resolves once every in-graph parent has a depth).
  const depth = new Map<string, number>();
  const pending = new Set<string>([id]);
  for (const ancestor of walk.ancestors) if (map.has(ancestor)) pending.add(ancestor);

  let progress = true;
  while (pending.size > 0 && progress) {
    progress = false;
    for (const node of pending) {
      const parents = map.get(node) ?? [];
      let resolved = true;
      let maxParentDepth = -1;
      for (const parent of parents) {
        if (!map.has(parent)) {
          if (maxParentDepth < 0) maxParentDepth = 0; // external root: depth 0
          continue;
        }
        const parentDepth = depth.get(parent);
        if (parentDepth === undefined) {
          resolved = false;
          break;
        }
        if (parentDepth > maxParentDepth) maxParentDepth = parentDepth;
      }
      if (resolved) {
        depth.set(node, parents.length === 0 ? 0 : maxParentDepth + 1);
        pending.delete(node);
        progress = true;
      }
    }
  }
  if (pending.size > 0) {
    // Unreachable after the cycle check, but kept as a total-function guard.
    return fail('chain_cycle', 'derivation chain did not resolve — cyclic parent edges');
  }
  return ok(depth.get(id) ?? 0);
}
