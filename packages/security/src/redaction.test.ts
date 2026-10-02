/**
 * @tradrl/security — the redaction/scrubbing tests.
 *
 * Pins: the pure redactor (marker replacement, input untouched,
 * deterministic paths matching credentialValueViolations); the VERIFIED
 * scrub (scrubForLog re-runs the trip wire and proves cleanliness); the
 * standalone gate.
 */
import { describe, expect, it } from 'vitest';

import {
  REDACTED_CREDENTIAL_MARKER,
  assertNoCredentialMaterial,
  credentialValueViolations,
  redactCredentialValues,
  scrubForLog,
} from './index';

describe('the pure redactor', () => {
  it('replaces every credential-shaped key value with the fixed marker and reports deterministic paths', () => {
    const input = {
      venue: 'binance',
      apiKey: 'AKIA-REAL-SECRET',
      nested: { api_key: 'another-secret', passphrase: 'p' },
      list: [{ token: 't1' }, { ok: true }],
    };
    const { tree, report } = redactCredentialValues(input);
    expect(report.redactedPaths).toEqual(['apiKey', 'list[0].token', 'nested.api_key', 'nested.passphrase']);
    expect(report.clean).toBe(false);
    const out = tree as Record<string, unknown>;
    expect(out.apiKey_redacted).toBe(REDACTED_CREDENTIAL_MARKER);
    expect(out).not.toHaveProperty('apiKey');
    expect((out.nested as Record<string, unknown>).api_key_redacted).toBe(REDACTED_CREDENTIAL_MARKER);
    expect((out.list as { token_redacted: unknown }[])[0]!.token_redacted).toBe(REDACTED_CREDENTIAL_MARKER);
    // Non-credential data is preserved verbatim.
    expect(out.venue).toBe('binance');
    expect(((out.list as { ok: unknown }[])[1] as { ok: unknown }).ok).toBe(true);
    // The scrubbed tree PASSES the trip wire (keys renamed, not just values).
    expect(credentialValueViolations(tree)).toEqual([]);
  });

  it('never mutates the input (purity)', () => {
    const input = { apiKey: 'AKIA-REAL-SECRET' };
    redactCredentialValues(input);
    expect(input.apiKey).toBe('AKIA-REAL-SECRET');
  });

  it('a clean tree passes through untouched with an empty report', () => {
    const input = { a: 1, b: 'two', c: [true, null] };
    const { tree, report } = redactCredentialValues(input);
    expect(report.clean).toBe(true);
    expect(report.redactedPaths).toEqual([]);
    expect(JSON.stringify(tree)).toBe(JSON.stringify(input));
  });
});

describe('the verified scrub', () => {
  it('redacts AND proves the result is clean (the trip wire re-run)', () => {
    const input = { note: 'handoff', password: 'hunter2', deep: { secret: 's' } };
    const scrubbed = scrubForLog(input);
    expect(scrubbed.verifiedClean).toBe(true);
    expect(scrubbed.report.redactedPaths).toEqual(['deep.secret', 'password']);
    expect(credentialValueViolations(scrubbed.tree)).toEqual([]);
    // The scrubbed tree is byte-safe to serialize.
    expect(JSON.stringify(scrubbed.tree)).not.toContain('hunter2');
    expect(JSON.stringify(scrubbed.tree)).not.toContain('"s"');
  });

  it('repeated scrubs are idempotent and deterministic', () => {
    const input = { apiKey: 'A', password: 'B' };
    const one = scrubForLog(input);
    const two = scrubForLog(input);
    expect(JSON.stringify(one.tree)).toBe(JSON.stringify(two.tree));
    const three = scrubForLog(one.tree);
    expect(JSON.stringify(three.tree)).toBe(JSON.stringify(one.tree));
  });
});

describe('the standalone gate', () => {
  it('ok(true) for clean trees; the typed credential_value_present otherwise', () => {
    expect(assertNoCredentialMaterial({ safe: 'yes' })).toEqual({ ok: true, value: true });
    const result = assertNoCredentialMaterial({ apiKey: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('credential_value_present');
      expect(result.errors[0]!.message).toContain('apiKey');
    }
  });
});
