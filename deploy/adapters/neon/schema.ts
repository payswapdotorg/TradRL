// deploy/adapters/neon/schema.ts — the durable stores' DDL records (T052).
//
// TABLE-PER-PORT, TENANT-SCOPED ROWS (L12 in shared infrastructure):
// every table's PRIMARY KEY starts with `tenant`; every query the
// stores issue carries `tenant = $1` as the FIRST bind parameter (the
// tests scan every built statement for this predicate — a store query
// without the tenant scope is inexpressible). The domain payload of
// each row is CANONICAL JSON TEXT (`payload`) — the stores round-trip
// records byte-faithfully without re-validating lane-owned internals;
// the extracted columns (`*_id`, `ordinal`, `status`/class refs,
// `as_of`) exist ONLY for scoping, filtering and ordering.
//
// THE RUNBOOK APPLIES THESE (deploy/README.md §neon): paste each
// statement into the Neon SQL editor (or psql) once per database.
// `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` keep the
// application idempotent; no migration tooling (zero-dep law).
//
// Spec anchors: L12 (tenant isolation — the schema is the FIRST line),
// L9 (payload canonicalization), D-033.

/** The knowledge-store table (FirmMemoryPort persistence). */
export const KNOWLEDGE_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_knowledge (
  tenant       TEXT   NOT NULL,
  project      TEXT   NOT NULL,
  knowledge_id TEXT   NOT NULL,
  ordinal      BIGINT NOT NULL,
  status       TEXT   NOT NULL,
  as_of        BIGINT NOT NULL,
  payload      TEXT   NOT NULL,
  PRIMARY KEY (tenant, knowledge_id)
);
CREATE INDEX IF NOT EXISTS tradrl_knowledge_scope
  ON tradrl_knowledge (tenant, project, ordinal);
`;

/** The outcome-store table (OutcomeLearningPort — outcomes). */
export const OUTCOME_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_outcomes (
  tenant        TEXT   NOT NULL,
  project       TEXT   NOT NULL,
  outcome_id    TEXT   NOT NULL,
  ordinal       BIGINT NOT NULL,
  outcome_class TEXT   NOT NULL,
  decision_ref  TEXT   NOT NULL,
  as_of         BIGINT NOT NULL,
  payload       TEXT   NOT NULL,
  PRIMARY KEY (tenant, outcome_id)
);
CREATE INDEX IF NOT EXISTS tradrl_outcomes_scope
  ON tradrl_outcomes (tenant, project, ordinal);
`;

/** The post-mortem-store table (OutcomeLearningPort — post-mortems). */
export const POST_MORTEM_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_post_mortems (
  tenant             TEXT   NOT NULL,
  project            TEXT   NOT NULL,
  post_mortem_id     TEXT   NOT NULL,
  ordinal            BIGINT NOT NULL,
  attribution_class  TEXT   NOT NULL,
  decision_ref       TEXT   NOT NULL,
  as_of              BIGINT NOT NULL,
  payload            TEXT   NOT NULL,
  PRIMARY KEY (tenant, post_mortem_id)
);
CREATE INDEX IF NOT EXISTS tradrl_post_mortems_scope
  ON tradrl_post_mortems (tenant, project, ordinal);
`;

/** The control-plane project-store table (ProjectRecord persistence). */
export const PROJECT_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_projects (
  tenant            TEXT   NOT NULL,
  project_id        TEXT   NOT NULL,
  name              TEXT   NOT NULL,
  lifecycle_status  TEXT   NOT NULL,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  payload           TEXT   NOT NULL,
  PRIMARY KEY (tenant, project_id)
);
CREATE INDEX IF NOT EXISTS tradrl_projects_tenant
  ON tradrl_projects (tenant, created_at);
`;

/** The control-plane lifecycle-event log (append-only — the transition history). */
export const PROJECT_EVENT_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_project_events (
  tenant     TEXT   NOT NULL,
  project_id TEXT   NOT NULL,
  ordinal    BIGINT NOT NULL,
  event      TEXT   NOT NULL,
  at         BIGINT NOT NULL,
  payload    TEXT   NOT NULL,
  PRIMARY KEY (tenant, project_id, ordinal)
);
`;

/**
 * The control-plane goal-set table (W-25D, D-5): one row per project — the
 * create-project input's goal statement + constraint set (the records the
 * W-3e hydration seam persists at createProject time and rehydrates at every
 * cold start, so the REAL control plane can reconstruct the project through
 * its own domain law). The payload is `{ goal, constraintSet }` as canonical
 * JSON; the row is a dependency of the project record (the seam writes the
 * goal set BEFORE the record — a partial write leaves an unread orphan, never
 * a record that cannot reconstruct).
 */
export const GOAL_SET_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_project_goals (
  tenant     TEXT NOT NULL,
  project_id TEXT NOT NULL,
  payload    TEXT NOT NULL,
  PRIMARY KEY (tenant, project_id)
);
`;

/**
 * The durable JOBS table (W-27, D-7): one row per job record of the
 * credential tenant — the durable jobs lane the W-27 write-through persists
 * every non-demo job mutation to (submission + each transition), and the
 * W-27 hydration replays back into each fresh instance's API-owned job
 * store (the frozen service's closure) so the per-id GET /v1/jobs/:jobId
 * and the jobs list serve durable jobs on EVERY instance, not just the one
 * that received the submission. The payload is the boundary's own
 * JobRecord as canonical JSON; the extracted columns exist only for
 * scoping and ordering (the async pattern's read model serves the record's
 * CURRENT state — no point-in-time filter by design, like the org-status
 * snapshots).
 */
export const JOBS_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_jobs (
  tenant       TEXT   NOT NULL,
  project      TEXT   NOT NULL,
  job_id       TEXT   NOT NULL,
  submitted_at BIGINT NOT NULL,
  status       TEXT   NOT NULL,
  payload      TEXT   NOT NULL,
  PRIMARY KEY (tenant, job_id)
);
CREATE INDEX IF NOT EXISTS tradrl_jobs_scope
  ON tradrl_jobs (tenant, project, submitted_at);
`;

/**
 * The PRINCIPALS registry (FW-39-1, the identity wave 1 — the G-11 restart
 * orphan's substrate): one row per named principal of a tenant — the
 * credential store the host-owned auth routes
 * (deploy/vercel/runtime/auth-routes.ts) register against and verify
 * logins by. The `payload` column carries the canonical-JSON credential
 * record `{ principalId, name, salt, verifier, createdAt }` — the verifier
 * is the SALTED KDF digest of the passphrase (Node platform crypto —
 * scrypt; the zero-dep law), NEVER the passphrase itself; the salt +
 * verifier never cross any wire the routes serve. The UNIQUE index on
 * (tenant, name) enforces one name per tenant at the store layer (the
 * route's check-then-insert is the common path; the index is the backstop
 * against the concurrent-register race). PRIMARY KEY leads with `tenant`
 * (L12 — the schema is the first line).
 */
export const AUTH_PRINCIPALS_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_auth_principals (
  tenant       TEXT   NOT NULL,
  principal_id TEXT   NOT NULL,
  name         TEXT   NOT NULL,
  created_at   BIGINT NOT NULL,
  payload      TEXT   NOT NULL,
  PRIMARY KEY (tenant, principal_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tradrl_auth_principals_name
  ON tradrl_auth_principals (tenant, name);
`;

/**
 * The principal-token REVOCATION list (FW-39-1): one row per REVOKED
 * token id (jti) — logout writes it; every token-bearing request (whoami,
 * logout, adopt, the principal marker fold, the create-stamp) checks it.
 * A revocation is durable truth: it survives cold starts and rehydrates
 * on every instance (the revocation check reads the durable table, never
 * an in-memory view — a logged-out token stays dead deployment-wide).
 */
export const AUTH_REVOCATIONS_TABLE_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS tradrl_auth_revocations (
  tenant       TEXT   NOT NULL,
  principal_id TEXT   NOT NULL,
  token_id     TEXT   NOT NULL,
  revoked_at   BIGINT NOT NULL,
  payload      TEXT   NOT NULL,
  PRIMARY KEY (tenant, token_id)
);
`;

/** Every DDL record, in application order (the runbook's §neon paste block). */
export const NEON_DDL_RECORDS: readonly { readonly table: string; readonly ddl: string }[] = [
  { table: 'tradrl_knowledge', ddl: KNOWLEDGE_TABLE_DDL },
  { table: 'tradrl_outcomes', ddl: OUTCOME_TABLE_DDL },
  { table: 'tradrl_post_mortems', ddl: POST_MORTEM_TABLE_DDL },
  { table: 'tradrl_projects', ddl: PROJECT_TABLE_DDL },
  { table: 'tradrl_project_events', ddl: PROJECT_EVENT_TABLE_DDL },
  { table: 'tradrl_project_goals', ddl: GOAL_SET_TABLE_DDL },
  { table: 'tradrl_jobs', ddl: JOBS_TABLE_DDL },
  { table: 'tradrl_auth_principals', ddl: AUTH_PRINCIPALS_TABLE_DDL },
  { table: 'tradrl_auth_revocations', ddl: AUTH_REVOCATIONS_TABLE_DDL },
];
