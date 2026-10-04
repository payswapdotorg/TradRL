// deploy/adapters/apify/jobs.ts — the data-ingestion job
// configuration: SCHEDULES as typed records + the jobs' push through
// the EXISTING T037/T038 adapter contracts (T052, W-3c).
//
// NO NEW DOMAIN SEMANTICS (the Work Order's law): the job
// configuration MIRRORS the news/alternative-data adapters'
// SubscriptionSpec shape (channel + the raw pass-through request +
// venue + instrument + asset_class + mapping_table_id — the exact
// fields of adapters/news/src/contract/session.ts) and the raw wire
// SUBSCRIBE frame the adapters document ({action, stream, symbol}) —
// STRUCTURAL MIRRORS, never imports (the contract test pins them
// test-only). An Apify actor run's input carries that frame; the run's
// dataset items flow back through the adapter sessions' documented
// pass-through — the adapters are never edited.
//
// SCHEDULES: typed records (kind + actor + the subscription spec +
// cron) — deterministic (identical schedule -> identical bytes).
// TENANT SCOPING (L12): every job record + schedule carries the
// server-side tenant; the job store's reads are tenant-scoped. R46:
// every provider failure is the typed failure — never a throw.
//
// Spec anchors: D-033, ADAPTERS.md (provider-neutral canonical
// contracts — the Apify feed is a substrate), L9, L12, R46.

import { getActorRunStatus, startActorRun, type ApifyConfig, type ApifyRun } from './client';
import { canonicalJson, isNonEmptyString, isRecord, type FetchLike, type InstantSourceMirror, type JsonValue, type StoreResult } from '../shared';

// ---------------------------------------------------------------------------
// The subscription-spec mirror (T037/T038's documented shape — structural)
// ---------------------------------------------------------------------------

/** The canonical asset classes (the adapters' closed vocabulary — mirror). */
export type AssetClassMirror = 'crypto' | 'equity' | 'index' | 'fx' | 'commodity';

/** The raw channel id on the provider's wire (mirror of the adapters' channel strings). */
export type RawChannelMirror = string;

/**
 * The subscription spec MIRROR (field-for-field the adapters' own
 * SubscriptionSpec — the contract test pins assignability against the
 * REAL news adapter's type, test-only).
 */
export interface SubscriptionSpecMirror {
  /** The raw channel to subscribe on (must be declared in the source's capabilities). */
  readonly channel: RawChannelMirror;
  /** The raw subscription request payload — passed through the transport UNMANGLED. */
  readonly request: Readonly<Record<string, string>>;
  /** The canonical venue the stream belongs to. */
  readonly venue: string;
  /** The canonical instrument the stream belongs to. */
  readonly instrument: string;
  /** The canonical asset class of the stream. */
  readonly asset_class: AssetClassMirror;
  /** The declared mapping table translating this channel's messages. */
  readonly mapping_table_id: string;
}

// ---------------------------------------------------------------------------
// The job + schedule records (typed, deterministic)
// ---------------------------------------------------------------------------

/** The ingestion feed kinds (the free-tier D-033 set). */
export const FEED_KINDS = ['market', 'news', 'alternative'] as const;

/** One ingestion feed kind. */
export type FeedKind = (typeof FEED_KINDS)[number];

/** One ingestion job (an actor run pushed for one tenant's feed). */
export interface IngestionJob {
  readonly jobId: string;
  readonly tenant: string;
  readonly feed: FeedKind;
  readonly actorId: string;
  readonly spec: SubscriptionSpecMirror;
  readonly runId?: string;
  readonly status: 'submitted' | 'running' | 'succeeded' | 'failed';
  readonly at: number;
}

/** One schedule (a typed record: which actor, which spec, which cadence). */
export interface IngestionSchedule {
  readonly scheduleId: string;
  readonly tenant: string;
  readonly feed: FeedKind;
  readonly actorId: string;
  readonly spec: SubscriptionSpecMirror;
  /** The cron expression (UTC — the schedule's cadence). */
  readonly cron: string;
  /** 'enabled' | 'paused' (schedules as typed records — no free-form flags). */
  readonly state: 'enabled' | 'paused';
}

/** Build one schedule record (pure — deterministic: identical inputs -> identical bytes). */
export function buildSchedule(input: {
  readonly tenant: string;
  readonly feed: FeedKind;
  readonly actorId: string;
  readonly spec: SubscriptionSpecMirror;
  readonly cron: string;
  readonly state?: 'enabled' | 'paused';
}): StoreResult<IngestionSchedule> {
  if (!isNonEmptyString(input.tenant) || !isNonEmptyString(input.actorId) || !isNonEmptyString(input.cron)) {
    return { ok: false, error: { code: 'invalid_schedule', message: 'the schedule requires tenant/actorId/cron' } };
  }
  const spec = validateSpec(input.spec);
  if (!spec.ok) return spec;
  const identity = canonicalJson([input.tenant, input.feed, input.actorId, input.spec, input.cron] as unknown as JsonValue);
  const digest = [...identity].reduce((hash, char) => {
    hash ^= char.charCodeAt(0);
    return Math.imul(hash, 0x01000193);
  }, 0x811c9dc5);
  return {
    ok: true,
    value: {
      scheduleId: `sch:${(digest >>> 0).toString(16).padStart(8, '0')}`,
      tenant: input.tenant,
      feed: input.feed,
      actorId: input.actorId,
      spec: input.spec,
      cron: input.cron,
      state: input.state ?? 'enabled',
    },
  };
}

function validateSpec(spec: unknown): StoreResult<SubscriptionSpecMirror> {
  if (!isRecord(spec)) return { ok: false, error: { code: 'invalid_schedule', message: 'the subscription spec must be an object' } };
  if (!isNonEmptyString(spec.channel) || !isNonEmptyString(spec.venue) || !isNonEmptyString(spec.instrument) || !isNonEmptyString(spec.mapping_table_id)) {
    return { ok: false, error: { code: 'invalid_schedule', message: 'the subscription spec requires channel/venue/instrument/mapping_table_id' } };
  }
  if (!isRecord(spec.request)) return { ok: false, error: { code: 'invalid_schedule', message: 'the subscription spec requires the raw request object (pass-through)' } };
  if (typeof spec.asset_class !== 'string') return { ok: false, error: { code: 'invalid_schedule', message: 'the subscription spec requires asset_class' } };
  return { ok: true, value: spec as unknown as SubscriptionSpecMirror };
}

// ---------------------------------------------------------------------------
// The job runner (the push through the actor-run REST surface)
// ---------------------------------------------------------------------------

/** The actor-run input for one feed (the spec's raw frame rides `input` — the adapters' pass-through). */
export function actorRunInputOf(spec: SubscriptionSpecMirror): Readonly<Record<string, unknown>> {
  return {
    // The raw SUBSCRIBE frame passes through UNMANGLED (the adapter's documented neutrality contract).
    subscribe: { ...spec.request },
    channel: spec.channel,
    venue: spec.venue,
    instrument: spec.instrument,
    asset_class: spec.asset_class,
    mapping_table_id: spec.mapping_table_id,
  };
}

/** The tenant-scoped ingestion job runner. */
export class ApifyIngestionJobs {
  private readonly config: ApifyConfig;
  private readonly fetchLike: FetchLike;
  private readonly instants: InstantSourceMirror;
  private readonly jobsByTenant = new Map<string, IngestionJob[]>();

  constructor(deps: { readonly config: ApifyConfig; readonly fetchLike?: FetchLike; readonly instants: InstantSourceMirror }) {
    this.config = deps.config;
    this.fetchLike = deps.fetchLike ?? ((globalThis as { fetch?: unknown }).fetch instanceof Function ? ((globalThis as { fetch: unknown }).fetch as FetchLike) : (async () => {
      throw new Error('no fetch implementation is available in this runtime');
    }) as FetchLike);
    this.instants = deps.instants;
  }

  /**
   * Submit one ingestion job for one tenant (an actor run over the
   * spec's raw frame). The job record is appended to the TENANT'S job
   * list — never another tenant's (L12).
   */
  async submitJob(scopeTenant: string, feed: FeedKind, actorId: string, spec: SubscriptionSpecMirror): Promise<StoreResult<IngestionJob>> {
    const validated = validateSpec(spec);
    if (!validated.ok) return validated;
    if (!isNonEmptyString(scopeTenant) || !isNonEmptyString(actorId)) {
      return { ok: false, error: { code: 'invalid_job', message: 'the job requires tenant/actorId' } };
    }
    const job: IngestionJob = {
      jobId: `job:${canonicalJson([scopeTenant, feed, actorId, spec] as unknown as JsonValue).slice(0, 0)}${this.instants.next()}`,
      tenant: scopeTenant,
      feed,
      actorId,
      spec,
      status: 'submitted',
      at: this.instants.next(),
    };
    const run = await startActorRun(this.config, actorId, actorRunInputOf(spec), this.fetchLike);
    const recorded: IngestionJob = run.ok ? { ...job, runId: run.value.id, status: run.value.status === 'SUCCEEDED' ? 'succeeded' : run.value.status === 'FAILED' || run.value.status === 'ABORTED' || run.value.status === 'TIMED_OUT' ? 'failed' : 'running' } : job;
    const jobs = this.jobsByTenant.get(scopeTenant) ?? [];
    jobs.push(recorded);
    this.jobsByTenant.set(scopeTenant, jobs);
    if (!run.ok) return { ok: false, error: { code: `apify_${run.error.code}`, message: run.error.message } };
    return { ok: true, value: recorded };
  }

  /** Refresh one job's run status (the run id is the provider's handle). */
  async refreshJob(scopeTenant: string, jobId: string): Promise<StoreResult<IngestionJob>> {
    const job = this.jobOf(scopeTenant, jobId);
    if (!job.ok) return job;
    if (job.value.runId === undefined) return job;
    const run: ApifyResultLike = await getActorRunStatus(this.config, job.value.runId, this.fetchLike);
    if (!run.ok) {
      // R46: a failed refresh leaves the job record intact (degraded, never a crash).
      return { ok: true, value: job.value };
    }
    const status = run.value.status === 'SUCCEEDED' ? 'succeeded' : run.value.status === 'FAILED' || run.value.status === 'ABORTED' || run.value.status === 'TIMED_OUT' ? 'failed' : 'running';
    const updated: IngestionJob = { ...job.value, status };
    const jobs = this.jobsByTenant.get(scopeTenant) ?? [];
    const index = jobs.findIndex((entry) => entry.jobId === jobId);
    if (index >= 0) jobs[index] = updated;
    return { ok: true, value: updated };
  }

  /** One tenant's jobs, in submission order (L12 scoping on the read side). */
  jobsOf(tenant: string): readonly IngestionJob[] {
    return this.jobsByTenant.get(tenant) ?? [];
  }

  private jobOf(tenant: string, jobId: string): StoreResult<IngestionJob> {
    const job = this.jobsOf(tenant).find((entry) => entry.jobId === jobId);
    if (job === undefined) {
      return { ok: false, error: { code: 'job_not_found', message: `no ingestion job ${jobId} is visible to this tenant` } };
    }
    return { ok: true, value: job };
  }
}

type ApifyResultLike = { readonly ok: true; readonly value: ApifyRun } | { readonly ok: false };
