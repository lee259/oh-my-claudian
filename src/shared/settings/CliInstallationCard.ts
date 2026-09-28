import type { ProviderIconSvg } from '../../core/providers/types';
import { createProviderIconSvg } from '../icons';

export type CliInstallationCardState =
  | 'checking'
  | 'disabled'
  | 'blocked'
  | 'attention'
  | 'ready';

export interface CliInstallationCardOptions {
  container: HTMLElement;
  icon?: ProviderIconSvg;
  label: string;
  expanded?: boolean;
}

export interface CliInstallationCardSummary {
  version?: string | null;
  sourceText?: string;
  path?: string | null;
}

export interface CliInstallationCardController {
  card: HTMLElement;
  body: HTMLElement;
  enablement: HTMLElement;
  setStatus: (state: CliInstallationCardState, text: string) => void;
  setSummary: (summary: CliInstallationCardSummary) => void;
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
  const card = mount.createDiv({ cls: 'claudian-cli-installation' });
  const heading = card.createDiv({ cls: 'claudian-cli-installation-heading' });
  const header = heading.createEl('button', {
    cls: 'claudian-cli-installation-header',
    attr: {
      type: 'button',
      'aria-label': `${options.label} details`,
      'aria-expanded': String(options.expanded ?? true),
    },
  });
  const icon = header.createSpan({ cls: 'claudian-cli-installation-icon', attr: { 'aria-hidden': 'true' } });
  if (options.icon) {
    createProviderIconSvg(options.icon, { parent: icon, width: 26, height: 26 });
  } else {
    icon.setText('⌘');
  }
  const dot = icon.createSpan({ cls: 'claudian-cli-installation-dot' });
  const details = header.createSpan({ cls: 'claudian-cli-installation-summary' });
  const title = details.createSpan({ cls: 'claudian-cli-installation-title' });
  title.createSpan({ text: options.label });
  const version = title.createSpan({ cls: 'claudian-cli-installation-version' });
  const source = details.createSpan({ cls: 'claudian-cli-installation-source' });
  const status = details.createSpan({
    cls: 'claudian-cli-installation-status',
    attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const chevron = header.createSpan({
    cls: 'claudian-cli-installation-chevron',
    text: options.expanded === false ? '›' : '⌄',
    attr: { 'aria-hidden': 'true' },
  });
  const enablement = heading.createDiv({ cls: 'claudian-cli-installation-enablement' });
  const pathRow = card.createDiv({ cls: 'claudian-cli-installation-path' });
  const path = pathRow.createEl('code');
  const body = card.createDiv({ cls: 'claudian-cli-installation-body' });
  const bodyId = `claudian-cli-installation-${++nextCardId}`;
  const headerId = `${bodyId}-header`;
  const statusId = `${bodyId}-status`;
  body.id = bodyId;
  body.hidden = options.expanded === false;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', headerId);
  header.id = headerId;
  header.setAttribute('aria-controls', bodyId);
  header.setAttribute('aria-describedby', statusId);
  status.id = statusId;

  header.addEventListener('click', () => {
    body.hidden = !body.hidden;
    header.setAttribute('aria-expanded', String(!body.hidden));
    chevron.setText(body.hidden ? '›' : '⌄');
  });

  const setStatus = (state: CliInstallationCardState, text: string): void => {
    card.dataset.state = state;
    dot.dataset.state = state;
    status.setText(text);
  };

  const setSummary = (summary: CliInstallationCardSummary): void => {
    version.setText(summary.version ? `v${summary.version.replace(/^v/u, '')}` : '');
    source.setText(summary.sourceText ?? '');
    path.setText(summary.path ?? '');
    pathRow.title = summary.path ?? '';
    pathRow.hidden = !summary.path;
  };

  const destroy = (): void => {
    if (!mountedCardDestructors.has(mount)) return;
    mountedCardDestructors.delete(mount);
    mount.remove();
  };

  mountedCardDestructors.set(mount, destroy);
  return { card, body, enablement, setStatus, setSummary, destroy };
}
