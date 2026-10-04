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

/** Every DDL record, in application order (the runbook's §neon paste block). */
export const NEON_DDL_RECORDS: readonly { readonly table: string; readonly ddl: string }[] = [
  { table: 'tradrl_knowledge', ddl: KNOWLEDGE_TABLE_DDL },
  { table: 'tradrl_outcomes', ddl: OUTCOME_TABLE_DDL },
  { table: 'tradrl_post_mortems', ddl: POST_MORTEM_TABLE_DDL },
  { table: 'tradrl_projects', ddl: PROJECT_TABLE_DDL },
  { table: 'tradrl_project_events', ddl: PROJECT_EVENT_TABLE_DDL },
];
