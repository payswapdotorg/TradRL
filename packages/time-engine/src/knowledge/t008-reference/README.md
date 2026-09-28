# t008-reference — verbatim vendor copy of the T008 provenance contracts

**DO NOT EDIT.** These five files are byte-identical copies of the T008
reference bundle sources (Work Order T026, "Read first" provision):

- Source bundle: `https://tmpfiles.org/wJwBpiqgTqqm/t026-ref.tar.gz`
  (re-provisioned 2026-09-28; the original dispatch link had expired)
- Bundle SHA256:
  `cb5bd0c149fed0d825debc6704ea5c446e88ee2fd5850550c8ada1c2c7d08f59`
- Extracted path in the bundle: `packages/provenance/src/`

| File | SHA256 |
| --- | --- |
| `errors.ts` | `2b49c4ac4386c0bb7881e20da724a075c1127c9987e6a16022037e3d2989bdce` |
| `fields.ts` | `c12e4ab0c31cfcce4464b46f50dd96de34ffb8ed257c23cd2870f94cbb944e60` |
| `timestamp.ts` | `666d394082197e8f4ddc0f4f0740cded8e20777934b2f63fded05236071b9770` |
| `custody.ts` | `48f58ba237623d3c5841264d47b1fbc3957d2ad9b4fa13e8b3ddbb5b29176f34` |
| `provenance.ts` | `0344b327facc4a54b9fb28a5cc3a22598bb459a300449910c866488ba4d6607f` |

## Purpose

`packages/time-engine/src/knowledge/provenance.ts` (the knowledge firewall's
provenance contract, this Work Order) is a **structural mirror** of T008's
`ProvenanceRecord` (law D-004: mirrors, never imports). This vendor copy is
the **authoritative shape source** the mirror is trip-wired against:

- `../interop.test.ts` asserts guard and validator parity between the
  knowledge mirror and the vendored (≡ reference) implementations over a
  corpus of T008-shaped fixtures, plus type-level mutual assignability.
- When `/tmp/reference/packages/provenance/src` is present (the reference
  bundle extracted), the same test asserts every vendored file is STILL
  byte-identical to the reference — proving the vendor copy is genuine and
  current. When the reference is absent (e.g. the Lead's CI machine), the
  parity trip-wires still run against the committed vendor copy.

## Maintenance

The Lead replaces this copy wholesale when T008 merges to main (at which
point the relative-import trip-wire pattern of
`packages/market-protocol/src/interop.test.ts` supersedes it). Never edit
individual files here — re-copy from the authoritative source and update the
SHA table above.
