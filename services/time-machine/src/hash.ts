/**
 * @tradrl/time-machine — deterministic lineage hashing (Work Order T029).
 *
 * The view hash and the snapshot lineage hash are pure functions of the
 * lineage-bearing content (ids, the availability quartet, graph edges,
 * provenance, positions) — recomputable from the artifact's own fields
 * ("lineage-recomputable" per the work order) and byte-stable across
 * processes and runs (the L9 determinism law). No crypto dependency:
 * zero-runtime-dependency law; the hash is a lineage CHECKSUM, not a
 * cryptographic commitment — determinism and collision-resistance over
 * realistic lineage graphs are what the contract demands.
 *
 * CANONICAL SERIALIZATION: objects serialize with RECURSIVELY SORTED keys,
 * arrays in order, strings JSON-escaped, numbers via their canonical
 * ECMAScript decimal form. Two structurally equal lineage skeletons always
 * produce the identical canonical string, therefore the identical hash.
 *
 * DELIBERATELY EXCLUDED from hashed content: opaque record payloads (they
 * are content, not lineage; view identity is bound by deep-equality in the
 * behavioral suite and by the snapshot's own structure).
 */

/**
 * Canonical serialization of a JSON-representable value: sorted keys,
 * deterministic scalar formatting. Payloads are never fed to this function
 * by the machine (lineage skeletons only), but the serializer itself is
 * total over JSON-representable values.
 */
export function canonicalString(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalString: non-finite numbers are not serializable');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalString(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalString((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  // Functions, symbols, bigints, undefined are not JSON-representable.
  throw new TypeError(`canonicalString: values of type ${typeof value} are not serializable`);
}

/** FNV-1a 32-bit over a string, with an explicit offset basis. */
function fnv1a32(text: string, basis: number): number {
  let hash = basis;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit.
  return hash >>> 0;
}

/** Standard FNV-1a offset basis (first lane). */
const FNV_BASIS_A = 0x811c9dc5;
/** Documented variant basis (second lane — a distinct constant, not a re-seed of A). */
const FNV_BASIS_B = 0x0707_a35f;

/**
 * Deterministic 64-hex-character lineage checksum: two independent FNV-1a
 * lanes over the canonical serialization, rendered as fixed-width lowercase
 * hex joined by a dash. Pure function of the canonical string — identical
 * content yields the identical hash in every process, every run.
 */
export function hashOf(value: unknown): string {
  const text = canonicalString(value);
  const laneA = fnv1a32(text, FNV_BASIS_A);
  const laneB = fnv1a32(text, FNV_BASIS_B);
  return `${laneA.toString(16).padStart(8, '0')}-${laneB.toString(16).padStart(8, '0')}`;
}
