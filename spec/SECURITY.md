# TradRL Security

## Trust zones
Browser -> control plane -> agent runtime -> isolated research/environment workers -> ingestion -> execution gateway -> credential boundary -> persistent tenant storage.

## Untrusted workloads
User-provided executable or research workloads are untrusted and require isolation.

## Execution
Require identity, authority, hard risk checks, venue permissions, limits, kill switch, rate limits, audit and credential isolation.

## Secrets
Never commit provider credentials. Inject them through secure runtime boundaries.

## Tenant isolation
Isolate data, projects, trajectories, memory, artifacts, credentials and usage. Do not reuse customer data for another tenant by default.

## LLM security
Market/news/retrieved content is untrusted input. Prompts are not security boundaries and untrusted text cannot grant tools.

## Audit
Record who/what acted, BodyVersion, substrate, policy, visible market/data state, risk checks, order, execution and outcome for consequential actions.