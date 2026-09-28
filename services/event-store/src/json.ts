/**
 * @tradrl/event-store — JSON value model.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol/src/json.ts and
 * @tradrl/provenance/src/json.ts (law D-004: never imports). Correction
 * amendments are free-form structured data typed as a closed recursive
 * JSON model, so no `unknown` or `any` leaks at the API boundary.
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

/**
 * Recursively freeze a JSON-shaped value. Returns the same reference,
 * deeply frozen (mirrors @tradrl/provenance's deepFreeze — law D-004
 * structural mirror; the provenance package owns the contract version).
 */
export function deepFreezeJson<T>(value: T): T {
  const freezeNode = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Object.isFrozen(node)) return;
    for (const key of Object.keys(node)) {
      freezeNode((node as Record<string, unknown>)[key]);
    }
    Object.freeze(node);
  };
  freezeNode(value);
  return value;
}
