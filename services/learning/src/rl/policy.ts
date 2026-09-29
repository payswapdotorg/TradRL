/**
 * @tradrl/learning (service) — the scripted Policy port.
 *
 * A deterministic reference learner port: the action choice derives ONLY
 * from the seed and the OBSERVATION REFS (ids + availability) of the
 * policy input — the L4 discipline made visible: a learner conditions on
 * references and availability, never on payloads it was not handed. The
 * same input always yields the same proposals (pure, L9); two trainers
 * over the same (world script, seed) produce identical action streams.
 *
 * The proposals use the documented action-payload convention
 * (`{ kind, body }` once the driver mints the envelope): `hold` (do
 * nothing) or `place_intent` (an opaque order-intent shape the scripted
 * world records as a request — never authority, L8).
 */

import { fnv1a32Hex, type PolicyInput, type PolicyPort, type PolicyProposal } from '../../../../packages/rl-protocol/src/index';

/** The proposal kinds the scripted policy emits (opaque labels). */
export const SCRIPTED_POLICY_KINDS = ['hold', 'place_intent'] as const;

/** The kind of a scripted proposal (deterministic given the input). */
export function scriptedPolicyKind(seed: string, input: PolicyInput): 'hold' | 'place_intent' {
  const joined = input.observations.map((observation) => observation.observation_id).join(',');
  const hash = fnv1a32Hex(`${seed}|${input.step}|${joined}`);
  const draw = Number.parseInt(hash.slice(0, 4), 16);
  // No visible observations yet (or one draw in three): hold.
  if (input.observations.length === 0 || draw % 3 === 0) return 'hold';
  return 'place_intent';
}

/**
 * Create the scripted policy port. Deterministic: the proposals derive
 * from (seed, step, observation refs) — nothing else, ever.
 */
export function createScriptedPolicy(seed: string): PolicyPort {
  return {
    propose(input: PolicyInput): readonly PolicyProposal[] {
      const kind = scriptedPolicyKind(seed, input);
      if (kind === 'hold') {
        return [{ kind: 'hold', payload: null }];
      }
      const joined = input.observations.map((observation) => observation.observation_id).join(',');
      const hash = fnv1a32Hex(`${seed}|${input.step}|${joined}`);
      const draw = Number.parseInt(hash.slice(0, 4), 16);
      const side = draw % 2 === 0 ? 'buy' : 'sell';
      const size = ((draw % 5) + 1) / 100;
      return [
        {
          kind: 'place_intent',
          payload: { side, size: size.toFixed(2), policy: 'scripted@1' },
        },
      ];
    },
  };
}
