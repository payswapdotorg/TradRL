import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_DOMAINS,
  CONSTRAINT_SEVERITIES,
  type ConstraintSetStatement,
  type ConstraintSetRef,
  type TenantId,
  type TimestampMs,
  isConstraintDomain,
  isConstraintSeverity,
  isConstraintSetStatement,
  isConstraintStatement,
  isDeeplyFrozen,
} from './index';
import { exampleConstraintSetStatement } from './examples';

const ts = (n: number) => n as TimestampMs;
const setId = (s: string) => s as ConstraintSetRef;
const tenant = (s: string) => s as TenantId;

function validSet(): ConstraintSetStatement {
  return JSON.parse(JSON.stringify(exampleConstraintSetStatement)) as ConstraintSetStatement;
}

describe('isConstraintSetStatement — acceptance', () => {
  it('accepts the canonical example set', () => {
    expect(isConstraintSetStatement(exampleConstraintSetStatement)).toBe(true);
  });

  it('accepts an EMPTY constraint set (vacuous — satisfies nothing, never passes vacuously)', () => {
    const empty: ConstraintSetStatement = {
      id: setId('cs_empty'),
      version: 1,
      tenantId: tenant('tenant_acme'),
      constraints: [],
      createdAt: ts(1_000),
    };
    expect(isConstraintSetStatement(empty)).toBe(true);
  });
});

describe('isConstraintSetStatement — rejection', () => {
  it('rejects malformed constraint sets', () => {
    const set = validSet();
    const invalid: unknown[] = [
      { ...set, id: '' },
      { ...set, version: 0 },
      { ...set, version: 3.5 },
      { ...set, version: '2' },
      { ...set, tenantId: '' },
      { ...set, name: '' },
      { ...set, constraints: 'all good things' }, // prose
      { ...set, constraints: null },
      { ...set, constraints: [{ ...set.constraints[0], id: '' }] },
      { ...set, constraints: [{ ...set.constraints[0], domain: 'unknown-phase' }] },
      { ...set, constraints: [{ ...set.constraints[0], subject: 'bad subject path' }] },
      { ...set, constraints: [{ ...set.constraints[0], predicate: { kind: 'limit.max' } }] },
      { ...set, constraints: [{ ...set.constraints[0], severity: 'fatal' }] },
      { ...set, constraints: [{ ...set.constraints[0], description: '' }] },
      // duplicate constraint ids within the set
      { ...set, constraints: [set.constraints[0], { ...set.constraints[1], id: set.constraints[0].id }] },
      { ...set, createdAt: ts(Number.NaN) },
      { ...set, createdAt: '2027-01-01T00:00:00Z' }, // control plane uses TimestampMs scalars
      null,
      'constraints',
      [],
    ];
    for (const s of invalid) expect(isConstraintSetStatement(s)).toBe(false);
  });
});

describe('component guards', () => {
  it('isConstraintStatement validates the full record shape', () => {
    expect(isConstraintStatement(exampleConstraintSetStatement.constraints[0])).toBe(true);
    expect(isConstraintStatement({ id: 'a' })).toBe(false);
    expect(isConstraintStatement({ id: 'a', domain: 'state', subject: 'x.y', predicate: { kind: 'flag', expected: true }, severity: 'blocking' })).toBe(true);
    // Missing or extra-typed pieces fail closed.
    expect(isConstraintStatement({ id: 'a', domain: 'state', subject: 'x.y', predicate: { kind: 'flag', expected: true } })).toBe(false);
    expect(isConstraintStatement({ id: 'a', domain: 'state', subject: 'x', predicate: { kind: 'flag', expected: true }, severity: 'blocking', extra: 1 })).toBe(true); // unknown fields are not interpreted
    expect(isConstraintStatement(null)).toBe(false);
  });

  it('isConstraintDomain and isConstraintSeverity are closed vocabularies', () => {
    expect([...CONSTRAINT_DOMAINS]).toEqual(['observation', 'state', 'action', 'outcome']);
    expect([...CONSTRAINT_SEVERITIES]).toEqual(['advisory', 'blocking']);
    for (const domain of CONSTRAINT_DOMAINS) expect(isConstraintDomain(domain)).toBe(true);
    for (const severity of CONSTRAINT_SEVERITIES) expect(isConstraintSeverity(severity)).toBe(true);
    expect(isConstraintDomain('phases')).toBe(false);
    expect(isConstraintSeverity('fatal')).toBe(false);
    expect(isConstraintDomain(1)).toBe(false);
    expect(isConstraintSeverity(null)).toBe(false);
  });
});

describe('immutability discipline', () => {
  it('the canonical example set is deeply frozen', () => {
    expect(isDeeplyFrozen(exampleConstraintSetStatement)).toBe(true);
  });
});
