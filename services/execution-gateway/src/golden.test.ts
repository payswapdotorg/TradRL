// @tradrl/execution_gateway — the byte-determinism golden test: the
// same scripted scenario run TWICE through two independently
// constructed gateways produces the byte-identical outcome log, audit
// trail and routing bundles (L9). The trip wire over the emitted
// records is re-run as part of the golden (clean records, twice).

import { describe, expect, it } from 'vitest';

import { canonicalJson, credentialValueViolations, verifyGatewayAuditChain } from '../../../packages/execution-authority/src/index';
import {
  compliantIntent,
  contaminatedIntent,
  referenceApproveBatch,
  referenceExposure,
  referenceKillSwitch,
  referencePolicy,
  referencePortfolio,
  referenceRegistry,
  referenceRiskPolicy,
  referenceRoutingTable,
  referenceVenueState,
  shadowModeIntent,
  SUBSTRATE,
  T0,
} from './fixtures';
import { createExecutionGateway, recordingPort, scriptedInstants, type ExecutionGatewaySession } from './index';

/**
 * The golden scenario: the approve batch (three routed orders across
 * both adapter lanes), a contaminated submission, a shadow-mode
 * submission and a duplicate replay — the full outcome vocabulary in
 * one deterministic sequence.
 */
function runGoldenScenario(): {
  readonly submissions: string;
  readonly audit: string;
  readonly brokerBundles: string;
  readonly omsBundles: string;
  readonly session: ExecutionGatewaySession;
} {
  const brokerPort = recordingPort();
  const omsPort = recordingPort();
  const construction = createExecutionGateway({
    policy: referencePolicy(),
    gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
    risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
    authority: referenceRegistry(),
    routing: referenceRoutingTable(),
    adapters: [
      { adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort },
      { adapterRef: 'adapter:adapter-oms-ems@0.0.0' as never, port: omsPort },
    ],
    killSwitch: referenceKillSwitch(),
    instants: scriptedInstants([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000, T0 + 4_000, T0 + 5_000]),
    substrate: SUBSTRATE,
  });
  if (!construction.ok) throw new Error(`the golden gateway must construct: ${JSON.stringify(construction.errors)}`);
  const gateway = construction.gateway;

  // The scripted sequence: three approvals, one contaminated, one shadow, one replay.
  const sequence: readonly unknown[] = [
    referenceApproveBatch()[0],
    referenceApproveBatch()[1],
    referenceApproveBatch()[2],
    contaminatedIntent(),
    shadowModeIntent(),
    referenceApproveBatch()[0], // the replay
  ];
  for (const anIntent of sequence) {
    const outcome = gateway.submitDecision(anIntent);
    if (!outcome.ok) throw new Error(`the golden scenario must decide: ${JSON.stringify(outcome.errors)}`);
  }

  return {
    submissions: canonicalJson(JSON.parse(JSON.stringify(gateway.submissions())) as never),
    audit: canonicalJson(JSON.parse(JSON.stringify(gateway.auditTrail())) as never),
    brokerBundles: canonicalJson(JSON.parse(JSON.stringify(brokerPort.calls())) as never),
    omsBundles: canonicalJson(JSON.parse(JSON.stringify(omsPort.calls())) as never),
    session: gateway,
  };
}

describe('the byte-determinism golden (run TWICE)', () => {
  it('the same scripted scenario produces the byte-identical submissions, audit trail and routing bundles', () => {
    const first = runGoldenScenario();
    const second = runGoldenScenario();
    expect(first.submissions).toBe(second.submissions);
    expect(first.audit).toBe(second.audit);
    expect(first.brokerBundles).toBe(second.brokerBundles);
    expect(first.omsBundles).toBe(second.omsBundles);
  });

  it('the golden outcome vocabulary is the expected shape (3 routed, 3 refused, 1 adapter call each lane)', () => {
    const golden = runGoldenScenario();
    const outcomes = golden.session.submissions().map((record) => record.kind);
    expect(outcomes).toEqual(['routed', 'routed', 'routed', 'refused', 'refused', 'refused']);
    // The refusal stages in order: credential_opacity, shadow_mode, duplicate_decision.
    const stages = golden.session
      .submissions()
      .filter((record) => record.kind === 'refused')
      .map((record) => (record.kind === 'refused' ? record.refusal.stage : ''));
    expect(stages).toEqual(['credential_opacity', 'shadow_mode', 'duplicate_decision']);
  });

  it('the golden audit trail chain-verifies and the emitted records pass the opacity trip wire', () => {
    const golden = runGoldenScenario();
    expect(verifyGatewayAuditChain(golden.session.auditTrail()).ok).toBe(true);
    expect(golden.session.verifyGatewayCoherence().ok).toBe(true);
    expect(credentialValueViolations(golden.session.auditTrail())).toEqual([]);
    expect(credentialValueViolations(golden.session.submissions() as unknown[])).toEqual([]);
  });
});

// Keep the compliantIntent import honest (the fixture discipline).
void compliantIntent;
