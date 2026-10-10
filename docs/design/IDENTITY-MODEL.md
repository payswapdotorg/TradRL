# The Identity Model — G-11 restart orphan access (FW-38-DESIGN-G11)

Status: DESIGN (a document deliverable — no product code changes ride this order).
Branch: `work/FW-38-design-identity`. Base: main @ 90aa0d1.
Register anchor: Round G register **G-11** (`docs/release/ROUND-G-REPORT.md` §4), the hard
deployment blocker L3 documented as **"durable DATA / ephemeral SESSION / absent IDENTITY /
orphaned access."**

---

## 1. The problem statement

### 1.1 The posture, precisely

Round F (P2F-L3, the D2 restart test) established the three-word posture:
**durable DATA / ephemeral SESSION / absent IDENTITY**. Round G (P2G-L3, the D2
re-documentation, re-tested at both boundaries) sharpened it to four words:
**durable DATA / ephemeral SESSION / absent IDENTITY / ORPHANED access**.

The exact loss model, measured twice by the same architect persona:

| Event | Theme | Onboarding | Scope | Switcher membership | Server data |
|---|---|---|---|---|---|
| Page RELOAD (same browser context) | preserved | preserved | preserved | preserved | durable |
| Full browser restart / fresh context / cleared site data / new machine / rotated profile | reset to light | re-shows | reset to demo | **demo seed ONLY** | durable, export-verifiable — **unreachable** |

Round G's decisive change: FW-37-B's hard tenancy wall
(`apps/web/src/render/shell.ts` `switcherOptions` — the FW-34-B "all desks in this
workspace" expander REMOVED, the widening parameter deleted at the module level)
removed the cross-session recovery list with **no replacement recovery path**. The
wall was correct for tenancy (the Round F information-barrier violation — L3 read
another session's desk and a 49,999,992-notional fill with zero authentication —
is now impossible on every surface) but it cuts both ways: **it hides the owner's
own prior-session desks as thoroughly as strangers'.** Post-restart, the user's
own launched desks are unreachable by every in-app path — palette searches for the
desk name and project id return "No matches"; Oversight renders demo-only; there
is no login, no re-attach, and no import-from-export surface. The durable
server-side data (projects, event chains, blotters — L3's pre-restart exports
verified perfectly from disk after the restart) becomes unreachable by any UI
path.

The user-facing consequence, in the architect's own words: "any user who clears
their browser, changes machines, or rotates a profile loses their workspace."

### 1.2 Why this is a DEPLOYMENT blocker and not a polish item

L3's ops-risk committee moved the product from "fail on information-barrier
grounds alone" (Round F) to **"conditional — pending an enterprise identity model
with durable session re-attachment"** (Round G). The committee's stated grounds,
after the wall shipped:

- CREDIT: the Round F information-barrier violation is closed at the product
  level, verified across four surfaces (switcher, palette, Oversight, export
  cohort).
- FAIL GROUND REMAINS: no SSO/AuthN, no roles or entitlements, no audit of WHO
  did WHAT across the estate, and the F-9 interaction means the isolation wall
  also locks out the OWNER on restart. "An information-barrier regime needs the
  wall to be a policy enforced against named principals with durable identity."

Anonymous-session isolation is not an identity model. The pilot path is NOT
blocked (9/9 personas would-pilot today, one walled desk per session — that shape
works); the ENTERPRISE rollout is blocked, and G-11 is the register's named
blocker for it. This design is the decision the Round G report asked for before
any code: "a login/re-attach surface vs durable local identity vs import."

### 1.3 A copy-promise that is currently broken (the honesty rider)

`apps/web/src/render/shell.ts:488` — the Theme row promises "your choice is
remembered for future visits" — and the Project switcher row (shell.ts:534) says
the same. A reload honors both; a browser-context loss does not. Whatever the
identity decision, the product's own law (no uncomputed claims; no silent walls)
requires the copy to become true or change. The identity model is the only path
that makes it TRUE for the loss cases; the alternative is a copy change, which
this design also permits (§5, wave 2).

---

## 2. How identity works today (the code, cited)

The deployed console is **anonymous by design**: one developer credential baked
into the public shell, one shared tenant. The layers:

1. **The credential/tenant layer (host).** `deploy/.env.example`:
   `TRADRL_API_DEVELOPER_TOKEN` (mirrored into the shell as
   `TRADRL_CONSOLE_TOKEN`), `TRADRL_API_DEVELOPER_TENANT`, and
   `TRADRL_API_DEVELOPER_PRINCIPAL=public-console`. Every /v1 request wraps into
   the frozen T041 pipeline (authn → authz → tenant-context injection → rate
   limit → validation → handler → audit — L20) in `deploy/vercel/api/router.ts`;
   the tenant always comes from the authorization, never a request value (L12 by
   construction). **Every anonymous session is the same principal
   (`public-console`) in the same tenant.**

2. **The session layer (client).** `apps/web/src/core/session.ts`: a 32-hex id
   minted on first load, persisted in localStorage under
   `tradrl_console_session`, sent as the `x-tradrl-console-session` header on
   every console API call. The module's own disclosure: **"the session id is a
   CORRELATION device, not a credential"** — public-shape data in the browser
   trust zone (spec/SECURITY.md; the same zone as `tradrl_theme` /
   `tradrl_onboarded` / `tradrl_scope_project` / `tradrl_console_posture`,
   `apps/web/src/core/posture.ts`).

3. **The ownership layer (host).** `deploy/vercel/api/router.ts`
   (`createdProjectOf`) stamps every successful create-project response-side with
   the owning session — the demo arm's per-instance map; the durable arm's
   additive `ownerSession` field on the goal-set row payload
   (`deploy/adapters/neon/stores.ts`, `ownerSessionOf`). The session-scoped
   routes (`deploy/vercel/runtime/session-routes.ts`, served BEFORE the boundary
   wrap with their own developer-credential authn — the W-8 host-route
   precedent) serve: under DEMO, the demo project + the session's own projects
   (cold start resets ownership with the world, honestly under SIMULATED); under
   DURABLE, **the tenant's whole registry lists** (FW-31-B — the fresh
   session-listing JOIN; a session id must not orphan durable desks), every item
   carrying the additive `consoleSessionScope` marker (`'session-owned'` /
   `'tenant-available'`); the `ownerSession` identity itself NEVER crosses the
   wire. Direct reads of a foreign project under DEMO are the typed 404
   (unknown-vs-foreign indistinguishable).

4. **The wall (client).** `apps/web/src/core/tenant.ts`
   (`isSessionOwnDesk` — `consoleSessionScope !== 'tenant-available'`, with the
   honest unmarked fallback) and `sessionOwnDesksOf`. The Settings switcher
   (`render/shell.ts` `switcherOptions`), the palette (`core/palette.ts`) and
   the Oversight fold (`core/oversight.ts`) all ride this fold: **the session's
   own desks + the shared demo seed, nothing else, no expander** (FW-37-B).

5. **The export (client).** `apps/web/src/core/export-flow.ts` +
   `core/workspace.ts`: `tradrl-workspace-export`, formatVersion 2, scope
   `{projectId, tenantId}`, a self-describing manifest (counts, `included`,
   `chainScopeNote`, `simulatedFlagRule`), the full chain rules published
   in-file — digest `= sha256Hex(canonicalJson({seq,tenantId,projectId,payload}))`
   (CHAIN_DIGEST_RULE, `core/digest.ts`) — per-record `simulated` flags placed
   OUTSIDE the digest input, `launchWorld`, `workspace.state`,
   `decisions.watch/gateway`, `readState`. E-9's law: the export never composes
   an unread workspace; every failure is a toast, never a no-op. A verify
   surface exists in Settings ("Verify an export file"); **no import surface
   exists.**

The gap, in one sentence: ownership is stamped by a **dying correlation device**
(the session id in a browser's localStorage), the wall correctly hides
everything else, and no re-attachment mechanism exists — so the durable data
outlives the only handle that can reach it.

---

## 3. The option space

Effort scale (this codebase's wave discipline — one wave = one worker, one
branch, one PR, one frozen surface; e.g. FW-37-A was +885/-89 on deploy/vercel,
FW-37-B +1696/-253 on apps/web):

- **S** = one wave, one surface (≤ ~15 files).
- **M** = 2–4 coordinated waves across deploy/vercel + apps/web.
- **L** = a multi-round program with new infrastructure and/or external
  dependencies.

### Option (a) — Durable local identity (a generated principal key persisted in localStorage + a recovery code)

A client-generated 256-bit principal key, persisted in localStorage beside the
session id, presented as a header; the host stamps ownership by principal
instead of session; the user is offered a recovery code (the key, formatted) to
re-enter after a device/profile loss.

- **Fixes:** the restart orphan (a same-browser restart keeps the key; a cleared
  browser / new machine recovers via the code); the theme/onboarding/scope resets
  stay cosmetic (still local, still lost on context loss — the code only
  restores the DESKS).
- **Does NOT fix:** the committee's named condition. A principal key is a
  durable ANONYMOUS identity — no named principals, no who-did-what audit (the
  key is opaque), no entitlements, no SSO path. The wall remains
  anonymous-session isolation, now with better continuity. The deployment
  blocker stands.
- **L12/tenancy:** unchanged shape — ownership widens from session to principal
  inside the one shared tenant; the marker vocabulary extends additively
  (`'principal-owned'` reads as own under the existing `isSessionOwnDesk` fold).
- **Audit trail:** an opaque principal id can ride the existing stamp seam, but
  it answers nothing the audit law asks (spec/SECURITY.md: "Record who/what
  acted"). The export/chain laws hold trivially (nothing digested changes).
- **Security posture:** this is the decisive strike. The codebase's own
  published law (`core/session.ts`'s disclosure; the browser trust zone) says
  localStorage holds "no credential, no record content". Option (a) makes
  localStorage carry a **long-lived, non-revocable bearer credential** — a
  trust-zone amendment in the WRONG direction, and one the forging disclosure
  already warns about ("a caller that forges another session's header defeats
  it" — a forged principal key is worse: it is the identity itself).
- **Migration:** `ownerSession` → `ownerPrincipal` re-stamp on first sight of
  the key; the same seam a later credential model would touch AGAIN (double
  migration).
- **Effort:** **S+** (1–2 waves: a client principal module, a host registry +
  adoption, a Settings recovery-code surface). The cheapest option.

### Option (b) — Export/import re-attach (an import path that re-adopts a workspace)

The export already carries the records (the full chain, the manifest, the world
spec). An import surface would read a downloaded export, extract its project
ids, and offer to re-adopt those desks into the current session/principal.

- **Fixes:** recovery for users who exported BEFORE the loss. Data portability
  round-trip (auditors can already verify standalone; import would re-attach).
- **Does NOT fix:** users who never exported (the common case); the identity
  asks (nothing named, nothing auditable); the theme/scope resets.
- **L12/tenancy:** **reopens the wall through a side door.** Re-adoption on
  proof-of-possession-of-the-file is weak proof: exports are SHARED artifacts
  (the persona harness's own Downloads folder contains prior workers' exports;
  audit exports are emailed to committees by design). On the one-shared-tenant
  deployment, any holder of a colleague's export could adopt that colleague's
  desks — the Round F information-barrier violation with a new mechanism. A
  safe variant requires the export to carry a per-desk adoption secret that
  today it does not (and should not — it is a public audit artifact).
- **Audit trail:** the chain verifies on import (by construction — that is the
  E-9 spine), but adoption-by-import muddies ownership lineage unless the
  adoption is stamped as its own record.
- **Security posture:** fails the tenant-isolation spirit unless the adoption
  secret problem is solved; adds a new untrusted-input surface (a parsed foreign
  file) to the no-build console.
- **Migration:** none needed for existing sessions (opt-in import).
- **Effort:** **M** (import surface + adoption semantics + the security
  analysis) — for a mechanism that fixes the least and risks the most.

### Option (c) — A lightweight credential model (named principals: register + passphrase, host-minted revocable session tokens)

The user creates a named principal (register with a passphrase; the host stores
only a salted verifier — a KDF over Node's platform crypto, zero-dep law
intact). Login exchanges the passphrase for a **scoped, revocable, expiring
session token** held in localStorage (the trust-zone amendment is to "a
revocable bearer token", never the passphrase). Ownership stamps widen to the
principal; a login lists the principal's desks (re-attach solved at the source);
the host can then enforce the wall server-side (principal-scoped serving — "the
wall as a policy enforced against named principals", the committee's verbatim
ask). Email/magic-link is an optional add-on (needs a mail provider — deferred);
SSO/OIDC is the later federation layer on the SAME substrate (§3d).

- **Fixes:** G-11 in full (log in on any device → your desks list; cleared
  browser, new machine, rotated profile — all recover); the committee's named
  condition in substance (named principals, durable re-attachment, who-did-what
  becomes stampable); the copy promise can become TRUE (theme/scope optionally
  ride the account, or the copy changes honestly); the host-side wall hardens
  beyond the client fold (the FW-37-B lesson — a wall a caller can widen is not
  a wall — applied at the host layer).
- **Does NOT fix:** enterprise SSO federation itself (no IdP, no SCIM, no
  per-principal entitlements yet — those are Phase 2 on this substrate); E-7
  pricing; E-6 the closed research world; nothing about the desks' own behavior.
- **L12/tenancy:** unchanged at the boundary — the tenant still comes from the
  deployment credential (L12 by construction); the principal scopes WITHIN the
  tenant. The two-layer model is clean: **developer credential = the tenant
  identity; the user credential = the principal identity; the session id = the
  device correlation.** Multi-tenant deployments (credential-per-tenant) remain
  the operator's later decision — nothing here forecloses it.
- **Audit trail:** the acting principal rides the EXISTING stamp seams (the
  create-stamp in `router.ts`, the promote route) as additive, non-digested
  fields — the exact precedent of the `simulated` flag's placement (the
  published `simulatedFlagRule`); the digest rule stays byte-identical
  (`{seq,tenantId,projectId,payload}` — identity NEVER enters the digest, so
  every chain verifies identically with or without the stamp; formatVersion
  stays 2, the `launchWorld`/`simulatedFlagRule` additive-field precedent). The
  export may disclose the workspace's principal additively; pre-account rows
  keep the honest absence (never fabricate an actor — no uncomputed claims).
  The SIMULATED disclosure is untouched: an account never implies real money —
  the Settings copy keeps the SIMULATED marking adjacent to the account rows.
- **Security posture:** real AuthN at the host layer, composable with the
  existing laws: the frozen T041 boundary is UNTOUCHED (services/api is frozen);
  the auth routes are host-owned additive routes BEFORE the boundary wrap (the
  W-8 precedent — the exact pattern the session/runbook/promote routes use),
  with their own authn, the boundary's envelope discipline, the typed
  401/404/503 laws, unknown-vs-foreign indistinguishability, and NO CORS ever
  (`deploy/vercel/vercel.test.ts` scans). Honest exposure note: the public shell
  ALREADY bakes the developer credential (the whole tenant is exposed to any
  script on the origin today); a revocable, principal-scoped user token adds no
  NEW exposure class — it strictly narrows what a stolen browser holds
  (principal desks, revocable) relative to the status quo (the tenant
  credential, irrevocable).
- **Migration:** one-shot, explicit, and honest. The ADOPTION CEREMONY: at first
  login (or registration from a session that owns desks), the console offers to
  adopt the CURRENT session's owned desks into the principal — per-desk visible,
  toast-disclosed, idempotent; the host re-stamps `ownerPrincipal` additively
  beside `ownerSession` (lineage preserved). No silent migration (the
  no-silent-walls law). Desks whose sessions died BEFORE any account remain
  unreachable — an operator runbook heal (the W-28 precedent) is SKETCHED for
  the Lead (§5, risks) and explicitly NOT decided here.
- **Effort:** **M** (3 waves: the host substrate + auth routes + adoption; the
  console surface; the audit stamp + export disclosure + pins). Passphrase-first
  keeps it M; email delivery would push it toward M+.

### Option (d) — Full AuthN integration (SSO/OIDC)

The enterprise endgame: federate to the customer's IdP; named employee
principals, entitlements from groups, SCIM provisioning, audit with employee
identities.

- **Fixes:** the committee's ask in full — this is what a 2,500-seat rollout
  actually runs.
- **Does NOT fix:** nothing enterprise-wise — but it fixes NOTHING on this
  loop's cadence: it needs an IdP tenant, a vendor/protocol decision, enterprise
  config, and business sign-off — none of which the local chain owns — and it
  DEPENDS on (c)'s substrate anyway (the principal model, the principal scoping,
  the audit stamping, the adoption ceremony; OIDC only replaces the local
  credential check with a federation flow).
- **L12/tenancy:** the cleanest end state (per-customer tenants, one credential
  registry per tenant) — a deployment-shape change owned by the operator.
- **Audit trail:** the strongest (employee identities on every consequential
  action).
- **Security posture:** the strongest (the IdP's, plus the boundary's).
- **Migration:** supersedes (c)'s login surface; the substrate carries over.
- **Effort:** **L** (a multi-round program with external dependencies and
  decisions outside the repo).

---

## 4. The recommendation

**Recommend option (c) — the lightweight credential model (passphrase-first
named principals on the shared tenant, host-minted revocable session tokens) —
as the next code program (3 waves), designed explicitly as the substrate (d)
federates onto. Reject (a) as the primary path and (b) as an identity
mechanism; hold (d) as Phase 2.**

Rationale, judged against the asks that actually exist:

1. **The blocker is the committee's condition, and only (c) meets it.** L3's
   committee said "conditional — pending an enterprise identity model with
   durable session re-attachment." (a) is durable re-attachment WITHOUT an
   identity model — the wall stays anonymous-session isolation, the committee's
   fail ground stands, and the deployment stays blocked. (c) is the minimum that
   delivers named principals + durable re-attachment + a stampable who-did-what
   with zero external dependencies.
2. **The pilot path stays untouched.** Anonymous stays first-class (the demo
   console keeps its no-login shape; the 9/9 would-pilot "one walled desk per
   session" flow is byte-preserved; SDK parity holds — headerless callers keep
   the boundary's byte-identical behavior). The account is an OPT-IN surface:
   "keep my desks across browsers/machines."
3. **The sequencing arithmetic kills (a)-then-(c).** (a) now = 1–2 waves, then
   (c) later = 3 waves re-touching every seam (a) touched (double migration,
   `ownerSession` → `ownerPrincipal` twice). (c) now = 3 waves, one migration,
   one trust-zone amendment in the right direction. Paying 4–5 waves to stay
   anonymous buys nothing the committee values.
4. **The codebase's own security disclosure argues for (c) over (a).** (a)
   stores a non-revocable credential in the zone the product's own law says
   holds no credentials; (c) stores a revocable, scoped token — the standard,
   defensible amendment — and strictly narrows the status-quo exposure (the
   public shell's baked tenant credential).
5. **(c) hardens the wall (d) will inherit.** Principal-scoped serving moves
   the wall from a client-side fold over a tenant-wide listing to a host-side
   policy against named principals — the committee's verbatim ask, and the
   FW-37-B lesson applied at the layer that can enforce it.
6. **The honesty laws are satisfied, not stretched.** The digest rule is
   byte-identical (identity rides outside digests — the `simulated`-flag
   precedent); the SIMULATED disclosure stays adjacent to every account
   surface; the theme/switcher copy promises become TRUE (or change honestly);
   adoption is explicit and disclosed; pre-account rows keep the honest
   absence; the auth routes degrade typed (R46) — under the DEMO backing
   accounts answer the typed not-available (never a silent cold-start reset of
   an account).

**Rejected:** (b) import-as-identity — the export is a PUBLIC audit artifact
(shared with committees by design); proof-of-possession-of-the-file re-adoption
on the one-shared-tenant deployment reopens the Round F information-barrier
violation through a side door. The export stays what it is — the offline
recovery artifact and integration surface — and the verify surface stays; no
import path rides this design.

---

## 5. The implementation plan (option (c), Phase 1)

Three waves, the established disjoint-surface discipline (AGENTS.md: pairwise
disjoint write surfaces, one PR per wave, no self-merge).

### Wave 1 — deploy/vercel: the principal substrate (auth + adoption)

- **The credential store** (durable, additive schema — the W-28 DDL runbook
  precedent for the migration): a `principals` registry (principal id, name,
  salted KDF verifier — Node platform crypto, zero-dep law) + a revocation
  list. The passphrase NEVER persists; the verifier never crosses the wire.
- **The auth routes** (host-owned, additive, BEFORE the boundary wrap — the W-8
  pattern `session-routes.ts`/`routes.ts`/`job-promote.ts` already establish):
  `POST /v1/auth/register`, `POST /v1/auth/login` (mints a scoped, expiring,
  revocable token — HMAC over platform crypto), `POST /v1/auth/logout`,
  `GET /v1/auth/whoami`. Envelope discipline imported from `runtime/routes.ts`
  (never duplicated); typed 401/404/503; unknown-vs-foreign indistinguishable;
  NO CORS (pinned — `vercel.test.ts` scans). Under the DEMO backing: the typed
  not-available (R46 — an account must never silently cold-start reset).
- **The ownership extension:** the create-stamp seam (`router.ts`
  `createdProjectOf` + the durable `ownerSession` field) gains the additive
  `ownerPrincipal` from the auth context; the session listing's marker
  vocabulary extends (`'principal-owned'` — which the existing client fold
  `isSessionOwnDesk` already reads as own: `!== 'tenant-available'`), so wave 1
  is invisible to the shipped console (additive, no client change required).
- **The adoption route:** `POST /v1/auth/adopt` — the CALLING session's own
  desks (the same visibility law `sessionSeesProject` already enforces) re-stamp
  `ownerPrincipal` additively; idempotent; per-desk response; never a widening
  parameter (the FW-37-B module-level lesson).
- **Runtime pins:** a new `deploy/vercel/auth-routes.test.ts` (register/login/
  logout/whoami, token expiry + revocation, verifier-never-served,
  demo-backing unavailability); `session-scope.test.ts` +
  `durable.test.ts` extensions (the principal marker, the adoption law, the
  principal identity never crossing the wire on reads — the `ownerSession`
  precedent).

### Wave 2 — apps/web: the account surface (login, re-attach, the copy honesty)

- **`core/principal.ts`** (new module — the `core/session.ts` pattern: pure +
  storage-seamed, no DOM; the token store, the auth client, the whoami cache).
- **The surface:** a Settings account section (register/login/logout, the
  adoption ceremony with per-desk adoption + toasts — no silent walls), a
  first-run offer AFTER onboarding (never inside it — the demo flow stays
  untouched), and the switcher/Oversight/palette folds reading
  principal-owned rows as own (already true via the marker law; pin it).
- **The payload budget is the binding constraint:** `console.ts` is at
  163,488 of 163,840 bytes (352 bytes of headroom) on the 160 KiB single-file
  line, and the boot transfer is at 951,325 of 1,048,576 bytes
  (`tests/performance/console-payload.test.ts`). The account code MUST follow
  the extraction pattern (new core + render modules, zero `console.ts`
  growth — the FW-36-B/FW-37-B precedent); re-measure and record the payload
  in the PR per the budget file's own protocol.
- **The copy honesty ride-along:** the Theme and Project rows' "remembered for
  future visits" becomes device-scoped copy for anonymous sessions ("remembered
  on this device") and stays true for accounts (per-account posture is a
  Phase-2 option; Phase 1 does NOT move posture server-side).
- **Render pins:** the login/register surface, the adoption ceremony, the
  wall census under a principal (own + demo only), the anonymous surface
  byte-unchanged (a no-change pin), the SIMULATED disclosure adjacent to the
  account rows.

### Wave 3 — the audit stamp + the export disclosure (both surfaces, small)

- **Who-did-what:** the acting principal stamped on the consequential host
  writes (the create-stamp; the promote route) as additive, non-digested
  fields; pre-account rows keep the honest absence; the L4 law holds — the
  stamp carries its own observed instant, never backdated.
- **The export:** an additive, published rule in the manifest (the
  `simulatedFlagRule` precedent — e.g. an `actorRule` naming what the actor
  field means and that it sits OUTSIDE every digest); the chain-equivalence
  pin: the same records verify identically with and without actor fields
  (digest rule byte-identical); formatVersion stays 2.
- **Security tests (new, `tests/security/`):** cross-principal isolation (the
  L12 analog at the principal layer — principal A's desks invisible to
  principal B on every surface, the tenant-isolation battery's shape); token
  forgery/revocation/replay; the export cohort under principals (a principal's
  export carries their desks + demo only — the FW-37-B boundary pin extended).

### Rollout order

Wave 1 → merge (invisible, additive) → wave 2 → merge (the surface; deploy) →
wave 3 → merge → production deploy (the D-023 battery discipline) → **Round H
re-measures on the origin**: the restart-posture re-test WITH an account (log
in post-restart → the desks return; the theme/scope copy honesty), plus the
wall census under principals. Round H's instrument should add the
restart-with-account protocol to D2 for the multi-desk personas (L3/L1/M1).

### Risks (honest)

1. **Payload budget** — the binding apps/web constraint; the extraction pattern
   is mandatory, the re-measurement rides the PR.
2. **localStorage unavailability (private mode)** — the token degrades to
   per-boot (re-login each boot); disclosed in the surface copy; the same
   honest-degradation class as the session id's ephemeral mint.
3. **Token theft** — scoped + revocable + expiring; the pre-existing truth
   disclosed in §3(c): the public shell already bakes the tenant credential, so
   no NEW exposure class arises; the design note says so in the PR.
4. **Adoption abuse** — adoption is restricted to the calling session's own
   desks by the existing visibility law; it cannot expropriate; pinned.
5. **Pre-account orphans** — desks whose sessions died before any account
   remain unreachable (no silent heal); an operator runbook route (the W-28
   precedent) is the sketched option for the Lead — NOT decided here.
6. **Two-layer credential confusion** (developer token = tenant; user token =
   principal) — documented in §2/§5 and in the Settings copy; the runbook
   gains a line.
7. **Scope creep into SSO** — Phase 2 is a separate order; this program's
   waves stop at wave 3.

---

## 6. What this design explicitly does NOT decide

- **Pricing (E-7).** The business decision, owned by the operator; unrelated to
  identity mechanics.
- **The SSO vendor/protocol (OIDC vs SAML; the IdP).** Phase 2's design order,
  on this substrate; no vendor is evaluated or implied here.
- **Per-principal entitlements/roles** beyond the own-desks wall (oversight
  roles, admin principals, shared desks). A later register item once named
  principals exist.
- **Multi-tenant deployment shape** (credential-per-tenant, per-customer
  registries). The operator's infrastructure decision; this design keeps the
  one-shared-tenant shape and forecloses nothing.
- **Email/magic-link delivery.** Deferred; passphrase-first keeps the wave M and
  the zero-dep law intact.
- **Per-account posture** (theme/onboarding/scope riding the account
  server-side). Phase-2 option; Phase 1 fixes the copy, not the storage.
- **The operator's heal of pre-account orphaned desks.** Sketched (a runbook
   route); explicitly not decided.
- **The account surface's naming/branding** in the UI. Unchanged vocabulary
  ("account", "keep my desks"); marketing naming is not a design decision.

---

## 7. The evidence trail (for the implementer)

- Round F posture + tenancy assessment: the worklog P2F-L3 section (D2 restart
  test; the cross-session blotter read; the "half-true" verdict).
- Round G re-documentation + the four-word posture: the worklog P2G-L3 section
  (D2 restart-before/after, the wall census, the committee verdict).
- The register + dispatch: `docs/release/ROUND-G-REPORT.md` §4 (G-11) and §5;
  `docs/release/RELEASE-NOTES-v0.1.0.md` (the Round G appendix: G-11 as "the
  NEW hard deployment blocker").
- The wall's origin: FW-37-B (PR #78) — the release notes' Round F section and
  `render/shell.ts` `switcherOptions`'s own FW-37-B comment.
- The code: §2 above cites every file by path.

*Composed as a design deliverable under FW-38-DESIGN-G11 — no product code
changes ride this branch.*
