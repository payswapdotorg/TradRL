// @tradrl/capability-provider — the EXCHANGE: the append-only,
// chain-verified state machine that runs the whole provider
// conversation (declaration -> request -> quote -> engagement ->
// deliverable -> verification -> withdrawal) for ONE tenant.
//
// THE LAWS THIS MODULE SERVES:
// - L12 (tenant isolation): the exchange is scoped to ONE tenant at
//   creation; every record entering it must carry that tenant — a
//   foreign record is the typed `cross_tenant_access` refusal at the
//   gate (nothing foreign is ever stored, so nothing foreign can leak).
// - The chain law (L9/L11): every operation APPENDS one log entry
//   (seq, kind, recordId, recordDigest, at, priorHead, head) — the
//   entries are linked by their digests, and `verifyExchangeChain`
//   recomputes the whole chain plus every record digest; a tampered
//   log entry, a rewritten record, or a hidden operation is the typed
//   `chain_mismatch`. History is retained — including REJECTED
//   deliverables (spec/CAPABILITY-DISCOVERY.md Reproducibility).
// - The idempotence law: every minted record is CONTENT-ADDRESSED, so
//   replaying an identical draft returns the EXISTING record
//   (`replayed: true`, no new log entry) — evidence contributes
//   exactly once; a retry after a timeout can never double-append.
// - The lifecycle law: the closed transition table from engagement.ts;
//   every illegal transition is the typed `invalid_transition`.
// - The deadline law (L4): a deliverable submitted after the frozen
//   deadline instant is the typed `deadline_exceeded` (refused —
//   recorded nowhere but the caller's error, per the refusal law).
// - Determinism: no ambient clock, no ambient randomness — every id
//   and every chain head is a pure function of the operation content;
//   the same op sequence mints byte-identical serializations.
//
// SECURITY (spec/SECURITY.md): the provider payload is UNTRUSTED
// input — the exchange never interprets it (only the digest pin);
// verification outcomes arrive from the PLATFORM's machinery, never
// from the provider; the provider never verifies its own deliverable.

import { canonicalJson, deepCloneJson, deepFreeze, isNonEmptyString, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import type { ProviderError, ProviderResult } from './errors';
import { fail, invalidField, missingField, ok } from './errors';
import type {
  CapabilityRequestId,
  DeliverableId,
  EngagementId,
  ProviderQuoteId,
  ProviderRef,
  ProviderVerificationReportId,
  TenantId,
} from './ids';
import { isCapabilityRequestId, isProjectId, isProviderRef, isTenantId } from './ids';
import type { ProviderDeclaration } from './declaration';
import { validateProviderDeclaration } from './declaration';
import type { CapabilityRequest, Deliverable, Engagement, EngagementStatus, ProviderQuote } from './engagement';
import { isProviderQuote, isProviderTerms, quoteMatchProblems, validateCapabilityRequest, validateDeliverable } from './engagement';
import { labelKeyPaths } from './mirrors';
import type { ProviderVerificationReport, VerificationOutcome } from './verification';
import { mintVerificationReport } from './verification';

// ---------------------------------------------------------------------------
// The append-only log (the chain)
// ---------------------------------------------------------------------------

/** The log-entry kinds — one per exchange operation. */
export const EXCHANGE_LOG_KINDS = [
  'provider-declared',
  'request-issued',
  'quote-submitted',
  'engagement-opened',
  'deliverable-submitted',
  'engagement-verified',
  'engagement-withdrawn',
] as const;

/** One log-entry kind. */
export type ExchangeLogKind = (typeof EXCHANGE_LOG_KINDS)[number];

/** The chain's zero state (the linked list's genesis head). */
export const GENESIS_CHAIN_HEAD = 'log:0000000000000000';

/**
 * ONE append-only log entry: the operation kind, the record it minted
 * (id + digest), the operation's explicit instant, and the chain link
 * (`priorHead` -> `head`, where `head` is the stable digest of the
 * entry's own content minus `head`). Tamper-evident: rewriting any
 * entry breaks every later head; rewriting a RECORD breaks its entry's
 * digest match.
 */
export interface ExchangeLogEntry {
  readonly seq: number;
  readonly kind: ExchangeLogKind;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly at: number;
  readonly priorHead: string;
  readonly head: string;
}

// ---------------------------------------------------------------------------
// The exchange state (immutable; one tenant; append-only histories)
// ---------------------------------------------------------------------------

/**
 * The provider exchange for ONE tenant: the provider registry (the
 * supersede HISTORY is retained; the map holds each provider's CURRENT
 * declaration), every issued request, every submitted quote, every
 * engagement (the map holds each engagement's CURRENT status; the
 * version history is retained), every deliverable, every verification
 * report, and the chain-verified log of every operation.
 */
export interface ProviderExchangeState {
  /** The exchange's ONE tenant (L12 — the gate every record must pass). */
  readonly tenantId: TenantId;
  /** Each provider's CURRENT declaration. */
  readonly declarations: ReadonlyMap<ProviderRef, ProviderDeclaration>;
  /** The FULL declaration history (append-only; supersede never mutates). */
  readonly declarationHistory: readonly ProviderDeclaration[];
  /** Every issued capability request, by id. */
  readonly requests: ReadonlyMap<CapabilityRequestId, CapabilityRequest>;
  /** Every submitted provider quote, by id. */
  readonly quotes: ReadonlyMap<ProviderQuoteId, ProviderQuote>;
  /** Each engagement's CURRENT record (status = latest). */
  readonly engagements: ReadonlyMap<EngagementId, Engagement>;
  /** Every engagement's version history, append-only (open -> ... -> terminal). */
  readonly engagementVersions: ReadonlyMap<EngagementId, readonly Engagement[]>;
  /** Every submitted deliverable, by id. */
  readonly deliverables: ReadonlyMap<DeliverableId, Deliverable>;
  /** Every minted verification report, by id. */
  readonly verificationReports: ReadonlyMap<ProviderVerificationReportId, ProviderVerificationReport>;
  /** The append-only, chain-verified operation log. */
  readonly log: readonly ExchangeLogEntry[];
}

/** Creates the GENESIS exchange state for one tenant (empty, chain at its zero state). */
export function createProviderExchange(tenantId: string): ProviderResult<ProviderExchangeState> {
  if (!isTenantId(tenantId)) {
    return fail('tenant_missing', 'the exchange is created within exactly one tenant scope (L12)', 'tenantId');
  }
  return ok(deepFreeze({
    tenantId,
    declarations: new Map<ProviderRef, ProviderDeclaration>(),
    declarationHistory: [],
    requests: new Map<CapabilityRequestId, CapabilityRequest>(),
    quotes: new Map<ProviderQuoteId, ProviderQuote>(),
    engagements: new Map<EngagementId, Engagement>(),
    engagementVersions: new Map<EngagementId, readonly Engagement[]>(),
    deliverables: new Map<DeliverableId, Deliverable>(),
    verificationReports: new Map<ProviderVerificationReportId, ProviderVerificationReport>(),
    log: [],
  }) as unknown as ProviderExchangeState);
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/** The digest of one log entry's own content (everything except `head`). */
function entryHead(entry: Omit<ExchangeLogEntry, 'head'>): string {
  return `log:${stableDigestJson(entry)}`;
}

/** Appends one entry to the log, linking it to the current head. */
function appendEntry(
  state: ProviderExchangeState,
  kind: ExchangeLogKind,
  recordId: string,
  record: unknown,
  at: number,
): { readonly log: readonly ExchangeLogEntry[]; readonly head: string } {
  const prior = state.log.length === 0 ? [] : state.log;
  const priorHead = state.log.length === 0 ? GENESIS_CHAIN_HEAD : state.log[state.log.length - 1].head;
  const content = { seq: state.log.length, kind, recordId, recordDigest: stableDigestJson(record), at, priorHead };
  const head = entryHead(content);
  const sealed: ExchangeLogEntry = Object.freeze({ ...content, head });
  return { log: Object.freeze([...prior, sealed]), head };
}

/**
 * Verifies the FULL chain: every entry's head recomputes, every
 * prior-head link is intact, seq is contiguous from 0, and every
 * record digest matches a retained record (the current record for
 * map-held kinds; the matching VERSION for engagement kinds). Any
 * tamper is the typed `chain_mismatch`.
 */
export function verifyExchangeChain(state: ProviderExchangeState): ProviderResult<void> {
  let expectedPrior = GENESIS_CHAIN_HEAD;
  for (let index = 0; index < state.log.length; index++) {
    const entry = state.log[index];
    if (typeof entry !== 'object' || entry === null) {
      return fail('chain_mismatch', `log entry ${index} is not an object`, `log[${index}]`);
    }
    if (entry.seq !== index) {
      return fail('chain_mismatch', `log entry ${index} carries seq ${entry.seq} — the sequence is contiguous from 0 (an entry was inserted or removed)`, `log[${index}].seq`);
    }
    if (entry.priorHead !== expectedPrior) {
      return fail('chain_mismatch', `log entry ${index} links to ${entry.priorHead} but the chain's prior head is ${expectedPrior} — the log was rewritten`, `log[${index}].priorHead`);
    }
    const recomputed = entryHead({ seq: entry.seq, kind: entry.kind, recordId: entry.recordId, recordDigest: entry.recordDigest, at: entry.at, priorHead: entry.priorHead });
    if (recomputed !== entry.head) {
      return fail('chain_mismatch', `log entry ${index} head is ${entry.head} but its content digests to ${recomputed} — the entry was tampered with`, `log[${index}].head`);
    }
    expectedPrior = entry.head;

    // The record-digest leg: the entry's record must still exist, unchanged.
    const record = recordOf(state, entry);
    if (record === undefined) {
      return fail('chain_mismatch', `log entry ${index} (${entry.kind}) references record ${entry.recordId} which is absent from the exchange — history was hidden`, `log[${index}].recordId`);
    }
    if (stableDigestJson(record) !== entry.recordDigest) {
      return fail('chain_mismatch', `log entry ${index} pins record ${entry.recordId} at digest ${entry.recordDigest} but the retained record digests to ${stableDigestJson(record)} — the record was rewritten`, `log[${index}].recordDigest`);
    }
  }
  return ok(undefined);
}

/** Resolves the retained record a log entry references (engagement kinds resolve to their matching VERSION). */
function recordOf(state: ProviderExchangeState, entry: ExchangeLogEntry): unknown {
  switch (entry.kind) {
    case 'provider-declared': {
      const declaration = state.declarationHistory.find((candidate) => candidate.declarationId === entry.recordId);
      return declaration;
    }
    case 'request-issued':
      return state.requests.get(entry.recordId as CapabilityRequestId);
    case 'quote-submitted':
      return state.quotes.get(entry.recordId as ProviderQuoteId);
    case 'engagement-opened':
    case 'engagement-withdrawn': {
      const versions = state.engagementVersions.get(entry.recordId as EngagementId);
      if (versions === undefined) return undefined;
      // The matching version: the log pins the exact bytes, so the
      // version whose digest equals the entry's digest is the record.
      return versions.find((version) => stableDigestJson(version) === entry.recordDigest) ?? versions[0];
    }
    case 'deliverable-submitted':
      return state.deliverables.get(entry.recordId as DeliverableId);
    case 'engagement-verified':
      return state.verificationReports.get(entry.recordId as ProviderVerificationReportId);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serialization (byte-deterministic)
// ---------------------------------------------------------------------------

/** The plain serializable view of an exchange (canonical-JSON-ready). */
export interface ProviderExchangeView {
  readonly tenantId: string;
  readonly declarationHistory: readonly ProviderDeclaration[];
  readonly requests: readonly CapabilityRequest[];
  readonly quotes: readonly ProviderQuote[];
  readonly engagements: readonly Engagement[];
  readonly deliverables: readonly Deliverable[];
  readonly verificationReports: readonly ProviderVerificationReport[];
  readonly log: readonly ExchangeLogEntry[];
}

/** The plain serializable view (insertion order — deterministic for the same op sequence). */
export function providerExchangeView(state: ProviderExchangeState): ProviderExchangeView {
  return {
    tenantId: state.tenantId,
    declarationHistory: state.declarationHistory,
    requests: [...state.requests.values()],
    quotes: [...state.quotes.values()],
    engagements: [...state.engagements.values()],
    deliverables: [...state.deliverables.values()],
    verificationReports: [...state.verificationReports.values()],
    log: state.log,
  };
}

/** Serializes the exchange to canonical JSON bytes (the determinism anchor, L9). */
export function serializeProviderExchange(state: ProviderExchangeState): string {
  return canonicalJson(providerExchangeView(state));
}

/** The exchange's stable digest (over the canonical serialization). */
export function providerExchangeDigest(state: ProviderExchangeState): string {
  return stableDigestJson(providerExchangeView(state));
}

// ---------------------------------------------------------------------------
// Operation: register a provider declaration
// ---------------------------------------------------------------------------

/** The L12 gate: every record entering the exchange carries the exchange's tenant. */
function tenantGate(state: ProviderExchangeState, record: { readonly tenantId: string }, path: string): ProviderResult<void> {
  if (record.tenantId !== state.tenantId) {
    return fail('cross_tenant_access', `the record's tenant "${record.tenantId}" is not the exchange's tenant "${state.tenantId}" — a foreign record never crosses the exchange boundary (L12)`, path);
  }
  return ok(undefined);
}

/** The result of an exchange operation: the NEXT state + the minted record + the replay marker. */
export interface ExchangeOperationResult<T> {
  readonly state: ProviderExchangeState;
  readonly record: T;
  /** `true` when the identical operation was already appended (content-addressed idempotence — no new log entry). */
  readonly replayed: boolean;
}

/**
 * Registers (or supersedes) a provider declaration. The FIRST
 * declaration for a provider starts at version 1; every later one must
 * SUPERSDEDE the registry's current declaration (version + 1, chained
 * id — a broken lineage is the typed `invalid_transition`). Replaying
 * a byte-identical declaration is an idempotent replay.
 */
export function registerProviderDeclaration(
  state: ProviderExchangeState,
  draft: unknown,
): ProviderResult<ExchangeOperationResult<ProviderDeclaration>> {
  const validated = validateProviderDeclaration(draft);
  if (!validated.ok) return validated;
  const declaration = validated.value;
  const gate = tenantGate(state, declaration, 'declaration');
  if (!gate.ok) return gate;

  const prior = state.declarations.get(declaration.providerRef);
  if (prior !== undefined) {
    if (prior.declarationId === declaration.declarationId) {
      return ok({ state, record: prior, replayed: true });
    }
    if (declaration.version !== prior.version + 1 || declaration.supersedes !== prior.declarationId) {
      return fail('invalid_transition', `the declaration (version ${declaration.version}) must supersede the registry's current declaration for provider ${declaration.providerRef} (version ${prior.version}, ${prior.declarationId}) — the supersede history is an unbroken chain`, 'declaration');
    }
  } else {
    if (declaration.version !== 1 || declaration.supersedes !== null) {
      return fail('invalid_transition', `the FIRST declaration for provider ${declaration.providerRef} starts at version 1 with supersedes null (got version ${declaration.version}, supersedes ${JSON.stringify(declaration.supersedes)})`, 'declaration');
    }
  }

  const appended = appendEntry(state, 'provider-declared', declaration.declarationId, declaration, declaration.declaredAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: new Map(state.declarations).set(declaration.providerRef, declaration),
    declarationHistory: [...state.declarationHistory, declaration],
    requests: state.requests,
    quotes: state.quotes,
    engagements: state.engagements,
    engagementVersions: state.engagementVersions,
    deliverables: state.deliverables,
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: declaration, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: issue a capability request
// ---------------------------------------------------------------------------

/**
 * Issues a capability request (the engagement request envelope). The
 * request id is content-addressed over the FULL request content, so
 * replaying a byte-identical draft (same instant included) returns the
 * existing record — idempotent, exactly-once in the log.
 */
export function issueCapabilityRequest(
  state: ProviderExchangeState,
  draft: unknown,
): ProviderResult<ExchangeOperationResult<CapabilityRequest>> {
  const validated = validateCapabilityRequest(draft);
  if (!validated.ok) return validated;
  const request = validated.value;
  const gate = tenantGate(state, request, 'request');
  if (!gate.ok) return gate;

  const existing = state.requests.get(request.requestId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }

  const appended = appendEntry(state, 'request-issued', request.requestId, request, request.requestedAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: new Map(state.requests).set(request.requestId, request),
    quotes: state.quotes,
    engagements: state.engagements,
    engagementVersions: state.engagementVersions,
    deliverables: state.deliverables,
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: request, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: submit a provider quote
// ---------------------------------------------------------------------------

/** Guard: `ProviderQuote` is not enough — the quote must be MINTED through this lane's validation. */
function validateProviderQuote(v: unknown): ProviderResult<ProviderQuote> {
  // Collect-all validation with the FULL law: the structural shape (the
  // REAL ProviderTerms guard — deliverableKind vocabulary, verification
  // members, JSON consideration, the estimate instant), the L16a label
  // scan (a label key anywhere in the quote is a typed violation — the
  // minted record must satisfy its own guard), and the L12 scope.
  if (!isRecordLike(v)) return fail('invalid_type', 'the quote must be an object', 'quote');
  const errors: ProviderError[] = [];

  // L16a trip-wire: label FIELD keys anywhere in the quote's JSON tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `quote.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.requestId === undefined) errors.push(missingField('quote.requestId'));
  else if (!isCapabilityRequestId(v.requestId)) errors.push(invalidField('quote.requestId', 'invalid CapabilityRequestId (cpr:<16-hex>)'));
  if (v.providerRef === undefined) errors.push(missingField('quote.providerRef'));
  else if (!isProviderRef(v.providerRef)) errors.push(invalidField('quote.providerRef', 'invalid ProviderRef (identifier pattern; a provider identity, never a qualification)'));
  if (v.offerRef === undefined) errors.push(missingField('quote.offerRef'));
  else if (!isNonEmptyString(v.offerRef)) errors.push(invalidField('quote.offerRef', 'must be a non-empty offer reference'));
  if (v.terms === undefined) errors.push(missingField('quote.terms'));
  else if (!isProviderTerms(v.terms)) errors.push(invalidField('quote.terms', 'failed the ProviderTerms shape (deliverableKind + NON-EMPTY verification contract + JSON consideration + estimatedDeliveryAt)'));
  if (v.quotedAt === undefined) errors.push(missingField('quote.quotedAt'));
  else if (!isTimestampMs(v.quotedAt)) errors.push(invalidField('quote.quotedAt', 'invalid TimestampMs (explicit instant — never a wall clock)'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'tenant_missing', path: 'quote.tenantId', message: 'every quote carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'tenant_missing', path: 'quote.projectId', message: 'every quote carries its owning project (L12)' });

  if (errors.length > 0) return { ok: false, errors };
  const draft = v as unknown as {
    readonly requestId: CapabilityRequestId;
    readonly providerRef: ProviderRef;
    readonly offerRef: string;
    readonly terms: ProviderQuote['terms'];
    readonly quotedAt: TimestampMs;
    readonly tenantId: TenantId;
    readonly projectId: ProviderQuote['projectId'];
  };
  const identityContent = {
    requestId: draft.requestId,
    providerRef: draft.providerRef,
    offerRef: draft.offerRef,
    terms: draft.terms,
    quotedAt: draft.quotedAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  };
  // Clone-then-freeze (the minted record never aliases the caller's draft).
  const quote: ProviderQuote = deepFreeze(deepCloneJson({
    quoteId: `qte:${stableDigestJson(identityContent)}` as ProviderQuoteId,
    ...identityContent,
  } as unknown as JsonValue) as unknown as ProviderQuote);
  if (!isProviderQuote(quote)) {
    return fail('invalid_field', 'the minted quote failed its own structural guard', 'quote');
  }
  return ok(quote);
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Submits a provider quote against an issued request. Enforces the
 * QUOTE-MATCH LAW (the quote answers its request: same deliverable
 * kind, the verification contract accepted VERBATIM, the offer
 * resolving on the provider's CURRENT declaration to the requested
 * capability, and the quote postdating the request — every violation
 * is the typed `quote_mismatch`).
 */
export function submitProviderQuote(
  state: ProviderExchangeState,
  draft: unknown,
): ProviderResult<ExchangeOperationResult<ProviderQuote>> {
  const validated = validateProviderQuote(draft);
  if (!validated.ok) return validated;
  const quote = validated.value;
  const gate = tenantGate(state, quote, 'quote');
  if (!gate.ok) return gate;

  const existing = state.quotes.get(quote.quoteId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }

  const request = state.requests.get(quote.requestId);
  if (request === undefined) {
    return fail('request_unknown', `the quote answers request ${quote.requestId} which is not in this exchange`, 'quote.requestId');
  }
  const declaration = state.declarations.get(quote.providerRef);
  if (declaration === undefined) {
    return fail('provider_unknown', `the quoting provider ${quote.providerRef} has no declaration in this exchange`, 'quote.providerRef');
  }
  const problems = quoteMatchProblems(request, quote, { providerRef: declaration.providerRef, offers: declaration.offers });
  if (problems.length > 0) {
    return fail('quote_mismatch', problems.join('; '), 'quote');
  }

  const appended = appendEntry(state, 'quote-submitted', quote.quoteId, quote, quote.quotedAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: state.requests,
    quotes: new Map(state.quotes).set(quote.quoteId, quote),
    engagements: state.engagements,
    engagementVersions: state.engagementVersions,
    deliverables: state.deliverables,
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: quote, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: open an engagement
// ---------------------------------------------------------------------------

/**
 * Opens the negotiated engagement from an accepted quote. The
 * engagement id is content-addressed over (request, quote, openedAt) —
 * the SAME pair may re-engage at a different instant after a
 * withdrawal (a fresh id), and replaying the same triple is an
 * idempotent replay. The verification contract + deadline are FROZEN
 * from the request; the applicability scope is SNAPSHOTTED from the
 * provider's declared offer (self-contained engagements — L18).
 */
export function openEngagement(
  state: ProviderExchangeState,
  input: { readonly requestId: string; readonly quoteId: string; readonly openedAt: number },
): ProviderResult<ExchangeOperationResult<Engagement>> {
  if (!isTimestampMs(input.openedAt)) {
    return fail('invalid_timestamp', 'the open instant must be a TimestampMs (explicit — never a wall clock)', 'openedAt');
  }
  const request = state.requests.get(input.requestId as CapabilityRequestId);
  if (request === undefined) {
    return fail('request_unknown', `the request ${input.requestId} is not in this exchange`, 'requestId');
  }
  const quote = state.quotes.get(input.quoteId as ProviderQuoteId);
  if (quote === undefined) {
    return fail('quote_unknown', `the quote ${input.quoteId} is not in this exchange`, 'quoteId');
  }
  if (quote.requestId !== request.requestId) {
    return fail('quote_mismatch', `the quote ${quote.quoteId} answers ${quote.requestId}, not ${request.requestId}`, 'quoteId');
  }
  if (quote.tenantId !== state.tenantId) {
    return fail('cross_tenant_access', `the quote's tenant "${quote.tenantId}" is not the exchange's tenant "${state.tenantId}" (L12)`, 'quoteId');
  }
  // Exactly-once FIRST: the same (request, quote, open-instant) triple is
  // the SAME operation — the existing record replays (any status), before
  // any live-engagement law can fire. A re-engagement after withdrawal
  // uses a different open instant (a fresh id, then the live law applies).
  const identityContent = { requestId: request.requestId, quoteId: quote.quoteId, openedAt: input.openedAt };
  const engagementId = `eng:${stableDigestJson(identityContent)}` as EngagementId;
  const existing = state.engagements.get(engagementId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }
  const live = liveEngagementFor(state, request.requestId);
  if (live !== undefined) {
    return fail('engagement_exists', `the request ${request.requestId} already has a LIVE engagement (${live.engagementId}, status ${live.status}) — one live engagement per request`, 'requestId');
  }
  if (input.openedAt < request.requestedAt || input.openedAt < quote.quotedAt) {
    return fail('l4_boundary_violation', `the open instant (${input.openedAt}) predates the request (${request.requestedAt}) or the quote (${quote.quotedAt}) — history never runs backwards`, 'openedAt');
  }
  const declaration = state.declarations.get(quote.providerRef);
  if (declaration === undefined) {
    return fail('provider_unknown', `the engaged provider ${quote.providerRef} has no declaration in this exchange`, 'quoteId');
  }
  const problems = quoteMatchProblems(request, quote, { providerRef: declaration.providerRef, offers: declaration.offers });
  if (problems.length > 0) {
    return fail('quote_mismatch', `the quote no longer matches (the provider's declaration may have superseded away the offer): ${problems.join('; ')}`, 'quoteId');
  }
  const offer = declaration.offers.find((candidate) => candidate.offerRef === quote.offerRef);
  if (offer === undefined) {
    return fail('quote_mismatch', `the offer "${quote.offerRef}" no longer exists on the provider's current declaration`, 'quoteId');
  }

  const engagement: Engagement = deepFreeze({
    engagementId,
    requestId: request.requestId,
    quoteId: quote.quoteId,
    providerRef: quote.providerRef,
    deliverableKind: request.deliverableKind,
    verification: request.verification,
    deadline: request.deadline,
    applicability: offer.applicability,
    status: 'open',
    openedAt: input.openedAt,
    tenantId: request.tenantId,
    projectId: request.projectId,
  }) as unknown as Engagement;

  const appended = appendEntry(state, 'engagement-opened', engagement.engagementId, engagement, engagement.openedAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: state.requests,
    quotes: state.quotes,
    engagements: new Map(state.engagements).set(engagement.engagementId, engagement),
    engagementVersions: new Map(state.engagementVersions).set(engagement.engagementId, [engagement]),
    deliverables: state.deliverables,
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: engagement, replayed: false });
}

/** The request's LIVE engagement (open | delivered), if any. */
export function liveEngagementFor(state: ProviderExchangeState, requestId: CapabilityRequestId): Engagement | undefined {
  for (const engagement of state.engagements.values()) {
    if (engagement.requestId === requestId && (engagement.status === 'open' || engagement.status === 'delivered')) {
      return engagement;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Operation: submit a deliverable
// ---------------------------------------------------------------------------

/**
 * Submits the provider's deliverable against an engagement. Enforces:
 * the engagement exists and is LIVE (open | delivered — anything else
 * is the typed `invalid_transition`), the deliverable kind matches the
 * engagement's (`deliverable_mismatch`), the submission instant
 * postdates the open instant (L4) and PRECEDES-or-equals the frozen
 * deadline (`deadline_exceeded` — refused, never recorded), and the
 * payload digest pins the opaque payload. Content-addressed
 * idempotence: a byte-identical resubmission is a replay.
 */
export function submitDeliverable(
  state: ProviderExchangeState,
  draft: unknown,
): ProviderResult<ExchangeOperationResult<Deliverable>> {
  if (!isRecordLike(draft)) return fail('invalid_type', 'the deliverable must be an object', 'deliverable');
  const engagementId = draft.engagementId;
  const validated = validateDeliverable(draft);
  if (!validated.ok) return validated;
  const deliverable = validated.value;

  const existing = state.deliverables.get(deliverable.deliverableId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }

  const engagement = state.engagements.get((typeof engagementId === 'string' ? engagementId : '') as EngagementId);
  if (engagement === undefined) {
    return fail('engagement_unknown', `the engagement ${JSON.stringify(engagementId)} is not in this exchange`, 'deliverable.engagementId');
  }
  const gate = tenantGate(state, deliverable, 'deliverable');
  if (!gate.ok) return gate;
  if (deliverable.tenantId !== engagement.tenantId || deliverable.projectId !== engagement.projectId) {
    return fail('cross_tenant_access', `the deliverable's scope disagrees with the engagement's (L12)`, 'deliverable');
  }
  if (engagement.status !== 'open' && engagement.status !== 'delivered') {
    return fail('invalid_transition', `the engagement ${engagement.engagementId} is ${engagement.status} (terminal) — only a LIVE engagement (open | delivered) accepts deliverables`, 'deliverable.engagementId');
  }
  if (deliverable.kind !== engagement.deliverableKind) {
    return fail('deliverable_mismatch', `the deliverable kind "${deliverable.kind}" does not match the engagement's frozen kind "${engagement.deliverableKind}"`, 'deliverable.kind');
  }
  if (deliverable.submittedAt < engagement.openedAt) {
    return fail('l4_boundary_violation', `the submission instant (${deliverable.submittedAt}) predates the engagement's open instant (${engagement.openedAt})`, 'deliverable.submittedAt');
  }
  if (engagement.deadline !== null && deliverable.submittedAt > engagement.deadline) {
    return fail('deadline_exceeded', `the submission instant (${deliverable.submittedAt}) is after the engagement's frozen deadline (${engagement.deadline}) — late work is refused, never silently accepted`, 'deliverable.submittedAt');
  }

  // The transition: open -> delivered (delivered -> delivered stays).
  const updated: Engagement = deepFreeze({ ...engagement, status: 'delivered' }) as Engagement;
  const versions = [...(state.engagementVersions.get(engagement.engagementId) ?? []), updated];

  const appended = appendEntry(state, 'deliverable-submitted', deliverable.deliverableId, deliverable, deliverable.submittedAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: state.requests,
    quotes: state.quotes,
    engagements: new Map(state.engagements).set(engagement.engagementId, updated),
    engagementVersions: new Map(state.engagementVersions).set(engagement.engagementId, versions),
    deliverables: new Map(state.deliverables).set(deliverable.deliverableId, deliverable),
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: deliverable, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: verify a deliverable (the platform's typed verdict)
// ---------------------------------------------------------------------------

/** The result of verification: the folded engagement + the minted report. */
export interface VerificationOperationResult {
  readonly engagement: Engagement;
  readonly report: ProviderVerificationReport;
}

/**
 * Verifies a deliverable: the PLATFORM supplies the outcomes (one per
 * contract requirement — EXACT coverage enforced; the verdict is the
 * pure fold, never provider text — L20). The engagement must be
 * `delivered` (an open engagement has nothing to verify —
 * `deliverable_missing`; a terminal one is `invalid_transition`), the
 * deliverable must belong to the engagement, and the verification
 * instant must postdate the submission (L4). Closes the engagement:
 * verified (every outcome passed) or rejected (any failed — retained
 * data; reproducibility records rejected candidates too).
 */
export function verifyDeliverable(
  state: ProviderExchangeState,
  input: {
    readonly engagementId: string;
    readonly deliverableId: string;
    readonly outcomes: readonly VerificationOutcome[];
    readonly verifiedAt: number;
  },
): ProviderResult<ExchangeOperationResult<VerificationOperationResult>> {
  const engagement = state.engagements.get(input.engagementId as EngagementId);
  if (engagement === undefined) {
    return fail('engagement_unknown', `the engagement ${input.engagementId} is not in this exchange`, 'engagementId');
  }
  if (engagement.status === 'open') {
    return fail('deliverable_missing', `the engagement ${engagement.engagementId} is still open — there is no deliverable to verify`, 'engagementId');
  }
  if (engagement.status !== 'delivered') {
    return fail('invalid_transition', `the engagement ${engagement.engagementId} is ${engagement.status} (terminal) — its verification is closed`, 'engagementId');
  }
  const deliverable = state.deliverables.get(input.deliverableId as DeliverableId);
  if (deliverable === undefined) {
    return fail('deliverable_unknown', `the deliverable ${input.deliverableId} is not in this exchange`, 'deliverableId');
  }
  if (deliverable.engagementId !== engagement.engagementId) {
    return fail('deliverable_mismatch', `the deliverable ${deliverable.deliverableId} belongs to engagement ${deliverable.engagementId}, not ${engagement.engagementId}`, 'deliverableId');
  }
  if (deliverable.kind !== engagement.deliverableKind) {
    return fail('deliverable_mismatch', `the deliverable kind "${deliverable.kind}" does not match the engagement's frozen kind "${engagement.deliverableKind}"`, 'deliverableId');
  }
  if (!isTimestampMs(input.verifiedAt)) {
    return fail('invalid_timestamp', 'the verification instant must be a TimestampMs (explicit — never a wall clock)', 'verifiedAt');
  }
  if (input.verifiedAt < deliverable.submittedAt) {
    return fail('l4_boundary_violation', `the verification instant (${input.verifiedAt}) predates the submission (${deliverable.submittedAt})`, 'verifiedAt');
  }

  const minted = mintVerificationReport({
    engagementId: engagement.engagementId,
    deliverableId: deliverable.deliverableId,
    contract: engagement.verification,
    outcomes: input.outcomes,
    verifiedAt: input.verifiedAt,
    tenantId: engagement.tenantId,
    projectId: engagement.projectId,
  });
  if (!minted.ok) return minted;
  const report = minted.value;

  const existingReport = state.verificationReports.get(report.reportId);
  if (existingReport !== undefined) {
    const existingEngagement = state.engagements.get(engagement.engagementId) ?? engagement;
    return ok({ state, record: { engagement: existingEngagement, report: existingReport }, replayed: true });
  }

  const nextStatus: EngagementStatus = report.verdict === 'verified' ? 'verified' : 'rejected';
  const updated: Engagement = deepFreeze({ ...engagement, status: nextStatus }) as Engagement;
  const versions = [...(state.engagementVersions.get(engagement.engagementId) ?? []), updated];

  const appended = appendEntry(state, 'engagement-verified', report.reportId, report, report.verifiedAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: state.requests,
    quotes: state.quotes,
    engagements: new Map(state.engagements).set(engagement.engagementId, updated),
    engagementVersions: new Map(state.engagementVersions).set(engagement.engagementId, versions),
    deliverables: state.deliverables,
    verificationReports: new Map(state.verificationReports).set(report.reportId, report),
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: { engagement: updated, report }, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: withdraw an engagement
// ---------------------------------------------------------------------------

/**
 * Withdraws a LIVE engagement (the platform's exit). Terminal states
 * are `invalid_transition`. The withdrawn version is appended to the
 * engagement's history (the log pins its bytes).
 */
export function withdrawEngagement(
  state: ProviderExchangeState,
  input: { readonly engagementId: string; readonly withdrawnAt: number },
): ProviderResult<ExchangeOperationResult<Engagement>> {
  const engagement = state.engagements.get(input.engagementId as EngagementId);
  if (engagement === undefined) {
    return fail('engagement_unknown', `the engagement ${input.engagementId} is not in this exchange`, 'engagementId');
  }
  if (!isTimestampMs(input.withdrawnAt)) {
    return fail('invalid_timestamp', 'the withdrawal instant must be a TimestampMs (explicit — never a wall clock)', 'withdrawnAt');
  }
  // Content-addressed replay (the idempotence law): the SAME withdrawal
  // instant on the SAME withdrawn engagement is the SAME operation — the
  // retained withdrawn version replays (`replayed: true`, no new log
  // entry), so a retry after a timeout never surfaces a misleading
  // `invalid_transition`. A DIFFERENT instant on the terminal engagement
  // stays the typed refusal.
  if (engagement.status === 'withdrawn') {
    const prior = lastWithdrawalEntry(state, engagement.engagementId);
    if (prior !== undefined && prior.at === input.withdrawnAt && stableDigestJson(engagement) === prior.recordDigest) {
      return ok({ state, record: engagement, replayed: true });
    }
  }
  if (engagement.status !== 'open' && engagement.status !== 'delivered') {
    return fail('invalid_transition', `the engagement ${engagement.engagementId} is ${engagement.status} (terminal) — a closed engagement cannot be withdrawn`, 'engagementId');
  }
  if (input.withdrawnAt < engagement.openedAt) {
    return fail('l4_boundary_violation', `the withdrawal instant (${input.withdrawnAt}) predates the engagement's open instant (${engagement.openedAt})`, 'withdrawnAt');
  }

  const withdrawn: Engagement = deepFreeze({ ...engagement, status: 'withdrawn' }) as Engagement;
  const versions = [...(state.engagementVersions.get(engagement.engagementId) ?? []), withdrawn];

  const appended = appendEntry(state, 'engagement-withdrawn', engagement.engagementId, withdrawn, input.withdrawnAt);
  const next: ProviderExchangeState = deepFreeze({
    tenantId: state.tenantId,
    declarations: state.declarations,
    declarationHistory: state.declarationHistory,
    requests: state.requests,
    quotes: state.quotes,
    engagements: new Map(state.engagements).set(engagement.engagementId, withdrawn),
    engagementVersions: new Map(state.engagementVersions).set(engagement.engagementId, versions),
    deliverables: state.deliverables,
    verificationReports: state.verificationReports,
    log: appended.log,
  }) as unknown as ProviderExchangeState;
  return ok({ state: next, record: withdrawn, replayed: false });
}

/**
 * The engagement's withdrawal log entry (the replay key), if the
 * engagement was ever withdrawn. An engagement is withdrawn at most once
 * (withdrawal is terminal), so at most one such entry exists.
 */
function lastWithdrawalEntry(state: ProviderExchangeState, engagementId: EngagementId): ExchangeLogEntry | undefined {
  for (let index = state.log.length - 1; index >= 0; index--) {
    const entry = state.log[index];
    if (entry.kind === 'engagement-withdrawn' && entry.recordId === engagementId) return entry;
  }
  return undefined;
}
