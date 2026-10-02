// @tradrl/security — redaction and scrubbing helpers.
//
// THE LAW (spec/SECURITY.md Secrets — VERBATIM: "Never commit provider
// credentials. Inject them through secure runtime boundaries."): the
// credential-opacity trip wire REFUSES records carrying credential
// material (the gate — see credentials.ts). These helpers are the
// scrubbing side: deterministic, total transforms that produce
// SAFE-TO-EMIT views of trees that would otherwise fail the gate.
//
//   - {@link redactCredentialValues} — rebuilds a tree with every
//     credential-shaped key's VALUE replaced by a fixed marker
//     (`[redacted:credential]`), reporting the deterministic dotted
//     paths it redacted. Pure: the input is never mutated; the output is
//     a fresh, deeply frozen tree.
//   - {@link scrubForLog} — the one-call scrub: redact credential
//     material, then re-run the trip wire to PROVE the result is clean
//     (the scrub is verified, not assumed). Returns the safe tree plus
//     the redaction report.
//   - {@link assertNoCredentialMaterial} — the gate as a standalone
//     predicate (typed `credential_value_present` on violation) for
//     call sites that must FAIL rather than scrub (record validation).
//
// Redaction NEVER crosses the tenant boundary: cross-tenant data is
// EXCLUDED (typed `cross_tenant_access` — see scope.ts), not redacted;
// redaction is for credential MATERIAL only, within a record the caller
// is already entitled to see.

import { deepFreeze, isDigest, type JsonValue } from './primitives';
import { credentialValueViolations, isCredentialValueKey } from './credentials';
import type { SecurityResult } from './errors';
import { fail, ok } from './errors';

/** The fixed marker that replaces redacted credential values (deterministic — never the original). */
export const REDACTED_CREDENTIAL_MARKER = '[redacted:credential]';

/** The redaction report: what was redacted, in deterministic (depth-first, key-sorted) order. */
export interface RedactionReport {
  /** The dotted paths whose values were replaced by {@link REDACTED_CREDENTIAL_MARKER}. */
  readonly redactedPaths: readonly string[];
  /** `true` iff nothing needed redaction. */
  readonly clean: boolean;
}

/** The scrub outcome: the safe tree plus the report. */
export interface ScrubbedTree {
  readonly tree: unknown;
  readonly report: RedactionReport;
}

// ---------------------------------------------------------------------------
// The redactor (pure tree rebuild)
// ---------------------------------------------------------------------------

function redactNode(node: unknown, path: string, redacted: string[]): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return Object.freeze(node.map((item, index) => redactNode(item, `${path}[${index}]`, redacted)));
  }
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (isCredentialValueKey(key)) {
      // Redact the credential-shaped key ENTIRELY: the key is renamed to
      // `<key>_redacted` and the value replaced by the fixed marker. The
      // trip wire flags credential-shaped KEY NAMES, so a scrub that only
      // replaced the value would still fail the gate — the rename makes
      // the redaction VERIFIABLE (scrubForLog re-runs the wire and
      // passes). The report carries the original path.
      redacted.push(childPath);
      out[`${key}_redacted`] = REDACTED_CREDENTIAL_MARKER;
      continue;
    }
    out[key] = redactNode(source[key], childPath, redacted);
  }
  return Object.freeze(out);
}

/**
 * Rebuild a tree with every credential-shaped key renamed to
 * `<key>_redacted` and its value replaced by the fixed marker. PURE
 * (input untouched); deterministic (sorted-key rebuild — the output's
 * key order is canonical regardless of input order); the report's paths
 * match {@link credentialValueViolations} exactly. The output is deeply
 * frozen and PASSES the credential-opacity trip wire (the rename removes
 * the credential-shaped key name — see {@link scrubForLog}'s verified
 * re-run).
 */
export function redactCredentialValues(value: unknown): ScrubbedTree {
  const redacted: string[] = [];
  const tree = redactNode(value, '', redacted);
  return Object.freeze({
    tree: deepFreeze(tree),
    report: Object.freeze({ redactedPaths: Object.freeze(redacted), clean: redacted.length === 0 }),
  });
}

/**
 * The one-call scrub: redact credential material, then RE-RUN the trip
 * wire over the result to PROVE it is clean. Returns the safe tree plus
 * the report; never fails (the redaction is total by construction — the
 * verification is the belt-and-braces proof the tests pin).
 */
export function scrubForLog(value: unknown): ScrubbedTree & { readonly verifiedClean: boolean } {
  const scrubbed = redactCredentialValues(value);
  const verifiedClean = credentialValueViolations(scrubbed.tree).length === 0;
  return Object.freeze({ ...scrubbed, verifiedClean });
}

// ---------------------------------------------------------------------------
// The gate (fail, don't scrub)
// ---------------------------------------------------------------------------

/**
 * The gate for record-emission call sites: `ok(true)` iff the tree is
 * credential-material-free; otherwise the typed
 * `credential_value_present` error with the deterministic violation
 * paths. Callers that must fail loudly (validation of records this
 * package owns) use this; callers producing operator-facing views use
 * {@link scrubForLog}.
 */
export function assertNoCredentialMaterial(value: unknown, path = 'record'): SecurityResult<true> {
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — never carry a secret in any record, log or audit line (spec/SECURITY.md: "Never commit provider credentials. Inject them through secure runtime boundaries.")`,
    );
  }
  return ok(true);
}

/** `true` iff a digest-shaped string is a well-formed possession fingerprint (8-hex). */
export function isFingerprint(v: unknown): v is string {
  return isDigest(v);
}
