import { h } from 'preact';

import { createPreactRoot } from '../ui/PreactRoot';
import {
  CliInstallationCardView,
  type CliInstallationCardViewState,
} from './CliInstallationCardView';

export type CliInstallationCardState = CliInstallationCardViewState;

export interface CliInstallationCardOptions {
  container: HTMLElement;
  label: string;
  expanded?: boolean;
}

export interface CliInstallationCardSummary {
  version?: string | null;
  sourceText?: string;
  path?: string | null;
}

export interface CliInstallationCardToggle {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => Promise<void> | void;
}

export interface CliInstallationCardController {
  card: HTMLElement;
  body: HTMLElement;
  setStatus: (state: CliInstallationCardState, text: string) => void;
  setSummary: (summary: CliInstallationCardSummary) => void;
  setToggle: (toggle: CliInstallationCardToggle | null) => void;
  destroy: () => void;
}

let nextCardId = 0;
const mountedCardDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount all CLI cards owned by a settings content host before it is cleared. */
export function destroyCliInstallationCards(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-cli-installation-mount'),
  );
  if (container.classList.contains('claudian-cli-installation-mount')) {
    mounts.unshift(container);
  }
  for (const mount of mounts) {
    mountedCardDestructors.get(mount)?.();
  }
}

export function renderCliInstallationCard(
  options: CliInstallationCardOptions,
): CliInstallationCardController {
  const mount = options.container.createDiv({ cls: 'claudian-cli-installation-mount' });
  const root = createPreactRoot(mount);
  const bodyId = `claudian-cli-installation-${++nextCardId}`;
  let expanded = options.expanded ?? true;
  let state: CliInstallationCardState = 'checking';
  let statusText = '';
  let body: HTMLElement | null = null;
  let summary: CliInstallationCardSummary = {};
  let toggle: CliInstallationCardToggle | null = null;

  const render = (): void => {
    root.render(h(CliInstallationCardView, {
      label: options.label,
      version: summary.version ?? '',
      sourceText: summary.sourceText ?? '',
      path: summary.path ?? '',
      headerToggle: toggle ? {
        name: toggle.name,
        checked: toggle.checked,
        disabled: toggle.disabled ?? false,
        onChange: toggle.onChange,
      } : undefined,
      bodyId,
      state,
      statusText,
      expanded,
      onToggle: () => {
        expanded = !expanded;
        render();
      },
      bodyRef: (nextBody) => {
        body = nextBody;
      },
    }));
  };

  render();

  const card = mount.querySelector<HTMLElement>('.claudian-cli-installation');
  if (!card || !body) {
    root.unmount();
    mount.remove();
    throw new Error('Could not mount the CLI installation card.');
  }

  const setStatus = (nextState: CliInstallationCardState, text: string): void => {
    state = nextState;
    statusText = text;
    render();
  };

  const setSummary = (nextSummary: CliInstallationCardSummary): void => {
    summary = nextSummary;
    render();
  };

  const setToggle = (nextToggle: CliInstallationCardToggle | null): void => {
    toggle = nextToggle;
    render();
  };

  const destroy = (): void => {
    if (!mountedCardDestructors.has(mount)) {
      return;
    }
    mountedCardDestructors.delete(mount);
    root.unmount();
    mount.remove();
  };

  mountedCardDestructors.set(mount, destroy);

  return { card, body, setStatus, setSummary, setToggle, destroy };
}
