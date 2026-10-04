// @tradrl/web-console — the SDK mirror: the typed client.
//
// THE LAW (Work Order T042): "the twelve UX.md sections ... each
// section fed by the T041 API read routes through structural mirrors
// of the SDK client" and "the launch composes the API's project/goal/
// job submission routes (async submitted->running->complete pattern
// with progress rendering)". This module is the STRUCTURAL MIRROR of
// packages/sdk/src/client.ts — same resource names, same method
// names, same request/response shapes, driven through the INJECTED
// transport (never imported; src/api/interop.test.ts pins the parity
// against the REAL SDK and drives the REAL API service through this
// mirror).
//
// THE INIT LAW (mirrored): the first request negotiates the version
// (GET /v1/meta must list this client's contract version among its
// supportedVersions, else the typed VersionMismatchError).
//
// Spec anchors: R36, R39 (async jobs/progress), R43, L8 (the
// execution route forwards an INTENT — authority is the gateway's
// output, never the console's), L20.

import type { ApiTransport, SdkRequest, SdkResponse } from './transport';
import { ApiConsoleError, VersionMismatchError, errorFromEnvelope, isRetryable } from './errors';
import type {
  ApiMeta,
  ApiVersion,
  ConstraintSetStatement,
  ExecutionRequest,
  GoalStatement,
  GatewaySubmissionRecord,
  JobRecord,
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
  OutcomeQueryRequest,
  OutcomeRecord,
  Page,
  PaginationParams,
  PostMortemQueryRequest,
  PostMortemRecord,
  ProjectLifecycleEvent,
  ProjectRecord,
  StrategyIntent,
  SubmitJobRequest,
  OrgStatusSnapshot,
} from './contracts';
import { CURRENT_API_VERSION, IDEMPOTENT_REPLAY_HEADER } from './contracts';
import { deriveIdempotencyKey } from './idempotency';
import { collectAll } from './pagination';

// ---------------------------------------------------------------------------
// The client configuration
// ---------------------------------------------------------------------------

/** The client construction bundle — everything INJECTED (the transport adapter, the credential, the policies). */
export interface ConsoleClientConfig {
  /** THE injectable transport adapter (the browser fetch binding, or a scripted test transport). */
  readonly transport: ApiTransport;
  /** The credential's bearer token (the host minted it at the secure boundary). */
  readonly token: string;
  /** The contract version this client speaks (default: the newest the mirror knows). */
  readonly apiVersion?: ApiVersion;
  /** The retry policy: the max attempts of the retryable families (default 4, immediate). */
  readonly retry?: { readonly maxAttempts: number };
  /** The host-injected sleep (retry delays; default: immediate — the app binds a timer). */
  readonly sleep?: (delayMs: number) => Promise<void>;
  /** Skip the init-time version negotiation (advanced: pinned-endpoint deployments). */
  readonly skipNegotiation?: boolean;
}

/** The idempotency-aware options of a consequential call. */
export interface ConsequentialOptions {
  /** The caller's idempotency key; auto-derived from the operation when absent. */
  readonly idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** The typed client over the boundary's public plane (the console's mirror of the SDK's resource surface). */
export interface ConsoleClient {
  /** `GET /v1/meta` — the version + capability surface (also the negotiation call). */
  meta(): Promise<ApiMeta>;
  /** Force the version negotiation now (the first request does it lazily otherwise). */
  negotiateVersion(): Promise<ApiMeta>;

  /** The /v1/projects family (the project/goal shapes behind the boundary). */
  readonly projects: {
    /** `POST /v1/projects` — create a project (the control plane compiles first). */
    create(input: { readonly id: string; readonly name: string; readonly executionMode: string; readonly goal: GoalStatement; readonly constraintSet: ConstraintSetStatement; readonly at: number }, options?: ConsequentialOptions): Promise<ProjectRecord>;
    /** `GET /v1/projects` — list the tenant's projects (paginated). */
    list(params?: PaginationParams): Promise<Page<ProjectRecord>>;
    /** Every project, walking the cursors (the bounded collector). */
    listAll(params?: { readonly limit?: number }): Promise<readonly ProjectRecord[]>;
    /** `GET /v1/projects/:projectId` — read one project. */
    get(projectId: string): Promise<ProjectRecord>;
    /** `POST /v1/projects/:projectId/lifecycle` — apply a lifecycle event. */
    transition(projectId: string, event: ProjectLifecycleEvent, at: number, options?: ConsequentialOptions): Promise<{ readonly record: ProjectRecord; readonly effects: readonly unknown[] }>;
    /** `POST /v1/projects/:projectId/organization` — bind an organization. */
    bindOrganization(projectId: string, organizationRef: string, at: number, options?: ConsequentialOptions): Promise<ProjectRecord>;
  };

  /** `POST /v1/knowledge/query` — the firm-knowledge point-in-time READ query. */
  readonly knowledge: {
    query(request: KnowledgeQueryRequest): Promise<KnowledgeQueryResponse>;
  };

  /** The outcome/evidence READ queries. */
  readonly outcomes: {
    /** `POST /v1/outcomes/query`. */
    query(request: OutcomeQueryRequest): Promise<Page<OutcomeRecord>>;
    /** `POST /v1/post-mortems/query`. */
    postMortems(request: PostMortemQueryRequest): Promise<Page<PostMortemRecord>>;
  };

  /** The /v1/jobs family (the async submitted/running/complete pattern). */
  readonly jobs: {
    /** `POST /v1/jobs/research` — submit a research job (idempotency REQUIRED; auto-derived when absent). */
    submitResearch(input: { readonly projectId: string; readonly spec: unknown }, options?: ConsequentialOptions): Promise<JobRecord>;
    /** `POST /v1/jobs/learning` — submit a learning job. */
    submitLearning(input: { readonly projectId: string; readonly spec: unknown }, options?: ConsequentialOptions): Promise<JobRecord>;
    /** `GET /v1/jobs/:jobId` — read one job's record. */
    get(jobId: string): Promise<JobRecord>;
  };

  /** `POST /v1/execution/requests` — THE L8 ROUTE: forward an intent through the execution gateway (the console REQUESTS; the gateway decides). */
  readonly execution: {
    submitRequest(intent: StrategyIntent, options?: ConsequentialOptions): Promise<GatewaySubmissionRecord>;
  };

  /** `GET /v1/organizations/:organizationRef/status?project=...` — the watch read. */
  readonly organizations: {
    status(organizationRef: string, project: string): Promise<OrgStatusSnapshot>;
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The negotiated-version cache. */
interface NegotiationState {
  negotiated: boolean;
  supported: readonly ApiVersion[];
}

/** Build the typed client. The transport adapter is INJECTED; the version negotiates on the first request (or now, via negotiateVersion). */
export function createConsoleClient(config: ConsoleClientConfig): ConsoleClient {
  if (typeof config !== 'object' || config === null) throw new Error('createConsoleClient: a configuration object is required');
  if (typeof config.transport !== 'function') throw new Error('createConsoleClient: the injectable transport adapter is required (the browser fetch binding, or a scripted test transport)');
  if (typeof config.token !== 'string' || config.token.length === 0) throw new Error('createConsoleClient: the credential token is required');
  const transport = config.transport;
  const token = config.token;
  const apiVersion = config.apiVersion ?? CURRENT_API_VERSION;
  const maxAttempts = config.retry?.maxAttempts ?? 4;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('createConsoleClient: retry.maxAttempts must be a positive integer');
  const sleep = config.sleep;
  const negotiation: NegotiationState = { negotiated: config.skipNegotiation === true, supported: [apiVersion] };

  /** One raw transport round-trip (no negotiation, no retry — the negotiation path uses it directly). */
  async function rawRequest(method: SdkRequest['method'], path: string, body?: unknown, headers: Record<string, string> = {}): Promise<SdkResponse> {
    return transport({ method, path, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body }) });
  }

  /** Parse the envelope of a response (success data or the thrown typed error). */
  function parseEnvelope<T>(response: SdkResponse): T {
    const body = response.body as { requestId?: string; data?: T; error?: Record<string, unknown> } | null;
    if (response.status >= 200 && response.status < 300) {
      if (body !== null && typeof body === 'object' && 'data' in body) return (body as { data: T }).data;
      throw new ApiConsoleError('unavailable', `the boundary returned ${response.status} without a success envelope`, response.status);
    }
    if (body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'object' && body.error !== null) {
      throw errorFromEnvelope(body.error as Parameters<typeof errorFromEnvelope>[0], body.requestId);
    }
    throw new ApiConsoleError('unavailable', `the boundary returned ${response.status} without an error envelope`, response.status);
  }

  /** The version negotiation: the served versions must include this client's contract version. */
  async function negotiate(): Promise<ApiMeta> {
    const response = await rawRequest('GET', '/v1/meta');
    const meta = parseEnvelope<ApiMeta>(response);
    if (!Array.isArray(meta.supportedVersions) || !meta.supportedVersions.includes(apiVersion)) {
      throw new VersionMismatchError(new ApiConsoleError(
        'unsupported_version',
        `the boundary serves ${JSON.stringify(meta.supportedVersions)} but this console speaks "${apiVersion}" — upgrade the console or pin a supported version`,
        404,
      ));
    }
    negotiation.negotiated = true;
    negotiation.supported = meta.supportedVersions;
    return meta;
  }

  async function ensureNegotiated(): Promise<void> {
    if (!negotiation.negotiated) await negotiate();
  }

  /** One attempt of a request (the retry classifier: the typed taxonomy + thrown transports). */
  async function attempt<T>(method: SdkRequest['method'], path: string, options: { readonly body?: unknown; readonly idempotencyKey?: string }): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
    let response: SdkResponse;
    try {
      response = await rawRequest(method, path, options.body, headers);
    } catch (cause) {
      // A thrown transport is the unavailable family (retryable per policy — graceful degradation, never a crash).
      throw new ApiConsoleError('unavailable', `the transport failed: ${(cause as Error)?.message ?? String(cause)}`, 503);
    }
    if (response.status === 404) {
      const body = response.body as { error?: { code?: string } } | null;
      if (body?.error?.code === 'unsupported_version') {
        // A mid-session upgrade: re-negotiate (the caller replays once).
        negotiation.negotiated = false;
        throw new VersionMismatchError(new ApiConsoleError('unsupported_version', 'the boundary no longer serves this console\'s contract version — re-negotiate', 404));
      }
    }
    return parseEnvelope<T>(response);
  }

  /** One request through negotiation + the bounded retry of the retryable families. */
  async function request<T>(method: SdkRequest['method'], path: string, options: { readonly body?: unknown; readonly idempotencyKey?: string } = {}, attemptCount = 1): Promise<T> {
    await ensureNegotiated();
    try {
      return await attempt<T>(method, path, options);
    } catch (error) {
      const retryable = error instanceof ApiConsoleError && isRetryable(error);
      if (!retryable || attemptCount >= maxAttempts) throw error;
      const delay = error.retryAfterMs ?? 0;
      if (sleep !== undefined && delay > 0) await sleep(delay);
      return request<T>(method, path, options, attemptCount + 1);
    }
  }

  /** The consequential-call key: the caller's or the deterministic derivation over the operation. */
  function keyFor(operation: string, parts: unknown, options?: ConsequentialOptions): string {
    return options?.idempotencyKey ?? deriveIdempotencyKey([operation, parts]);
  }

  function withQuery(path: string, query: Readonly<Record<string, string | undefined>>): string {
    const entries = Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][];
    if (entries.length === 0) return path;
    return `${path}?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
  }

  return {
    async meta(): Promise<ApiMeta> {
      return request<ApiMeta>('GET', '/v1/meta');
    },
    async negotiateVersion(): Promise<ApiMeta> {
      return negotiate();
    },

    projects: {
      async create(input, options) {
        return request<ProjectRecord>('POST', '/v1/projects', { body: input, idempotencyKey: keyFor('projects.create', input, options) });
      },
      async list(params) {
        return request<Page<ProjectRecord>>('GET', withQuery('/v1/projects', { cursor: params?.cursor, limit: params?.limit === undefined ? undefined : String(params.limit) }));
      },
      async listAll(params) {
        return collectAll((cursor) => request<Page<ProjectRecord>>('GET', withQuery('/v1/projects', { cursor, limit: params?.limit === undefined ? undefined : String(params.limit) })));
      },
      async get(projectId) {
        return request<ProjectRecord>('GET', `/v1/projects/${encodeURIComponent(projectId)}`);
      },
      async transition(projectId, event, at, options) {
        return request<{ record: ProjectRecord; effects: readonly unknown[] }>('POST', `/v1/projects/${encodeURIComponent(projectId)}/lifecycle`, { body: { event, at }, idempotencyKey: keyFor('projects.lifecycle', [projectId, event, at], options) });
      },
      async bindOrganization(projectId, organizationRef, at, options) {
        return request<ProjectRecord>('POST', `/v1/projects/${encodeURIComponent(projectId)}/organization`, { body: { organizationRef, at }, idempotencyKey: keyFor('projects.bindOrganization', [projectId, organizationRef, at], options) });
      },
    },

    knowledge: {
      async query(queryRequest) {
        return request<KnowledgeQueryResponse>('POST', '/v1/knowledge/query', { body: queryRequest });
      },
    },

    outcomes: {
      async query(queryRequest) {
        return request<Page<OutcomeRecord>>('POST', '/v1/outcomes/query', { body: queryRequest });
      },
      async postMortems(queryRequest) {
        return request<Page<PostMortemRecord>>('POST', '/v1/post-mortems/query', { body: queryRequest });
      },
    },

    jobs: {
      async submitResearch(input, options) {
        const body: SubmitJobRequest = { kind: 'research', projectId: input.projectId, spec: input.spec };
        return request<JobRecord>('POST', '/v1/jobs/research', { body, idempotencyKey: keyFor('jobs.research', body, options) });
      },
      async submitLearning(input, options) {
        const body: SubmitJobRequest = { kind: 'learning', projectId: input.projectId, spec: input.spec };
        return request<JobRecord>('POST', '/v1/jobs/learning', { body, idempotencyKey: keyFor('jobs.learning', body, options) });
      },
      async get(jobId) {
        return request<JobRecord>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
      },
    },

    execution: {
      async submitRequest(intent, options) {
        const body: ExecutionRequest = { intent };
        return request<GatewaySubmissionRecord>('POST', '/v1/execution/requests', { body, idempotencyKey: keyFor('execution.requests', intent.intentId, options) });
      },
    },

    organizations: {
      async status(organizationRef, project) {
        return request<OrgStatusSnapshot>('GET', withQuery(`/v1/organizations/${encodeURIComponent(organizationRef)}/status`, { project }));
      },
    },
  };
}

/** The replay-marker check over a raw response's headers (the collector's join helper). */
export function isIdempotentReplay(response: { readonly headers: Readonly<Record<string, string>> }): boolean {
  return response.headers[IDEMPOTENT_REPLAY_HEADER] === 'true';
}
