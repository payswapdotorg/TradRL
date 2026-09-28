# Vendored T026 reference copy (trip-wire target)

`mirrors.ts` in this directory is the VERBATIM copy of
`services/knowledge-firewall/src/mirrors.ts` (Work Order T026) from the
Lead's reference bundle (sha256-verified at download time). It is vendored
for exactly one purpose: the drift trip-wire
(`../interop.test.ts`) proves — at the type level and at runtime — that
this package's mirrors (`../firewall.ts`, `../record.ts`, `../timestamp.ts`,
`../ids.ts`, `../provenance.ts`) stay structurally assignable to and
behaviorally consistent with the real T026 contract shapes.

This follows the established repo pattern:
`packages/time-engine/src/knowledge/t008-reference/` (T026 vendoring the
T008 shapes) — law D-004: contract packages stay zero-dependency; shared
shapes use structural mirrors + interop trip-wire tests.

DO NOT EDIT. The owning lane (T026) is the sole authority for the content;
if the contract changes upstream, the Lead re-provisions the reference
bundle and the trip-wire forces this package to track it.
