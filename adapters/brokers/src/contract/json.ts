/**
 * @tradrl/adapter-brokers — JSON value model for raw payloads.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/json.ts (itself a mirror of
 * @tradrl/market-protocol; law D-004: never imports). Raw provider payloads
 * cross the adapter as a CLOSED recursive JSON model — no `unknown` or `any`
 * leaks at the API boundary while the documented broker-gateway shapes remain
 * fully general (L2/L13: vendor specifics never leak past the adapter
 * boundary, but the raw side still needs a typed surface).
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
