/**
 * Trial emission tests (L11): the experiments-lane mirror's status
 * invariants, the TrainerTrial lineage binding, and THE L11 TRIP WIRES —
 * appending a duplicate trial id or rewriting a recorded trial is a typed
 * `trial_rewrite` error; the log is append-only and nothing is ever
 * projected away.
 */

import { describe, expect, it } from 'vitest';

import * as rl from './index';

const T0 = 1_700_000_000_000;
const T1 = T0 + 5_000;

function trialLiteral(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trial_id: 'trial-1',
    arm: 'arm-treatment',
    status: 'succeeded',
    trajectory: 'traj-abc12345',
    outcome: { note: 'evidence; evaluation owns acceptance (L7)' },
    started_at: T0,
    ended_at: T1,
    failure_reason: null,
    ...overrides,
  };
}

function lineageLiteral(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'run-trial-test',
    method: 'rl',
    tenant: 'tenant-trial',
    project: 'prj-trial',
    trajectory: 'traj-abc12345',
    environment_config: 'envcfg-trial-test',
    reward_models: ['reward-model:obs-count@1'],
    world: {
      world: { config_hash: 'a1b2c3d4' },
      episode: { spec_hash: 'e5f6a7b8' },
      ingestion: { chain_head: 'c9d0e1f2' },
      digest: 'deadbeef',
    },
    ...overrides,
  };
}

function trainerTrialLiteral(trialOverrides: Record<string, unknown> = {}, lineageOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { trial: trialLiteral(trialOverrides), lineage: lineageLiteral(lineageOverrides) };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

describe('TrialRecord mirror (experiments-lane status invariants)', () => {
  it('accepts a succeeded trial with evidence', () => {
    const result = rl.validateTrialRecord(trialLiteral());
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });

  it('enforces the status invariants (mirrored from the experiments lane)', () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ['succeeded without trajectory (success without evidence is inexpressible)', trialLiteral({ trajectory: null })],
      ['succeeded without outcome', trialLiteral({ outcome: null })],
      ['succeeded with a failure reason', trialLiteral({ failure_reason: 'x' })],
      ['succeeded with ended before started', trialLiteral({ started_at: T1, ended_at: T0 })],
      ['failed without a reason (an unexplained failure is not auditable)', trialLiteral({ status: 'failed', failure_reason: null })],
      ['failed without ended_at', trialLiteral({ status: 'failed', failure_reason: 'env broke', ended_at: null })],
      ['rejected that ran', trialLiteral({ status: 'rejected', failure_reason: 'refused', started_at: T0 })],
      ['planned carrying a start', trialLiteral({ status: 'planned', started_at: T0 })],
      ['running carrying an end', trialLiteral({ status: 'running', ended_at: T1 })],
      ['unknown status', trialLiteral({ status: 'completed' })],
      ['empty trial id', trialLiteral({ trial_id: '' })],
      ['empty arm', trialLiteral({ arm: '' })],
    ];
    for (const [label, value] of cases) {
      const result = rl.validateTrialRecord(value);
      expect(result.ok, label).toBe(false);
    }
  });

  it('a failed trial may carry partial evidence (the experiments-lane law)', () => {
    const result = rl.validateTrialRecord(
      trialLiteral({ status: 'failed', failure_reason: 'environment rejected the spec', outcome: null }),
    );
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });
});

describe('TrainerTrial (record + lineage)', () => {
  it('accepts a lineage-bound trial', () => {
    const result = rl.validateTrainerTrial(trainerTrialLiteral());
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
    if (result.ok) expect(result.value.lineage.world.config_hash).toBe('a1b2c3d4');
  });

  it('a trial without a lineage block is a typed lineage_gap (L9)', () => {
    const result = rl.validateTrainerTrial({ trial: trialLiteral() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('lineage_gap');
  });
});

describe('THE L11 TRIP WIRES (the append-only trial log)', () => {
  it('appends fresh trials and retains every entry in order', () => {
    let log = rl.createTrialLog();
    log = unwrap(rl.appendTrainerTrial(log, trainerTrialLiteral()));
    log = unwrap(
      rl.appendTrainerTrial(
        log,
        trainerTrialLiteral(
          { trial_id: 'trial-2', arm: 'arm-control', trajectory: 'traj-def67890' },
          { trajectory: 'traj-def67890' },
        ),
      ),
    );
    expect(rl.trialLogEntries(log).map((entry) => entry.trial.trial_id)).toEqual(['trial-1', 'trial-2']);
    expect(rl.isDeeplyFrozen(log)).toBe(true);
  });

  it('appending a DUPLICATE trial id is a typed trial_rewrite error', () => {
    let log = rl.createTrialLog();
    log = unwrap(rl.appendTrainerTrial(log, trainerTrialLiteral()));
    const duplicate = rl.appendTrainerTrial(log, trainerTrialLiteral());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors[0]?.code).toBe('trial_rewrite');
      expect(duplicate.errors[0]?.message).toContain('L11');
    }

    // Even a DIFFERENT record under the same id is a rewrite, not an update.
    const rewrite = rl.appendTrainerTrial(
      log,
      trainerTrialLiteral({ status: 'failed', failure_reason: 'attempted rewrite', outcome: null }, {}),
    );
    expect(rewrite.ok).toBe(false);
    if (!rewrite.ok) expect(rewrite.errors[0]?.code).toBe('trial_rewrite');
  });

  it('a trajectory already bound to another trial is a typed duplicate_trajectory', () => {
    let log = rl.createTrialLog();
    log = unwrap(rl.appendTrainerTrial(log, trainerTrialLiteral()));
    const clash = rl.appendTrainerTrial(log, trainerTrialLiteral({ trial_id: 'trial-other' }));
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.errors[0]?.code).toBe('duplicate_trajectory');
  });

  it('invalid entries are typed errors; the original log is untouched', () => {
    const log = unwrap(rl.appendTrainerTrial(rl.createTrialLog(), trainerTrialLiteral()));
    const invalid = rl.appendTrainerTrial(log, { trial: trialLiteral({ status: 'nope' }), lineage: lineageLiteral() });
    expect(invalid.ok).toBe(false);
    const noLineage = rl.appendTrainerTrial(log, { trial: trialLiteral() });
    expect(noLineage.ok).toBe(false);
    expect(log.entries.length).toBe(1);
    expect(() => {
      (log.entries as unknown as unknown[]).push('x');
    }).toThrow();
  });
});
