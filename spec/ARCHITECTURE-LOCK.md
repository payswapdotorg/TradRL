# TradRL Architecture Lock

These are invariants. Violations require an explicit architecture update before dependent work.

L1 — Standalone learning: core runtime, simulation, learning, evaluation, body creation and improvement work without Arena.
L2 — Body/model separation: BodyVersion, CognitiveSubstrate, Possession and AgentInstance are distinct.
L3 — Immutable versioned capability: certified/versioned bodies do not mutate in place.
L4 — Point-in-time truth: observations and derived features obey information availability time.
L5 — Explicit world fidelity: replay, reactive replay and counterfactual/generative simulation are distinct.
L6 — Microstructure fidelity: relevant execution behavior is modeled or explicitly declared as approximate.
L7 — Constraint-aware evaluation: raw PnL is insufficient.
L8 — External execution authority: models cannot bypass hard risk/authorization gates.
L9 — Reproducible lineage: results bind data, code, body, substrate, environment, runtime, evaluator and config.
L10 — Adversarial evaluation: friendly replay alone does not release a strategy.
L11 — Search integrity: optimization history is retained to expose selection effects.
L12 — Tenant isolation: customer data, memory, trajectories and credentials are isolated.
L13 — Provider neutrality: vendor specifics stay in adapters.
L14 — External substrates: data vendors, brokers, exchanges, OMS/EMS and model providers are replaceable.
L15 — Project continuity: goal, research, decision, execution and outcome share lineage.
L16 — Strategic/execution separation: strategic and order-level control have distinct clocks and authority.

L16a — Autonomous capability discovery: organization search may discover missing capabilities and candidate Body/Substrate assignments from evidence; labels alone never establish suitability.
L17 — Human expertise optional: Arena can augment but cannot be required.
L18 — Human artifacts localizable: imported expert artifacts become independently versionable and locally usable.
L19 — No professional qualification inference from trading performance.
L20 — Safety outside prompts: security, risk and authorization are implemented in code/infrastructure.