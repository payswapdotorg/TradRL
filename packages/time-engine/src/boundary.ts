/**
 * @tradrl/time-engine — the point-in-time information boundary (firewall).
 *
 * This is the predicate at the heart of TradRL (ARCHITECTURE-LOCK L4):
 *
 *     At simulation time `t`, an agent may observe an event iff
 *     `event.available_time <= t`   (INCLUSIVE).
 *
 * Everything that carries an `available_time` — raw market events, derived
 * features, aggregates, labels, cached data — is an {@link Observable} and is
 * policed by the SAME boundary. The firewall makes no exception for origin:
 * simulated and generated observations are withheld exactly like historical
 * ones.
 *
 * `@tradrl/market-protocol`'s `MarketEvent` satisfies {@link Observable}
 * structurally (it has a validated `available_time`), so the filter accepts
 * canonical events without either package depending on the other.
 */

import type { SimulationClock } from './clock';
import type { TimestampMs } from './timestamp';

/**
 * The minimal structural contract for anything the firewall can police.
 * Implementations MUST populate `available_time` with the earliest instant at
 * which the information may legitimately be observed.
 */
export interface Observable {
  readonly available_time: TimestampMs;
}

/**
 * The boundary predicate itself: is `observation` legitimately observable at
 * instant `at`? Inclusive at `available_time` — an observation becomes
 * visible EXACTLY at its availability instant, never before.
 */
export function isVisibleAt<T extends Observable>(observation: T, at: TimestampMs): boolean {
  return observation.available_time <= at;
}

/** All members of `observations` that are observable at instant `at`. */
export function observableAt<T extends Observable>(observations: readonly T[], at: TimestampMs): T[] {
  return observations.filter((observation) => isVisibleAt(observation, at));
}

/**
 * A VisibilityFilter binds the boundary predicate to a {@link SimulationClock}
 * and yields the observable subset of any collection.
 *
 * Pure: the filter never mutates the clock or the input; advancing the
 * simulation requires a new clock (and thus a new filter).
 */
export interface VisibilityFilter<T extends Observable> {
  /** The clock whose `now` defines the boundary instant. */
  readonly clock: SimulationClock;
  /** Boundary predicate at the clock's current `now`. */
  isVisible(observation: T): boolean;
  /** The observable subset (preserves input order). */
  filter(observations: readonly T[]): T[];
  /** The withheld subset — the complement of {@link VisibilityFilter.filter}. */
  withheld(observations: readonly T[]): T[];
}

/** Create a VisibilityFilter over a clock. */
export function createVisibilityFilter<T extends Observable>(clock: SimulationClock): VisibilityFilter<T> {
  return {
    clock,
    isVisible: (observation: T) => isVisibleAt(observation, clock.now),
    filter: (observations: readonly T[]) => observableAt(observations, clock.now),
    withheld: (observations: readonly T[]) => observations.filter((observation) => !isVisibleAt(observation, clock.now)),
  };
}
