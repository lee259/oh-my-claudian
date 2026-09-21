import { h } from 'preact';

import { createPreactRoot, type PreactRoot } from '../../../shared/ui/PreactRoot';
import {
  type WelcomeHomeOptions,
  type WelcomeProviderSummary,
  WelcomeView,
} from '../ui/WelcomeView';
import { renderLegacyWelcomeContent } from './WelcomeLegacyRenderer';

export type { WelcomeHomeOptions, WelcomeProviderSummary } from '../ui/WelcomeView';

type WelcomeRenderState = {
  root: PreactRoot | null;
  greeting?: string;
  providerSummary?: WelcomeProviderSummary;
  homeOptions?: WelcomeHomeOptions;
};

const welcomeRoots = new WeakMap<HTMLElement, WelcomeRenderState>();

function renderWelcomeView(
  welcomeEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
  homeOptions?: WelcomeHomeOptions,
): void {
  welcomeEl.classList.toggle('claudian-welcome--home', Boolean(homeOptions));

  let state = welcomeRoots.get(welcomeEl);
  if (!state) {
    state = { root: null };
    welcomeRoots.set(welcomeEl, state);
  }

  state.greeting = greeting;
  state.providerSummary = providerSummary;
  state.homeOptions = homeOptions;
  if (!canMountPreact(welcomeEl)) {
    renderLegacyWelcomeContent(welcomeEl, greeting, providerSummary, homeOptions);
    return;
  }

  state.root ??= createPreactRoot(welcomeEl);
  state.root.render(h(WelcomeView, {
    greeting,
    providerSummary,
    homeOptions,
  }));
}

function canMountPreact(welcomeEl: HTMLElement): boolean {
  return welcomeEl.nodeType === 1
    && typeof welcomeEl.ownerDocument?.createElement === 'function';
}

/** Renders or updates the Preact-owned welcome subtree in an existing host. */
export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
  homeOptions?: WelcomeHomeOptions,
): void {
  renderWelcomeView(welcomeEl, greeting, providerSummary, homeOptions);
}

/** Re-renders a mounted welcome surface after its lazy presentation data changes. */
export function refreshWelcomeContent(welcomeEl: HTMLElement | null): void {
  if (!welcomeEl) return;
  const state = welcomeRoots.get(welcomeEl);
  if (!state) return;
  renderWelcomeView(
    welcomeEl,
    state.greeting,
    state.providerSummary,
    state.homeOptions,
  );
}

/** Releases Preact event handlers before a welcome host is removed or emptied. */
export function unmountWelcomeElement(welcomeEl: HTMLElement | null): void {
  if (!welcomeEl) return;
  welcomeRoots.get(welcomeEl)?.root?.unmount();
  welcomeRoots.delete(welcomeEl);
}

/** Releases the current welcome subtree owned by a messages container. */
export function unmountWelcomeContent(parentEl: HTMLElement): void {
  const welcomeEl = parentEl.querySelector<HTMLElement>('.claudian-welcome');
  unmountWelcomeElement(welcomeEl);
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
  homeOptions?: WelcomeHomeOptions,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'claudian-welcome' });
  renderWelcomeView(welcomeEl, greeting, providerSummary, homeOptions);
  return welcomeEl;
}
