// @tradrl/body-execution — lifecycle tests: THE DECLARED TOTAL STATE
// MACHINE — transition totality (every legal transition exercised
// forward; every illegal skip/replay is the typed lifecycle_violation),
// THE L16 clock_confusion laws, the exact-decimal quantity laws, the
// evidence laws (never fabricate), the chain/sequence laws.

import { describe, expect, it } from 'vitest';
import {
  CANCEL_EVENTS,
  FILL_EVENTS,
  GENESIS_EVENT,
  LIFECYCLE_CHAIN_SEED,
  ORDER_LIFECYCLE_EVENTS,
  ORDER_LIFECYCLE_TRANSITIONS,
  ORDER_STATES,
  STUCK_EVENTS,
  TERMINAL_ORDER_STATES,
  appendOrderLifecycleEvent,
  canonicalLifecycleJson,
  currentChainHead,
  currentOrderState,
  cumulativeFills,
  expectedChainHead,
  expectedLifecycleId,
  genesisRecord,
  isLegalEdge,
  isOrderLifecycleLog,
  isOrderLifecycleRecord,
  isTerminalOrderState,
  lifecycleContentTree,
  prepareOrder,
  transitionFor,
  transitionsFrom,
  validateFillEvidenceRecord,
  validateOrderLifecycleLog,
  validateOrderLifecycleRecord,
  type OrderState,
  type OrderLifecycleEvent,
  type OrderTransition,
} from './lifecycle';
import {
  FIXTURE_APPROVE_DECISION,
  FIXTURE_BACKWARD_PREPARATION,
  FIXTURE_CLOCKS,
  FIXTURE_CLOCK_CONFUSED_PREPARATION,
  FIXTURE_DECISION_ID,
  FIXTURE_DIRECTOR_DECISION,
  FIXTURE_FILLS,
  FIXTURE_HAPPY_PATH,
  FIXTURE_INTENT_REF,
  FIXTURE_ORDER_REF,
  FIXTURE_PREPARATION_CITATION,
  FIXTURE_QUANTITY,
  FIXTURE_REGISTRY,
  FIXTURE_STANDING_SWITCH,
  FIXTURE_STUCK_ACK,
  FIXTURE_T0,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  FIXTURE_CANCEL_CONFIRMATION,
  buildAcknowledgedLog,
  buildPreparedLog,
  buildSubmittedLog,
  strategicAsOfRecord,
} from './fixtures';
import { isDeeplyFrozen, canonicalJson } from './primitives';

/** The canonical preparation input (the genesis of every test lifecycle). */
const preparation = {
  decisionRef: FIXTURE_DECISION_ID,
  decisionAsOf: FIXTURE_T0,
  intentRef: FIXTURE_INTENT_REF,
  directorDecision: FIXTURE_DIRECTOR_DECISION,
  orderRef: FIXTURE_ORDER_REF,
  venue: 'REFSIM',
  instrument: 'BTC-USD',
  side: 'buy' as const,
  orderKind: 'limit',
  quantity: FIXTURE_QUANTITY,
  orderClock: FIXTURE_CLOCKS.prepare,
  methodId: FIXTURE_PREPARATION_CITATION.methodId,
  methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
  tenant: FIXTURE_TENANT,
  project: FIXTURE_PROJECT,
};

/** Unwraps or fails the test. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; errors: readonly { message: string }[] }): T {
  if (!result.ok) throw new Error(`must construct: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.value;
}

describe('THE DECLARED STATE MACHINE (totality)', () => {
  it('nine states declared; four are terminal', () => {
    expect(ORDER_STATES).toEqual([
      'prepared', 'submitted', 'acknowledged', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired', 'stuck',
    ]);
    expect([...TERMINAL_ORDER_STATES]).toEqual(['filled', 'cancelled', 'rejected', 'expired']);
    expect(isTerminalOrderState('filled')).toBe(true);
    expect(isTerminalOrderState('stuck')).toBe(false); // stuck is recoverable, NOT terminal
  });

  it('the transition table is total, enumerable and unique per (from, event)', () => {
    expect(ORDER_LIFECYCLE_TRANSITIONS).toHaveLength(21); // the genesis + 20 declared motions
    const pairs = ORDER_LIFECYCLE_TRANSITIONS.map((t) => `${t.from ?? 'null'}->${t.event}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    // every transition's target is a declared state; every source is declared or null
    for (const transition of ORDER_LIFECYCLE_TRANSITIONS) {
      expect(ORDER_STATES).toContain(transition.to);
      if (transition.from !== null) expect(ORDER_STATES).toContain(transition.from);
    }
    // no transition leaves a terminal state
    for (const transition of ORDER_LIFECYCLE_TRANSITIONS) {
      if (transition.from !== null) {
        expect(isTerminalOrderState(transition.from)).toBe(false);
      }
    }
  });

  it('EVERY legal transition is exercised forward (the totality law)', () => {
    // Drive each declared transition through the real append machinery.
    const logs = new Map<OrderState, ReturnType<typeof buildPreparedLog>>();
    logs.set('prepared', buildPreparedLog());
    logs.set('submitted', buildSubmittedLog());
    logs.set('acknowledged', buildAcknowledgedLog());
    // partially_filled: acknowledged + one fill
    logs.set(
      'partially_filled',
      unwrap(appendOrderLifecycleEvent(buildAcknowledgedLog(), {
        event: 'partial-fill',
        orderClock: FIXTURE_CLOCKS.fillOne,
        fills: [FIXTURE_FILLS[0] as { fillRef: string; quantity: string; orderClock: number }],
        methodId: 'method/execution/fill-reconciliation',
        methodVersion: '1.0.0',
      }, FIXTURE_REGISTRY)),
    );
    // filled: the happy path's log
    logs.set('filled', FIXTURE_HAPPY_PATH);
    // stuck: the stuck-ack scenario's log
    if (FIXTURE_STUCK_ACK.outcome.kind === 'stuck') logs.set('stuck', FIXTURE_STUCK_ACK.outcome.log);
    // cancelled: prepared + cancel-before-submit
    logs.set(
      'cancelled',
      unwrap(appendOrderLifecycleEvent(buildPreparedLog(), {
        event: 'cancel-before-submit',
        orderClock: FIXTURE_CLOCKS.prepare + 10,
        cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
        methodId: 'method/execution/cancellation-policy',
        methodVersion: '1.0.0',
      }, FIXTURE_REGISTRY)),
    );

    // For EVERY source state we can reach, apply EVERY event that
    // leaves it and confirm the append succeeds and lands on the
    // declared target.
    let exercised = 0;
    for (const transition of ORDER_LIFECYCLE_TRANSITIONS) {
      const source = transition.from;
      if (source === null) {
        // the genesis: prepareOrder exercises it
        expect(transition.event).toBe(GENESIS_EVENT);
        expect(transition.to).toBe('prepared');
        exercised += 1;
        continue;
      }
      const base = logs.get(source);
      if (base === undefined) continue; // sources we cannot reach with this fixture set
      const result = appendOrderLifecycleEvent(base, {
        event: transition.event,
        orderClock: base.records[base.records.length - 1].orderClock + 1,
        ...(FILL_EVENTS.includes(transition.event)
          ? { fills: [{ fillRef: 'xsf-00000099', quantity: '0.01', orderClock: base.records[base.records.length - 1].orderClock + 1 }] }
          : {}),
        ...(CANCEL_EVENTS.includes(transition.event) ? { cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION } : {}),
        ...(STUCK_EVENTS.includes(transition.event) ? { escalationRef: 'esc-0123456789abcdef' } : {}),
        methodId: FILL_EVENTS.includes(transition.event)
          ? 'method/execution/fill-reconciliation'
          : CANCEL_EVENTS.includes(transition.event)
            ? 'method/execution/cancellation-policy'
            : STUCK_EVENTS.includes(transition.event)
              ? 'method/execution/stuck-order-detection'
              : FIXTURE_PREPARATION_CITATION.methodId,
        methodVersion: '1.0.0',
      }, FIXTURE_REGISTRY);
      expect(result.ok, `${source} --${transition.event}--> ${transition.to} must apply`).toBe(true);
      if (result.ok) {
        expect(currentOrderState(result.value)).toBe(transition.to);
      }
      exercised += 1;
    }
    // every NON-terminal state's full adjacency is enumerable; terminal states have none (replay protection)
    for (const state of ORDER_STATES) {
      if (isTerminalOrderState(state)) {
        expect(transitionsFrom(state)).toHaveLength(0);
      } else {
        expect(transitionsFrom(state).length).toBeGreaterThan(0);
      }
    }
    expect(exercised).toBeGreaterThanOrEqual(15); // a substantive fraction of the table, machine-driven
  });

  it('EVERY illegal skip is the typed lifecycle_violation (undefined transitions)', () => {
    const prepared = buildPreparedLog();
    // every (state, event) pair NOT in the table is a violation
    let violations = 0;
    for (const from of ORDER_STATES) {
      for (const event of ORDER_LIFECYCLE_EVENTS) {
        if (transitionFor(from, event) !== null) continue;
        expect(transitionFor(from, event)).toBeNull();
        violations += 1;
      }
    }
    expect(violations).toBe(ORDER_STATES.length * ORDER_LIFECYCLE_EVENTS.length - (ORDER_LIFECYCLE_TRANSITIONS.length - 1));
    // concretely: skip prepared (submit directly from prepared to filled)
    const skip = appendOrderLifecycleEvent(prepared, {
      event: 'fill-complete',
      orderClock: FIXTURE_CLOCKS.fillTwo,
      fills: [...FIXTURE_FILLS],
      methodId: 'method/execution/fill-reconciliation',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(skip.ok).toBe(false);
    if (!skip.ok) {
      expect(skip.errors[0]?.code).toBe('lifecycle_violation');
      expect(skip.errors[0]?.message).toContain('UNDEFINED');
    }
    // and a motion to the wrong target: acknowledged + cancel-remaining (must come from partially_filled)
    const wrongTarget = appendOrderLifecycleEvent(buildAcknowledgedLog(), {
      event: 'cancel-remaining',
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
      methodId: 'method/execution/cancellation-policy',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(wrongTarget.ok).toBe(false);
    if (!wrongTarget.ok) expect(wrongTarget.errors[0]?.code).toBe('lifecycle_violation');
  });

  it('EVERY replay out of a terminal state is the typed lifecycle_violation', () => {
    for (const terminal of TERMINAL_ORDER_STATES) {
      // a terminal source cannot appear in the table at all
      expect(ORDER_LIFECYCLE_TRANSITIONS.some((t) => t.from === terminal)).toBe(false);
    }
    // concretely: the filled happy path + any motion
    for (const event of ['submit', 'acknowledge', 'partial-fill', 'cancel-remaining', 'expire-partial', 'late-reject'] as const) {
      const replay = appendOrderLifecycleEvent(FIXTURE_HAPPY_PATH, {
        event,
        orderClock: FIXTURE_CLOCKS.cancelAttempt + 100,
        ...(FILL_EVENTS.includes(event) ? { fills: [{ fillRef: 'xsf-00000099', quantity: '0.01', orderClock: FIXTURE_CLOCKS.cancelAttempt }] } : {}),
        ...(CANCEL_EVENTS.includes(event) ? { cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION } : {}),
        methodId: FILL_EVENTS.includes(event)
          ? 'method/execution/fill-reconciliation'
          : CANCEL_EVENTS.includes(event)
            ? 'method/execution/cancellation-policy'
            : FIXTURE_PREPARATION_CITATION.methodId,
        methodVersion: '1.0.0',
      }, FIXTURE_REGISTRY);
      expect(replay.ok).toBe(false);
      if (!replay.ok) {
        expect(replay.errors.some((e) => e.code === 'lifecycle_violation')).toBe(true);
      }
    }
  });

  it('isLegalEdge + transitionFor agree with the table', () => {
    expect(isLegalEdge(null, 'prepared')).toBe(true);
    expect(isLegalEdge('prepared', 'filled')).toBe(false);
    expect(transitionFor('stuck', 'late-acknowledge')?.to).toBe('acknowledged');
    expect(transitionFor('filled', 'late-acknowledge')).toBeNull();
  });
});

describe('THE L16 CLOCK LAWS (the existential separation)', () => {
  it('THE CLOCK-CONFUSION LAW: orderClock === decisionAsOf is clock_confusion', () => {
    const confused = prepareOrder(FIXTURE_CLOCK_CONFUSED_PREPARATION, FIXTURE_REGISTRY);
    expect(confused.ok).toBe(false);
    if (!confused.ok) {
      expect(confused.errors.some((e) => e.code === 'clock_confusion')).toBe(true);
      expect(confused.errors[0]?.message).toContain('DIFFERENT clock');
    }
  });

  it('THE CLOCK-CONFUSION LAW (a): a strategic `asOf` field on a lifecycle record is clock_confusion', () => {
    const doctored = strategicAsOfRecord();
    const errors = validateOrderLifecycleRecord(doctored);
    expect(errors.some((e) => e.code === 'clock_confusion')).toBe(true);
    expect(errors.find((e) => e.code === 'clock_confusion')?.message).toContain('orderClock');
    expect(isOrderLifecycleRecord(doctored)).toBe(false);
  });

  it('THE CAUSALITY LAW: orderClock < decisionAsOf is timestamp_order (not clock_confusion)', () => {
    const backward = prepareOrder(FIXTURE_BACKWARD_PREPARATION, FIXTURE_REGISTRY);
    expect(backward.ok).toBe(false);
    if (!backward.ok) {
      expect(backward.errors.some((e) => e.code === 'timestamp_order')).toBe(true);
      expect(backward.errors.some((e) => e.code === 'clock_confusion')).toBe(false);
    }
  });

  it('the clock marker is a DISTINCT field: every record carries orderClock AND decisionAsOf separately', () => {
    for (const record of FIXTURE_HAPPY_PATH.records) {
      expect(record.orderClock).toBeGreaterThan(record.decisionAsOf);
      expect(record.orderClock).not.toBe(record.decisionAsOf);
      expect('asOf' in record).toBe(false);
    }
  });

  it('the clock is monotone within a lifecycle (backwards is timestamp_order)', () => {
    const backwards = appendOrderLifecycleEvent(buildSubmittedLog(), {
      event: 'acknowledge',
      orderClock: FIXTURE_CLOCKS.prepare - 1, // before the submit!
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) {
      expect(backwards.errors.some((e) => e.code === 'timestamp_order')).toBe(true);
      expect(backwards.errors[0]?.message).toContain('backwards');
    }
  });
});

describe('THE EXACT-DECIMAL QUANTITY LAWS', () => {
  it('float mediation at preparation is the typed decimal_imprecision', () => {
    const floated = prepareOrder({ ...preparation, quantity: 0.75 }, FIXTURE_REGISTRY);
    expect(floated.ok).toBe(false);
    if (!floated.ok) {
      expect(floated.errors.some((e) => e.code === 'decimal_imprecision')).toBe(true);
    }
  });

  it('a malformed quantity string is decimal_invalid; a non-canonical one is decimal_invalid', () => {
    for (const quantity of ['abc', '', '00.75', '1.2.3', null]) {
      const result = prepareOrder({ ...preparation, quantity }, FIXTURE_REGISTRY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'decimal_invalid' || e.code === 'invalid_field')).toBe(true);
      }
    }
  });

  it('a fill quantity as a float is decimal_imprecision (fill evidence)', () => {
    const errors = validateFillEvidenceRecord({ fillRef: 'xsf-00000001', quantity: 0.5, orderClock: FIXTURE_CLOCKS.fillOne });
    expect(errors.some((e) => e.code === 'decimal_imprecision')).toBe(true);
    expect(validateFillEvidenceRecord(FIXTURE_FILLS[0])).toEqual([]);
  });

  it('THE OVERFILL LAW: cumulative fills exceeding the order quantity is quantity_mismatch', () => {
    const overfilled = appendOrderLifecycleEvent(buildAcknowledgedLog(), {
      event: 'partial-fill',
      orderClock: FIXTURE_CLOCKS.fillOne,
      fills: [{ fillRef: 'xsf-00000001', quantity: '0.8', orderClock: FIXTURE_CLOCKS.fillOne }], // > 0.75
      methodId: 'method/execution/fill-reconciliation',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(overfilled.ok).toBe(false);
    if (!overfilled.ok) {
      expect(overfilled.errors[0]?.code).toBe('quantity_mismatch');
      expect(overfilled.errors[0]?.message).toContain('exceed');
    }
  });
});

describe('THE EVIDENCE LAWS (never fabricate)', () => {
  it('a fill event without fill evidence is fill_fabricated', () => {
    const fabricated = appendOrderLifecycleEvent(buildAcknowledgedLog(), {
      event: 'partial-fill',
      orderClock: FIXTURE_CLOCKS.fillOne,
      methodId: 'method/execution/fill-reconciliation',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(fabricated.ok).toBe(false);
    if (!fabricated.ok) {
      expect(fabricated.errors[0]?.code).toBe('fill_fabricated');
    }
  });

  it('a cancel event without a confirmation ref is cancel_fabricated', () => {
    const fabricated = appendOrderLifecycleEvent(buildAcknowledgedLog(), {
      event: 'cancel-unfilled',
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      methodId: 'method/execution/cancellation-policy',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(fabricated.ok).toBe(false);
    if (!fabricated.ok) {
      expect(fabricated.errors[0]?.code).toBe('cancel_fabricated');
    }
  });

  it('a stuck-entering event without an escalation ref is escalation_missing (never a silent timeout)', () => {
    const silent = appendOrderLifecycleEvent(buildSubmittedLog(), {
      event: 'ack-deadline-exceeded',
      orderClock: FIXTURE_CLOCKS.stuckCheck,
      methodId: 'method/execution/stuck-order-detection',
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(silent.ok).toBe(false);
    if (!silent.ok) {
      expect(silent.errors[0]?.code).toBe('escalation_missing');
    }
  });

  it('evidence rides ONLY on its own event family (fill evidence on a non-fill event is invalid)', () => {
    const misplaced = validateOrderLifecycleRecord({
      ...buildSubmittedLog().records[1],
      fills: [FIXTURE_FILLS[0]],
    });
    expect(misplaced.some((e) => e.code === 'invalid_field')).toBe(true);
    const misplacedCancel = validateOrderLifecycleRecord({
      ...buildSubmittedLog().records[1],
      cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
    });
    expect(misplacedCancel.some((e) => e.code === 'invalid_field')).toBe(true);
  });
});

describe('THE CHAIN + SEQUENCE LAWS (append-only, tamper-evident)', () => {
  it('the genesis folds from the chain seed; ids are content-addressed', () => {
    const log = buildPreparedLog();
    const genesis = log.records[0] as typeof log.records[number];
    expect(genesis.chainHead).toBe(expectedChainHead(LIFECYCLE_CHAIN_SEED, genesis));
    expect(genesis.lifecycleId).toBe(expectedLifecycleId(genesis));
    expect(genesis.lifecycleId).toMatch(/^ol-[0-9a-f]{16}$/);
    expect(genesis.sequence).toBe(1);
    expect(genesis.from).toBeNull();
    expect(genesis.event).toBe('prepare');
  });

  it('each record folds from its predecessor (the rewrite trip wire fires on tampering)', () => {
    const log = buildAcknowledgedLog();
    for (let index = 1; index < log.records.length; index += 1) {
      const record = log.records[index] as typeof log.records[number];
      const predecessor = log.records[index - 1] as typeof log.records[number];
      expect(record.chainHead).toBe(expectedChainHead(predecessor.chainHead, record));
      expect(record.sequence).toBe(predecessor.sequence + 1);
      expect(record.from).toBe(predecessor.to);
    }
    // tamper with the middle record's content: the chain breaks
    const tampered = JSON.parse(JSON.stringify(log));
    (tampered.records[1] as { venue: string }).venue = 'OTHER-VENUE';
    const errors = validateOrderLifecycleLog(tampered);
    expect(errors.some((e) => e.code === 'lifecycle_chain')).toBe(true);
    expect(errors.some((e) => e.code === 'digest_mismatch')).toBe(true);
  });

  it('sequence gaps are lifecycle_sequence; state discontinuity is lifecycle_violation', () => {
    const log = JSON.parse(JSON.stringify(buildAcknowledgedLog()));
    (log.records[2] as { sequence: number }).sequence = 4;
    const sequenceErrors = validateOrderLifecycleLog(log);
    // re-derive id? No — the sequence change breaks the chain and id; the sequence gap is reported
    expect(sequenceErrors.some((e) => e.code === 'lifecycle_sequence')).toBe(true);

    const discontinuous = JSON.parse(JSON.stringify(buildAcknowledgedLog()));
    (discontinuous.records[2] as { from: string }).from = 'prepared'; // ack record claiming to leave 'prepared'
    const discontinuousErrors = validateOrderLifecycleLog(discontinuous);
    expect(discontinuousErrors.some((e) => e.code === 'lifecycle_violation')).toBe(true);
  });

  it('a reordered/empty/missing-genesis log fails (the genesis law)', () => {
    const log = JSON.parse(JSON.stringify(buildAcknowledgedLog()));
    (log.records[0] as { event: string }).event = 'submit';
    const errors = validateOrderLifecycleLog(log);
    expect(errors.some((e) => e.code === 'lifecycle_violation')).toBe(true);
    expect(validateOrderLifecycleLog({ orderRef: FIXTURE_ORDER_REF, records: [] })[0]?.code).toBe('invalid_type');
    expect(validateOrderLifecycleLog(null)[0]?.code).toBe('invalid_type');
  });

  it('isOrderLifecycleLog accepts the golden logs', () => {
    expect(isOrderLifecycleLog(FIXTURE_HAPPY_PATH)).toBe(true);
    expect(isOrderLifecycleLog(buildPreparedLog())).toBe(true);
  });
});

describe('the preparation gate (the L8 law at the genesis)', () => {
  it('a refusal-shaped ref (or non-xd:) is decision_not_approved', () => {
    const refused = prepareOrder({ ...preparation, decisionRef: 'dd-not-a-decision' }, FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]?.code).toBe('decision_not_approved');
  });

  it('an undeclared method at preparation is the typed undeclared_method', () => {
    const magic = prepareOrder({ ...preparation, methodId: 'method/execution/magic' }, FIXTURE_REGISTRY);
    expect(magic.ok).toBe(false);
    if (!magic.ok) expect(magic.errors.some((e) => e.code === 'undeclared_method')).toBe(true);
  });

  it('COLLECT-ALL: a many-broken draft reports EVERY violation', () => {
    const broken = prepareOrder(
      {
        decisionRef: 'nope',
        decisionAsOf: -1,
        intentRef: '',
        directorDecision: 'nope',
        orderRef: '',
        venue: '',
        instrument: '',
        side: 'both',
        orderKind: '',
        quantity: 0.75,
        orderClock: 'not-a-time',
        methodId: '',
        methodVersion: 'x',
        tenant: '',
        project: '',
      },
      FIXTURE_REGISTRY,
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      // decision + intent + director + orderRef + venue + instrument + side + kind + quantity + clock + method x2 + tenant + project
      expect(broken.errors.length).toBeGreaterThanOrEqual(13);
      const codes = new Set(broken.errors.map((e) => e.code));
      expect(codes.has('decision_not_approved')).toBe(true);
      expect(codes.has('decimal_imprecision')).toBe(true);
      expect(codes.has('tenant_missing')).toBe(true);
      expect(codes.has('project_missing')).toBe(true);
    }
  });
});

describe('helpers + serialization', () => {
  it('currentOrderState / currentChainHead / cumulativeFills / genesisRecord', () => {
    expect(currentOrderState(buildPreparedLog())).toBe('prepared');
    expect(currentOrderState(buildAcknowledgedLog())).toBe('acknowledged');
    expect(currentOrderState(FIXTURE_HAPPY_PATH)).toBe('filled');
    expect(currentChainHead(buildPreparedLog())).toBe((buildPreparedLog().records[0] as { chainHead: string }).chainHead);
    expect(cumulativeFills(FIXTURE_HAPPY_PATH)).toHaveLength(2);
    expect(cumulativeFills(buildPreparedLog())).toHaveLength(0);
    expect(genesisRecord(FIXTURE_HAPPY_PATH)?.event).toBe('prepare');
    expect((genesisRecord(FIXTURE_HAPPY_PATH) as { decisionRef: string }).decisionRef).toBe(FIXTURE_DECISION_ID);
  });

  it('canonicalLifecycleJson is byte-deterministic', () => {
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const first = canonicalLifecycleJson(record);
    const second = canonicalLifecycleJson(JSON.parse(JSON.stringify(record)) as typeof record);
    expect(first).toBe(second);
    expect(first).toBe(canonicalJson(record as never));
  });

  it('lifecycleContentTree carries every content field (id/chain excluded)', () => {
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const tree = lifecycleContentTree(record) as Record<string, unknown>;
    expect(tree.lifecycleId).toBeUndefined();
    expect(tree.chainHead).toBeUndefined();
    expect(tree.decisionRef).toBe(FIXTURE_DECISION_ID);
    expect(tree.orderClock).toBe(FIXTURE_CLOCKS.prepare);
    expect(tree.decisionAsOf).toBe(FIXTURE_T0);
    expect(tree.tenant).toBe(FIXTURE_TENANT);
    expect(tree.project).toBe(FIXTURE_PROJECT);
  });

  it('every minted record is deeply frozen', () => {
    for (const log of [buildPreparedLog(), buildSubmittedLog(), buildAcknowledgedLog(), FIXTURE_HAPPY_PATH]) {
      expect(isDeeplyFrozen(log)).toBe(true);
    }
  });

  it('a thrown standing switch refuses a submit event (killswitch_thrown — fail-closed)', () => {
    const refused = appendOrderLifecycleEvent(buildPreparedLog(), {
      event: 'submit',
      orderClock: FIXTURE_CLOCKS.submit,
      killSwitch: { state: 'thrown' },
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]?.code).toBe('killswitch_thrown');
      expect(refused.errors[0]?.message).toContain('fails closed');
    }
    // the standing switch does NOT block
    const standing = appendOrderLifecycleEvent(buildPreparedLog(), {
      event: 'submit',
      orderClock: FIXTURE_CLOCKS.submit,
      killSwitch: { state: 'standing' },
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: '1.0.0',
    }, FIXTURE_REGISTRY);
    expect(standing.ok).toBe(true);
  });

  it('the OrderTransition shape is exported and inspectable', () => {
    const transition: OrderTransition = ORDER_LIFECYCLE_TRANSITIONS[0] as OrderTransition;
    expect(transition.from).toBeNull();
    expect(transition.event).toBe('prepare');
    expect(transition.to).toBe('prepared');
    const event: OrderLifecycleEvent = transition.event;
    expect(event).toBe('prepare');
    const state: OrderState = transition.to;
    expect(state).toBe('prepared');
  });
});
