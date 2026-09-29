# @tradrl/body-forge — the reference body forge (T017)

**Owning Work Order: T017** · Status: implemented (reference forge only) ·
Contract package: [`packages/skills`](../../packages/skills) ·
Depends on (merged): T003 (agent-body), T011 (trajectory/experiments),
T012 (evaluation/verification), T015 (curriculum/populations — gap records),
T016 (organization + capability registry — CapabilityGap + "new body spec
required" commission records)

The forge is the learning loop's closing half (spec/LEARNING-LOOP.md:
"failure analysis -> **skill extraction -> Body Version -> compatibility ->
shadow** -> outcome -> next experiment"). Failures produce typed gaps
(T016), the compiler emits "new body spec required" records (discovery
level 3: "Create a new Body specification"), the extraction protocol
(packages/skills) turns recorded evidence into evidence-backed skill
records and deltas — and then THIS service mints the candidate Body
Version, gates it on substrate compatibility, and walks the certification
path. Without it, every lesson learned dies in the experiment log.

```
(parent BodyVersion mirror, SkillDelta set, gap records, evidence, seed,
 forgeVersion, targetVersion, createdAt)     packages/skills + mirrors.ts
        │ forgeBodyVersion (PURE — no clock, no randomness, canonical
        │                       delta application order)
        ▼
ForgedCandidate ── kind: 'forged-candidate' (a DISTINCT record kind
        │             until certified; L3)
        ├─ delta manifest: additions/refinements/DECLARED removals
        │  (each removal carries its structured breaking-change record)
        ├─ compatibility gate: the candidate's substrate-compatibility
        │  refs validated against the agent-body mirror shapes — a
        │  failing manifest is NOT minted (compatibility_fail; L2)
        └─ L9 lineage: parent version ref, evidence refs, gap refs,
           forge version, seed, tenant/project (L12)
        │ certifyCandidate(candidate, verdict refs, log)
        ▼
CertificationRecord ── certified | rejected, structured reasons,
        │                append-only (terminal per candidate; L3:
        │                re-certifying a certified candidate is the typed
        │                error certified_version_mutation)
        ▼
certified BodyVersion mirror (a NEW object — mint, never mutate) ──►
shadow trading is a RECORD here (the next loop step), not a service (T030)
```

## The laws this service demonstrates

- **L3 (the existential law)** — a certified BodyVersion NEVER mutates.
  `forgeBodyVersion` always returns a NEW object (the parent composition
  is deep-cloned before the first patch; the parent reference stays
  deeply frozen and unchanged); `certifyCandidate` refuses an
  already-certified candidate with the typed error
  `certified_version_mutation`; the certified version is a fresh mint. A
  forged candidate is a distinct record kind (`kind:
  'forged-candidate'`) until certified.
- **L2 (body != model)** — forged bodies reference substrate
  COMPATIBILITY requirements (opaque refs into agent-body's compatibility
  shapes); never a specific model identity as suitability evidence
  (L16a: measured evidence only). A model upgrade triggers compatibility
  testing, NOT body redevelopment.
- **The breaking-change law** — every capability removal carries its
  declared-breaking-change record; the delta manifest records each
  removal as a structured record; and the declared-vs-actual drop check
  refuses any undeclared capability drop (`undeclared_breaking_change`).
- **The compatibility gate** — minting a BodyVersion whose
  substrate-compatibility refs fail agent-body's compatibility mirror
  shapes is a typed error (`compatibility_fail`).
- **The determinism law** — same (parent, deltas, gaps, evidence, seed,
  forge version, target version, createdAt) -> byte-identical forged
  candidate (deep-equal, twice; golden fixture). No ambient clock, no
  ambient randomness; delta application order is canonical.
- **L11 (search integrity)** — the attempt log is append-only; rejected
  candidates are RETAINED with structured reasons; hiding one
  (`attempt_hidden`) or rewriting history (`attempt_rewrite` — the digest
  chain) are typed errors.
- **L9 (reproducible lineage)** — every candidate, certification and
  attempt carries the full lineage block (parent version ref, evidence
  refs, gap refs, forge version, seed); the run state is
  chain-verified on resume.
- **L12 (tenant isolation)** — every record carries tenant + project;
  scope disagreement is a typed error (`tenant_mismatch`).

## Mirrors, never imports (D-003/D-004)

`src/mirrors.ts` re-declares the agent-body BodyVersion contract family
by STRUCTURE (never by import — the frozen workspace lockfile forbids the
dependency edge). The interop trip wires (src/interop.test.ts) import the
REAL agent-body package and prove BOTH directions: a real
`createBodyVersion` output satisfies `isBodyVersionMirror`, and a FORGED
candidate satisfies agent-body's real `isBodyVersion` guard. The gap
inputs satisfy the organization lane's real `CapabilityGap` shape
(packages/skills mirrors); the extraction evidence satisfies the
trajectory/experiments/evaluation mirrors (packages/skills interop).

The contract package is consumed via a relative source import
(`../../../packages/skills/src/index`) — the same discipline
services/organization-compiler and services/learning document; the Lead
may convert to `workspace:*` at the next serialized lockfile change.

## Non-scope (per the work order)

No organization search (T016), no curriculum/populations (T015), no
evaluation logic (T012 — the forge CITES verdicts, it never computes
acceptance), no actual model calls or training (runtime concern), no
Arena (imported expertise enters as ordinary validated SkillRecords),
no trading-director/researcher bodies (T021-T025), no shadow trading
(T030 — the loop step after certification is a RECORD here), no network.
