/**
 * @tradrl/adapter-oms-ems — the declared mapping table tests.
 *
 * Behavioral: the table declaration's totality (validated, frozen), the
 * accounted raw-field inventory, the declared source-time policy (L4 —
 * the documented updatedAt -> epoch milliseconds; availability at
 * receive time, clamped), and the negative paths of the collect-all
 * validator.
 */

import { describe, expect, it } from 'vitest';

import {
  OMS_EMS_MAPPING_TABLES,
  OMS_EMS_ORDER_STATE_TABLE,
  OMS_EMS_CHANNEL_TABLE_IDS,
  accountedRawFields,
  timePolicyFields,
  validateMappingTable,
  type MappingTable,
} from './index';

describe('OMS_EMS_MAPPING_TABLES declaration', () => {
  it('declares exactly one table per documented inbound channel', () => {
    expect(OMS_EMS_MAPPING_TABLES.length).toBe(1);
    expect(OMS_EMS_MAPPING_TABLES[0]).toBe(OMS_EMS_ORDER_STATE_TABLE);
    expect(OMS_EMS_CHANNEL_TABLE_IDS['orderState']).toBe('oms-ems-order-state');
  });

  it('every table is validated and deep-frozen', () => {
    for (const table of OMS_EMS_MAPPING_TABLES) {
      expect(table.table_id).toBe('oms-ems-order-state');
      expect(table.event_type).toBe('other');
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.isFrozen(table.fields)).toBe(true);
      expect(() => {
        (table as unknown as Record<string, unknown>).table_id = 'mutation';
      }).toThrow();
    }
  });

  it('the table accounts for every derived emitter-facing raw field', () => {
    const accounted = accountedRawFields(OMS_EMS_ORDER_STATE_TABLE);
    expect(accounted).toContain('data');
    expect(accounted).toContain('updatedAtMs');
    expect(timePolicyFields(OMS_EMS_ORDER_STATE_TABLE.source_time_policy)).toEqual(['updatedAtMs']);
  });

  it('the canonical target vocabulary is exactly the other payload\'s fields', () => {
    for (const field of OMS_EMS_ORDER_STATE_TABLE.fields) {
      expect(['data', 'kind']).toContain(field.canonical_field);
    }
    const constants = OMS_EMS_ORDER_STATE_TABLE.constants.map((constant) => constant.canonical_field);
    expect(constants).toEqual(['kind']);
  });

  it('the source-time policy is the declared L4-honest derivation', () => {
    const policy = OMS_EMS_ORDER_STATE_TABLE.source_time_policy;
    expect(policy.event_time_basis).toBe('raw-field');
    expect(policy.event_time_field).toBe('updatedAtMs');
    expect(policy.source_time_field).toBeNull();
    expect(policy.availability_basis).toBe('receive-time');
  });

  it('collect-all rejects malformed tables (the negative paths)', () => {
    const invalid = [
      {},
      { table_id: '', event_type: 'other', fields: [], constants: [], tolerated: [], source_time_policy: { event_time_basis: 'raw-field', event_time_field: 'x', source_time_field: null, availability_basis: 'receive-time' } },
      {
        table_id: 'x',
        event_type: 'other',
        fields: [{ raw_field: 'data', canonical_field: 'nonexistent_canonical_field' }],
        constants: [],
        tolerated: [],
        source_time_policy: { event_time_basis: 'raw-field', event_time_field: 't', source_time_field: null, availability_basis: 'receive-time' },
      },
      // The required canonical fields (kind, data) must be covered.
      {
        table_id: 'x',
        event_type: 'other',
        fields: [{ raw_field: 'data', canonical_field: 'data' }],
        constants: [],
        tolerated: [],
        source_time_policy: { event_time_basis: 'receive-time', event_time_field: null, source_time_field: null, availability_basis: 'receive-time' },
      },
    ];
    for (const value of invalid) {
      const result = validateMappingTable(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
    const valid = validateMappingTable({
      table_id: 'x',
      event_type: 'other',
      fields: [{ raw_field: 'data', canonical_field: 'data' }],
      constants: [{ canonical_field: 'kind', value: 'order_state' }],
      tolerated: [],
      source_time_policy: { event_time_basis: 'raw-field', event_time_field: 'updatedAtMs', source_time_field: null, availability_basis: 'receive-time' },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(Object.isFrozen(valid.value)).toBe(true);
  });

  it('the table type mirror is structurally the SDK\'s (compile-time witness)', () => {
    const witness: MappingTable = OMS_EMS_ORDER_STATE_TABLE;
    expect(witness.event_type).toBe('other');
  });
});
