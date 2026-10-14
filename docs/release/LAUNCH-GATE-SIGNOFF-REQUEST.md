# The launch-gate sign-off request — Phase-2 perception campaign complete; the operator's two decisions requested

**Campaign:** Phase-2 · Round P + Round P-RP (spec/COMPETITIVE-ADOPTION.md,
the 9-persona perception protocol)
**Origin:** https://tradrl-console.vercel.app — production main @ 4d04219
(the ec34976 FW-53 app code + the campaign's docs-only state commits)
**Request armed:** 2026-10-14 ~18:20Z by the takeover TL (replay console)
**Deadline:** 2026-10-14 24:00 Africa/Accra (the operator's standing window)

---

## 1. What the operator is asked to decide

1. **THE LAUNCH-GATE SIGN-OFF** — review the perception evidence (§2)
   against the launch bar and record the verdict: GO / NO-GO / conditions.
   A NO-GO is itself recorded (the readiness runbook's stop law) and names
   its blocker; the campaign's evidence is complete either way.
2. **THE LIVE-DATA PILOT DECISION** — the one structural frontier the
   campaign surfaced: market-world post-declaration alerts are impossible
   without a live feed (L1's finding; S3 + L2 both request the pilot
   before committing to switch). The pilot's scope, provider posture, and
   start date are the operator's product call.

## 2. The evidence chain (what to review, in order)

| # | Artifact | What it carries |
|---|---|---|
| 1 | docs/release/ROUND-P-REPORT.md | The full Round P harness disclosure + the 9-seat tally + the FW-52 delta verdicts + the FW-53 register |
| 2 | docs/release/ROUND-P-RP-REPORT.md | The re-poll: all three leaning seats flip to YES; the O-3R gate closure with measured geometry; the carried residues |
| 3 | ops/round-p/aggregate.json + summary.json (ops vault) | The machine records behind both reports (12 banked seat transcripts) |
| 4 | spec/PROJECT-STATE.md D-052..D-055 + this file's D-056 | The decision log: FW-52 → Round P → FW-53 → P-RP → tonight's verification |

**The tally under sign-off:** 9/9 verdict YES · would_pilot 9/9 ·
7 SWITCH (S1 S2 M1 M2 M3 L1 L3) + 2 pilot-deferred (S3 L2) · zero
protocol violations across both rounds · the O-3R overlap gate CLOSED with
measured geometry (worst case 17px separation; 117px at the critical
Step 5) · N-1/N-2/N-3 verified by the seats that cited them.

## 3. The TL's own verification record (2026-10-14 ~18:0xZ, post-recycle #11)

Never trust reported numbers — the origin was re-verified from scratch
tonight, by hand, after the sandbox recycle wiped the local station:

- **The seven-point smoke: 7/7 PASSED** (ops/tooling/smoke.mjs against the
  origin): api-authn-first typed 401 · api-meta 200 apiVersion=v1 ·
  same-origin no-CORS · api-projects 200 **items=43 (the durable store
  serving — it grew through the campaign)** · api-knowledge 200 ·
  loader-source 200 bytes=61,235 · console-shell 200 bytes=8,451.
- **The security posture (the C2 probes):** /internal/usage/tenant-demo
  without a credential → the typed 401; the public token on the internal
  route → the typed 403 `wrong_auth_plane` — the plane separation law
  holds on the live boundary.
- **The FW-53 markers in the served sources:** /src/render/flow.ts
  (50,797 bytes) carries `alert_fired` ×4 + `data-geometry` ×2 — the fix
  wave's code is what the origin serves.
- **The serving deployment:** the production alias resolves to the 4d04219
  build (READY 15:20:22Z, git-integrated, alias tradrl-console.vercel.app).
- **The credential generation (the D-055 precedent re-cited):** the
  authenticated probes used the runtime's hex token generation — the
  Vercel API's `decrypt=true` phantom values (JWE-shaped, 1116–1128
  chars) answer the typed 401 "not registered" and are NOT what the
  runtime reads. Do not re-burn an hour on that trap; it is recorded at
  D-055 and re-confirmed tonight.

## 4. Disclosed context (NOT launch blockers — the honest-blocker law)

- **The historical cut origin is gone:** trrl-console-staging.vercel.app
  (the v0.1.0 J1–J12 verified origin, an account outside this project's
  Vercel scope) was observed ~17:58Z answering the typed R46 503 — "the
  durable boot world failed (neon_http_error): the hydrated registry is
  degraded: Neon answered 402 (quota exceeded)" — and its deployment has
  since been removed (DEPLOYMENT_NOT_FOUND). It is NOT this project's
  origin. This project's durable store (the tradrl-durable Neon project)
  serves healthily tonight (43 projects, knowledge reads green). The
  observation matters only as a capacity-planning input for the pilot:
  the durable plane's provider quota is a real operational frontier.
- **The campaign's one carried residue:** the market-world alert feed
  (L1's structural finding) — the pilot's subject, not a defect; the
  seats were told the data is SIMULATED and verified the badge (UX-DESIGN
  §7, anti-deception green).
- **The harness classes** (capacity droughts, frozen renderers, the
  zombie-modal peak dialog, never-spawned sends) are disclosed in full
  inside both reports — zero fabricated rows across the campaign.

## 5. What sign-off unlocks

The launch gate closes the Phase-2 perception program: the console's
publicity posture may proceed on the measured evidence (9/9 YES, 7/9
switch intent), and the pilot decision (FW-54 candidacy: the live-feed
integration) becomes the next REAL frontier on the roadmap — with the
durable-plane capacity planning of §4 as its first work item.

## 6. The stop rule

Any red evidence step stops the sign-off. The fix forward is a change on
the owning surface through the normal Work Order discipline — a launch is
never cut from a red tree, and a NO-GO is itself recorded with its
blocker named.
