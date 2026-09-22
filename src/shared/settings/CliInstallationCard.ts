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

export interface CliInstallationCardController {
  card: HTMLElement;
  body: HTMLElement;
  setStatus: (state: CliInstallationCardState, text: string) => void;
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

  const render = (): void => {
    root.render(h(CliInstallationCardView, {
      label: options.label,
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

  const destroy = (): void => {
    if (!mountedCardDestructors.has(mount)) {
      return;
    }
    mountedCardDestructors.delete(mount);
    root.unmount();
    mount.remove();
  };

  mountedCardDestructors.set(mount, destroy);

  return { card, body, setStatus, destroy };
}
