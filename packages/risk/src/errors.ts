/**
 * @tradrl/risk — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects
 * ALL violations and reports them as typed errors (the collect-all
 * discipline of the sibling contract packages — execution-policy,
 * trading-strategy, exchange-sim), while state transitions fail with a
 * precise single cause. Both flow through the same {@link RiskResult}
 * shape: a failure carries a non-empty `errors` array.
 *
 * The taxonomy names this Work Order's existential laws explicitly:
 *   - `limit_unevaluable` — the LIMIT-STATE TOTALITY law: every limit
 *     kind the engine declares has an exhaustive machine-enumerated
 *     check; an unevaluable limit is a typed error, never a silent pass
 *     ("the totality law");
 *   - `acceptance_threshold_embedded` — THE L7 EXISTENTIAL LAW: the
 *     engine computes and records RISK MEASURES as data; it never
 *     converts a risk figure into an acceptance verdict. A RiskPolicy
 *     (or risk measure record) embedding an acceptance threshold
 *     masquerading as evaluation fails validation — the engine informs,
 *     evaluation (T012) decides;
 *   - `policy_history_rewrite` — the L11 append-only evolution law:
 *     superseded policy versions are RETAINED with structured reasons;
 *     rewriting history is a typed error (a tampered or forged trail
 *     fails chain verification — same discipline as the kill-switch
 *     chain);
 *   - `decimal_imprecision` — the exact-decimal law: a JS NUMBER in a
 *     money path is float mediation and fails with this code (strings in
 *     the mirrored grammars are the only legal money);
 *   - `lineage_gap` (L9) and `tenant_missing` (L12);
 *   - `market_state_gap` — the declared-inputs law: the market state
 *     does not cover an instrument the exposure must price (never a
 *     best-effort reference price);
 *   - `risk_constraint_uncompilable` — a risk-bearing constraint whose
 *     predicate/bound cannot compile into a limit record.
 *
 * DISTINCTION (L7, mirroring execution-policy's error note): an
 * operation FAILURE (this module) means the engine could not even
 * evaluate the request as a well-formed record (malformed portfolio
 * mirror, market-state gap, tampered switch log, incoherent measures). A
 * BREACHING limit state (limits.ts) is a SUCCESSFUL measurement
 * outcome — the measure was taken, the state is structured data, and
 * evaluation (T012) decides what it means. The engine NEVER produces
 * acceptance verdicts.
 */

/** Machine-readable failure codes for risk-engine operations. */
export type RiskErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** Serialized text is not parseable JSON. */
  | 'invalid_json'
  /** A decimal string is malformed or outside the mirrored grammars. */
  | 'invalid_decimal'
  // --- the L7 existential law (the engine informs, evaluation decides) --------
  /** A record embeds an acceptance threshold/score/verdict — risk figures are measures or opaque refs, never acceptance. */
  | 'acceptance_threshold_embedded'
  // --- the limit-state totality law --------------------------------------------
  /** A declared limit cannot be evaluated over the given inputs (never a silent pass). */
  | 'limit_unevaluable'
  // --- the exact-decimal law ------------------------------------------------------
  /** A JS number appeared in a money path — float mediation is inexpressible (strings only). */
  | 'decimal_imprecision'
  // --- the compile law (control-domain constraints -> limit records) ----------------
  /** A risk-bearing constraint cannot compile (predicate kind or bound is not a compilable cap). */
  | 'risk_constraint_uncompilable'
  // --- the append-only laws (L11 + the trail chain) -----------------------------------
  /** Policy history was rewritten, truncated, tampered or illegally versioned (chain verification failed). */
  | 'policy_history_rewrite'
  /** The risk audit trail was rewritten, truncated or tampered (chain verification failed). */
  | 'risk_audit_rewrite'
  // --- the declared-inputs laws ----------------------------------------------------------
  /** The market state does not cover an instrument the exposure must price. */
  | 'market_state_gap'
  /** A lineage field is absent or malformed (L9). */
  | 'lineage_gap'
  /** A record carries no tenant/project scope (L12). */
  | 'tenant_missing'
  /** The kill-switch mirror failed chain verification (mirrors execution-policy's law). */
  | 'killswitch_rewrite'
  /** A record contradicts its own invariants (idempotency, sequence, digest, arithmetic coherence). */
  | 'invalid_state';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface RiskError {
  readonly code: RiskErrorCode;
  /** Dotted path from the validated root, e.g. `policy.limits[1].maxOrderSize`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type RiskResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly RiskError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: RiskErrorCode, message: string, path = ''): RiskResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly RiskError[]): RiskResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): RiskResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): RiskError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): RiskError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): RiskError {
  return { code: 'invalid_type', path: '', message };
}
