/**
 * @tradrl/adapter-equities — the documented record schema tests.
 *
 * Behavioral: every channel's documented shape validated; the negative
 * dispositions (unmapped raw field -> MappingError, malformed documented
 * field -> protocol error, unknown record type -> protocol error); the
 * documented domain laws (weight bounds, share class codes, action type
 * codes, ratio and currency forms); and the derivations into the
 * emitter-facing representation (guard-consumed fields dropped,
 * escape-hatch data objects built with canonical keys).
 */

import { describe, expect, it } from 'vitest';

import {
  guardIndexLevelPayload,
  guardConstituentWeightsPayload,
  guardCorporateActionsPayload,
  guardEquitiesPayload,
  deriveIndexLevelPayload,
  deriveConstituentWeightPayload,
  deriveCorporateActionPayload,
  isNormalizedIndexLevel,
  isNormalizedConstituentWeight,
  isNormalizedCorporateAction,
  equitiesProtocolCodeOf,
  type JsonObject,
  type SdkResult,
} from './index';

const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, inside the declared US regular session.

const indexLevel = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'INDEX_LEVEL',
    indexId: 'TEST-LARGECAP',
    tradeDate: '2024-06-03',
    disseminationTimeMs: AT0,
    indexLevel: '104.5000',
    indexDivisor: '1234.5678',
    sequenceNumber: 41,
    ...overrides,
  }) as JsonObject;

const constituentWeight = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'CONSTITUENT_WEIGHT',
    indexId: 'TEST-LARGECAP',
    tradeDate: '2024-06-03',
    disseminationTimeMs: AT0 + 10,
    constituentSymbol: 'TEST-AAA',
    constituentWeight: '0.06940',
    shareClassCode: 'COMMON',
    sequenceNumber: 7,
    ...overrides,
  }) as JsonObject;

const corporateAction = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'CORPORATE_ACTION',
    actionId: 'ACT-2024-0001',
    corporateSymbol: 'TEST-AAA',
    actionTypeCode: 'SPLIT',
    effectiveDate: '2024-06-10',
    announcementTimeMs: AT0 + 20,
    actionRatio: '4:1',
    currencyCode: 'USD',
    ...overrides,
  }) as JsonObject;

function expectFailure(result: SdkResult<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe('channel "indexLevel" — the documented index level record', () => {
  it('validates the documented shape into a normalized record', () => {
    const result = guardIndexLevelPayload(indexLevel());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recordType).toBe('INDEX_LEVEL');
      expect(result.value.indexId).toBe('TEST-LARGECAP');
      expect(result.value.tradeDate).toBe('2024-06-03');
      expect(result.value.disseminationTimeMs).toBe(AT0);
      expect(result.value.indexLevel).toBe('104.5000');
      expect(result.value.indexDivisor).toBe('1234.5678');
      expect(result.value.sequenceNumber).toBe(41);
      expect(isNormalizedIndexLevel(result.value)).toBe(true);
    }
  });

  it('an extra field the schema does not document is a typed unmapped_raw_field', () => {
    const result = guardIndexLevelPayload(indexLevel({ vendor_extra: 'surprise' }));
    expectFailure(result, 'unmapped_raw_field');
    if (!result.ok) expect(result.error.message).toContain('vendor_extra');
  });

  it('a missing documented field is a typed malformed_payload', () => {
    const missing = { ...indexLevel() } as Record<string, unknown>;
    delete missing.indexLevel;
    expectFailure(guardIndexLevelPayload(missing as JsonObject), 'malformed_payload');
  });

  it('an undocumented record type discriminator is a typed unknown_message_type', () => {
    const result = guardIndexLevelPayload(indexLevel({ recordType: 'CLOSING_LEVEL' }));
    expectFailure(result, 'unknown_message_type');
    if (!result.ok) {
      expect(equitiesProtocolCodeOf(result.error)).toBe('unknown_message_type');
      expect(result.error.message).toContain('CLOSING_LEVEL');
    }
  });

  it('documented shape laws: date form, timestamp, positive decimals, positive sequence', () => {
    expectFailure(guardIndexLevelPayload(indexLevel({ tradeDate: '2024-6-3' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ tradeDate: '2024-06-31' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ disseminationTimeMs: 0 })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ disseminationTimeMs: -5 })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ disseminationTimeMs: '1717423200000' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ indexLevel: 'free' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ indexLevel: '0' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ indexDivisor: '-1' })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ sequenceNumber: 0 })), 'malformed_payload');
    expectFailure(guardIndexLevelPayload(indexLevel({ sequenceNumber: 41.5 })), 'malformed_payload');
  });
});

describe('channel "constituentWeights" — the documented constituent weight record', () => {
  it('validates the documented shape into a normalized record', () => {
    const result = guardConstituentWeightsPayload(constituentWeight());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constituentSymbol).toBe('TEST-AAA');
      expect(result.value.constituentWeight).toBe('0.06940');
      expect(result.value.shareClassCode).toBe('COMMON');
      expect(isNormalizedConstituentWeight(result.value)).toBe(true);
    }
  });

  it('weight domain: [0, 1] inclusive — a weight above one is malformed, zero and one are legitimate', () => {
    expect(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: '1' })).ok).toBe(true);
    expect(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: '0' })).ok).toBe(true);
    expect(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: '1.00001' })).ok).toBe(false);
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: '1.1' })), 'malformed_payload');
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: '-0.5' })), 'malformed_payload');
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ constituentWeight: 'half' })), 'malformed_payload');
  });

  it('the documented share class codes are enforced', () => {
    expect(guardConstituentWeightsPayload(constituentWeight({ shareClassCode: 'PREFERRED' })).ok).toBe(true);
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ shareClassCode: 'CLASS-B' })), 'malformed_payload');
  });

  it('an extra field is a typed unmapped_raw_field; an unknown record type is typed', () => {
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ vendor_extra: 1 })), 'unmapped_raw_field');
    expectFailure(guardConstituentWeightsPayload(constituentWeight({ recordType: 'INDEX_LEVEL' })), 'unknown_message_type');
  });
});

describe('channel "corporateActions" — the documented corporate action record', () => {
  it('validates the documented shape into a normalized record', () => {
    const result = guardCorporateActionsPayload(corporateAction());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actionTypeCode).toBe('SPLIT');
      expect(result.value.actionRatio).toBe('4:1');
      expect(isNormalizedCorporateAction(result.value)).toBe(true);
    }
  });

  it('the documented action type codes are enforced (an undocumented code is an unknown message type)', () => {
    expect(guardCorporateActionsPayload(corporateAction({ actionTypeCode: 'CASH_DIVIDEND' })).ok).toBe(true);
    expect(guardCorporateActionsPayload(corporateAction({ actionTypeCode: 'MERGER' })).ok).toBe(true);
    const result = guardCorporateActionsPayload(corporateAction({ actionTypeCode: 'TENDER_OFFER' }));
    expectFailure(result, 'unknown_message_type');
    if (!result.ok) expect(result.error.message).toContain('TENDER_OFFER');
  });

  it('documented form laws: N:M ratio, three-letter currency, effective date', () => {
    expectFailure(guardCorporateActionsPayload(corporateAction({ actionRatio: '4-to-1' })), 'malformed_payload');
    expectFailure(guardCorporateActionsPayload(corporateAction({ actionRatio: '4:1:1' })), 'malformed_payload');
    expectFailure(guardCorporateActionsPayload(corporateAction({ currencyCode: 'usd' })), 'malformed_payload');
    expectFailure(guardCorporateActionsPayload(corporateAction({ currencyCode: 'DOLLAR' })), 'malformed_payload');
    expectFailure(guardCorporateActionsPayload(corporateAction({ effectiveDate: 'June 10' })), 'malformed_payload');
  });

  it('an extra field is a typed unmapped_raw_field; an unknown record type is typed', () => {
    expectFailure(guardCorporateActionsPayload(corporateAction({ vendor_extra: true })), 'unmapped_raw_field');
    expectFailure(guardCorporateActionsPayload(corporateAction({ recordType: 'CONSTITUENT_WEIGHT' })), 'unknown_message_type');
  });
});

describe('the derivations into the emitter-facing representation', () => {
  it('deriveIndexLevelPayload keeps the mapped and tolerated fields, drops the guard-consumed ones', () => {
    const guarded = guardIndexLevelPayload(indexLevel());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveIndexLevelPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['disseminationTimeMs', 'indexDivisor', 'indexLevel', 'tradeDate']);
  });

  it('deriveConstituentWeightPayload builds the escape-hatch data object with canonical keys', () => {
    const guarded = guardConstituentWeightsPayload(constituentWeight());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveConstituentWeightPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['data', 'disseminationTimeMs']);
    const data = payload.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['share_class', 'symbol', 'weight']);
    expect(data.symbol).toBe('TEST-AAA');
    expect(data.weight).toBe('0.06940');
    expect(data.share_class).toBe('common');
  });

  it('deriveCorporateActionPayload translates the action type and builds canonical keys', () => {
    const guarded = guardCorporateActionsPayload(corporateAction());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveCorporateActionPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['announcementTimeMs', 'data']);
    const data = payload.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['action', 'currency', 'effective_date', 'ratio', 'symbol']);
    expect(data.action).toBe('split');
    expect(data.effective_date).toBe('2024-06-10');
    expect(data.ratio).toBe('4:1');
    expect(data.currency).toBe('USD');
  });
});

describe('guardEquitiesPayload routing', () => {
  it('routes each documented channel to its schema guard and derivation', () => {
    expect(guardEquitiesPayload('indexLevel', indexLevel()).ok).toBe(true);
    expect(guardEquitiesPayload('constituentWeights', constituentWeight()).ok).toBe(true);
    expect(guardEquitiesPayload('corporateActions', corporateAction()).ok).toBe(true);
    expectFailure(guardEquitiesPayload('indexLevel', indexLevel({ recordType: 'NOPE' })), 'unknown_message_type');
  });

  it('channels without a documented schema pass through verbatim (the session owns routing)', () => {
    const payload: JsonObject = { anything: 'goes' } as JsonObject;
    const result = guardEquitiesPayload('someOtherChannel', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(payload);
  });
});
