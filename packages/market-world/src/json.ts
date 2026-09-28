/**
 * @tradrl/market-world — JSON value model.
 *
 * World events, world states and run records are JSON-serializable by
 * contract: the replay world PERSISTS history (resume) and EMITS lineage
 * records (L9), so every envelope this package accepts must be portable
 * across processes. This mirrors the JSON model of `@tradrl/market-protocol`
 * (src/json.ts) — the model IS standard JSON, so the mirror cannot diverge in
 * semantics; it is re-declared only because contract packages never import
 * each other (D-004).
 */

/** Recursive JSON value model. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object (record of JSON values). */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Runtime guard for a JSON value (deep). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValue(element));
  }
  return false;
}

/** Runtime guard for a JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((element) => isJsonValue(element));
}
