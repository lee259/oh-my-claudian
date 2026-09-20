import { setIcon } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type { WelcomeHomeOptions, WelcomeProviderSummary } from '../ui/WelcomeView';
import { formatActivity } from '../utils/formatActivity';

const CAPABILITIES: ReadonlyArray<{
  key: keyof Pick<
    ProviderCapabilities,
    | 'supportsPlanMode'
    | 'supportsRewind'
    | 'supportsFork'
    | 'supportsProviderCommands'
    | 'supportsImageAttachments'
    | 'supportsMcpTools'
    | 'supportsTurnSteer'
  >;
  label: Parameters<typeof t>[0];
}> = [
  { key: 'supportsPlanMode', label: 'settings.capabilityMatrix.rows.planMode' },
  { key: 'supportsRewind', label: 'settings.capabilityMatrix.rows.rewind' },
  { key: 'supportsFork', label: 'settings.capabilityMatrix.rows.fork' },
  { key: 'supportsProviderCommands', label: 'settings.capabilityMatrix.rows.providerCommands' },
  { key: 'supportsImageAttachments', label: 'settings.capabilityMatrix.rows.imageAttachments' },
  { key: 'supportsMcpTools', label: 'settings.capabilityMatrix.rows.mcpTools' },
  { key: 'supportsTurnSteer', label: 'settings.capabilityMatrix.rows.turnSteer' },
];

export function renderLegacyWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
  homeOptions?: WelcomeHomeOptions,
): void {
  welcomeEl.empty();
  welcomeEl.toggleClass('claudian-welcome--home', Boolean(homeOptions));

  if (homeOptions) {
    const header = welcomeEl.createDiv({ cls: 'claudian-home-header' });
    header.createDiv({ cls: 'claudian-home-title', text: t('chat.home.title') });
    const actions = header.createDiv({ cls: 'claudian-home-actions' });
    const addAction = (icon: string, label: string, onClick?: () => void): void => {
      const button = actions.createEl('button', {
        cls: 'claudian-home-action',
        attr: { type: 'button', 'aria-label': label },
      });
      setIcon(button, icon);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick?.();
      });
    };
    addAction('history', t('chat.home.history'), homeOptions.onOpenHistory);
    addAction('settings', t('chat.home.settings'), homeOptions.onOpenSettings);
    addAction('square-pen', t('chat.home.newConversation'), homeOptions.onNewConversation);

    const recent = welcomeEl.createDiv({ cls: 'claudian-home-recent' });
    const conversations = [...homeOptions.getConversations()]
      .filter(conversation => !conversation.isArchived)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    conversations.slice(0, 3).forEach((conversation) => {
      const row = recent.createEl('button', {
        cls: 'claudian-home-conversation',
        attr: { type: 'button', 'aria-label': conversation.title },
      });
      row.createSpan({ cls: 'claudian-home-conversation-title', text: conversation.title });
      row.createSpan({
        cls: 'claudian-home-conversation-time',
        text: formatActivity(conversation.lastActivityAt),
      });
      if (conversation.titleGenerationStatus === 'pending') {
        const loadingEl = row.createSpan({
          cls: 'claudian-home-conversation-loading',
        });
        setIcon(loadingEl, 'loader-2');
        loadingEl.setAttribute('aria-label', t('chat.history.generatingTitle'));
      }
      row.addEventListener('click', (event) => {
        event.stopPropagation();
        homeOptions.onOpenConversation?.(conversation.id);
      });
    });
    const allButton = recent.createEl('button', {
      cls: 'claudian-home-all-conversations',
      attr: { type: 'button' },
    });
    allButton.setText(t('chat.home.viewAll', { count: conversations.length }));
    allButton.addEventListener('click', (event) => {
      event.stopPropagation();
      homeOptions.onOpenHistory?.();
    });
    const center = welcomeEl.createDiv({ cls: 'claudian-home-center' });
    if (greeting) center.createDiv({ cls: 'claudian-home-greeting', text: greeting });
    return;
  }

  welcomeEl.createDiv({ cls: 'claudian-welcome-brand claudian-welcome-text', text: 'Oh My Claudian' });
  if (greeting) {
    welcomeEl.createDiv({ cls: 'claudian-welcome-greeting claudian-welcome-text', text: greeting });
  }
  if (!providerSummary) return;

  const supported = CAPABILITIES
    .filter(({ key }) => providerSummary.capabilities[key])
    .map(({ label }) => t(label));
  const unsupported = CAPABILITIES
    .filter(({ key }) => !providerSummary.capabilities[key])
    .map(({ label }) => t(label));
  const summary = welcomeEl.createDiv({ cls: 'claudian-welcome-capability-summary' });
  summary.createDiv({ cls: 'claudian-welcome-provider-name', text: providerSummary.displayName });
  summary.createDiv({
    cls: 'claudian-welcome-capability-line claudian-welcome-capability-line--supported',
    text: t('chat.welcome.availableCapabilities', { capabilities: supported.join(' · ') }),
  });
  if (unsupported.length > 0) {
    summary.createDiv({
      cls: 'claudian-welcome-capability-line claudian-welcome-capability-line--unsupported',
      text: t('chat.welcome.unavailableCapabilities', { capabilities: unsupported.join(' · ') }),
    });
  }
}
