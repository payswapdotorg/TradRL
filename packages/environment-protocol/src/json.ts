/**
 * @tradrl/environment-protocol — JSON value model.
 *
 * Observation and action payloads are OPAQUE to this protocol: the
 * environment mediates delivery and validation of the ENVELOPE, never the
 * payload semantics (market semantics belong to T009/T010; agent semantics
 * to T003/T006). The surface type is nevertheless a closed recursive JSON
 * model — no `unknown` or `any` leaks at the API boundary, and every
 * envelope (and therefore every step trace built from them) is
 * JSON-serializable, which T011 (trajectories) and T014 (distributed
 * episode generation) depend on.
 *
 * This mirrors the JSON model of `@tradrl/market-protocol` (src/json.ts) —
 * the model IS standard JSON, so the mirror cannot diverge in semantics;
 * it is re-declared only because contract packages never import each other.
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
