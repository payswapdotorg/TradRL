// Tests for the component system part 2 (render/flow.ts — UX-DESIGN
// §4.7-§4.11, T051).
//
// Laws pinned here:
//   §4.7 the stream card structure (agent + role chip + capability in
//        the header; evidence badges + proposal + challenge +
//        risk-check pills + the semibold decision in the body) and the
//        pass-teal / flag-amber / block-rose tone mapping. The
//        chain-of-thought firewall itself is core/watch.ts's law and
//        stays pinned by ITS tests (untouched).
//   §4.8 the Time Machine bar: the four modes, the scrubber bounds,
//        the playback controls, the MONOSPACE ISO-8601 instant
//        readout and the per-mode projection notice.
//   §4.9 the capsule badge: the content-address label format
//        (abbreviated like sha256:9f2a…c41), the type icon, the
//        payload render (mono) + the provenance line.
//   §4.10 notifications: the bell badge counts, the toast record
//        (role=status), and all eight UX.md event types carry a
//        distinct icon + ONE plain-language sentence.
//   §4.11 forms: the label sits ABOVE the input; validation renders
//        only after blur (touched) and is destructive; the review
//        step renders the summary list; the two-step confirm renders
//        [Cancel] [Confirm] inline when armed — never a bare confirm().

import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS } from '../core/notices';
import { formatInstantUtc } from '../core/format';
import {
  capsuleBadge,
  capsuleBadgeLabel,
  capsulePayload,
  CONFIRM_QUESTIONS,
  evidenceBadgeLabel,
  fieldError,
  labeledInput,
  noticeCopyOf,
  NOTICE_ICONS,
  NOTICE_SENTENCES,
  notificationBell,
  projectionNoticeOf,
  reviewStep,
  riskCheckToneOf,
  scrubberBoundsOf,
  streamCard,
  timeMachineControls,
  TIME_MACHINE_MODE_DESCRIPTIONS,
  TIME_MACHINE_MODES,
  toastRecord,
  twoStepConfirm,
} from './flow';
import { serializeVNode, type VNode } from './vtree';

const render = (node: VNode | null): string => (node === null ? '' : serializeVNode(node));
const T = 1_700_000_000_000;

describe('flow §4.7: the watch-mode stream card', () => {
  const card = streamCard({
    agent: 'inst:researcher-1',
    role: 'researcher',
    capability: 'research',
    evidenceConsulted: [{ kind: 'fill', ref: 'fil-1' }],
    proposal: 'prop-9',
    challenge: 'chall-2',
    riskChecks: [
      { dimension: 'position-limit', outcome: 'pass' },
      { dimension: 'var-budget', outcome: 'flag' },
      { dimension: 'kill-switch', outcome: 'block' },
    ],
    decision: { kind: 'routed', ref: 'dec-1' },
    at: T + 40,
  });

  it('the header carries agent + role chip + capability + the mono instant', () => {
    const bytes = render(card);
    expect(bytes).toContain('class="stream-card"');
    expect(bytes).toContain('<span class="stream-agent">inst:researcher-1</span>');
    expect(bytes).toContain('<span class="role-chip">researcher</span>');
    expect(bytes).toContain('<span class="stream-capability">research</span>');
    expect(bytes).toContain(formatInstantUtc(T + 40));
  });

  it('the body carries evidence badges (mono content-address), proposal, challenge, risk pills and the semibold decision', () => {
    const bytes = render(card);
    expect(bytes).toContain('capsule-badge');
    expect(bytes).toContain('fill:fil-1');
    expect(bytes).toContain('<span class="stream-value">prop-9</span>');
    expect(bytes).toContain('<span class="stream-value">chall-2</span>');
    expect(bytes).toContain('class="status-pill pill-live check-pill"');   // pass -> teal
    expect(bytes).toContain('class="status-pill pill-warn check-pill"');   // flag -> amber
    expect(bytes).toContain('class="status-pill pill-down check-pill"');   // block -> rose
    expect(bytes).toContain('position-limit: pass');
    expect(bytes).toContain('<span class="stream-decision-value">routed dec-1</span>');
  });

  it('the risk-check tone mapping is closed (pass teal / flag amber / block rose; unknowns block)', () => {
    expect(riskCheckToneOf('pass')).toBe('live');
    expect(riskCheckToneOf('passed')).toBe('live');
    expect(riskCheckToneOf('ok')).toBe('live');
    expect(riskCheckToneOf('flag')).toBe('warn');
    expect(riskCheckToneOf('flagged')).toBe('warn');
    expect(riskCheckToneOf('warn')).toBe('warn');
    expect(riskCheckToneOf('block')).toBe('down');
    expect(riskCheckToneOf('blocked')).toBe('down');
    expect(riskCheckToneOf('anything-else')).toBe('down');
  });

  it('null lenses render an honest none (the console never invents what the API does not serve)', () => {
    const bytes = render(streamCard({
      agent: 'inst:x', role: undefined, capability: null, evidenceConsulted: [], proposal: null, challenge: null, riskChecks: [], decision: null, at: T,
    }));
    expect(bytes).toContain('unspecified');
    expect(bytes.match(/>none<\/span>/g)?.length).toBe(5); // evidence + proposal + challenge + risk checks + decision (capability renders 'unspecified', its own honest none)
    expect(bytes).not.toContain('role-chip');
  });

  it('DETERMINISM: identical props -> identical bytes', () => {
    const props = { agent: 'inst:a', capability: 'research', evidenceConsulted: [], proposal: null, challenge: null, riskChecks: [], decision: null, at: T };
    expect(render(streamCard(props))).toBe(render(streamCard(props)));
  });
});

describe('flow §4.9: the evidence capsule badge', () => {
  it('the badge label abbreviates the content address (sha256:9f2a…c41 style)', () => {
    expect(capsuleBadgeLabel('evc:9f2ac41bde07')).toBe('evc:9f2a…e07');
    expect(capsuleBadgeLabel('short')).toBe('short');
    expect(evidenceBadgeLabel('fill', 'fil-1')).toBe('fill:fil-1');
  });

  it('the badge is a button carrying the type icon + the mono address + an accessible label', () => {
    const bytes = render(capsuleBadge('outcome', 'out-1'));
    expect(bytes).toContain('class="capsule-badge"');
    expect(bytes).toContain('data-capsule="outcome:out-1"');
    expect(bytes).toContain('capsule-address');
    expect(bytes).toContain('aria-label="Open evidence capsule outcome:out-1"');
  });

  it('the opened payload renders mono + the provenance line (refs only — L20)', () => {
    const bytes = render(capsulePayload('evc:9f2ac41bde07', ['disposition: filled', 'realized: 1.75'], 'folded from GET /v1/outcomes/query out-1'));
    expect(bytes).toContain('data-capsule-open="evc:9f2ac41bde07"');
    expect(bytes).toContain('<pre class="capsule-mono">disposition: filled');
    expect(bytes).toContain('<div class="capsule-provenance">folded from GET /v1/outcomes/query out-1</div>');
  });

  it('D-18 (W-29 wave 2): the badge carries the FULL ref as its hover title — an abbreviated label never hides the value (M5: "evidence ref labels are hard-truncated — full ref only in aria-label")', () => {
    // M5's exact finding: a long ref abbreviates in the label ("shadow_o…001" style)...
    expect(capsuleBadgeLabel('shadow_outcome:shadow_outcome_0001')).toBe('shadow_o…001');
    // ...but the FULL ref now rides the hover tooltip, not the aria-label alone
    const bytes = render(capsuleBadge('shadow_outcome', 'shadow_outcome_0001'));
    expect(bytes).toContain('title="shadow_outcome:shadow_outcome_0001"');
    expect(bytes).toContain('aria-label="Open evidence capsule shadow_outcome:shadow_outcome_0001"');
  });

  it('D-18 (W-29 wave 2): the opened payload carries the FULL refs line as the mono block\'s hover title (the refs line wraps in CSS — the title keeps the complete refs hoverable)', () => {
    const refsLine = 'refs: job:558af789, outcome:out:demo0001';
    const bytes = render(capsulePayload('evc:9f2ac41bde07', ['deliverable: release-candidate', refsLine], 'read from /v1/jobs/:jobId', refsLine));
    expect(bytes).toContain('title="refs: job:558af789, outcome:out:demo0001"');
    expect(bytes).toContain('data-refs-line="refs: job:558af789, outcome:out:demo0001"');
    expect(bytes).toContain(`refs: job:558af789, outcome:out:demo0001`); // the line itself renders verbatim
    // without a refs line the payload renders exactly as before (the optional prop adds nothing)
    const bare = render(capsulePayload('evc:9f2ac41bde07', ['facts only'], 'provenance'));
    expect(bare).not.toContain('data-refs-line');
    expect(bare).not.toContain('title=');
  });
});

describe('flow §4.8: the Time Machine control bar', () => {
  const bar = timeMachineControls({ mode: 't-minus', viewAt: T - 60_000, openedAt: T, anchorAt: T + 50, playing: false, progress: null });

  it('the four charter modes render as a pressed group (LIVE / T-x / TIMESTAMP / PLAYBACK)', () => {
    const bytes = render(bar);
    expect(TIME_MACHINE_MODES.map((entry) => entry.label)).toEqual(['LIVE', 'T-x', 'TIMESTAMP', 'PLAYBACK']);
    for (const entry of TIME_MACHINE_MODES) {
      expect(bytes).toContain(`data-action="tm-mode-${entry.key}"`);
    }
    expect(bytes).toContain('aria-pressed="true"');   // the active mode (t-minus)
    expect(bytes.match(/aria-pressed="true"/g)?.length).toBe(1);
  });

  it('the scrubber is a styled range input bounded by the workspace lifetime', () => {
    const bytes = render(bar);
    expect(bytes).toContain('class="tm-scrubber"');
    expect(bytes).toContain('type="range"');
    expect(scrubberBoundsOf(T, T + 50)).toEqual({ min: T, max: T + 50 });
    expect(scrubberBoundsOf(T + 50, T)).toEqual({ min: T, max: T + 50 }); // order-independent
    expect(bytes).toContain(`value="${T - 60_000}"`.replace(String(T - 60_000), String(Math.min(Math.max(T - 60_000, T), T + 50))));
  });

  it('the playback controls + the MONOSPACE ISO-8601 readout + the projection notice render', () => {
    const bytes = render(bar);
    expect(bytes).toContain('data-action="playback-start"');
    expect(bytes).toContain('data-action="playback-step-back"');
    expect(bytes).toContain('data-action="playback-step"');
    expect(bytes).toContain('>Play</button>'); // not playing -> Play
    expect(bytes).toContain(`<output class="tm-readout" aria-label="Selected view instant">${formatInstantUtc(T - 60_000)}</output>`);
    expect(bytes).toContain(projectionNoticeOf('t-minus'));
    expect(bytes).toContain('data-tm-mode="t-minus"');
  });

  it('every mode carries its own projection state notice', () => {
    for (const mode of ['live', 't-minus', 'timestamp', 'playback'] as const) {
      expect(projectionNoticeOf(mode).length).toBeGreaterThan(10);
    }
    expect(projectionNoticeOf('live')).toContain('live');
    expect(projectionNoticeOf('t-minus')).toContain('not yet knowable');
    expect(projectionNoticeOf('playback')).toContain('Playing history');
  });

  it('D-18 (W-29 wave 2): every mode button carries its meaning BEFORE the click — the description rides the hover title + the aria-description (S2: "T-x is cryptic pre-click — no tooltips on mode buttons")', () => {
    const bytes = render(bar);
    for (const entry of TIME_MACHINE_MODES) {
      const description = TIME_MACHINE_MODE_DESCRIPTIONS[entry.key];
      expect(description, entry.key).toBeDefined();
      expect(bytes).toContain(`title="${description}"`);
      expect(bytes).toContain(`aria-description="${description}"`);
    }
    // the T-x description names the offset it arms (the console arms 60s) and the Watch word is nowhere near cryptic anymore
    expect(TIME_MACHINE_MODE_DESCRIPTIONS['t-minus']).toContain('60 seconds before the latest datum');
    expect(TIME_MACHINE_MODE_DESCRIPTIONS['t-minus']).toContain('x is the offset');
  });

  it('the playing state swaps the play/pause label + renders the progress', () => {
    const playing = render(timeMachineControls({ mode: 'playback', viewAt: T, openedAt: T, anchorAt: T, playing: true, progress: 0.5 }));
    expect(playing).toContain('Pause');
    expect(playing).toContain('aria-label="Pause playback"');
    expect(playing).toContain('<span class="tm-progress">50%</span>');
  });
});

describe('flow §4.10: notifications (bell + toast + the eight event types)', () => {
  it('the bell badge counts unread (and hides at zero)', () => {
    const zero = render(notificationBell(0));
    expect(zero).toContain('aria-label="Inbox — no unread notices"');
    expect(zero).not.toContain('bell-badge');
    const three = render(notificationBell(3));
    expect(three).toContain('class="bell-badge" data-unread="3"');
    expect(three).toContain('aria-label="Inbox — 3 unread notices"');
  });

  it('the toast record is role=status and carries the icon + title + ONE sentence', () => {
    const bytes = render(toastRecord('failed_evaluation', 'Failed evaluation', NOTICE_SENTENCES.failed_evaluation));
    expect(bytes).toContain('role="status"');
    expect(bytes).toContain('data-toast="failed_evaluation"');
    expect(bytes).toContain('toast-title');
    expect(bytes).toContain(NOTICE_SENTENCES.failed_evaluation);
  });

  it('the toast record carries a DISMISS affordance (§4.10: the app layer\'s toast-close handler has an element — the J6 stuck-toast fix)', () => {
    const bytes = render(toastRecord('failed_evaluation', 'Failed evaluation', NOTICE_SENTENCES.failed_evaluation));
    expect(bytes).toContain('data-action="toast-close"');
    expect(bytes).toContain('aria-label="Dismiss notification"');
    expect(bytes).toContain('class="toast-close"');
  });

  it('ALL EIGHT UX.md event types carry a distinct icon + ONE plain-language sentence', () => {
    expect(NOTICE_KINDS.length).toBe(8);
    const icons = new Set<string>();
    for (const kind of NOTICE_KINDS) {
      const copy = noticeCopyOf(kind);
      expect(copy.title.length, kind).toBeGreaterThan(0);
      expect(copy.sentence, kind).toMatch(/^[A-Z].*\.$/); // one sentence
      expect(copy.sentence.split('.').length, kind).toBe(2);
      icons.add(copy.icon);
    }
    expect(icons.size).toBe(8); // distinct
    expect(NOTICE_ICONS.failed_evaluation).toBe('flask');
    expect(NOTICE_ICONS.safety_intervention).toBe('shield');
    expect(NOTICE_SENTENCES.safety_intervention).toBe('A safety gate intervened and stopped a decision.');
  });
});

describe('flow §4.11: forms (labels-above + inline validation + review + the two-step confirm)', () => {
  it('the label sits ABOVE the input (label precedes input in the bytes)', () => {
    const [field] = labeledInput({ label: 'Objective', name: 'objective', value: 'beat the index', required: true });
    const bytes = render(field);
    expect(bytes).toContain('<label class="field-label" for="launch-objective">Objective *</label>');
    expect(bytes.indexOf('field-label')).toBeLessThan(bytes.indexOf('field-input'));
    expect(bytes).toContain('class="field-input"');
    expect(bytes).toContain('value="beat the index"');
  });

  it('validation renders ONLY after blur (touched) and is destructive + role=alert', () => {
    const pristine = render(fieldError({ message: 'Describe the objective in one sentence.', touched: false }));
    expect(pristine).toBe('');
    const touched = render(fieldError({ message: 'Describe the objective in one sentence.', touched: true }));
    expect(touched).toContain('class="field-error"');
    expect(touched).toContain('role="alert"');
    expect(touched).toContain('Describe the objective in one sentence.');
    const [invalid] = labeledInput({ label: 'Objective', name: 'objective', value: '', validation: { message: 'Required.', touched: true }, required: true });
    const invalidBytes = render(invalid);
    expect(invalidBytes).toContain('field-invalid');
    expect(invalidBytes).toContain('aria-invalid="true"');
  });

  it('the review step renders the summary list + the confirm-only lede (§4.11)', () => {
    const bytes = render(reviewStep([['Objective', 'beat the index'], ['Markets', 'SPY, QQQ']]));
    expect(bytes).toContain('data-review="launch"');
    expect(bytes).toContain('<div class="def-eyebrow">REVIEW</div>');
    expect(bytes).toContain('<dt>Objective</dt><dd>beat the index</dd>');
    expect(bytes).toContain('<dt>Markets</dt><dd>SPY, QQQ</dd>');
  });

  it('the two-step confirm: arm -> question + [Cancel] [Confirm] inline; NEVER a bare confirm()', () => {
    const unarmed = render(twoStepConfirm('launch', false));
    expect(unarmed).toContain('data-action="confirm-arm-launch"');
    expect(unarmed).toContain(CONFIRM_QUESTIONS.launch);
    expect(unarmed).not.toContain('Are you sure?');
    const armed = render(twoStepConfirm('launch', true));
    expect(armed).toContain('data-confirm-pending="launch"');
    expect(armed).toContain('Are you sure? Launch this organization?');
    expect(armed).toContain('data-action="confirm-cancel-launch"');
    expect(armed).toContain('data-action="confirm-launch"');
    expect(armed.match(/>Cancel<|>Confirm</g)?.length).toBe(2);
    // every confirm action carries a question (closed vocabulary)
    for (const question of Object.values(CONFIRM_QUESTIONS)) expect(question.endsWith('?')).toBe(true);
  });

  it('DETERMINISM: identical props -> identical bytes', () => {
    const review = reviewStep([['a', 'b']]);
    expect(render(review)).toBe(render(reviewStep([['a', 'b']])));
    expect(render(twoStepConfirm('cancel-launch', true))).toBe(render(twoStepConfirm('cancel-launch', true)));
  });
});
