/**
 * @tradrl/execution-policy — the credential-opacity trip wire.
 *
 * THE LAW (spec/ARCHITECTURE.md Execution: "Consequential actions
 * require hard controls outside prompts: identity, authorization,
 * limits, venue permissions, rate limits, kill switch, CREDENTIALS and
 * audit"; spec/ARCHITECTURE-LOCK.md L12: "customer data, memory,
 * trajectories and credentials are isolated"; the Work Order: "your
 * credentials are OPAQUE REFS (never values — a record embedding a
 * credential VALUE is a typed error, negative test)").
 *
 * This lane carries credential REFERENCES only: a policy binds each
 * venue to an opaque `cred:`-prefixed ref; the referent VALUE lives in
 * the secrets lane (T044), and binding a ref to a real venue is the
 * execution-gateway lane (T040). A record that embeds credential
 * MATERIAL — a secret, an API key, a private key, a password, a
 * passphrase, a token, a mnemonic or a seed phrase under a
 * credential-shaped key ANYWHERE in its JSON tree — fails validation
 * with the typed `credential_value_present` error (mirroring
 * trading-strategy's authority.ts trip-wire discipline: the scan is a
 * pure function over the record's JSON tree, and the guards AND the
 * collect-all validators both run it).
 *
 * The scan is TOTAL: it walks every plain object and array reachable
 * from the root and flags any key on the closed
 * {@link CREDENTIAL_VALUE_KEYS} list (case-insensitive, comparing the
 * key's kebab/snake/camel normalizations). A credential VALUE smuggled
 * under `apiKey`, `api_key` or `API-KEY` is caught identically.
 */

import { deepFreeze } from './primitives';

/** The closed list of credential-material key shapes (normalized lowercase, no separators). */
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
