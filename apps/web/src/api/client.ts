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
  ProjectGoalWorldSpec,
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
  /**
   * Extra headers carried on EVERY request (FW-MI-A, MI-D1): the boot
   * wiring injects the console session header (`x-tradrl-console-session` —
   * core/session.ts) so the host can scope the project listing/detail to
   * THIS browser session (the demo project + the session's own projects).
   * The credential's authorization header is always applied AFTER these
   * (a caller can never override the token through this seam); per-request
   * headers (the idempotency key) still win over these.
   */
  readonly headers?: Readonly<Record<string, string>>;
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

/** The lifecycle-transition envelope (the erasable-subset law: no inline object types at call-site generic arguments). */
export type ProjectLifecycleTransitionResult = { readonly record: ProjectRecord; readonly effects: readonly unknown[] };

/**
 * The goal-route bundle (the W-23 goal-boot read): the project's goal
 * statement + its constraint set, exactly as the host-owned route
 * serves them — `{ data: { goal: GoalStatement, constraintSet: ConstraintSetStatement } }`,
 * field-for-field the T007 contract shapes (verified against the live
 * production origin; no field mapping needed — the wire IS the
 * contract). Since W-28 (D-8) the route serves the launch's WORLD
 * SPECIFICATION as an ADDITIVE third field (`world:
 * ProjectGoalWorldSpec`) when the project's kickoff job carried a
 * console-launch spec — the optional mirror field below; a pre-W-28
 * backing or a world-less project (the demo scope — its seeded goal
 * genuinely has no world fields) serves no `world`, and the console
 * keeps its teaching empty state. The erasable-subset law: no inline
 * object types at call-site generic arguments.
 */
export interface ProjectGoalBundle {
  /** The project's goal statement (the T007 shape behind the boundary). */
  readonly goal: GoalStatement;
  /** The project's constraint-set statement (the T007 shape behind the boundary). */
  readonly constraintSet: ConstraintSetStatement;
  /** The launch world specification (D-8, W-28 — the ADDITIVE host-route field; absent for world-less projects and pre-W-28 backings). */
  readonly world?: ProjectGoalWorldSpec;
}

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
    /** `GET /v1/projects/:projectId/goal?project=:projectId` — the project's goal + constraint set (the HOST-OWNED W-8 demo-substance route: the seeded records are served from the demo backing BEFORE the boundary wrap, so the frozen SDK surface does not carry it — the mirror extends the family for the console's own read; interop.test.ts documents the amendment. The route serves only projects with a host-seeded goal and answers a typed 404 elsewhere — the caller degrades honestly on it). */
    goal(projectId: string): Promise<ProjectGoalBundle>;
    /** `POST /v1/projects/:projectId/lifecycle` — apply a lifecycle event. */
    transition(projectId: string, event: ProjectLifecycleEvent, at: number, options?: ConsequentialOptions): Promise<ProjectLifecycleTransitionResult>;
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
    /** `GET /v1/jobs?project=<id>` — the project's job list (the HOST-OWNED W-25A demo-substance route: the backing's API-owned job store — the same store the per-id GET reads — served from the deployed backing BEFORE the boundary wrap, so the frozen SDK surface does not carry it; the mirror extends the family for the console's boot read, interop.test.ts documents the amendment). */
    list(project: string): Promise<Page<JobRecord>>;
  };

  /** The execution routes: THE L8 ROUTE (forward an intent — the console REQUESTS; the gateway decides) + the HOST-OWNED blotter read. */
  readonly execution: {
    submitRequest(intent: StrategyIntent, options?: ConsequentialOptions): Promise<GatewaySubmissionRecord>;
    /** `GET /v1/execution/submissions?project=<id>` — the execution blotter (the HOST-OWNED W-8 demo-substance route: served from the seeded demo data BEFORE the boundary wrap, so the frozen SDK surface does not carry it — the mirror extends the family for the console's own read; interop.test.ts documents the amendment). */
    submissions(project: string): Promise<Page<GatewaySubmissionRecord>>;
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
  const extraHeaders = config.headers ?? {};
  const apiVersion = config.apiVersion ?? CURRENT_API_VERSION;
  const maxAttempts = config.retry?.maxAttempts ?? 4;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('createConsoleClient: retry.maxAttempts must be a positive integer');
  const sleep = config.sleep;
  const negotiation: NegotiationState = { negotiated: config.skipNegotiation === true, supported: [apiVersion] };

  /** One raw transport round-trip (no negotiation, no retry — the negotiation path uses it directly). */
  async function rawRequest(method: SdkRequest['method'], path: string, body?: unknown, headers: Record<string, string> = {}): Promise<SdkResponse> {
    return transport({ method, path, headers: { ...extraHeaders, authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body }) });
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
    const meta = parseEnvelope(response) as ApiMeta;
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
      // The cast lives OUTSIDE the template interpolation (the erasable-subset law:
      // no type syntax inside template-literal interpolations — hoist first).
      const causeError = cause as Error;
      throw new ApiConsoleError('unavailable', `the transport failed: ${causeError?.message ?? String(cause)}`, 503);
    }
    if (response.status === 404) {
      const body = response.body as { error?: { code?: string } } | null;
      if (body?.error?.code === 'unsupported_version') {
        // A mid-session upgrade: re-negotiate (the caller replays once).
        negotiation.negotiated = false;
        throw new VersionMismatchError(new ApiConsoleError('unsupported_version', 'the boundary no longer serves this console\'s contract version — re-negotiate', 404));
      }
    }
    return parseEnvelope(response) as T;
  }

  /** One request through negotiation + the bounded retry of the retryable families. */
  async function request<T>(method: SdkRequest['method'], path: string, options: { readonly body?: unknown; readonly idempotencyKey?: string } = {}, attemptCount = 1): Promise<T> {
    await ensureNegotiated();
    try {
      return await attempt(method, path, options) as T;
    } catch (error) {
      const retryable = error instanceof ApiConsoleError && isRetryable(error);
      if (!retryable || attemptCount >= maxAttempts) throw error;
      const delay = error.retryAfterMs ?? 0;
      if (sleep !== undefined && delay > 0) await sleep(delay);
      return request(method, path, options, attemptCount + 1) as Promise<T>;
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
      return request('GET', '/v1/meta') as Promise<ApiMeta>;
    },
    async negotiateVersion(): Promise<ApiMeta> {
      return negotiate();
    },

    projects: {
      async create(input, options) {
        return request('POST', '/v1/projects', { body: input, idempotencyKey: keyFor('projects.create', input, options) }) as Promise<ProjectRecord>;
      },
      async list(params) {
        return request('GET', withQuery('/v1/projects', { cursor: params?.cursor, limit: params?.limit === undefined ? undefined : String(params.limit) })) as Promise<Page<ProjectRecord>>;
      },
      async listAll(params) {
        return collectAll((cursor) => request('GET', withQuery('/v1/projects', { cursor, limit: params?.limit === undefined ? undefined : String(params.limit) })) as Promise<Page<ProjectRecord>>);
      },
      async get(projectId) {
        return request('GET', `/v1/projects/${encodeURIComponent(projectId)}`) as Promise<ProjectRecord>;
      },
      async goal(projectId) {
        // The route is project-scoped twice over: the path carries the
        // project id and the read repeats it as the `?project=` query
        // (the demo-substance routes' own law — the sibling blotter read
        // and the org-status read carry the same query). The served body
        // is the { goal, constraintSet } bundle, already the contract
        // shapes — the envelope parse is the whole translation.
        return request('GET', withQuery(`/v1/projects/${encodeURIComponent(projectId)}/goal`, { project: projectId })) as Promise<ProjectGoalBundle>;
      },
      async transition(projectId, event, at, options) {
        return request('POST', `/v1/projects/${encodeURIComponent(projectId)}/lifecycle`, { body: { event, at }, idempotencyKey: keyFor('projects.lifecycle', [projectId, event, at], options) }) as Promise<ProjectLifecycleTransitionResult>;
      },
      async bindOrganization(projectId, organizationRef, at, options) {
        return request('POST', `/v1/projects/${encodeURIComponent(projectId)}/organization`, { body: { organizationRef, at }, idempotencyKey: keyFor('projects.bindOrganization', [projectId, organizationRef, at], options) }) as Promise<ProjectRecord>;
      },
    },

    knowledge: {
      async query(queryRequest) {
        return request('POST', '/v1/knowledge/query', { body: queryRequest }) as Promise<KnowledgeQueryResponse>;
      },
    },

    outcomes: {
      async query(queryRequest) {
        return request('POST', '/v1/outcomes/query', { body: queryRequest }) as Promise<Page<OutcomeRecord>>;
      },
      async postMortems(queryRequest) {
        return request('POST', '/v1/post-mortems/query', { body: queryRequest }) as Promise<Page<PostMortemRecord>>;
      },
    },

    jobs: {
      async submitResearch(input, options) {
        const body: SubmitJobRequest = { kind: 'research', projectId: input.projectId, spec: input.spec };
        return request('POST', '/v1/jobs/research', { body, idempotencyKey: keyFor('jobs.research', body, options) }) as Promise<JobRecord>;
      },
      async submitLearning(input, options) {
        const body: SubmitJobRequest = { kind: 'learning', projectId: input.projectId, spec: input.spec };
        return request('POST', '/v1/jobs/learning', { body, idempotencyKey: keyFor('jobs.learning', body, options) }) as Promise<JobRecord>;
      },
      async get(jobId) {
        return request('GET', `/v1/jobs/${encodeURIComponent(jobId)}`) as Promise<JobRecord>;
      },
      async list(project) {
        // The exact 2-segment list path (the per-id GET /v1/jobs/:jobId is
        // the frozen route's own 3-segment shape — never a collision): the
        // read carries the project query parameter like every sibling
        // host-owned read, and the envelope unwraps to the Page listing.
        return request('GET', withQuery('/v1/jobs', { project })) as Promise<Page<JobRecord>>;
      },
    },

    execution: {
      async submitRequest(intent, options) {
        const body: ExecutionRequest = { intent };
        return request('POST', '/v1/execution/requests', { body, idempotencyKey: keyFor('execution.requests', intent.intentId, options) }) as Promise<GatewaySubmissionRecord>;
      },
      async submissions(project) {
        return request('GET', withQuery('/v1/execution/submissions', { project })) as Promise<Page<GatewaySubmissionRecord>>;
      },
    },

    organizations: {
      async status(organizationRef, project) {
        return request('GET', withQuery(`/v1/organizations/${encodeURIComponent(organizationRef)}/status`, { project })) as Promise<OrgStatusSnapshot>;
      },
    },
  };
}

/** The replay-marker check over a raw response's headers (the collector's join helper). */
export function isIdempotentReplay(response: { readonly headers: Readonly<Record<string, string>> }): boolean {
  return response.headers[IDEMPOTENT_REPLAY_HEADER] === 'true';
}
