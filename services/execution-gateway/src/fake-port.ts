// @tradrl/execution_gateway (service) — the recording fake port (test
// support; NOT exported from the package index's contract surface —
// but shipped as an exported test helper for the gateway suite and
// downstream lanes' tests, mirroring the T039 fixture discipline).
//
// The REAL adapters are the interop tests' business (REAL T039
// sessions over the SDK's scripted FakeTransport); THIS helper is the
// minimal deterministic port for the behavioral suite: it records
// every routeOrder call (the zero-transport-calls assertions read the
// call log) and can be scripted to fail at chosen call indices (the
// adapter-stage refusal fixture).

import { deepFreeze } from '../../../packages/execution-authority/src/index';
import type { OrderRoutingPort, RoutingBundleMirror, RoutingSendFailure, RoutingSendResult } from './ports';

/** A scripted failure to inject at one call index (0-based). */
export interface PortScriptedFailure extends RoutingSendFailure {
  /** The 0-based routeOrder call index the failure fires at. */
  readonly atCall: number;
}

/** The recording fake port: the call log + optional scripted failures. */
export interface RecordingPort extends OrderRoutingPort {
  /** Every routing bundle handed to routeOrder, in order. */
  calls(): readonly RoutingBundleMirror[];
}

/**
 * Build one recording fake port. Deterministic: the same calls always
 * produce the same log; the scripted failures fire at their indices.
 */
export function recordingPort(failures: readonly PortScriptedFailure[] = []): RecordingPort {
  const log: RoutingBundleMirror[] = [];
  const port: RecordingPort = {
    routeOrder(routing: RoutingBundleMirror): RoutingSendResult {
      const callIndex = log.length;
      log.push(deepFreeze({ ...routing }));
      const scripted = failures.find((failure) => failure.atCall === callIndex);
      if (scripted !== undefined) {
        return { ok: false, error: { kind: scripted.kind, code: scripted.code, message: scripted.message } };
      }
      return { ok: true, value: null };
    },
    calls(): readonly RoutingBundleMirror[] {
      return [...log];
    },
  };
  return port;
}
