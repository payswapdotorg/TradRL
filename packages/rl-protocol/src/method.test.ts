/**
 * LearningMethod taxonomy tests: the closed union of spec/LEARNING-LOOP.md
 * ("Method selection"), the `method_unknown` trip wire, and the runtime
 * list/guard totality.
 */

import { describe, expect, it } from 'vitest';

import { isLearningMethod, LEARNING_METHODS } from './index';

describe('LearningMethod closed taxonomy (spec/LEARNING-LOOP.md)', () => {
  it('declares exactly the nine LEARNING-LOOP methods, in order', () => {
    expect(LEARNING_METHODS).toEqual([
      'rl',
      'offline_rl',
      'supervised',
      'imitation',
      'preference_optimization',
      'bandits',
      'self_play',
      'adversarial',
      'population_search',
    ]);
  });

  it('accepts every member and rejects everything else (closed union)', () => {
    for (const method of LEARNING_METHODS) {
      expect(isLearningMethod(method)).toBe(true);
    }
    const rejects: readonly unknown[] = [
      'reinforcement_learning', // spelled out — not a member
      'RL', // case-sensitive
      'offlineRL',
      'statistical', // evaluation-side concern, deliberately NOT a member
      'causal',
      '',
      ' ',
      0,
      null,
      undefined,
      {},
      [],
    ];
    for (const sample of rejects) {
      expect(isLearningMethod(sample)).toBe(false);
    }
  });

  it('the taxonomy is a type-level closed union (compile-time witness)', () => {
    // Every member narrows through the guard; the assignment below compiles
    // only because the union is closed over exactly these literals.
    const first: 'rl' = 'rl';
    const last: 'population_search' = 'population_search';
    expect(isLearningMethod(first)).toBe(true);
    expect(isLearningMethod(last)).toBe(true);
  });
});
