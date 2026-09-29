// @tradrl/body-execution — the public surface.
//
// Owning Work Order: T025 (frozen write surface: bodies/execution only —
// this Work Order is bodies-only, no services/ directory).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, the fnv chain-head fold,
//                 TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//                 (the order-lane prefix-guarded refs: xd: decisions,
//                 si: intents, dd- director decisions, ksw: switches,
//                 xsf- fills, confirm: cancellations)
//   errors      — the typed error taxonomy (collect-all + single
//                 failure; the L16 clock_confusion, the L8 authority
//                 family, the lifecycle_violation, the
//                 decimal_imprecision, the reconciliation_gap, the
//                 fabrication refusals)
//   decimals    — exact decimal-string numerics (the execution-lane
//                 canonical grammar + scaled BigInt arithmetic: sums,
//                 differences, products)
//   methods     — the DECLARED-METHOD discipline
//                 (OrderLifecycleMethodRecord/MethodRegistry: the five
//                 order-management kinds — order-preparation,
//                 stuck-order-detection, fill-reconciliation,
//                 cancellation-policy, kill-switch-response — the
//                 canonical registry)
//   intake      — the order-lane intake contracts (T019's
//                 ApproveDecision/RefusalDecision, the order intent,
//                 SimulatedFill, the kill-switch standing state, T020's
//                 limit states — plus the T024 director directive as
//                 OPAQUE refs; the L8 approve-only authority gate)
//   lifecycle   — the DECLARED TOTAL ORDER-STATE MACHINE (nine states,
//                 21 enumerable transitions, the L16 clock marker, the
//                 chain-verified append-only log, the exact-decimal
//                 quantity laws)
//   monitoring  — the declared monitoring procedures (stuck-order
//                 detection, exact-equality fill reconciliation, the
//                 cancellation policy with race recording, kill-switch
//                 mid-flight response — records, never exceptions)
//   body        — EXECUTION_BODY (the agent-body BodyVersion mirror +
//                 execution declaration + the L8 external-gateway-only
//                 REQUEST mode + the L16 order-level clock)
//   publication — the agent-os envelope mirror + the
//                 ExecutionPublicationPort
//                 (PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only) +
//                 the gateway request record (the submission seam)
//   fixtures    — the deterministic fixture set (the golden scenarios:
//                 happy path, gate rejection, expiry, stuck-ack
//                 escalation, partial-fill reconciliation (reconciled
//                 and one-grid-step gap), kill-switch mid-flight,
//                 cancellation race; the violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './intake';
export * from './lifecycle';
export * from './monitoring';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-execution',
  owner: 'T025',
  status: 'implemented',
  concepts: [
    'EXECUTION_BODY',
    'MethodRecord',
    'MethodRegistry',
    'ApprovedDecisionMirror',
    'RefusalDecisionMirror',
    'OrderIntentMirror',
    'SimulatedFillMirror',
    'KillSwitchStandingStateMirror',
    'LimitStateMirror',
    'OrderLifecycleRecord',
    'OrderLifecycleLog',
    'ORDER_LIFECYCLE_TRANSITIONS',
    'EscalationRecord',
    'ReconciliationRecord',
    'GatewayRequest',
    'ExecutionPublicationPort',
  ],
} as const;
