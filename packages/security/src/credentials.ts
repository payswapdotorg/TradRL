/**
 * @tradrl/security — the credential-opacity trip wire.
 *
 * THE LAW (spec/SECURITY.md Secrets — VERBATIM: "Never commit provider
 * credentials. Inject them through secure runtime boundaries.";
 * spec/ARCHITECTURE-LOCK.md L12: "customer data, memory, trajectories
 * and credentials are isolated"; L20: "safety outside prompts"; the T044
 * Work Order: "credential ENVELOPE types (a secret is referenced by
 * id+version, NEVER carried in plaintext in any record, log or audit
 * line)").
 *
 * STRUCTURAL MIRROR of @tradrl/execution-policy/src/credentials.ts (T019)
 * and @tradrl/execution-authority/src/credentials.ts (T040) — re-declared
 * by STRUCTURE, never imported (D-003/D-004): the SAME closed key list,
 * the SAME case/separator-insensitive normalization, the SAME depth-first
 * key-sorted scan, the SAME deterministic dotted-path reporting. A REAL
 * T019 scan, a REAL T040 scan and THIS scan flag the identical trees —
 * the interop trip wire proves it.
 *
 * This lane carries credential REFERENCES only (the envelope's
 * `cred:`-prefixed id + version); the referent VALUE lives behind the
 * secrets injection boundary (services/security — the runtime boundary
 * SECURITY.md mandates). A record that embeds credential MATERIAL — a
 * secret, an API key, a private key, a password, a passphrase, a token,
 * a mnemonic or a seed phrase under a credential-shaped key ANYWHERE in
 * its JSON tree — fails validation with the typed
 * `credential_value_present` error. Every guard AND every collect-all
 * validator in this package runs the scan (defense in depth).
 *
 * The scan is TOTAL: it walks every plain object and array reachable
 * from the root and flags any key on the closed
 * {@link CREDENTIAL_VALUE_KEYS} list (case-insensitive, comparing the
 * key's kebab/snake/camel normalizations). A credential VALUE smuggled
 * under `apiKey`, `api_key` or `API-KEY` is caught identically.
 */

import { deepFreeze } from './primitives';

/** The closed list of credential-material key shapes (normalized lowercase, no separators). Mirror of T019/T040's list. */
export const CREDENTIAL_VALUE_KEYS: readonly string[] = [
  'secret',
  'apikey',
  'privatekey',
  'password',
  'passphrase',
  'token',
  'mnemonic',
  'seedphrase',
  'credential',
] as const;

/** `true` when a record key is a credential-material key shape (case/separator-insensitive). */
export function isCredentialValueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return CREDENTIAL_VALUE_KEYS.includes(normalized);
}

/**
 * Scan a record's JSON tree for embedded credential material: the
 * dotted paths of every credential-shaped key found, in deterministic
 * (depth-first, key-sorted) order. Pure; never throws; an empty result
 * means the tree is value-free.
 */
export function credentialValueViolations(value: unknown): readonly string[] {
  const found: string[] = [];
  const scan = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (isCredentialValueKey(key)) {
        found.push(path === '' ? key : `${path}.${key}`);
      }
      scan(record[key], path === '' ? key : `${path}.${key}`);
    }
  };
  scan(value, '');
  return deepFreeze(found);
}
