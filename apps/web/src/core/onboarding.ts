// @tradrl/web-console — the onboarding wizard (UX-DESIGN.md §4.13, T051).
//
// Exactly three steps with the charter's own copy; skippable on every
// step; completion persists (localStorage `tradrl_onboarded`) and
// lands on Home; returning users skip straight to Home; the "?"
// affordance in Settings re-opens it.
//
// This module is PURE: the step machine is data + reducers, the
// wizard chrome is VNodes. The app layer owns the storage seam, the
// mount decision (first run vs returning) and the navigation.

import { v, type VNode } from '../render/vtree';

/** The localStorage key the onboarding completion persists under (§4.13). */
export const ONBOARDING_STORAGE_KEY = 'tradrl_onboarded';

/** The persisted value (a fixed marker string — the presence is the signal). */
export const ONBOARDING_STORED_VALUE = 'true';

/** One wizard step (the charter's own copy, verbatim). */
export interface OnboardingStep {
  /** The 0.7rem uppercase tracking eyebrow. */
  readonly eyebrow: string;
  /** The H1 (text-3xl / sm:text-4xl). */
  readonly title: string;
  /** The one-sentence body. */
  readonly sentence: string;
  /** The CTA label (h-12 min-w-44 rounded-full + arrow). */
  readonly cta: string;
}

/** THE THREE STEPS — the charter's copy, verbatim (§4.13). */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  {
    eyebrow: 'Welcome',
    title: 'Welcome to TradRL',
    sentence: 'Run a trading research organization: set a goal, watch it work, and audit every decision.',
    cta: 'Continue',
  },
  {
    eyebrow: 'How it works',
    title: 'How it works',
    sentence: 'Your organization researches, proposes, and executes under hard risk gates — with evidence attached to every step.',
    cta: 'Continue',
  },
  {
    eyebrow: "You're ready",
    title: "You're ready",
    sentence: 'Start by describing a goal; the console compiles an organization and you watch it work.',
    cta: 'Get started',
  },
]);

/** The wizard's state machine: a step index (0-2) or completed. */
export type OnboardingState = { readonly step: number } | { readonly completed: true };

/** The initial state: step one. */
export function initialOnboarding(): OnboardingState {
  return { step: 0 };
}

/** Advance one step; the last step's CTA completes the wizard. */
export function advanceOnboarding(state: OnboardingState): OnboardingState {
  if ('completed' in state) return state;
  return state.step + 1 >= ONBOARDING_STEPS.length ? { completed: true } : { step: state.step + 1 };
}

/** Skip completes the wizard from ANY step (§4.13 — skippable on every step). */
export function skipOnboarding(state: OnboardingState): OnboardingState {
  void state;
  return { completed: true };
}

/** True when the wizard has finished (completed or skipped — both persist). */
export function isOnboarded(state: OnboardingState): boolean {
  return 'completed' in state;
}

/** The stored-marker reader: any stored value that is not the marker means NOT onboarded (deterministic). */
export function readStoredOnboarding(storage: { getItem(key: string): string | null }): OnboardingState {
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_STORED_VALUE ? { completed: true } : { step: 0 };
  } catch {
    return { step: 0 }; // storage unavailable: show the wizard, session-only
  }
}

/** Persist the completion (a failure to persist never breaks the session). */
export function persistOnboarding(storage: { setItem(key: string, value: string): void }): void {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, ONBOARDING_STORED_VALUE);
  } catch {
    // storage unavailable: the completion holds for this session only
  }
}

/** The wizard chrome's glyph per step (a calm line mark in the soft teal circle). */
function stepGlyph(step: number): VNode {
  const mark = step === 0
    ? v('path', { d: 'M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z' }, [])
    : step === 1
      ? v('path', { d: 'M4 11 12 4l8 7v9h-5.5v-6h-5v6H4Z' }, [])
      : v('path', { d: 'M8.4 12.2l2.3 2.3 4.9-4.9' }, []);
  return v('svg', {
    class: 'ci ci-20',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [mark]);
}

/** The progress dots (§4.13): the active step is a 24×6px teal pill, inactive are 6px dots. */
export function onboardingDots(step: number): VNode {
  return v('div', { class: 'onboarding-dots', role: 'progressbar', 'aria-label': `Step ${step + 1} of ${ONBOARDING_STEPS.length}` }, ONBOARDING_STEPS.map((_, index) => v('span', {
    class: `onboarding-dot${index === step ? ' active' : index < step ? ' done' : ''}`,
    'aria-hidden': 'true',
  }, [])));
}

/** The wizard panel (one step): glyph circle + eyebrow + H1 + sentence + CTA + Skip + progress dots. */
export function onboardingPanel(state: OnboardingState): VNode {
  if ('completed' in state) return v('div', { class: 'onboarding-hidden', 'data-onboarding': 'completed' }, []);
  const step = ONBOARDING_STEPS[state.step];
  return v('div', {
    class: 'onboarding',
    'data-onboarding': `step-${state.step + 1}`,
    // FW-34-B (Round C register §3.1 — L3's finding: the restart-summoned
    // wizard was an A11Y-INVISIBLE div that BLOCKED native mouse clicks):
    // the overlay is a real, labelled DIALOG — assistive tech announces it,
    // and the backdrop itself is the mouse dismissal (the click handler's
    // onboarding-backdrop branch skips the wizard when the press lands
    // OUTSIDE the card; a dismissed wizard renders NOTHING at all, so it
    // can never block the page).
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'onboarding-title',
    'data-action': 'onboarding-backdrop',
  }, [
    v('div', { class: 'onboarding-card' }, [
      v('div', { class: 'onboarding-circle', 'aria-hidden': 'true' }, [stepGlyph(state.step)]),
      v('div', { class: 'onboarding-eyebrow' }, [step.eyebrow]),
      v('h1', { class: 'onboarding-title', id: 'onboarding-title' }, [step.title]),
      v('p', { class: 'onboarding-sentence' }, [step.sentence]),
      v('div', { class: 'onboarding-actions' }, [
        v('button', { class: 'onboarding-cta', 'data-action': 'onboarding-next', type: 'button' }, [
          step.cta,
          v('svg', { class: 'ci ci-16 onboarding-arrow', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }, [v('path', { d: 'M5 12h14M13 6l6 6-6 6' }, [])]),
        ]),
        v('button', { class: 'onboarding-skip', 'data-action': 'onboarding-skip', type: 'button' }, ['Skip']),
      ]),
      onboardingDots(state.step),
    ]),
  ]);
}

/** The "?" affordance in Settings (§4.13 — re-opens the wizard). */
export function onboardingReopenAffordance(): VNode {
  return v('button', { class: 'connection-retry', 'data-action': 'onboarding-reopen', type: 'button' }, ['Show the guided intro']);
}
