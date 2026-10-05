/**
 * @tradrl/adapter-arena — the JSON value model.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/json.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). All contract data is
 * JSON-serializable so provider records are portable across processes
 * and byte-stable under canonical serialization.
 */

/** A JSON value (the only payload model this adapter accepts). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** `true` when `value` is a total JSON value (no undefined/functions/symbols anywhere). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isJsonObject(value)) return true;
  return false;
}

/** `true` when `value` is a JSON object (a record of JSON values). */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isJsonValue);
}
