# TradRL Console UX Design Charter

Binding design law for `apps/web` (T042 delivers the functional console per
`spec/UX.md`; T051 brings the console to full conformance with THIS
charter). Derived from the ShareNet reference
(https://sharenet-conformance.vercel.app), live-re-verified 2026-10-04
(program agent 3-b; evidence bundle `/tmp/sharenet-verify/` — live
HTML/CSS/DOM walkthrough + repo source cross-check). Operator directive
D-033.

IMPLEMENTATION LAW (from the work orders, unchanged): the console carries
ZERO runtime dependencies — no framework, no bundler, no CSS framework.
Everything in this charter is achieved with hand-authored CSS custom
properties and DOM APIs only. Motion is CSS transitions/animations (plus
tiny DOM-API helpers where needed), always gated by
`prefers-reduced-motion`. ShareNet's look is achieved with tokens and
craft, not libraries.

## 0. Reference correction (authoritative)

The ShareNet CONSUMER surface (onboarding, home, network, activity,
devices, settings) is a **warm-light palette** (soft off-whites, graphite
ink, one calm teal accent). The dark zinc palette (#0a0a0a / #171717 /
#262626, white@10% borders) belongs to ShareNet's engineering
`/diagnostics` route only. Earlier program notes describing the consumer
surface as dark zinc are CORRECTED by this charter. The TradRL console
adopts the warm-light consumer language as its DEFAULT (light) theme and
the engineering palette as the `.dark` alternate, switchable in Settings.

## 1. Design tokens

All tokens are CSS custom properties declared on the shell root element
`.tradrl-shell` (the single root wrapper of the app, analogous to
ShareNet's `.sharenet-shell`). The active theme is selected by
`data-theme="light"` (default) or `data-theme="dark"` on that root; the
`html` element's background always follows the active theme so overscroll
never flashes the wrong color. Theme choice persists in
`localStorage` (`tradrl_theme`) and re-applies before first paint.

### 1.1 Light theme (default) — the warm palette

| Token | Value (oklch) | Hex |
|---|---|---|
| `--background` | `oklch(0.98 0.002 90)` | `#f9f8f7` |
| `--foreground` | `oklch(0.2 0.005 90)` | `#171613` |
| `--card` / `--popover` | `oklch(0.99 0.001 90)` | `#fcfcfb` |
| `--card-foreground` | `oklch(0.2 0.005 90)` | `#171613` |
| `--primary` | `oklch(0.28 0.01 90)` | `#2b2923` |
| `--primary-foreground` | `oklch(0.98 0.002 90)` | `#f9f8f7` |
| `--secondary` / `--muted` / `--input` | `oklch(0.95 0.003 90)` | `#efeeec` |
| `--secondary-foreground` | `oklch(0.2 0.01 90)` | `#22221f` |
| `--muted-foreground` | `oklch(0.48 0.008 90)` | `#5f5d59` |
| `--accent` | `oklch(0.93 0.025 165)` | `#d9eee4` |
| `--accent-foreground` | `oklch(0.3 0.06 165)` | `#043726` |
| `--destructive` | `oklch(0.65 0.15 25)` | `#dc655f` |
| `--border` | `oklch(0.91 0.004 90)` | `#e2e1de` |
| `--ring` | `oklch(0.7 0.1 165)` | `#5cb28f` |
| `--sidebar` | `oklch(0.97 0.003 90)` | `#f6f5f3` |
| `--sidebar-primary` / `--sidebar-ring` | `oklch(0.7 0.1 165)` | `#5cb28f` |
| `--sidebar-accent` | `oklch(0.93 0.025 165)` | `#d9eee4` |
| `--sidebar-accent-foreground` | `oklch(0.3 0.06 165)` | `#043726` |
| `--sidebar-border` | `oklch(0.91 0.004 90)` | `#e2e1de` |

### 1.2 Dark theme (`data-theme="dark"`)

| Token | Value |
|---|---|
| `--background` | `#0a0a0a` |
| `--foreground` | `#fafafa` |
| `--card` / `--popover` | `#171717` |
| `--primary` / `--primary-foreground` | `#e5e5e5` / `#171717` |
| `--secondary` / `--muted` | `#262626` |
| `--muted-foreground` | `#a1a1a1` |
| `--accent` / `--accent-foreground` | `#262626` / `#fafafa` |
| `--destructive` | `#ff6568` |
| `--border` | `#ffffff1a` |
| `--input` | `#ffffff26` |
| `--ring` | `#737373` |
| `--sidebar` | `#171717` |
| `--sidebar-primary` / `--sidebar-ring` | `#5cb28f` (brand teal retained) |
| `--sidebar-accent` / `--sidebar-accent-foreground` | `#262626` / `#fafafa` |
| `--sidebar-border` | `#ffffff1a` |

### 1.3 Connection-state tokens (both themes; dark soft/text variants via `color-mix(in oklch, <base> 18%, transparent)` softs and the base color for text)

| State | Base | Soft | Text |
|---|---|---|---|
| `--tradrl-live` | `#5cb28f` | `#d9eee4` | `#00563c` |
| `--tradrl-warn` | `#d58b4b` | `#fbe7d8` | `#7d460b` |
| `--tradrl-down` | `#dc655f` | `#ffe4e1` | `#90302e` |
| `--tradrl-idle` | `#82807a` | `#e8e8e6` | `#57554f` |

Mapping: API connection classes LIVE (teal, steady), DEGRADED (amber,
steady), UNREACHABLE (rose), CONNECTING (neutral, gentle pulse). Pulse
only for transient states; disabled under reduced motion. State is always
dot + text label — never color alone.

### 1.4 Radius, spacing, typography

- `--radius: 0.625rem` (10px); derived: `--radius-sm` 6px, `--radius-md`
  8px, `--radius-lg` 10px, `--radius-xl` 14px.
- Spacing on a 4px base (`--space-1` … `--space-8`: 4/8/12/16/24/32/48/64).
- Fonts: **Geist Sans** (UI) and **Geist Mono** (metrics, addresses,
  technical detail), bundled as static woff2 assets with system fallbacks
  (`ui-sans-serif, -apple-system, "Segoe UI", Arial` /
  `ui-monospace, "SF Mono", Consolas, monospace`). All numeric metrics
  render with `font-variant-numeric: tabular-nums`.
- Chart palette (both themes): `#f05100` (orange), `#009588` (teal),
  `#fcbb00` (amber), `#ac4bff` (violet), `#ff2357` (rose).

### 1.5 Focus law

`.tradrl-shell *:focus-visible { outline: 2px solid var(--tradrl-live);
outline-offset: 2px; border-radius: 4px; }` — visible keyboard focus
everywhere, no exceptions.

## 2. Layout — the app shell

- **Desktop (≥768px):** fixed left sidebar **256px**, full height,
  `background: var(--sidebar)`, `border-right: 1px solid
  var(--sidebar-border)`. Main content `padding-left: 256px`, content
  wrapper `max-w-6xl`, `px-5 py-10 sm:px-8 md:py-14`. No desktop topbar.
- **Brand row** (sidebar top, `height: 64px`, `padding: 0 24px`): 32px
  `rounded-lg` tile in `var(--primary)` with the logo mark (white icon,
  16px) + wordmark **"TradRL"** (`text-base font-semibold
  tracking-tight`); links to Home; `hover: opacity 0.8`.
- **Navigation** (`aria-label="Primary"`, `padding: 12px`, one group
  label + items): grouped, in order —

  - **Overview**: Home
  - **Workspace**: Goal, Organization, Market World, Time Machine,
    Research, Experiments, Decisions, Execution, Risk
  - **Evidence**: Evidence, Outcomes, Lessons
  - **Account**: Inbox, Settings

  Group labels: `0.65rem semibold uppercase tracking 0.14em` muted.
  Items: `rounded-lg px-3 py-2.5 text-sm font-medium`, 16px icon
  (strokeWidth 2.25 active / 1.75 inactive), 12px icon–label gap.
- **Active item treatment:** `aria-current="page"`, text
  `var(--sidebar-accent-foreground)` (inactive
  `var(--muted-foreground)`), and a sliding pill behind the item
  (`background: var(--sidebar-accent)`, `border-radius: var(--radius-lg)`,
  300ms `cubic-bezier(0.22, 1, 0.36, 1)`; instant under
  reduced-motion). Inactive hover: `background:
  color-mix(in oklch, var(--sidebar-accent) 60%, transparent)`.
- **Connection status block** (sidebar bottom): `border-top: 1px solid
  var(--sidebar-border)`, inner `rounded-lg` tile on `var(--muted)`;
  label **"CONNECTION"** (`0.65rem semibold uppercase tracking 0.14em`
  muted); below it the state indicator (10px dot + `text-sm` label +
  one detail line, e.g. "42 ms · v1"). Click opens a details popover:
  endpoint, last poll instant, degradation reason, retry action. While
  loading: pulsing skeleton bar. Below the tile, an environment badge —
  **"SIMULATED · demo data"** (amber outline) whenever the console runs
  on a fake/demo adapter, "LIVE" (teal) when on the real API.
- **Mobile (<768px):** sticky top header `height: 56px` (brand mark +
  connection indicator (6px dot, `text-xs`) + menu button); the sidebar
  becomes a **slide-in drawer** (same nav, 300ms transform, backdrop,
  Esc and backdrop click close, focus trapped while open); `html`
  background follows the theme; bottom safe-area respected
  (`env(safe-area-inset-bottom)`); main content gets bottom padding for
  the drawer's safe close zone. No bottom nav (too many sections).

## 3. Page scaffold (every section)

- **Standard header** (`margin-bottom: 24px`): H1 `text-2xl font-semibold
  tracking-tight`; one-sentence muted subtitle `text-sm
  text-muted-foreground`; right-aligned cluster: **status badge**
  (LIVE / SIMULATED / READ-ONLY — outline pill; LIVE teal, SIMULATED
  amber, READ-ONLY neutral) + actions (ghost icon-only **Refresh** with
  spinning state and `aria-label`; primary action where applicable).
- **Secondary-page variant** (sub-pages of a section): leading icon tile
  (`36px rounded-lg` on `muted/60`) + H1 `text-xl` + small status badge +
  `text-xs` subtitle + outline Refresh with visible label.
- **Home has no header — the hero IS the page.**
- Sub-pages open with a **"← Back to <parent>"** link.

Section subtitles (one sentence each; workers may refine wording, the
shape is law): Home "Your organization at a glance." · Goal "Describe
what this organization should achieve." · Organization "The compiled
team working your goal." · Market World "The world your organization
trades in." · Time Machine "Revisit any instant, exactly as it was known
then." · Research "Evidence-gathering work by your research bodies." ·
Experiments "Evaluations your organization has run." · Decisions "Every
proposal, challenge, and decision." · Execution "Orders and their
lifecycle." · Risk "Risk checks, limits, and interventions." · Evidence
"Content-addressed evidence capsules." · Outcomes "Results and
post-mortems." · Lessons "What the firm has learned." · Inbox
"Notifications from your organization." · Settings "Configure the
console and its connection."

## 4. Component system

### 4.1 Stat cards (KPI tiles)
Label row: 14px icon + `0.7rem uppercase tracking 0.12em semibold` muted
label; value `text-lg font-semibold` tabular (ok → `foreground`,
not-ok → `muted-foreground`); optional one-line delta. Grid:
`2-col` narrow, `4-col` from 640px.

### 4.2 Rich stat card (the "PATH QUALITY" pattern)
`rounded-2xl` on `card/70`, hairline border, inset ring; eyebrow
`0.7rem uppercase`; big value + qualifier ("Good · 42 ms"); ONE full
human sentence beneath; then `border-top` and a 3-column `<dl>` (dt
`0.7rem` muted, dd `text-sm font-medium` tabular).

### 4.3 Status pills and dots
Dot (6/8/10px) + label; semantic mapping to §1.3 for connection states
and domain states (submitted/running/complete/failed/blocked). Never
color alone.

### 4.4 Interactive list rows
Full-width `button`, `rounded-xl`/`rounded-2xl`, hairline border,
`card` background; leading icon tile (36–44px `rounded-lg`, ring);
label + status pill; trailing chevron (16px, `translate-x 2px` on
hover); selected: `border-foreground/30 bg-accent/50` + inset ring;
disabled/offline rows `opacity: 0.6`.

### 4.5 Detail views
Two sanctioned patterns: (a) **right-side sheet** (`max-width: 28rem`,
slide-in, backdrop, focus trap) for heavyweight drill-downs; (b)
**inline accordion** ("Show details" / "Hide details", chevron rotates
180°) revealing a definition grid — dt `muted/70`, dd
`font-mono text-xs` — under `0.65rem uppercase` eyebrows (STATUS /
METRICS / IDENTITY / ADVANCED).

### 4.6 Timelines
Grouped by period buckets — **TODAY / YESTERDAY** / weekday / "Mon D" —
`0.65rem uppercase tracking-wider` headers; a thin 1px rail behind
severity-tinted icon circles (36px, ring); time `HH:MM` tabular; title
`font-semibold` (latest row tinted `bg-accent/30`); one-line
description; expandable details with event-type slugs in mono (e.g.
`decision.made`, `evaluation.failed`).

### 4.7 Watch-mode stream cards
Per agent-turn record: header = agent name + role chip + capability
used; body = evidence links (inline content-address mono badges that
open the capsule), proposal, challenge, risk-check pills (each check a
pill: pass teal / flag amber / block rose), decision (semibold).
**Chain-of-thought NEVER renders** — a record carrying reasoning text
is a typed error (T042 law, unchanged).

### 4.8 Time Machine control bar
Sticky bar: mode select (LIVE / T-x / TIMESTAMP / PLAYBACK), scrubber
(styled range input), play/pause + step controls, **monospace instant
readout** (the selected as-of instant, ISO 8601), and the
point-in-time projection state notice. Rendering a datum whose
availability instant is after the selected view time is a **typed
error** (L4 at the interface — enforced in code, T042 law unchanged).

### 4.9 Evidence capsules
Inline capsule: `rounded-lg`, hairline border, monospace
content-address badge (e.g. `sha256:9f2a…c41`), type icon; opens to the
payload render (mono for raw records) + provenance line. Capsules
render refs — they never recompute (L20).

### 4.10 Notifications
Bell with unread-count badge (in the Account group + visible from every
page); **Inbox** page (list rows + read/unread state + mark-all-read);
toasts (top-right, auto-dismiss ~5s, `role="status"`) for new notices.
The eight `spec/UX.md` event types each get a distinct icon + one
plain-language sentence.

### 4.11 Forms
Labels ABOVE inputs; inline validation on blur (`text-sm
destructive` message); **review step before any launch** (summary list +
confirm); destructive actions use **two-step inline confirm** (button →
"Are you sure? [Cancel] [Confirm]") — never a bare `confirm()`.

### 4.12 Empty / loading / error states
- **EmptyState:** `rounded-2xl` dashed hairline border on `muted/20`,
  `padding: 56px 0`, centered icon circle, title + ONE sentence +
  exactly ONE primary action (e.g. "No experiments yet" / "Run your
  first evaluation from Research." + a button that navigates there).
- **ErrorState:** `role="alert"`, soft rose circle (44px), one-sentence
  message, ONE "Try again" pill. Raw error text NEVER renders on this
  surface; a typed error code may appear inside an expandable
  "Technical details" mono block.
- **LoadingState:** layout-mirroring skeletons (no spinners — a spinner
  may only live inside a pending button). Skeletons must mirror the
  layout that is about to appear.

### 4.13 Onboarding wizard (first run)
Exactly three steps, this shape (TradRL copy):
1. eyebrow **"Welcome"** — H1 **"Welcome to TradRL"** — "Run a trading
   research organization: set a goal, watch it work, and audit every
   decision." — CTA **"Continue"**
2. eyebrow **"How it works"** — H1 **"How it works"** — "Your
   organization researches, proposes, and executes under hard risk
   gates — with evidence attached to every step." — CTA **"Continue"**
3. eyebrow **"You're ready"** — H1 **"You're ready"** — "Start by
   describing a goal; the console compiles an organization and you
   watch it work." — CTA **"Get started"** (accent teal)

Chrome: glyph in a soft teal circle, eyebrow `0.7rem uppercase tracking
0.16em`, H1 `text-3xl sm:text-4xl`, CTA `h-12 min-w-44 rounded-full
px-7` + arrow; progress dots (active = 24×6px teal pill, inactive 6px
neutral dot), `aria` "Step N of 3"; fade+slide (x: 12px, 320ms,
`cubic-bezier(0.22,1,0.36,1)`) skipped under reduced-motion. **Skippable**
("Skip" text link on every step); completion persists
(`localStorage tradrl_onboarded`) and lands on Home; returning users
skip straight to Home. `?`-affordance re-opens it from Settings.

### 4.14 Command palette (Ctrl/Cmd+K)
Overlay + fuzzy search over **navigation targets (100% coverage),
projects, jobs, notifications, evidence**; keyboard navigable (↑ ↓ Enter
Esc); grouped results with type badges; a visible "Search ⌘K"
affordance sits in the sidebar under the brand row.

## 5. The Discoverability Law (seven clauses — the operator's acceptance bar)

> A feature that is not easily discoverable is considered ABSENT.

- **D1 One-click reachability.** Every section, Inbox and Settings is
  reachable in exactly one click from any section (persistent sidebar;
  drawer on mobile; the palette is the sanctioned second path).
- **D2 Above-the-fold orientation.** Every section renders H1 + a
  one-sentence muted subtitle + its status badge within the first
  viewport, primary actions visible without scrolling.
- **D3 Teaching states.** Empty, loading and error states are
  first-class: icon + one plain sentence + exactly ONE primary action;
  never a blank region; raw errors never on the consumer surface.
- **D4 Palette coverage.** The command palette resolves 100% of
  navigation targets, plus projects, jobs, notifications and evidence.
- **D5 Onboarding coverage.** The wizard explains the primary flow and
  completes or is skippable in ≤ 3 steps; it never blocks returning
  users.
- **D6 Notification surfacing.** Every API notice surfaces via bell
  badge + Inbox + toast within one poll cycle; unread state is
  recoverable from any page.
- **D7 Settings completeness.** Theme, API endpoint, tenant context and
  data export each appear in Settings with a plain-language description;
  nothing else configurable hides elsewhere (inline context actions
  excepted).

## 6. Journey catalog (J1–J12) — the merge gate

The Tech Lead executes every journey with an agent browser **on the
deployed console**; all twelve must pass before T051's PR opens (D-033;
reaffirmed by the operator: undiscoverable = absent).

- **J1 Onboarding:** first visit → wizard steps 1→3 → Home; skip path;
  reload skips the wizard (persisted).
- **J2 Shell orientation:** sidebar groups render; from Home, every
  section opens in one click; each shows H1 + subtitle + status badge
  above the fold; connection block shows the API state.
- **J3 Primary flow:** Goal → guided spec (goal, constraints, capital /
  risk budget, markets / venues, horizon, data, execution mode,
  preferences) → review step → Launch → async progress
  (submitted → running → complete) renders.
- **J4 Watch mode:** open a running organization → stream cards show
  agent + role, capability, evidence links, proposal, challenge,
  risk-check pills, decision; no chain-of-thought anywhere.
- **J5 Time Machine:** select T-x / explicit timestamp / playback;
  scrub; monospace instant readout; availability projection respected
  (no post-view-time datum renders; the typed error path is exercised).
- **J6 Notifications:** bell badge appears on a new notice → Inbox
  lists it → read state toggles → toast fires; all eight event types
  render with distinct copy.
- **J7 Evidence:** Evidence section lists capsules with content-address
  badges → open one → payload + provenance render; capsules render
  inline from Outcomes / Decisions.
- **J8 Command palette:** Ctrl/Cmd+K → fuzzy query → navigate to a
  section, a project, a job, a notification and an evidence capsule via
  the palette alone.
- **J9 Teaching states:** fresh tenant → every section shows its empty
  state (icon + sentence + ONE action); with the API unreachable →
  degraded banner + UNREACHABLE connection block + Try again recovers;
  skeletons mirror layout on load. No blank regions.
- **J10 Settings:** theme toggles light/dark and persists across
  reload; API endpoint shown; tenant context shown; data export action
  works; each row carries a plain-language description.
- **J11 Timeline:** activity groups by period (TODAY / YESTERDAY /
  date); a row expands to typed detail records.
- **J12 Responsive + accessibility:** at 390px width the header + drawer
  nav work; touch targets ≥ 44px; focus-visible ring everywhere;
  reduced-motion disables animation; no horizontal scroll.

## 7. Tone

Plain-language, one sentence, reassurance-first, sentence case.
Protocol/domain jargon is quarantined to expandable "Technical details"
(mono) sections. Metrics always tabular. Anti-deception: prototype and
simulated states are always labeled (the environment badge and section
status badges are contractual, not decorative).

## 8. Conformance tests (T051 test law)

T051 adds tests that pin: the token system (both palettes complete on
the shell root; light default; dark via `data-theme`; persistence), 100%
palette coverage of navigation targets, one-click reachability of every
section, per-section empty-state presence with a fresh tenant, onboarding
step machine (1→3, skip, persistence), notice-fold determinism, and the
T042 regression floor — every T042 test stays green (chain-of-thought
exposure, availability projection, cross-tenant render,
wall-clock-in-render, notice-fold determinism, and all others).
