// @tradrl/web-console — THE COMPONENT SYSTEM part 2 (UX-DESIGN.md
// §4.7-§4.11, T051): the watch-mode stream cards, the Time Machine
// control bar's visual layer, evidence capsule badges, notifications
// (bell + toast copy) and the form scaffolds (labels-above + inline
// validation + review step + the two-step inline confirm).
//
// Pure VNode builders — same (props) -> identical bytes; no DOM, no
// clock, no randomness. LAWS CARRIED (each pinned by tests):
//   §4.7 stream cards render UX.md's seven lenses from the SANITIZED
//        WatchEvent shape — the chain-of-thought firewall
//        (core/watch.ts's assertNoReasoningText) is upstream, at
//        INGEST: a reasoning-shaped key never reaches this layer, and
//        this layer renders only the closed-vocabulary fields (there
//        is structurally no reasoning slot to fill). T042 law UNTOUCHED.
//   §4.8 the Time Machine bar: mode select (LIVE / T-x / TIMESTAMP /
//        PLAYBACK), the styled scrubber, play/pause + step controls,
//        the MONOSPACE instant readout (ISO 8601, the pure
//        formatInstantUtc) and the point-in-time projection state
//        notice. The L4 projection is upstream in the render model —
//        unchanged.
//   §4.9 capsule badges: monospace content-address badges in the
//        console's own digest vocabulary (`evc:<hex>`), type icon,
//        rounded-lg hairline; opening renders the payload (mono) +
//        the provenance line. Capsules render refs — never recompute
//        (L20).
//   §4.10 notifications: the bell with unread-count badge (renders
//        from every page — the shell places it), the toast record
//        (role=status, ~5s auto-dismiss wired by the app layer) and
//        the eight UX.md event types' distinct icons + one
//        plain-language sentence each (closed vocabulary).
//   §4.11 forms: labels ABOVE inputs; inline validation on blur
//        (text-sm destructive); the review step before launch
//        (summary list + confirm); destructive actions use the
//        TWO-STEP INLINE CONFIRM (button -> "Are you sure? [Cancel]
//        [Confirm]") — never a bare confirm().

import { NOTICE_TITLES, type NoticeKind } from '../core/notices';
import { formatInstantUtc } from '../core/format';
import { v, type VNode } from './vtree';
import { iconOf, statusPill, type ComponentIcon } from './components';

// ---------------------------------------------------------------------------
// §4.7 Watch-mode stream cards.
// ---------------------------------------------------------------------------

/** One risk check as the stream renders it (the gateway's own verdict — L20). */
export interface StreamRiskCheck {
  readonly dimension: string;
  readonly outcome: string;
}

/** The pass/flag/block tone mapping for risk-check pills (§4.7's own table). */
export function riskCheckToneOf(outcome: string): 'live' | 'warn' | 'down' {
  if (outcome === 'pass' || outcome === 'passed' || outcome === 'ok') return 'live';
  if (outcome === 'flag' || outcome === 'flagged' || outcome === 'warn' || outcome === 'warned') return 'warn';
  return 'down'; // block / blocked / refused — anything not passing or flagging blocks
}

/** The stream card's props (UX.md's seven lenses — the sanitized WatchEvent shape). */
export interface StreamCardProps {
  /** The acting agent (instance ref). */
  readonly agent: string;
  /** The agent's role chip (a closed label: researcher / challenger / executor / organization). */
  readonly role?: string;
  /** The capability used (closed vocabulary). */
  readonly capability: string | null;
  /** The evidence consulted (typed refs, rendered as capsule badges). */
  readonly evidenceConsulted: readonly { readonly kind: string; readonly ref: string }[];
  /** The proposal (an artifact ref) — null renders an honest 'none'. */
  readonly proposal: string | null;
  /** The challenge (the adversarial artifact ref) — null renders an honest 'none'. */
  readonly challenge: string | null;
  /** The risk checks (the gateway's dimensions + outcomes, verbatim). */
  readonly riskChecks: readonly StreamRiskCheck[];
  /** The decision (semibold; the gateway's own verdict — L20). */
  readonly decision: { readonly kind: 'routed' | 'refused' | 'observed'; readonly ref: string } | null;
  /** The event's instant (the mono readout in the header). */
  readonly at: number;
  /** The inline-opened evidence ref (§4.9): when one of this card's evidence badges is the opened one, its payload renders inline. */
  readonly openRef?: string | null;
}

/** The evidence badge label of a consulted ref (mono, content-address style). */
export function evidenceBadgeLabel(kind: string, ref: string): string {
  return `${kind}:${ref}`;
}

/** One watch-mode stream card (§4.7). The header = agent + role chip + capability; the body = evidence badges, proposal, challenge, risk-check pills, decision. */
export function streamCard(props: StreamCardProps): VNode {
  return v('article', { class: 'stream-card', 'data-stream': props.agent }, [
    v('header', { class: 'stream-header' }, [
      v('span', { class: 'stream-agent' }, [props.agent]),
      ...(props.role === undefined ? [] : [v('span', { class: 'role-chip' }, [props.role])]),
      v('span', { class: 'stream-capability' }, [props.capability ?? 'unspecified']),
      v('span', { class: 'stream-at' }, [formatInstantUtc(props.at)]),
    ]),
    v('div', { class: 'stream-body' }, [
      v('div', { class: 'stream-evidence' }, [
        v('span', { class: 'stream-label' }, ['Evidence']),
        ...(props.evidenceConsulted.length === 0
          ? [v('span', { class: 'stream-none' }, ['none'])]
          : props.evidenceConsulted.map((entry) => capsuleBadge(entry.kind, entry.ref, props.openRef === `${entry.kind}:${entry.ref}`))),
        ...(props.openRef === null || props.openRef === undefined || !props.evidenceConsulted.some((entry) => `${entry.kind}:${entry.ref}` === props.openRef)
          ? []
          : [capsulePayload(props.openRef, [`ref ${props.openRef}`], 'rendered as a reference — the evidence read family owns its payload (L20)', `ref ${props.openRef}`)]),
      ]),
      v('div', { class: 'stream-line' }, [
        v('span', { class: 'stream-label' }, ['Proposal']),
        v('span', { class: 'stream-value' }, [props.proposal ?? 'none']),
      ]),
      v('div', { class: 'stream-line' }, [
        v('span', { class: 'stream-label' }, ['Challenge']),
        v('span', { class: 'stream-value' }, [props.challenge ?? 'none']),
      ]),
      v('div', { class: 'stream-checks' }, [
        v('span', { class: 'stream-label' }, ['Risk checks']),
        ...(props.riskChecks.length === 0
          ? [v('span', { class: 'stream-none' }, ['none'])]
          : props.riskChecks.map((check) => statusPill(riskCheckToneOf(check.outcome), `${check.dimension}: ${check.outcome}`, 'check-pill'))),
      ]),
      v('div', { class: 'stream-decision' }, [
        v('span', { class: 'stream-label' }, ['Decision']),
        v('span', { class: 'stream-decision-value' }, [props.decision === null ? 'none' : `${props.decision.kind} ${props.decision.ref}`]),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// §4.9 Evidence capsule badges (the inline capsule).
// ---------------------------------------------------------------------------

/**
 * The monospace content-address badge label in the console's own
 * digest vocabulary: the capsule id is `evc:<8-hex>…<3-hex>` (the T042
 * digest format, abbreviated like the charter's `sha256:9f2a…c41`).
 */
export function capsuleBadgeLabel(capsuleId: string): string {
  return capsuleId.length <= 12 ? capsuleId : `${capsuleId.slice(0, 8)}…${capsuleId.slice(-3)}`;
}

/** One inline capsule badge (§4.9): rounded-lg, hairline, mono content address; opens the payload + provenance. D-18 (W-29 wave 2): the badge's label is abbreviated by design (the content-address style) — the FULL ref rides the hover tooltip (title) so a truncated label never hides the value (M5's finding: "evidence ref labels are hard-truncated — full ref only in aria-label"). */
export function capsuleBadge(kind: string, ref: string, open = false): VNode {
  const fullRef = `${kind}:${ref}`;
  return v('button', { class: `capsule-badge${open ? ' open' : ''}`, 'data-capsule': fullRef, 'data-action': 'capsule-open', 'data-capsule-open': fullRef, type: 'button', 'aria-label': `Open evidence capsule ${fullRef}`, 'aria-expanded': open ? 'true' : 'false', title: fullRef }, [
    iconOf('box', 'ci ci-14'),
    v('span', { class: 'capsule-address' }, [capsuleBadgeLabel(fullRef)]),
  ]);
}

/**
 * The capsule's opened payload render (§4.9): mono for raw records +
 * the provenance line. D-18 (W-29 wave 2): the refs line rides the
 * mono block's hover tooltip (`title`) — the line WRAPS in CSS
 * (`.capsule-mono { white-space: pre-wrap }`) and now the FULL refs
 * are also hoverable verbatim, so no wrapping or abbreviation ever
 * hides a ref (M5's truncated-refs finding).
 */
export function capsulePayload(capsuleId: string, payloadLines: readonly string[], provenance: string, refsLine?: string): VNode {
  return v('div', { class: 'capsule-payload', 'data-capsule-open': capsuleId }, [
    v('div', { class: 'capsule-address' }, [capsuleId]),
    v('pre', { class: 'capsule-mono', ...(refsLine === undefined ? {} : { title: refsLine, 'data-refs-line': refsLine }) }, [...payloadLines.join('\n')]),
    v('div', { class: 'capsule-provenance' }, [provenance]),
  ]);
}

/** The §4.9 evidence capsule surface's props (the Evidence rows + the inline badges' opened state). */
export interface CapsuleSurfaceProps {
  /** The capsule's content-addressed id (`evc:<hex>`). */
  readonly capsuleId: string;
  /** Which read family the capsule bundles (the subtitle). */
  readonly sourceKind: string;
  /** True when this capsule is the opened one (the payload renders inline). */
  readonly open: boolean;
  /** The payload's mono lines (the capsule's typed facts + refs — rendered verbatim, never recomputed). */
  readonly payloadLines: readonly string[];
  /** D-18 (W-29 wave 2): the full refs line — carried as the mono block's hover title (never truncated, never recomputed; L20). */
  readonly refsLine?: string;
  /** The provenance line (§4.9 + R45: the source route + identity + availability). */
  readonly provenance: string;
}

/**
 * THE §4.9 EVIDENCE CAPSULE SURFACE: the inline capsule row — the
 * monospace content-address badge (the open button) + the source-kind
 * label; when open, the payload (mono) + the provenance line render
 * INLINE beneath. Capsules render refs — never recompute (L20): the
 * payload lines are the bundled record's own typed facts, verbatim.
 */
export function capsuleSurface(props: CapsuleSurfaceProps): VNode {
  const hex = props.capsuleId.startsWith('evc:') ? props.capsuleId.slice('evc:'.length) : props.capsuleId;
  return v('div', { class: `capsule-row${props.open ? ' open' : ''}`, 'data-capsule-row': props.capsuleId }, [
    v('div', { class: 'capsule-row-line' }, [
      capsuleBadge('evc', hex, props.open),
      v('span', { class: 'capsule-kind' }, [props.sourceKind]),
    ]),
    ...(props.open ? [capsulePayload(props.capsuleId, props.payloadLines, props.provenance, props.refsLine)] : []),
  ]);
}

// ---------------------------------------------------------------------------
// §4.8 The Time Machine control bar (visual layer).
// ---------------------------------------------------------------------------

/** One mode button (the charter's four modes). */
export interface TmModeEntry { readonly key: string; readonly label: string }

/** The mode buttons' closed vocabulary (§4.8: LIVE / T-x / TIMESTAMP / PLAYBACK). */
export const TIME_MACHINE_MODES: readonly TmModeEntry[] = Object.freeze([
  { key: 'live', label: 'LIVE' },
  { key: 't-minus', label: 'T-x' },
  { key: 'timestamp', label: 'TIMESTAMP' },
  { key: 'playback', label: 'PLAYBACK' },
]);

/**
 * D-18 (W-29 wave 2): each mode button's hover/aria explanation — the
 * meaning exists BEFORE the click now (S2's finding: "T-x is cryptic
 * pre-click — no tooltips on mode buttons; the meaning only appears in
 * the post-click status line"). The copy is the product's own voice:
 * plain, precise, one sentence per mode; T-x names the offset it arms.
 */
export const TIME_MACHINE_MODE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  live: 'View the live world — every datum as the API serves it now.',
  't-minus': 'T-x: view the world as of 60 seconds before the latest datum (x is the offset; Step back moves it further back).',
  timestamp: 'View one explicit instant you pick — the availability projection decides what renders.',
  playback: 'Play history forward — each step renders only what was knowable then.',
});

/**
 * The projection state notice (§4.8): what the projection is doing at
 * this view instant. MI-D9: a PAUSED playback says so — the pre-fix
 * caption said "Playing history forward" while the view was frozen
 * (M2/M5's mislabel); the paused caption names the manual steps that
 * still work. The default (no second argument) keeps the playing
 * caption — the pinned back-compat surface.
 */
export function projectionNoticeOf(mode: string, paused = false): string {
  if (mode === 'live') return 'Viewing the live world — every datum as the API serves it now.';
  if (mode === 't-minus') return 'Viewing a past instant — facts that were not yet knowable are hidden.';
  if (mode === 'timestamp') return 'Viewing one explicit instant — the availability projection decides what renders.';
  if (paused) return 'Playback paused — the view instant is frozen; Step and Step back move it one controlled step at a time.';
  return 'Playing history forward — each step renders only what was knowable then.';
}

/** The scrubber's range bounds for a state (min = the opened instant, max = the anchor). */
export function scrubberBoundsOf(openedAt: number, anchorAt: number): { readonly min: number; readonly max: number } {
  return { min: Math.min(openedAt, anchorAt), max: Math.max(openedAt, anchorAt) };
}

/** The Time Machine control bar (§4.8): mode select + scrubber + playback controls + the mono instant readout + the projection notice. */
export function timeMachineControls(options: {
  readonly mode: string;
  readonly viewAt: number;
  readonly openedAt: number;
  readonly anchorAt: number;
  readonly playing: boolean;
  readonly progress: number | null;
}): VNode {
  const bounds = scrubberBoundsOf(options.openedAt, options.anchorAt);
  const value = Math.min(Math.max(options.viewAt, bounds.min), bounds.max);
  return v('div', { class: 'tm-controls-bar', 'data-tm-mode': options.mode }, [
    v('div', { class: 'tm-modes', role: 'group', 'aria-label': 'Time Machine mode' }, TIME_MACHINE_MODES.map((entry) => v('button', {
      class: `tm-mode-btn${options.mode === entry.key ? ' active' : ''}`,
      'data-action': `tm-mode-${entry.key}`,
      type: 'button',
      'aria-pressed': options.mode === entry.key ? 'true' : 'false',
      // D-18 (W-29 wave 2): the mode's meaning renders BEFORE the click —
      // the hover tooltip + the screen-reader description (S2's finding:
      // the labels alone were cryptic jargon).
      title: TIME_MACHINE_MODE_DESCRIPTIONS[entry.key] ?? entry.label,
      'aria-description': TIME_MACHINE_MODE_DESCRIPTIONS[entry.key] ?? entry.label,
    }, [entry.label]))),
    v('input', {
      class: 'tm-scrubber',
      type: 'range',
      min: String(bounds.min),
      max: String(bounds.max),
      value: String(value),
      'aria-label': 'View instant',
      'data-action': 'tm-scrub',
    }, []),
    v('div', { class: 'tm-playback', role: 'group', 'aria-label': 'Playback controls' }, [
      v('button', { class: 'tm-button', 'data-action': 'playback-start', type: 'button', 'aria-label': options.playing ? 'Pause playback' : 'Play playback' }, [options.playing ? 'Pause' : 'Play']),
      // MI-D9: the manual steps carry their meaning BEFORE the click (the
      // D-18 law) — Step back steps the view BACK one controlled step (in
      // T-x it grows the offset), Step steps it forward one.
      v('button', { class: 'tm-button', 'data-action': 'playback-step-back', type: 'button', 'aria-label': 'Step back', title: 'Step the view instant back one controlled step (in T-x: grow the offset)' }, ['Step back']),
      v('button', { class: 'tm-button', 'data-action': 'playback-step', type: 'button', 'aria-label': 'Step forward', title: 'Step the view instant forward one controlled step' }, ['Step']),
    ]),
    v('output', { class: 'tm-readout', 'aria-label': 'Selected view instant' }, [formatInstantUtc(options.viewAt)]),
    v('span', { class: 'tm-notice' }, [projectionNoticeOf(options.mode, options.mode === 'playback' && !options.playing)]),
    ...(options.progress === null ? [] : [v('span', { class: 'tm-progress' }, [`${Math.round(options.progress * 100)}%`])]),
  ]);
}

// ---------------------------------------------------------------------------
// §4.10 Notifications: the bell + the toast record + the per-kind copy.
// ---------------------------------------------------------------------------

/** The eight UX.md event types' distinct icons (closed vocabulary). */
export const NOTICE_ICONS: Readonly<Record<NoticeKind, ComponentIcon>> = Object.freeze({
  organization_compiled: 'layers',
  training_milestone: 'pulse',
  failed_evaluation: 'flask',
  capability_gap: 'spark',
  release_candidate: 'check',
  acceptance_criteria_met: 'target',
  shadow_degradation: 'clock',
  safety_intervention: 'shield',
});

/** The eight event types' one plain-language sentence (§4.10 — the shape is law: one sentence, reassurance first). */
export const NOTICE_SENTENCES: Readonly<Record<NoticeKind, string>> = Object.freeze({
  organization_compiled: 'Your organization compiled and is now working the goal.',
  training_milestone: 'A learning job reached a training milestone.',
  failed_evaluation: 'An evaluation did not pass — the firm keeps the lesson.',
  capability_gap: 'The organization is missing a capability it needs.',
  release_candidate: 'Research produced a release candidate worth reviewing.',
  acceptance_criteria_met: 'The goal\'s acceptance criteria were met.',
  shadow_degradation: 'A shadow read drifted from its live expectation.',
  safety_intervention: 'A safety gate intervened and stopped a decision.',
});

/** The bell with the unread-count badge (§4.10) — rendered by the shell on every page. */
export function notificationBell(unread: number, target = 'inbox'): VNode {
  return v('button', {
    class: `nav-item bell${unread > 0 ? ' has-unread' : ''}`,
    'data-target': target,
    type: 'button',
    'aria-label': unread > 0 ? `Inbox — ${unread} unread notice${unread === 1 ? '' : 's'}` : 'Inbox — no unread notices',
  }, [
    iconOf('inbox', 'nav-icon'),
    v('span', { class: 'nav-item-label' }, ['Inbox']),
    ...(unread === 0 ? [] : [v('span', { class: 'bell-badge', 'data-unread': String(unread) }, [String(unread)])]),
  ]);
}

/** The toast record (§4.10): top-right, role=status, ~5s auto-dismiss (the app layer owns the timer) + the manual dismiss (the W-14b close button — the app layer's toast-close handler finally has an element). */
export function toastRecord(kind: NoticeKind, title: string, sentence: string): VNode {
  return v('div', { class: `toast toast-${kind}`, role: 'status', 'data-toast': kind }, [
    iconOf(NOTICE_ICONS[kind], 'ci ci-16'),
    v('div', { class: 'toast-text' }, [
      v('div', { class: 'toast-title' }, [title]),
      v('div', { class: 'toast-sentence' }, [sentence]),
    ]),
    v('button', { class: 'toast-close', 'data-action': 'toast-close', type: 'button', 'aria-label': 'Dismiss notification' }, ['\u00d7']),
  ]);
}

/** The notice-kind copy resolver (title + icon + the one-sentence body) — one closed lookup. */
export function noticeCopyOf(kind: NoticeKind): { readonly title: string; readonly icon: ComponentIcon; readonly sentence: string } {
  return { title: NOTICE_TITLES[kind], icon: NOTICE_ICONS[kind], sentence: NOTICE_SENTENCES[kind] };
}

// ---------------------------------------------------------------------------
// §4.11 Forms: labels-above + inline validation + review step + the two-step confirm.
// ---------------------------------------------------------------------------

/** One field's validation state (computed on blur; text-sm destructive when invalid). */
export interface FieldValidation {
  /** The error message (empty = valid). */
  readonly message: string;
  /** True once the field has been blurred (validation renders only after blur). */
  readonly touched: boolean;
}

/** The field's validation message node (inline, destructive, only when touched + invalid — §4.11). */
export function fieldError(field: FieldValidation): VNode | null {
  if (field.touched !== true || field.message.length === 0) return null;
  return v('p', { class: 'field-error', role: 'alert' }, [field.message]);
}

/**
 * One labeled input (§4.11: the label sits ABOVE the input; validation
 * rides under it). The `vocabulary` picks the delegated data-field
 * attribute — 'launch' (the wizard's data-launch-field, the default)
 * or 'research' (the D-12 standalone research form's
 * data-research-field) — so each form's inputs bind to their OWN
 * beat-safe edit buffer.
 */
export function labeledInput(options: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly type?: 'text' | 'number';
  readonly placeholder?: string;
  readonly hint?: string;
  readonly validation?: FieldValidation;
  readonly required?: boolean;
  readonly vocabulary?: 'launch' | 'research';
}): VNode[] {
  const invalid = options.validation?.touched === true && (options.validation?.message.length ?? 0) > 0;
  const idPrefix = options.vocabulary === 'research' ? 'research' : 'launch';
  const fieldAttr = options.vocabulary === 'research' ? 'data-research-field' : 'data-launch-field';
  return [
    v('div', { class: `field${invalid ? ' field-invalid' : ''}`, 'data-field': options.name }, [
      v('label', { class: 'field-label', for: `${idPrefix}-${options.name}` }, [options.label, ...(options.required === true ? [' *'] : [])]),
      v('input', {
        class: 'field-input',
        id: `${idPrefix}-${options.name}`,
        name: options.name,
        type: options.type ?? 'text',
        value: options.value,
        ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        [fieldAttr]: options.name,
      }, []),
      ...(options.hint === undefined ? [] : [v('p', { class: 'field-hint' }, [options.hint])]),
      ...(options.validation === undefined ? [] : [fieldError(options.validation)]),
    ]),
  ];
}

/** One labeled select (§4.11: the label sits ABOVE the control — the closed-vocabulary fields). */
export function labeledSelect(options: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly choices: readonly (readonly [string, string])[];
  readonly hint?: string;
  readonly validation?: FieldValidation;
  readonly required?: boolean;
}): VNode[] {
  const invalid = options.validation?.touched === true && (options.validation?.message.length ?? 0) > 0;
  return [
    v('div', { class: `field${invalid ? ' field-invalid' : ''}`, 'data-field': options.name }, [
      v('label', { class: 'field-label', for: `launch-${options.name}` }, [options.label, ...(options.required === true ? [' *'] : [])]),
      v('select', {
        class: 'field-input field-select',
        id: `launch-${options.name}`,
        name: options.name,
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        'data-launch-field': options.name,
      }, options.choices.map(([value, label]) => v('option', { value, ...(value === options.value ? { selected: 'selected' } : {}) }, [label]))),
      ...(options.hint === undefined ? [] : [v('p', { class: 'field-hint' }, [options.hint])]),
      ...(options.validation === undefined ? [] : [fieldError(options.validation)]),
    ]),
  ];
}

/** The review step (§4.11): the summary list before any launch — confirm is the only way forward. */
export function reviewStep(summary: readonly (readonly [string, string])[]): VNode {
  return v('div', { class: 'review-step', 'data-review': 'launch' }, [
    v('div', { class: 'def-eyebrow' }, ['REVIEW']),
    v('p', { class: 'review-lede' }, ['Review every choice before launching — the organization compiles from this summary.']),
    v('dl', { class: 'def-grid review-grid' }, summary.map(([term, detail]) => v('div', { class: 'def-item' }, [
      v('dt', {}, [term]),
      v('dd', {}, [detail]),
    ]))),
  ]);
}

/** The two-step inline confirm (§4.11): a closed vocabulary of confirmations. */
export type ConfirmAction = 'launch' | 'cancel-launch';

/** The confirmation question of each two-step action (the charter's own shape). */
export const CONFIRM_QUESTIONS: Readonly<Record<ConfirmAction, string>> = Object.freeze({
  launch: 'Launch this organization?',
  'cancel-launch': 'Cancel this launch?',
});

/**
 * The two-step inline confirm (§4.11): the armed state renders the
 * question + [Cancel] [Confirm] INLINE — never a bare confirm(). The
 * first click arms (data-confirm-armed), the second click confirms
 * (data-confirm); the app layer owns the arming state.
 */
export function twoStepConfirm(action: ConfirmAction, armed: boolean): VNode {
  if (!armed) {
    return v('button', { class: 'confirm-arm', 'data-action': `confirm-arm-${action}`, type: 'button' }, [CONFIRM_QUESTIONS[action]]);
  }
  return v('div', { class: 'confirm-inline', 'data-confirm-pending': action, role: 'group', 'aria-label': CONFIRM_QUESTIONS[action] }, [
    v('span', { class: 'confirm-question' }, [`Are you sure? ${CONFIRM_QUESTIONS[action]}`]),
    v('button', { class: 'confirm-cancel', 'data-action': `confirm-cancel-${action}`, type: 'button' }, ['Cancel']),
    v('button', { class: 'confirm-go', 'data-action': `confirm-${action}`, type: 'button' }, ['Confirm']),
  ]);
}
