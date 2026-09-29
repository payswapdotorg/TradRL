/**
 * @tradrl/rl-protocol — the LEARNING-LOOP method taxonomy.
 *
 * spec/LEARNING-LOOP.md ("Method selection"): "Per capability: RL, offline
 * RL, supervised learning, imitation, preference optimization, bandits,
 * self-play, adversarial training, population search or statistical/causal
 * methods." The learning PLANE declares the first nine as a CLOSED
 * discriminated union — this package is the protocol bridge for exactly that
 * set ("organization learning" search over topologies is T016's compiler
 * lane; "statistical/causal methods" remain an evaluation-side concern and
 * are deliberately NOT members of the learning-method union — adding one
 * requires an explicit taxonomy change, never a string typo).
 *
 * The union is CLOSED: a run declaration naming anything else fails with
 * `method_unknown` (typed, negative-tested). The reference trainer (T013,
 * services/learning) implements the GENERIC deterministic episode loop —
 * drive -> record -> reward -> bind lineage -> emit trial — for ANY method;
 * it performs NO method-specific gradient/math optimization (concrete
 * algorithms belong to external engines behind the ports; T014/T015
 * specialize).
 */

/** The closed learning-method set of spec/LEARNING-LOOP.md (see module header). */
export type LearningMethod =
  | 'rl'
  | 'offline_rl'
  | 'supervised'
  | 'imitation'
  | 'preference_optimization'
  | 'bandits'
  | 'self_play'
  | 'adversarial'
  | 'population_search';

/** Runtime-checkable list of learning methods, for guards and diagnostics. */
export const LEARNING_METHODS: readonly LearningMethod[] = [
  'rl',
  'offline_rl',
  'supervised',
  'imitation',
  'preference_optimization',
  'bandits',
  'self_play',
  'adversarial',
  'population_search',
];

/**
 * Runtime guard for a learning method. Everything outside the closed union
 * is a typed `method_unknown` failure at declaration time — never a silent
 * default (the taxonomy is law, L11's search history must be able to name
 * what ran).
 */
export function isLearningMethod(value: unknown): value is LearningMethod {
  return typeof value === 'string' && (LEARNING_METHODS as readonly string[]).includes(value);
}
