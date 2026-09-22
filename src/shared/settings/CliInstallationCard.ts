export type CliInstallationCardState =
  | 'checking'
  | 'disabled'
  | 'blocked'
  | 'attention'
  | 'ready';

export interface CliInstallationCardOptions {
  container: HTMLElement;
  label: string;
  expanded?: boolean;
}

export interface CliInstallationCardController {
  card: HTMLElement;
  body: HTMLElement;
  setStatus: (state: CliInstallationCardState, text: string) => void;
}

let nextCardId = 0;

export function renderCliInstallationCard(
  options: CliInstallationCardOptions,
): CliInstallationCardController {
  const card = options.container.createDiv({ cls: 'claudian-cli-installation' });
  const heading = card.createDiv({ cls: 'claudian-cli-installation-heading' });
  const header = heading.createEl('button', {
    cls: 'claudian-cli-installation-header',
    attr: {
      type: 'button',
      'aria-label': `${options.label} CLI details`,
      'aria-expanded': String(options.expanded ?? true),
    },
  });
  const icon = header.createSpan({
    cls: 'claudian-cli-installation-icon',
    text: '⌘',
    attr: { 'aria-hidden': 'true' },
  });
  const dot = icon.createSpan({ cls: 'claudian-cli-installation-dot' });
  const summary = header.createSpan({ cls: 'claudian-cli-installation-summary' });
  summary.createSpan({ cls: 'claudian-cli-installation-title', text: options.label });
  const status = summary.createSpan({
    cls: 'claudian-cli-installation-status',
    attr: { role: 'status' },
  });
  const chevron = header.createSpan({
    cls: 'claudian-cli-installation-chevron',
    text: options.expanded === false ? '›' : '⌄',
    attr: { 'aria-hidden': 'true' },
  });
  const body = card.createDiv({ cls: 'claudian-cli-installation-body' });
  body.id = `claudian-cli-installation-${++nextCardId}`;
  body.hidden = options.expanded === false;
  header.setAttribute?.('aria-controls', body.id);
  header.setAttribute?.('aria-describedby', `${body.id}-status`);
  status.id = `${body.id}-status`;

  header.addEventListener?.('click', () => {
    body.hidden = !body.hidden;
    header.setAttribute?.('aria-expanded', String(!body.hidden));
    chevron.textContent = body.hidden ? '›' : '⌄';
  });

  const setStatus = (state: CliInstallationCardState, text: string): void => {
    dot.setAttribute?.('data-state', state);
    status.setText?.(text);
  };

  return { card, body, setStatus };
}
