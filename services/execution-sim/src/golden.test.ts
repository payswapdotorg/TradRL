/**
 * @tradrl/execution_sim (service) — the golden determinism fixtures:
 * the byte-stable digests of the reference scenarios' outcomes.
 *
 * The same (intent batch, policy, venue state, seed) always yields the
 * byte-identical decision sequence + fill sequence — the digests below
 * pin them. A contract or simulator change that alters the byte output
 * changes these constants — visibly.
 */

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_APPROVE_COUNT,
  GOLDEN_APPROVE_DIGEST,
  GOLDEN_FILL_COUNT,
  GOLDEN_REFUSAL_COUNT,
  GOLDEN_REFUSED_VENUE_RECORDS,
  GOLDEN_REFUSAL_DIGEST,
  processIntentBatch,
  referenceApproveBatch,
  referenceAuthorizationFailIntent,
  referenceIdentityFailIntent,
  referenceKillSwitchFailIntent,
  referenceLimitFailIntent,
  referenceRateFailIntent,
  referenceVenueFailIntent,
  referenceVenueState,
  sessionOutcomeDigest,
} from './index';
import { throwKillSwitch } from '../../../packages/execution-policy/src/index';
import { referenceSession } from './simulator.test-helpers';

describe('the golden determinism fixtures', () => {
  it('the APPROVE scenario digest is byte-stable', () => {
    const first = processIntentBatch(referenceSession(), referenceApproveBatch());
    if (!first.ok) throw new Error('unreachable');
    const second = processIntentBatch(referenceSession(), referenceApproveBatch());
    if (!second.ok) throw new Error('unreachable');
    expect(first.value.decisions).toHaveLength(GOLDEN_APPROVE_COUNT);
    expect(first.value.fills).toHaveLength(GOLDEN_FILL_COUNT);
    expect(sessionOutcomeDigest(first.value)).toBe(GOLDEN_APPROVE_DIGEST);
    expect(sessionOutcomeDigest(second.value)).toBe(GOLDEN_APPROVE_DIGEST); // deep-equal, twice
  });

  it('the SIX-REFUSAL scenario digest is byte-stable (zero fills, zero venue records)', () => {
    // The first five paths refuse against a STANDING switch; the
    // switch is thrown only then (the sixth refuses with kill_switch).
    const base = referenceSession({ venueState: referenceVenueState(10) });
    const firstFive = [
      referenceIdentityFailIntent(),
      referenceAuthorizationFailIntent(),
      referenceLimitFailIntent(),
      referenceVenueFailIntent(),
      referenceRateFailIntent(),
    ];
    const preSwitch = processIntentBatch(base, firstFive);
    if (!preSwitch.ok) throw new Error(`the pre-switch batch must run: ${JSON.stringify(preSwitch.errors)}`);
    const thrown = throwKillSwitch(preSwitch.value.killSwitch, 'batch halt', 1_700_000_001_000 as never);
    if (!thrown.ok) throw new Error('unreachable');
    const session = { ...preSwitch.value, killSwitch: thrown.value };
    const first = processIntentBatch(session, [referenceKillSwitchFailIntent()]);
    if (!first.ok) throw new Error(`the kill-switch path must run: ${JSON.stringify(first.errors)}`);
    const second = processIntentBatch(session, [referenceKillSwitchFailIntent()]);
    if (!second.ok) throw new Error('unreachable');
    expect(first.value.decisions).toHaveLength(GOLDEN_REFUSAL_COUNT);
    expect(first.value.fills).toHaveLength(0);
    expect(first.value.venues.reduce((total, entry) => total + entry.engine.orders.length, 0)).toBe(GOLDEN_REFUSED_VENUE_RECORDS);
    expect(sessionOutcomeDigest(first.value)).toBe(GOLDEN_REFUSAL_DIGEST);
    expect(sessionOutcomeDigest(second.value)).toBe(GOLDEN_REFUSAL_DIGEST);
  });
});
