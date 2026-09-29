/**
 * @tradrl/learning (service) — the curriculum version tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden version validates (the declared ladder table);
 *   - the L6 trip-wire negative: a version declaring a generative world
 *     behind historical_replay fails `fidelity_claim_violation`
 *     (acceptance #7);
 *   - the totality laws: a missing stage rule, a foreign stage key, a
 *     missing gap-kind remediation, a duplicate gap remediation — all
 *     typed `version_invalid` / `stage_unknown` (acceptance #9's table
 *     totality);
 *   - L9/L12: a missing tenant/project or version ref is typed
 *     (`tenant_missing` / `lineage_gap`) — the L12 negative test;
 *   - validation is pure and the validated record deeply frozen.
 */

import { describe, expect, it } from 'vitest';

import { deepFreeze } from './primitives';
import { stageRuleOf, validateCurriculumVersion } from './version';
import { goldenCurriculumVersion, goldenCurriculumVersionLiteral } from './fixtures';

describe('the golden curriculum version', () => {
  it('validates and freezes (the declared ladder table)', () => {
    const version = goldenCurriculumVersion();
    expect(version.version).toBe('curriculum@1.0.0');
    expect(version.sequence).toBe(1);
    expect(version.tenant).toBe('tenant-golden');
    expect(version.project).toBe('prj-golden');
    expect(Object.keys(version.stages).sort()).toEqual([
      'adversarial_population',
      'controlled_live',
      'historical_replay',
      'microstructure_friction',
      'reactive_market',
      'rolling_time_machine',
      'shadow_trading',
      'synthetic_regimes',
      'unseen_multi_regime',
    ]);
    // The gap table covers all six failure classes (LEARNING-LOOP.md).
    expect(version.gap_table.map((rule) => rule.kind).sort()).toEqual([
      'coordination',
      'execution',
      'liquidity',
      'regime',
      'risk',
      'sentiment-event',
    ]);
    // Deeply frozen.
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.stages)).toBe(true);
    expect(() => {
      (version.gap_table as unknown as unknown[]).push({ kind: 'regime', stage: 'synthetic_regimes', method: 'rl' });
    }).toThrow();
  });

  it('is deterministic: the same literal validates to the same record, twice', () => {
    const first = goldenCurriculumVersion();
    const second = goldenCurriculumVersion();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('exposes every stage rule (stageRuleOf)', () => {
    const version = goldenCurriculumVersion();
    for (const stage of Object.keys(version.stages)) {
      const rule = stageRuleOf(version, stage as keyof typeof version.stages);
      expect(rule.ok).toBe(true);
      if (rule.ok) expect(rule.value.stage).toBe(stage);
    }
  });
});

describe('version validation negatives (the declaration laws)', () => {
  it('refuses a generative world behind historical_replay (L6 trip-wire, the named negative)', () => {
    const literal = goldenCurriculumVersionLiteral();
    const stages = literal.stages as Record<string, Record<string, unknown>>;
    stages.historical_replay = {
      ...stages.historical_replay,
      config: { ...(stages.historical_replay.config as Record<string, unknown>), world_mode: 'generative' },
    };
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('fidelity_claim_violation');
      const violation = result.errors.find((error) => error.code === 'fidelity_claim_violation');
      expect(violation?.path).toBe('version.stages.historical_replay.config.world_mode');
      expect(violation?.message).toContain('historical truth from a generative world');
    }
  });

  it('refuses a reactive world behind shadow_trading (same trip-wire, the live-tape claim)', () => {
    const literal = goldenCurriculumVersionLiteral();
    const stages = literal.stages as Record<string, Record<string, unknown>>;
    stages.shadow_trading = {
      ...stages.shadow_trading,
      config: { ...(stages.shadow_trading.config as Record<string, unknown>), world_mode: 'reactive_replay' },
    };
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('fidelity_claim_violation');
    }
  });

  it('refuses a missing stage rule (the ladder totality law)', () => {
    const literal = goldenCurriculumVersionLiteral();
    delete (literal.stages as Record<string, unknown>).rolling_time_machine;
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.errors.find((error) => error.path === 'version.stages.rolling_time_machine');
      expect(missing?.code).toBe('version_invalid');
      expect(missing?.message).toContain('no declared rule');
    }
  });

  it('refuses a foreign stage key (the closed union)', () => {
    const literal = goldenCurriculumVersionLiteral();
    (literal.stages as Record<string, unknown>)['tenth_stage'] = (literal.stages as Record<string, unknown>).synthetic_regimes;
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('stage_unknown');
    }
  });

  it('refuses a key/named-stage disagreement', () => {
    const literal = goldenCurriculumVersionLiteral();
    const stages = literal.stages as Record<string, Record<string, unknown>>;
    stages.synthetic_regimes = { ...stages.synthetic_regimes, stage: 'historical_replay' };
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('must agree'))).toBe(true);
    }
  });

  it('refuses a gap table missing a failure class (the six-kind totality)', () => {
    const literal = goldenCurriculumVersionLiteral();
    (literal.gap_table as unknown[]) = (literal.gap_table as unknown[]).filter(
      (rule) => (rule as { kind: string }).kind !== 'liquidity',
    );
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.errors.find((error) => error.message.includes('"liquidity"'));
      expect(missing?.code).toBe('version_invalid');
    }
  });

  it('refuses a duplicate gap remediation', () => {
    const literal = goldenCurriculumVersionLiteral();
    const table = literal.gap_table as unknown as { kind: string }[];
    table.push({ ...table[0] }); // duplicate the regime rule
    const result = validateCurriculumVersion(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('duplicate remediation'))).toBe(true);
    }
  });

  it('refuses a missing tenant (L12 negative) and a missing version ref (L9 negative)', () => {
    const noTenant = goldenCurriculumVersionLiteral();
    delete (noTenant as Record<string, unknown>).tenant;
    const tenantResult = validateCurriculumVersion(noTenant);
    expect(tenantResult.ok).toBe(false);
    if (!tenantResult.ok) {
      expect(tenantResult.errors.map((error) => error.code)).toContain('tenant_missing');
    }

    const noVersion = goldenCurriculumVersionLiteral();
    delete (noVersion as Record<string, unknown>).version;
    const versionResult = validateCurriculumVersion(noVersion);
    expect(versionResult.ok).toBe(false);
    if (!versionResult.ok) {
      expect(versionResult.errors.map((error) => error.code)).toContain('lineage_gap');
    }
  });

  it('refuses non-objects and arrays at the root', () => {
    expect(validateCurriculumVersion(null).ok).toBe(false);
    expect(validateCurriculumVersion(undefined).ok).toBe(false);
    expect(validateCurriculumVersion('curriculum').ok).toBe(false);
    expect(validateCurriculumVersion([]).ok).toBe(false);
  });

  it('is pure: an untrusted input is never mutated', () => {
    const literal = goldenCurriculumVersionLiteral();
    const snapshot = deepFreeze(JSON.parse(JSON.stringify(literal)) as unknown);
    validateCurriculumVersion(literal);
    expect(literal).toEqual(snapshot);
  });
});
