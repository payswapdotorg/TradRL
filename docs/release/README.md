# docs/release/ — the release documentation (T050)

How a TradRL release is **cut, accepted and recorded**. The release
process is the composition of three runbooks (each owns its phase,
none is duplicated here): the readiness review
(`ops/runbooks/production-readiness.md`), the deploy
(`deploy/README.md` §4), and this tree's checklist + record.

| File | What it is |
|---|---|
| `docs/release/README.md` | this file — the release model: what a release is, the train, the versioning policy, the acceptance law |
| `docs/release/CHECKLIST.md` | the per-release checklist — every step with its command and expected outcome |
| `docs/release/RELEASE-NOTES-v0.1.0.md` | the release record of v0.1.0 — the first production release (the program-complete console) |

---

## What a release IS

A **release candidate** is `main` at a specific merged SHA — by the
program's discipline (one Work Order = one branch = one PR = one
verified merge; the Lead runs the gates on the merge result) the
candidate has already passed: typecheck 0 errors, the full vitest
floor with zero regressions, `Program state valid.`, and the
governance self-test, all in CI
(`.github/workflows/ci.yml`) and on the merge result.

A **release** is a candidate that has additionally passed the
production acceptance — deployed per `deploy/README.md` §4, the
seven-point smoke green (`ops/tooling/smoke.mjs`), the J1–J12 journey
catalog green on the live origin — and has been **recorded** (a
release-notes file in this tree + the program-state entry).

There is no build artifact to publish besides the deployment itself:
the release artifact IS the deployed console + API at the recorded
SHA (the prebuilt `.vercel/output` is deterministically re-derivable
from the SHA — byte-identical, test-pinned).

## The release train (the order is the law)

1. **Readiness** — run `ops/runbooks/production-readiness.md` in
   full. Any red gate = NO-GO; fix forward, re-run. The review
   produces the go/no-go record with the measured numbers.
2. **Deploy** — `deploy/README.md` §4 verbatim (the Lead executes
   it; the worker never deploys).
3. **Post-deploy verification** — the seven-point smoke
   (`node ops/tooling/smoke.mjs "$BASE" "$TOKEN"` → `7/7`) and the
   J1–J12 journey catalog on the live origin.
4. **The record** — write `docs/release/RELEASE-NOTES-vX.Y.Z.md`
   (the format is below; the v0.1.0 file is the worked example),
   append the program-state entry (the decisions log), and broadcast
   to the operator.
5. **Rollback readiness** — walk `ops/runbooks/incident-response.md`
   §4's decision tree on the new deployment; note the previous
   production URL in the record.

## Versioning

- The version lives in the root `package.json` (`0.1.0` at v0.1.0)
  and is the ONLY version number the release carries — the platform
  is one deployable (the console + the API), versioned together.
- **Semver, pragmatically:** MAJOR = a breaking change to the public
  `/v1` contracts or the console's user model; MINOR = new capability
  surfaces (new sections, new route families); PATCH = fixes with no
  surface change. The spec surfaces (`spec/`, `program/`) are
  governed by the Work Order program, not by semver.
- A version bump rides the release train like any other change: a
  Work Order (or the Lead's release commit) bumps `package.json`,
  the gates run, the release cuts at the merged SHA.
- The console's own API-version surface (`/v1/meta`'s
  `apiVersion`, `supportedVersions`) is the runtime contract, owned
  by T041's contracts — a release may ship with no bump there.

## The acceptance law (spec/EVALUATION-PROTOCOL.md "Acceptance")

> "Every release candidate defines objective success criteria,
> confidence target, evidence volume, allowed constraint violation
> rate, blind policy, stress suite and rollback triggers."

Mapped to what a TradRL release actually holds:

| The protocol asks | The TradRL release's answer |
|---|---|
| Objective success criteria | the readiness gate table (all green) + the J1–J12 journey catalog (all twelve green) — objective, re-runnable, recorded |
| Confidence target | the full vitest floor at the release SHA (recorded in the notes: passed + skipped / files, zero regressions vs. the merged floor) |
| Evidence volume | the CI run on the release PR + the smoke probe's 7/7 + the per-journey verdicts |
| Allowed constraint-violation rate | zero for the gates; the console's honest-degradation contract (R46) covers provider absence — never silently |
| Blind policy | the evaluation machinery owns this for TRADING evidence (T031/T032 splits, holdouts, the T049 benchmark platform + `pev:` publication); a RELEASE never re-judges it — it ships the machinery's verdicts |
| Stress suite | the deterministic stress surfaces the platform pins (adversarial evaluation, execution stress — the evaluation suites) + the performance work laws (`tests/performance/`) |
| Rollback triggers | `ops/runbooks/incident-response.md` §4's decision tree, walked before the release |

**Simulation and live evidence are never conflated** — the console's
SIMULATED badge is part of the acceptance: a release under the demo
backing is a SIMULATED release, recorded as such.

## The release record format

Every release record (`RELEASE-NOTES-vX.Y.Z.md`) carries: the
identity block (version, date, the release SHA, the deployment
origin, the deployed backing); the verification block (the measured
gate numbers, the smoke verdict, the journey verdicts); what shipped
(by plane, real component names); the requirement coverage summary
(the traceability duty below); the honest limitations; the known
issues; and how to verify the release (the exact commands). The
v0.1.0 file is the worked example.

## The traceability duty (spec/TRACEABILITY.md's completion rule)

> "Tech Lead must not mark an individual requirement complete merely
> because its primary Work Order merged. Verify the actual implemented
> behavior and evidence."

A release record that claims requirement coverage must cite where
the behavior is VERIFIED (the suite, the journey, the smoke) — not
merely which Work Order merged. v0.1.0's record does this per
requirement group; future releases update the citations, not just
the numbers.
