/**
 * TrainingRunProtocol tests (L9/L12): declaration validation (the closed
 * method taxonomy, tenant/project isolation, budget/seed laws), the
 * append-only episode log with its digest step chain, chain verification
 * (tamper detection), and the L9 lineage block — including the per-field
 * lineage-gap trip wires (config hash, chain head, spec hash, digest,
 * trajectory ref, reward-model refs, method, tenant, project).
 */

import { describe, expect, it } from 'vitest';

import * as rl from './index';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 1_000;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function declarationLiteral(): Record<string, unknown> {
  return {
    run_id: 'run-test-1',
    method: 'rl',
    environment_spec: {
      profile: {
        environment_id: 'env-run-test',
        fidelity: 'exact_replay',
        clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
        seed: 'seed-run-test',
        venue_scope: [],
        instrument_scope: [],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-run-test', kind: 'fake' },
      information_policy: 'point-in-time',
    },
    reward_models: ['reward-model:obs-count@1'],
    step_budget: 10,
    seed: 'seed-run-test',
    tenant: 'tenant-run-test',
    project: 'prj-run-test',
  };
}

function stepLiteral(ordinal: number, now: number): Record<string, unknown> {
  return {
    step: ordinal,
    step_id: `st-run-${ordinal}`,
    observations: [{ observation_id: `obs-run-${ordinal}`, available_time: now }],
    actions: [
      {
        action_id: `act-run-${ordinal}`,
        actor: 'agent-run-test',
        submitted_at: now,
        client_sequence: ordinal - 1,
        payload: null,
      },
    ],
    rejections: [],
    rewards: [],
    tool_outcomes: [],
    environment_result: null,
    clock: { now, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
    causality_id: `cz-run-${ordinal}`,
  };
}

function twoEpisodeSteps(): readonly unknown[] {
  return [stepLiteral(1, T0), stepLiteral(2, T0 + 100)];
}

/** A ReplayRunRecord-SHAPED literal (the structural mirror target — untrusted). */
function worldRecordLiteral(): Record<string, unknown> {
  return {
    schema: 'tradrl/replay-run-record@1',
    world: { world_id: 'world-run-test', config_hash: 'a1b2c3d4', fidelity: 'exact_replay', seed: 'seed-run-test', as_of: AS_OF, streams: [], playback_speed: 1 },
    episode: { episode_id: 'ep-run-test', environment_id: 'env-run-test', spec_hash: 'e5f6a7b8', termination: { code: 'completed', detail: 'x' }, final_now: AS_OF },
    ingestion: { batches: 3, events: 18, snapshot_count: 0, streams_seen: [], chain_head: 'c9d0e1f2' },
    clock_timeline: [],
    intent_log: [],
    observations: { queries: 2, served: 5 },
    digest: 'deadbeef',
  };
}

// ---------------------------------------------------------------------------
// Declaration (L12 + method taxonomy)
// ---------------------------------------------------------------------------

describe('TrainingRunDeclaration validation', () => {
  it('accepts a well-formed declaration', () => {
    const result = rl.validateTrainingRunDeclaration(declarationLiteral());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe('rl');
      expect(result.value.tenant).toBe('tenant-run-test');
      expect(rl.isDeeplyFrozen(result.value)).toBe(true);
    }
  });

  it('method_unknown: the taxonomy is closed', () => {
    const result = rl.validateTrainingRunDeclaration({ ...declarationLiteral(), method: 'deep_rl' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('method_unknown');
  });

  it('L12: a declaration missing tenant or project fails its guards', () => {
    const { tenant, ...withoutTenant } = declarationLiteral() as { tenant: string } & Record<string, unknown>;
    const tenantResult = rl.validateTrainingRunDeclaration(withoutTenant);
    expect(tenantResult.ok).toBe(false);
    if (!tenantResult.ok) {
      expect(tenantResult.errors[0]?.code).toBe('missing_field');
      expect(tenantResult.errors[0]?.path).toBe('declaration.tenant');
    }

    const { project, ...withoutProject } = declarationLiteral() as { project: string } & Record<string, unknown>;
    const projectResult = rl.validateTrainingRunDeclaration(withoutProject);
    expect(projectResult.ok).toBe(false);
    if (!projectResult.ok) expect(projectResult.errors[0]?.path).toBe('declaration.project');

    const emptyTenant = rl.validateTrainingRunDeclaration({ ...declarationLiteral(), tenant: '' });
    expect(emptyTenant.ok).toBe(false);
  });

  it('budget, seed, and reward-model laws', () => {
    for (const [label, override] of [
      ['zero budget', { step_budget: 0 }],
      ['fractional budget', { step_budget: 1.5 }],
      ['empty seed', { seed: '' }],
      ['duplicate reward models', { reward_models: ['a@1', 'a@1'] }],
      ['empty reward model ref', { reward_models: [''] }],
      ['bad spec', { environment_spec: { nope: true } }],
    ] as const) {
      const result = rl.validateTrainingRunDeclaration({ ...declarationLiteral(), ...override });
      expect(result.ok, label).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The append-only run state + the step chain
// ---------------------------------------------------------------------------

describe('TrainingRunState append + chain', () => {
  it('prepares a fresh declared run and appends episodes', () => {
    const run = unwrap(rl.prepareTrainingRun(declarationLiteral()));
    expect(run.status).toBe('declared');
    expect(run.step_chain).toEqual([]);

    const driven = unwrap(rl.appendRunEpisode(run, 'ep-run-test', twoEpisodeSteps()));
    expect(driven.status).toBe('driving');
    expect(driven.episodes.length).toBe(1);
    expect(driven.steps_used).toBe(2);
    expect(driven.step_chain.length).toBe(2);
    expect(unwrap(rl.verifyRunChain(driven))).toBe(true);

    // The chain is deterministic: the same run + steps fold identically.
    const again = unwrap(rl.appendRunEpisode(run, 'ep-run-test', twoEpisodeSteps()));
    expect(again.step_chain).toEqual(driven.step_chain);
    expect(rl.declarationChainSeed(driven.declaration)).toBe(rl.declarationChainSeed(again.declaration));
  });

  it('enforces the append laws: ordinals, episodes, budget, ids, finish', () => {
    const run = unwrap(rl.prepareTrainingRun(declarationLiteral()));

    const outOfOrder = rl.appendRunEpisode(run, 'ep-a', [stepLiteral(2, T0)]);
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) expect(outOfOrder.errors[0]?.code).toBe('step_out_of_order');

    const clockRegression = rl.appendRunEpisode(run, 'ep-a', [stepLiteral(1, T0 + 100), stepLiteral(2, T0)]);
    expect(clockRegression.ok).toBe(false);
    if (!clockRegression.ok) expect(clockRegression.errors[0]?.code).toBe('clock_regression');

    const driven = unwrap(rl.appendRunEpisode(run, 'ep-a', twoEpisodeSteps()));
    const duplicateEpisode = rl.appendRunEpisode(driven, 'ep-a', [stepLiteral(1, T0)]);
    expect(duplicateEpisode.ok).toBe(false);
    if (!duplicateEpisode.ok) expect(duplicateEpisode.errors[0]?.code).toBe('duplicate_episode');

    // Ids are unique WITHIN an episode (the env-protocol identity scope):
    // the same episode cannot re-record an id...
    const within = rl.appendRunEpisode(run, 'ep-c', [stepLiteral(1, T0), stepLiteral(2, T0 + 100)]);
    const withinDuplicate = rl.appendRunEpisode(within.ok ? within.value : run, 'ep-c', [stepLiteral(1, T0)]);
    expect(withinDuplicate.ok).toBe(false);
    if (!withinDuplicate.ok) expect(withinDuplicate.errors[0]?.code).toBe('duplicate_episode');

    // ...and a SECOND episode legitimately mints its own id space (the
    // episode scope resets with the world's own minting).
    const secondEpisode = rl.appendRunEpisode(driven, 'ep-b', [stepLiteral(1, T0)]);
    expect(secondEpisode.ok, JSON.stringify(secondEpisode.ok ? null : secondEpisode.errors)).toBe(true);

    // The run-wide budget bounds the total recorded steps.
    const tight = unwrap(rl.prepareTrainingRun({ ...declarationLiteral(), step_budget: 2 }));
    const full = unwrap(rl.appendRunEpisode(tight, 'ep-a', twoEpisodeSteps()));
    const over = rl.appendRunEpisode(full, 'ep-b', [stepLiteral(1, T0)]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe('budget_exhausted');

    // Finish is once-only; the log freezes.
    const finished = unwrap(rl.finishTrainingRun(full, { code: 'completed', detail: 'run test' }));
    const appendAfterFinish = rl.appendRunEpisode(finished, 'ep-b', [stepLiteral(1, T0)]);
    expect(appendAfterFinish.ok).toBe(false);
    if (!appendAfterFinish.ok) expect(appendAfterFinish.errors[0]?.code).toBe('run_finished');
    const doubleFinish = rl.finishTrainingRun(finished, { code: 'aborted', detail: 'double' });
    expect(doubleFinish.ok).toBe(false);
    if (!doubleFinish.ok) expect(doubleFinish.errors[0]?.code).toBe('run_finished');
    expect(unwrap(rl.verifyRunChain(finished))).toBe(true);
  });

  it('detects tampering: chain_mismatch is typed', () => {
    const run = unwrap(rl.prepareTrainingRun(declarationLiteral()));
    const driven = unwrap(rl.appendRunEpisode(run, 'ep-a', twoEpisodeSteps()));

    // A shape-valid state whose STEP CONTENT was rewritten after the chain
    // was folded (JSON round-trip keeps the structural guard satisfied;
    // only the digest fold exposes the lie).
    const parsed = JSON.parse(JSON.stringify(driven)) as {
      episodes: { episode: string; steps: { actions: Record<string, unknown>[] }[] }[];
    };
    const original = parsed.episodes[0]?.steps[0]?.actions[0] as Record<string, unknown> | undefined;
    parsed.episodes[0]?.steps[0]?.actions.push({ ...original, action_id: 'act-tampered', payload: 'tampered' });
    const tampered = parsed as unknown as rl.TrainingRunState;
    expect(rl.isTrainingRunState(tampered)).toBe(true);
    const tamperedResult = rl.verifyRunChain(tampered);
    expect(tamperedResult.ok).toBe(false);
    if (!tamperedResult.ok) expect(tamperedResult.errors[0]?.code).toBe('chain_mismatch');

    // Truncation is caught EARLIER by the structural guard (the chain length
    // must equal the recorded step count) — also a typed error, never a
    // silent default.
    const truncated = JSON.parse(JSON.stringify(driven)) as { step_chain: string[] };
    truncated.step_chain = truncated.step_chain.slice(0, 1);
    const truncatedResult = rl.verifyRunChain(truncated as unknown as rl.TrainingRunState);
    expect(truncatedResult.ok).toBe(false);
    if (!truncatedResult.ok) {
      expect(truncatedResult.errors[0]?.code === 'chain_mismatch' || truncatedResult.errors[0]?.code === 'invalid_run_state').toBe(true);
    }
  });

  it('the original state is untouched by appends (append-only, frozen)', () => {
    const run = unwrap(rl.prepareTrainingRun(declarationLiteral()));
    unwrap(rl.appendRunEpisode(run, 'ep-a', twoEpisodeSteps()));
    expect(run.episodes.length).toBe(0);
    expect(run.steps_used).toBe(0);
    expect(rl.isDeeplyFrozen(run)).toBe(true);
    expect(() => {
      (run as unknown as { steps_used: number }).steps_used = 99;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The L9 lineage block
// ---------------------------------------------------------------------------

describe('WorldLineage extraction (the ReplayRunRecord mirror)', () => {
  it('extracts the four L9 fields from a ReplayRunRecord-shaped value', () => {
    const lineage = unwrap(rl.extractWorldLineage(worldRecordLiteral()));
    expect(lineage).toEqual({ config_hash: 'a1b2c3d4', chain_head: 'c9d0e1f2', spec_hash: 'e5f6a7b8', digest: 'deadbeef' });
    expect(rl.isDeeplyFrozen(lineage)).toBe(true);
  });

  it('lineage_gap: EVERY missing field is a typed error', () => {
    const base = worldRecordLiteral();
    const cases: readonly [string, unknown][] = [
      ['world.config_hash', { ...base, world: { ...(base.world as Record<string, unknown>), config_hash: undefined } }],
      ['episode.spec_hash', { ...base, episode: { ...(base.episode as Record<string, unknown>), spec_hash: undefined } }],
      ['ingestion.chain_head', { ...base, ingestion: { ...(base.ingestion as Record<string, unknown>), chain_head: undefined } }],
      ['digest', { ...base, digest: undefined }],
      ['world block', { ...base, world: undefined }],
      ['episode block', { ...base, episode: undefined }],
      ['ingestion block', { ...base, ingestion: undefined }],
    ];
    for (const [label, value] of cases) {
      const result = rl.extractWorldLineage(value);
      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code, label).toBe('lineage_gap');
      }
    }
    // A non-object fails with invalid_type (the root shape).
    const notAnObject = rl.extractWorldLineage('nope');
    expect(notAnObject.ok).toBe(false);
    if (!notAnObject.ok) expect(notAnObject.errors[0]?.code).toBe('invalid_type');
  });
});

describe('TrainingRunLineage validation (the full L9 block)', () => {
  function lineageLiteral(): Record<string, unknown> {
    return {
      run_id: 'run-test-1',
      method: 'rl',
      tenant: 'tenant-run-test',
      project: 'prj-run-test',
      trajectory: 'traj-abc12345',
      environment_config: 'envcfg-abc12345',
      reward_models: ['reward-model:obs-count@1'],
      world: worldRecordLiteral(),
    };
  }

  it('accepts a lineage-complete block', () => {
    const result = rl.validateTrainingRunLineage(lineageLiteral());
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
    if (result.ok) expect(result.value.world.chain_head).toBe('c9d0e1f2');
  });

  it('lineage_gap: every missing field fails its guard (the L9 trip wire)', () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ['run_id', { ...lineageLiteral(), run_id: undefined }],
      ['method', { ...lineageLiteral(), method: undefined }],
      ['tenant (L12)', { ...lineageLiteral(), tenant: undefined }],
      ['project (L15)', { ...lineageLiteral(), project: undefined }],
      ['trajectory ref', { ...lineageLiteral(), trajectory: undefined }],
      ['environment_config', { ...lineageLiteral(), environment_config: undefined }],
      ['reward_models', { ...lineageLiteral(), reward_models: undefined }],
      ['world block', { ...lineageLiteral(), world: undefined }],
      [
        'world.config_hash',
        {
          ...lineageLiteral(),
          world: {
            ...(worldRecordLiteral() as Record<string, unknown>),
            world: { ...((worldRecordLiteral() as Record<string, unknown>).world as Record<string, unknown>), config_hash: undefined },
          },
        },
      ],
    ];
    for (const [label, value] of cases) {
      const result = rl.validateTrainingRunLineage(value);
      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        const codes = result.errors.map((error) => error.code);
        expect(codes.includes('lineage_gap') || codes.includes('missing_field') || codes.includes('method_unknown'), label).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic derivations
// ---------------------------------------------------------------------------

describe('L9 derivations', () => {
  it('deriveEnvironmentConfigRef is content-derived from the spec', () => {
    const specA = unwrap(rl.validateEnvironmentSpec((declarationLiteral() as Record<string, unknown>).environment_spec));
    const specB = unwrap(rl.validateEnvironmentSpec((declarationLiteral() as Record<string, unknown>).environment_spec));
    expect(rl.deriveEnvironmentConfigRef(specA)).toBe(rl.deriveEnvironmentConfigRef(specB));
    const specC = unwrap(
      rl.validateEnvironmentSpec({
        ...(declarationLiteral().environment_spec as Record<string, unknown>),
        world: { world_id: 'world-other', kind: 'fake' },
      }),
    );
    expect(rl.deriveEnvironmentConfigRef(specA)).not.toBe(rl.deriveEnvironmentConfigRef(specC));
  });

  it('deriveTrajectoryId binds run + episode deterministically', () => {
    const run = 'run-test-1' as rl.TrainingRunId;
    const episode = 'ep-run-test' as rl.EpisodeId;
    expect(rl.deriveTrajectoryId(run, episode)).toBe(rl.deriveTrajectoryId(run, episode));
    expect(rl.deriveTrajectoryId(run, episode)).not.toBe(rl.deriveTrajectoryId('run-other' as rl.TrainingRunId, episode));
    expect(rl.deriveTrajectoryId(run, episode).startsWith('traj-')).toBe(true);
  });
});
