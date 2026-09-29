/**
 * @tradrl/adapter-brokers — the declared mapping table tests.
 *
 * Behavioral: the table declaration's totality (validated, frozen), the
 * accounted raw-field inventory, the declared source-time policy (L4 —
 * the documented TransactTime -> epoch milliseconds; availability at
 * receive time, clamped), and the negative paths of the collect-all
 * validator.
 */

import { describe, expect, it } from 'vitest';

import {
  BROKER_MAPPING_TABLES,
  BROKER_EXECUTION_REPORT_TABLE,
  BROKER_CHANNEL_TABLE_IDS,
  accountedRawFields,
  timePolicyFields,
  validateMappingTable,
  type MappingTable,
} from './index';

describe('BROKER_MAPPING_TABLES declaration', () => {
  it('declares exactly one table per documented inbound channel', () => {
    expect(BROKER_MAPPING_TABLES.length).toBe(1);
    expect(BROKER_MAPPING_TABLES[0]).toBe(BROKER_EXECUTION_REPORT_TABLE);
    expect(BROKER_CHANNEL_TABLE_IDS['executionReport']).toBe('broker-execution-report');
  });

  it('every table is validated and deep-frozen', () => {
    for (const table of BROKER_MAPPING_TABLES) {
      expect(table.table_id).toBe('broker-execution-report');
      expect(table.event_type).toBe('other');
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.isFrozen(table.fields)).toBe(true);
      expect(() => {
        (table as unknown as Record<string, unknown>).table_id = 'mutation';
      }).toThrow();
    }
  });

  it('the table accounts for every derived emitter-facing raw field', () => {
    const accounted = accountedRawFields(BROKER_EXECUTION_REPORT_TABLE);
    expect(accounted).toContain('data');
    // The time-policy field is accounted for.
    expect(accounted).toContain('transactTimeMs');
    expect(timePolicyFields(BROKER_EXECUTION_REPORT_TABLE.source_time_policy)).toEqual(['transactTimeMs']);
  });

  it('the canonical target vocabulary is exactly the other payload\'s fields', () => {
    for (const field of BROKER_EXECUTION_REPORT_TABLE.fields) {
      expect(['data', 'kind']).toContain(field.canonical_field);
    }
    const constants = BROKER_EXECUTION_REPORT_TABLE.constants.map((constant) => constant.canonical_field);
    expect(constants).toEqual(['kind']);
  });

  it('the source-time policy is the declared L4-honest derivation', () => {
    const policy = BROKER_EXECUTION_REPORT_TABLE.source_time_policy;
    expect(policy.event_time_basis).toBe('raw-field');
    expect(policy.event_time_field).toBe('transactTimeMs');
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
    // A complete valid declaration passes and freezes.
    const valid = validateMappingTable({
      table_id: 'x',
      event_type: 'other',
      fields: [{ raw_field: 'data', canonical_field: 'data' }],
      constants: [{ canonical_field: 'kind', value: 'execution_report' }],
      tolerated: [],
      source_time_policy: { event_time_basis: 'raw-field', event_time_field: 'transactTimeMs', source_time_field: null, availability_basis: 'receive-time' },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(Object.isFrozen(valid.value)).toBe(true);
  });

  it('the table type mirror is structurally the SDK\'s (compile-time witness)', () => {
    const witness: MappingTable = BROKER_EXECUTION_REPORT_TABLE;
    expect(witness.event_type).toBe('other');
  });
});
