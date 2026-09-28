/**
 * @tradrl/trajectory — deterministic canonical serialization.
 *
 * The trajectory exchange format: a canonical JSON form with the property
 * that the SAME record (by value) always serializes to IDENTICAL bytes —
 * regardless of key insertion order, construction history or append order
 * of structurally distinct records. Distinct append orders produce distinct
 * records and therefore distinct bytes.
 *
 * Canonical form rules (mirrors of the JSON data model, tightened):
 * - Objects: keys sorted lexicographically (Unicode code-point order, the
 *   default `Array.prototype.sort` on strings — deterministic across
 *   platforms), no whitespace.
 * - Arrays: order preserved (order is MEANINGFUL — it is the step log).
 * - Primitives: standard JSON literals; numbers via `JSON.stringify`
 *   (finite only — the guards reject non-finite numbers first).
 * - Optional-absent fields: absent. A key with value `undefined` is skipped,
 *   matching `JSON.stringify` semantics.
 *
 * Round-trip law: `parseTrajectory(serializeTrajectory(t))` deep-equals `t`,
 * and re-serializing the parse yields byte-identical output.
 */

import { deepFreeze, isJsonValue } from './primitives';
import { fail, ok, type TrajectoryResult } from './errors';
import { createTrajectory, type Trajectory, type TrajectorySpec } from './record';

/** Render a JSON value in canonical form (sorted keys, no whitespace). */
export function canonicalize(value: unknown): string {
  return render(value);
}

function render(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(render).join(',')}]`;
      }
      const keys = Object.keys(value)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort();
      const body = keys
        .map((key) => `${JSON.stringify(key)}:${render((value as Record<string, unknown>)[key])}`)
        .join(',');
      return `{${body}}`;
    }
    default:
      // Unreachable for guard-validated records (JSON discipline upstream).
      throw new TypeError(`canonicalize: value is not JSON-safe (${typeof value})`);
  }
}

/** Serialize a trajectory to its canonical JSON bytes. */
export function serializeTrajectory(trajectory: Trajectory): string {
  return render(trajectory);
}

/** Parse and validate canonical trajectory text back into a frozen record. */
export function parseTrajectory(text: string): TrajectoryResult<Trajectory> {
  if (typeof text !== 'string' || text.length === 0) {
    return fail('invalid_serialization', 'trajectory text must be a non-empty string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail('invalid_serialization', `trajectory text is not valid JSON: ${String(error)}`);
  }
  if (!isJsonValue(parsed)) {
    return fail('invalid_serialization', 'trajectory text did not decode to a JSON value');
  }
  const spec = parsed as TrajectorySpec;
  const result = createTrajectory(spec);
  if (!result.ok) {
    return fail('invalid_serialization', `parsed trajectory failed validation: ${result.error.message}`);
  }
  return ok(deepFreeze(result.value));
}
