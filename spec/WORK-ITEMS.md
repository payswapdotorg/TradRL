# TradRL Work Orders

One Work Order = one branch = one PR = one worker. Maximum active workers = 3.

## Foundation

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T001 | Repository foundation, governance, CI, test harness, package boundaries | — | root, apps/, packages/, services/, adapters/, scripts/, .github/ |
| T002 | Canonical domain contracts | T001 | packages/domain-core/, contracts/domain/ |
| T003 | Agent Body/substrate/possession/instance | T001 | packages/agent-body/, contracts/agent/ |
| T004 | Market event/data/time contracts | T001 | packages/market-protocol/, packages/time-engine/, contracts/market/ |

## Environment/control plane

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T005 | Environment protocol/runner | T002,T004 | packages/environment-protocol/, services/environment-runner/, contracts/environment/ |
| T006 | Agent OS kernel/runtime | T003 | packages/agent-os/, services/agent-runtime/ |
| T007 | Goal/constraint/project control plane | T002,T003 | packages/control-domain/, services/control-plane/ |
| T008 | Data ingestion/event store/provenance | T004 | services/data-ingestion/, services/event-store/, packages/provenance/ |
| T009 | Historical replay World | T004,T005 | packages/market-world/, services/market-world/replay/ |
| T010 | Exchange/order-book simulation | T004,T009 | packages/exchange-sim/, services/market-world/exchange/ |

## Learning substrate

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T011 | Trajectory/experiment protocol | T002,T005,T006 | packages/trajectory/, packages/experiments/, contracts/learning/ |
| T012 | Evaluation/verification | T002,T011 | packages/evaluation/, packages/verification/, contracts/evaluation/ |
| T013 | RL interface/trainer bridge | T009,T010,T011,T012 | packages/rl-protocol/, services/learning/rl/ |
| T014 | Distributed episode generation | T005,T011,T013 | services/learning/compute/, packages/compute/ |
| T015 | Curriculum/self-play/adversarial populations | T011,T012,T013,T014 | services/learning/curriculum/, services/learning/populations/ |
| T016 | Organization compiler/team search | T006,T007,T012 | packages/organization/, services/organization-compiler/ |
| T017 | Skill extraction/body forge | T003,T011,T012,T015,T016 | packages/skills/, services/body-forge/ |

## Finance capabilities

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T018 | Portfolio strategy domain | T007,T010,T012,T013,T016 | packages/trading-strategy/, services/strategy/ |
| T019 | Execution policy/simulation | T010,T013,T018 | packages/execution-policy/, services/execution-sim/ |
| T020 | Risk policy engine | T007,T019 | packages/risk/, services/risk/ |
| T021 | Sentiment/event research body | T003,T008,T012,T017 | bodies/sentiment-researcher/, services/research/sentiment/ |
| T022 | Market-regime research body | T003,T009,T012,T017 | bodies/regime-researcher/, services/research/regime/ |
| T023 | Fundamental/cross-market research | T003,T008,T012,T017 | bodies/fundamental-researcher/, bodies/cross-market-researcher/ |
| T024 | Trading Director body | T003,T016,T017,T018,T021,T022,T023 | bodies/trading-director/ |
| T025 | Execution body | T003,T017,T019,T020 | bodies/execution/ |

## Time Machine/counterfactual

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T026 | Point-in-time knowledge firewall | T004,T008,T009 | packages/time-engine/, services/knowledge-firewall/ |
| T027 | Reactive market simulation | T009,T010,T013,T015,T026 | services/market-world/reactive/ |
| T028 | Generative/counterfactual population | T010,T015,T026 | services/market-world/generative/, research/market-generation/ |
| T029 | Rolling near-real-time Time Machine | T008,T026 | services/time-machine/ |
| T030 | Shadow trading | T019,T020,T027,T029 | services/shadow-trading/ |

## Learning from reality

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T031 | Backtest-overfitting/search integrity | T011,T012,T028 | research/evaluation-integrity/, packages/search-lineage/ |
| T032 | Walk-forward/regime/holdout suite | T009,T011,T012,T028,T031 | research/benchmarks/, packages/evaluation-splits/ |
| T033 | Outcome/post-mortem learning | T011,T030 | services/outcome-learning/, packages/outcomes/ |
| T034 | Firm Brain | T007,T011,T033 | packages/firm-memory/, services/firm-memory/ |
| T035 | Continuous autonomous improvement | T015,T017,T030,T031,T033,T034 | services/autonomous-learning/ |

## Integrations/production

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T036 | Provider-neutral adapter SDK | T004,T008 | packages/provider-sdk/ |
| T037 | Binance/Coinbase adapters | T036 | adapters/binance/, adapters/coinbase/ |
| T038 | Equities/index/news/alternative-data adapters | T036 | adapters/equities/, adapters/news/, adapters/alternative-data/ |
| T039 | Broker/OMS/EMS adapters | T019,T036 | adapters/brokers/, adapters/oms-ems/ |
| T040 | Execution gateway/policy enforcement | T019,T020,T039 | services/execution-gateway/, packages/execution-authority/ |
| T041 | Public/private API/SDK | T007,T034,T040 | packages/sdk/, services/api/ |
| T042 | Web project console | T041 | apps/web/ |
| T043 | Observability/audit/operations | T040 | packages/observability/, services/observability/, services/audit/ |
| T044 | Security/tenancy/secrets/isolation | T005,T040 | packages/security/, services/security/, tests/security/ |

## Optional human expertise / launch

| ID | Scope | Depends | Write surface |
|---|---|---|---|
| T045 | Capability-provider interface | T017,T041 | packages/capability-provider/ |
| T046 | Arena provider adapter | T041,T045 | adapters/arena/ |
| T047 | Commercial capability marketplace | T017,T034,T041 | services/marketplace/, packages/entitlements/ |
| T048 | Reference end-to-end trading slice | T018,T024,T025,T027,T030,T037,T038,T040 | examples/end-to-end-trading/, tests/end-to-end-trading/ |
| T049 | Benchmark/evidence publication | T028,T032,T035,T048 | benchmarks/, research/public-evaluation/ |
| T050 | Production reliability/performance/release | T035,T042,T043,T044,T047,T048,T049 | deploy/, ops/, docs/release/, tests/performance/ |

## Universal acceptance
- scope/write-surface compliance;
- positive and negative tests;
- contract tests where applicable;
- reproducible evidence;
- security checks;
- exact base/head SHA;
- limitations recorded;
- no unresolved critical review finding.
