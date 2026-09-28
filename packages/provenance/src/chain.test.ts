/**
 * @tradrl/provenance — derivation chains.
 *
 * Behavioral suite: DAG validation (acyclicity, self-reference,
 * duplicate parents — mirroring market-protocol's validator discipline),
 * chain-depth and root-resolution queries, external/dangling lineage,
 * cycle-detecting queries, determinism of results.
 */

import { describe, expect, it } from 'vitest';

import {
  ancestorsOf,
  chainDepth,
  isChainNode,
  resolveRoots,
  validateDerivationChain,
  type ChainNode,
} from './index';

function node(id: string, derived_from: readonly string[]): ChainNode {
  return { id, derived_from };
}

/** A 3-deep chain: r <- e1 <- e2 <- e3. */
const THREE_DEEP: readonly ChainNode[] = [
  node('r', []),
  node('e1', ['r']),
  node('e2', ['e1']),
  node('e3', ['e2']),
];

/** A diamond: a <- b, a <- c, d <- [b, c]. */
const DIAMOND: readonly ChainNode[] = [
  node('a', []),
  node('b', ['a']),
  node('c', ['a']),
  node('d', ['b', 'c']),
];

/** A 2-cycle: a <- b <- a. */
const TWO_CYCLE: readonly ChainNode[] = [node('a', ['b']), node('b', ['a'])];

describe('validateDerivationChain', () => {
  it('accepts a clean chain and a diamond (shared parents are fine)', () => {
    expect(validateDerivationChain(THREE_DEEP)).toEqual({ ok: true, violations: [] });
    expect(validateDerivationChain(DIAMOND)).toEqual({ ok: true, violations: [] });
  });

  it('rejects a self-referencing node', () => {
    const validation = validateDerivationChain([node('a', ['a'])]);
    expect(validation.ok).toBe(false);
    expect(validation.violations).toEqual([{ kind: 'chain_self_reference', node: 'a', parent: 'a' }]);
  });

  it('rejects duplicate parents within one node', () => {
    const validation = validateDerivationChain([node('a', []), node('b', ['a', 'a'])]);
    expect(validation.ok).toBe(false);
    expect(validation.violations).toEqual([{ kind: 'chain_duplicate_parent', node: 'b', parent: 'a' }]);
  });

  it('rejects a 2-cycle with the exact cycle path', () => {
    const validation = validateDerivationChain(TWO_CYCLE);
    expect(validation.ok).toBe(false);
    const cycle = validation.violations.find((violation) => violation.kind === 'chain_cycle');
    expect(cycle).toBeDefined();
    if (cycle !== undefined && cycle.kind === 'chain_cycle') {
      // The cycle path starts and ends at the same node.
      expect(cycle.cycle[0]).toBe(cycle.cycle[cycle.cycle.length - 1]);
      expect([...cycle.cycle].slice(0, -1).sort()).toEqual(['a', 'b']);
    }
  });

  it('rejects a longer cycle (a <- b <- c <- a)', () => {
    const validation = validateDerivationChain([node('a', ['c']), node('b', ['a']), node('c', ['b'])]);
    expect(validation.ok).toBe(false);
    expect(validation.violations.some((violation) => violation.kind === 'chain_cycle')).toBe(true);
  });

  it('external parents are NOT violations (dangling lineage is reported, not rejected)', () => {
    const validation = validateDerivationChain([node('x', ['external-1', 'external-2'])]);
    expect(validation.ok).toBe(true);
  });

  it('collects multiple violations in node order', () => {
    const validation = validateDerivationChain([node('a', ['a']), node('b', ['b', 'b'])]);
    expect(validation.violations).toEqual([
      { kind: 'chain_self_reference', node: 'a', parent: 'a' },
      { kind: 'chain_self_reference', node: 'b', parent: 'b' },
      { kind: 'chain_duplicate_parent', node: 'b', parent: 'b' },
    ]);
  });

  it('isChainNode guards the node shape', () => {
    expect(isChainNode(node('a', []))).toBe(true);
    expect(isChainNode({ id: '', derived_from: [] })).toBe(false);
    expect(isChainNode({ id: 'a', derived_from: 'nope' })).toBe(false);
    expect(isChainNode(null)).toBe(false);
  });
});

describe('chainDepth', () => {
  it('a primitive is depth 0; each derivation edge adds 1 (3-deep chain -> 3)', () => {
    expect(chainDepth('r', THREE_DEEP)).toEqual({ ok: true, value: 0 });
    expect(chainDepth('e1', THREE_DEEP)).toEqual({ ok: true, value: 1 });
    expect(chainDepth('e2', THREE_DEEP)).toEqual({ ok: true, value: 2 });
    expect(chainDepth('e3', THREE_DEEP)).toEqual({ ok: true, value: 3 });
  });

  it('a diamond resolves to the LONGEST path', () => {
    expect(chainDepth('d', DIAMOND)).toEqual({ ok: true, value: 2 });
    expect(chainDepth('b', DIAMOND)).toEqual({ ok: true, value: 1 });
  });

  it('an external parent is a root one edge away', () => {
    const nodes = [node('x', ['ext'])];
    expect(chainDepth('x', nodes)).toEqual({ ok: true, value: 1 });
  });

  it('fails with chain_unknown_node for ids outside the chain', () => {
    const result = chainDepth('missing', THREE_DEEP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('chain_unknown_node');
  });

  it('fails with chain_cycle on a cyclic graph', () => {
    const result = chainDepth('a', TWO_CYCLE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('chain_cycle');
  });
});

describe('resolveRoots', () => {
  it('a 3-deep chain resolves to its single root', () => {
    expect(resolveRoots('e3', THREE_DEEP)).toEqual({ ok: true, value: ['r'] });
  });

  it('a diamond resolves to its shared root (deduplicated, sorted)', () => {
    expect(resolveRoots('d', DIAMOND)).toEqual({ ok: true, value: ['a'] });
  });

  it('a primitive resolves to itself', () => {
    expect(resolveRoots('r', THREE_DEEP)).toEqual({ ok: true, value: ['r'] });
  });

  it('external parents resolve as roots', () => {
    const nodes = [node('x', ['ext-a', 'ext-b']), node('y', ['x'])];
    expect(resolveRoots('y', nodes)).toEqual({ ok: true, value: ['ext-a', 'ext-b'] });
  });

  it('roots are sorted (deterministic)', () => {
    const nodes = [node('m', ['z-root', 'a-root'])];
    expect(resolveRoots('m', nodes)).toEqual({ ok: true, value: ['a-root', 'z-root'] });
  });

  it('fails on unknown nodes and cycles', () => {
    expect(resolveRoots('nope', THREE_DEEP).ok).toBe(false);
    expect(resolveRoots('a', TWO_CYCLE).ok).toBe(false);
  });
});

describe('ancestorsOf', () => {
  it('returns the transitive parent set, sorted, excluding the query node', () => {
    expect(ancestorsOf('e3', THREE_DEEP)).toEqual({ ok: true, value: ['e1', 'e2', 'r'] });
    expect(ancestorsOf('r', THREE_DEEP)).toEqual({ ok: true, value: [] });
  });

  it('deduplicates shared ancestors (diamond)', () => {
    expect(ancestorsOf('d', DIAMOND)).toEqual({ ok: true, value: ['a', 'b', 'c'] });
  });

  it('includes external parent ids', () => {
    const nodes = [node('x', ['ext'])];
    expect(ancestorsOf('x', nodes)).toEqual({ ok: true, value: ['ext'] });
  });
});
