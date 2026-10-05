# The release checklist (T050)

The per-release procedure in execution order. Each step names its
command and its expected outcome; a step that does not match STOPS
the release (fix forward, re-run from the failed step). The full
rationale for each phase lives in its owning runbook:
`ops/runbooks/production-readiness.md` (Phase A's repository gates +
Phase C's acceptance posture), `deploy/README.md` §4 (Phase B's
deployment), `ops/runbooks/incident-response.md` (B4's failure path +
D3's rollback walk), `docs/release/README.md` (Phase D's record).

**Release:** vX.Y.Z  **Candidate SHA:** `<sha>`  **Operator:** the
Tech Lead  **Date (UTC):** `<date>`

## Phase A — the release candidate is releasable (the repository gates)

- [ ] **A1. Clean checkout at the candidate SHA.**
      `git checkout <sha> && git status --short` → clean.
- [ ] **A2. Dependencies provision.**
      `corepack pnpm install --frozen-lockfile` → completes;
      `git status --short` still clean (the lockfile's recurring
      importer-block dirt is restored with
      `git checkout -- pnpm-lock.yaml`, never committed).
- [ ] **A3. Types.** `corepack pnpm typecheck` → **0 errors**.
- [ ] **A4. The full suite.** `corepack pnpm vitest run` →
      **the merged floor + exactly this release's net-new tests,
      ZERO regressions** (record: `<passed> passed + <skipped>
      skipped / <files> files`; the v0.1.0 baseline: 7706 + 1 / 529).
- [ ] **A5. Program state.** `node scripts/program/check.mjs` →
      ends with **`Program state valid.`**
- [ ] **A6. Governance.** `node scripts/validate-governance.mjs` →
      **`TradRL governance self-test passed.`**

## Phase B — the deployment (per deploy/README.md, never re-stated here)

- [ ] **B1. Pre-deploy hosting checks.** The root `vercel.json` is
      byte-identical to `deploy/vercel/vercel.json`; NO repo-root
      `api/` directory exists (both test-pinned; verify visually).
- [ ] **B2. Env posture.** Runtime: `TRADRL_API_DEVELOPER_TOKEN`,
      `TRADRL_API_DEVELOPER_TENANT`,
      `TRADRL_API_DEVELOPER_PRINCIPAL`, the optional internal pair
      (set it for the full demo: org-status + the job tick).
      Build: `TRADRL_CONSOLE_TOKEN` (equals the developer token),
      `TRADRL_CONSOLE_TENANT_ID` (equals the tenant), optionally
      `TRADRL_CONSOLE_PROJECT_ID=prj-demo-console`.
      `TRADRL_DEPLOY_BACKING` unset (auto: demo while no
      `NEON_*`/`UPSTASH_*` key is configured).
      The full inventory: `deploy/.env.example`.
- [ ] **B3. Deploy.** `npx vercel --prod` (from the repo root,
      linked to the project) → the build emits the complete prebuilt
      `.vercel/output` (static console + the sealed `.func` +
      `config.json`); the platform publishes the same-origin `/v1` +
      `/internal` planes.
- [ ] **B4. The seven-point smoke.**
      `node ops/tooling/smoke.mjs "$BASE" "$TOKEN"` →
      **`smoke: 7/7 checks passed`**, exit 0. Any `[fail]` line →
      `ops/runbooks/incident-response.md` §3.

## Phase C — the acceptance (the live origin)

- [ ] **C1. The J1–J12 journey catalog** (the agent browser, per
      `spec/UX-DESIGN.md` §6): J1 onboarding · J2 shell · J3 primary
      flow (launch → submitted/running/complete) · J4 watch ·
      J5 Time Machine · J6 notifications · J7 evidence capsules ·
      J8 palette · J9 teaching states (+ the degraded-state path:
      unreachable banner, Try-again recovery) · J10 settings ·
      J11 timeline · J12 responsive/a11y. **All twelve green.**
      Record per-journey verdicts for the release record.
- [ ] **C2. The security posture.**
      `curl -s "$BASE/internal/usage/tenant-demo"` → 401/403 (the
      private plane closed without the internal credential);
      the smoke's no-CORS check green (same-origin law);
      `corepack pnpm vitest run tests/security` → green.
- [ ] **C3. The SIMULATED disclosure.** The console's environment
      badge reads SIMULATED under the demo backing (UX-DESIGN §7 —
      if it does not, that is an anti-deception violation: NO-GO).

## Phase D — the record (docs/release/)

- [ ] **D1. The release notes.** Write
      `docs/release/RELEASE-NOTES-vX.Y.Z.md` (the format:
      `docs/release/README.md` §the release record format; the
      v0.1.0 file is the worked example) with the measured numbers
      from A4/B4/C1.
- [ ] **D2. The program-state entry.** Append the decisions-log row
      (the release SHA, the deployment origin, the verdicts) to
      `spec/PROJECT-STATE.md`.
- [ ] **D3. Rollback readiness walked.** Note the previous
      production deployment (`npx vercel ls`) in the record; walk
      `ops/runbooks/incident-response.md` §4's tree on paper.
- [ ] **D4. Broadcast.** Report the release to the operator with the
      record's identity block + the verification numbers.

## The stop rule

Any red step stops the release. The fix forward is a change on the
owning surface through the normal Work Order discipline (or the
Lead's release commit for docs-only fixes) — a release is never cut
from a red tree, and a NO-GO is itself recorded (the readiness
runbook's go/no-go record).
