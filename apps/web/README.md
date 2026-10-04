# @tradrl/web-console — the web project console

The project-centric human interface (Work Order T042; R36/R37/R38):
the twelve UX.md workspace sections (Goal, Organization, Market
World, Time Machine, Research, Experiments, Decisions, Execution,
Risk, Evidence, Outcomes, Lessons), the primary launch flow, watch
mode, the Time Machine, notifications and evidence capsules — all
rendered from the T041 API's read routes through **structural
mirrors** of `@tradrl/sdk` (never imports of workspace packages —
D-003/D-004 law; the parity is pinned by
`src/api/interop.test.ts`).

**A zero-dependency TypeScript application.** No framework, no
bundler, no CSS framework, no runtime dependency, no CDN — DOM APIs
and hand-authored TS only. `package.json` carries **no**
`dependencies`/`devDependencies` keys (the 37-merge precedent).

## The no-build loader

The app boots **from the TS entry via the package main**
(`src/index.ts`) with **no compilation step**:

1. `index.html` (the static shell) carries the app root
   (`#tradrl-console`), the console's configuration
   (`window.__TRADRL_CONSOLE__` — the host injects the credential
   token, tenant and project scope when it serves the page), and the
   inline **loader bootstrap**.
2. The bootstrap fetches `src/loader/strip-types.ts` as text and
   strips it with a ~40-line regex pass — the loader file is written
   in a restricted **self-hosting micro-style** so this is possible
   (see the file header). The stripped code is imported as a blob
   module. (A test pins the equivalence: the regex pass's output on
   the loader file is byte-identical to the full stripper's.)
3. That loader module — the full, tokenizer-based
   **erasable-TS-subset type stripper** — then loads the whole module
   graph (`src/index.ts` and everything it imports) as browser
   modules: fetch the TS text, strip the types, rewrite the import
   specifiers to blob URLs, `import()` the entry. The graph must be
   acyclic (a cycle is a typed `LoaderError`).
4. The entry (`src/index.ts`) reads the shell's configuration,
   constructs the injected transport (the fetch binding pointed at
   the API origin), constructs the injected clock, boots the console
   (`src/app/console.ts`) and mounts the render tree into the root.

### The erasable subset (the stripper's contract)

**Allowed** (stripped cleanly):
- `interface` / `type` declarations (removed entirely)
- type annotations: parameters, returns, variable declarators, class
  fields, destructuring annotations
- `as` / `satisfies` casts, generics on function/method declarations,
  `import type` / `export type`, optional parameters (`?:`),
  `readonly`/`private`/`public`/`protected` member modifiers,
  optional class members

**Forbidden** (loud typed `LoaderError` — never a silent mis-strip):
`enum`, `namespace`, parameter properties, decorators, `declare`,
abstract classes, non-null assertions (`x!`), `switch`/`case` and
labels (use maps and if/else), function types at annotation depth
zero (name a type alias instead), type syntax inside template-literal
interpolations, definite assignment (`x!: T`).

The subset is **tested as a contract**
(`src/loader/strip-types.test.ts`): every allowed construct strips to
the exact expected JavaScript (deterministic — identical input bytes
strip to identical output bytes), and every forbidden construct is
rejected with a clear message.

### Serving and running

Any static file server that serves the package directory works
(the console is a consumer of the API — serve the API separately,
e.g. `services/api`):

```sh
# from the repo root, serve the package (any zero-dep static server):
python3 -m http.server 8080 --directory apps/web
# or: npx --yes serve apps/web   (a dev convenience, not a dependency)

# then open http://localhost:8080/
```

Configure the shell by editing (or host-substituting) the
`window.__TRADRL_CONSOLE__` block in `apps/web/index.html`:
`apiOrigin` (default: the page's own origin), `token` (the
credential token — **never commit a real token**), `tenantId`
(required), `projectId` (`''` opens the launchpad — the primary flow
starts here).

### The graceful-degradation contract

- **Boot failures** (no root, no token/tenant, a module that fails
  to load, a loader failure) render a readable message inside
  `#tradrl-console`. Never a blank page, never an unhandled crash.
- **API unreachability** degrades per-read: the console keeps
  rendering the last known world plus a degradation note and flips
  its connection banner (`connecting` → `degraded`/`offline`); every
  read failure lands in the workspace state as a typed
  `DegradationNote` (route + family + message + injected instant).
- **No JavaScript**: the `<noscript>` message renders.

## The design system + the app shell (T051 — UX-DESIGN.md)

The console's ShareNet-derived design language (operator directive
D-033) is **hand-authored CSS custom properties — zero runtime
dependencies**:

- **`src/shell/tokens.css`** — THE DESIGN TOKEN SYSTEM (UX-DESIGN
  §1), the pure data layer: both palettes on the `.tradrl-shell` root
  (light DEFAULT via the bare selector + `[data-theme="light"]`; dark
  via `[data-theme="dark"]`), the connection-state tokens
  (`--tradrl-live/warn/down/idle` + `-soft`/`-text` variants; dark
  softs via `color-mix(in oklch, … 18%, transparent)`), the radius
  scale (`--radius` 0.625rem + `sm` 6/`md` 8/`lg` 10/`xl` 14), the
  4px spacing scale (`--space-1..8`), the font stacks (Geist
  Sans/Mono with system fallbacks — a host MAY drop Geist woff2 files
  in as static assets behind `--font-sans`/`--font-mono`; nothing
  requires it), the chart palette, the focus-visible law (§1.5) and
  the `prefers-reduced-motion` gate. `src/shell/tokens.test.ts`
  parses this file and pins every value of both palettes.
- **`src/shell/shell.css`** — the app-shell LAYOUT (§2: the fixed
  256px sidebar, the brand row, the grouped nav with the active pill
  on `cubic-bezier(0.22, 1, 0.36, 1)` 300ms, the CONNECTION block,
  the mobile 56px header + slide-in drawer with backdrop and
  safe-area) and the page scaffold (§3: H1 + subtitle + status badge
  + the ghost icon-only Refresh), plus the retokened legacy panel
  styles. Linked statically from `index.html` — no build, ever.

**Location decision:** tokens (data) and shell (layout) are separate
hand-authored stylesheets under `src/shell/` so the token tables stay
byte-pinnable by tests while the layout evolves.

**Theme persistence (§1):** the choice persists in `localStorage`
under `tradrl_theme`. `index.html` carries a tiny pre-paint script in
`<head>` (before the stylesheets and the loader) that re-applies the
stored theme to `<html>` — `tokens.css` keys the `<html>` background
on `data-theme` so overscroll never flashes the wrong color. The
entry (`src/index.ts`) reads the same key at boot; Settings' theme
control (and any future toggle) writes it through the injected
storage seam (`core/theme.ts` — pure, headless-testable).

**The shell render (T051):** `src/render/shell.ts` composes the
`.tradrl-shell` root — mobile header, drawer backdrop, sidebar (brand
row + the four nav groups with all fifteen targets + the CONNECTION
block + the environment badge) and the main content wrapper
(`max-w-6xl`). `renderConsoleModel(state, at, view?)` stays PURE:
the optional `ShellView` carries only chrome state (theme, the
account landing target, endpoint, simulated flag, busy/drawer); the
default view reproduces the classic section render, and every T042
panel + law gate inside the sections is unchanged. The app layer
(`src/app/console.ts`) owns the view: Home lands first (the hero IS
the page, §3), the twelve workspace sections keep their
`data-section` interaction law, Inbox/Settings are shell targets, the
drawer is Esc/backdrop closable with a focus trap, and the Refresh
action renders its busy (spinning) state.

**Motion under the no-diff projection:** the console re-projects its
whole tree per state change (T042 law — no virtual DOM), so two
motion carriers are persistent-state driven: the mobile drawer slides
via `data-drawer` on the persistent host (`#tradrl-console`, applied
by the app layer without re-projection), and continuous animations
(skeleton pulse, refresh spin) start at element insertion. The
active-item pill and hovers carry the charter's curve; a cross-item
FLIP polish for the pill is scheduled with the component pass.

**The environment badge (§7 anti-deception):** the static shell's
default configuration is honestly labeled `simulated: true` — the
sidebar renders **"SIMULATED · demo data"** (amber) and every section
scaffold carries the SIMULATED status badge until a real host
overrides the flag when it injects the credential token.

## The laws this console enforces (each a typed error, each pinned by tests)

| Law | The typed error | Where |
| --- | --- | --- |
| L4 — point-in-time truth at the interface: rendering a fact whose availability instant is after the selected view time | `AvailabilityViolationError` | `src/core/availability.ts` |
| Wall-clock law — a wall-clock read in a render path | `WallClockReadError` | `src/core/clock.ts` (the render guard) |
| L12 — a cross-tenant/cross-project record reaching a render path | `CrossTenantRenderError` | `src/core/tenant.ts` |
| R37 — a render path that could surface hidden chain-of-thought | `ChainOfThoughtExposureError` | `src/core/watch.ts` (the firewall) |
| L20 — the console attempting a policy decision (fabricating a verdict) | `PolicyEnforcementError` | `src/render/model.ts` |
| Exact decimals — a non-exact-decimal numeric record in a render path | (typed refusal in `renderDecimal`) | `src/core/decimals.ts` |
| The launch form's local validation | `InvalidLaunchDraftError` | `src/core/launch.ts` |
| The loader's non-erasable syntax | `LoaderError` | `src/loader/strip-types.ts` |

The console **renders, never enforces** (L20): policy lives in the
API/gateway. The tenant context rides every read (L12). Instants are
injected — the only wall-clock read is `src/core/clock.ts`'s
`systemNowMs` seam (boot/scheduler boundary only).

## Testing

```sh
# from the repo root
corepack pnpm vitest run apps/web        # the whole console suite
corepack pnpm tsc -p apps/web --noEmit   # typecheck
```
