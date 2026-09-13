import type { ProviderCapabilities } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';

const WELCOME_BRAND_NAME = 'Oh My Claudian';

type WelcomeCapabilityKey = keyof Pick<
  ProviderCapabilities,
  | 'supportsPlanMode'
  | 'supportsRewind'
  | 'supportsFork'
  | 'supportsProviderCommands'
  | 'supportsImageAttachments'
  | 'supportsMcpTools'
  | 'supportsTurnSteer'
>;

const WELCOME_CAPABILITIES: ReadonlyArray<{
  key: WelcomeCapabilityKey;
  label: 'settings.capabilityMatrix.rows.planMode'
    | 'settings.capabilityMatrix.rows.rewind'
    | 'settings.capabilityMatrix.rows.fork'
    | 'settings.capabilityMatrix.rows.providerCommands'
    | 'settings.capabilityMatrix.rows.imageAttachments'
    | 'settings.capabilityMatrix.rows.mcpTools'
    | 'settings.capabilityMatrix.rows.turnSteer';
}> = [
  { key: 'supportsPlanMode', label: 'settings.capabilityMatrix.rows.planMode' },
  { key: 'supportsRewind', label: 'settings.capabilityMatrix.rows.rewind' },
  { key: 'supportsFork', label: 'settings.capabilityMatrix.rows.fork' },
  { key: 'supportsProviderCommands', label: 'settings.capabilityMatrix.rows.providerCommands' },
  { key: 'supportsImageAttachments', label: 'settings.capabilityMatrix.rows.imageAttachments' },
  { key: 'supportsMcpTools', label: 'settings.capabilityMatrix.rows.mcpTools' },
  { key: 'supportsTurnSteer', label: 'settings.capabilityMatrix.rows.turnSteer' },
];

export interface WelcomeProviderSummary {
  displayName: string;
  capabilities: ProviderCapabilities;
}

function renderCapabilitySummary(
  welcomeEl: HTMLElement,
  providerSummary: WelcomeProviderSummary,
): void {
  const supported = WELCOME_CAPABILITIES
    .filter(({ key }) => providerSummary.capabilities[key])
    .map(({ label }) => t(label));
  const unsupported = WELCOME_CAPABILITIES
    .filter(({ key }) => !providerSummary.capabilities[key])
    .map(({ label }) => t(label));

  const summaryEl = welcomeEl.createDiv({ cls: 'claudian-welcome-capability-summary' });
  summaryEl.createDiv({
    cls: 'claudian-welcome-provider-name',
    text: providerSummary.displayName,
  });
  summaryEl.createDiv({
    cls: 'claudian-welcome-capability-line claudian-welcome-capability-line--supported',
    text: t('chat.welcome.availableCapabilities', { capabilities: supported.join(' · ') }),
  });

  if (unsupported.length > 0) {
    summaryEl.createDiv({
      cls: 'claudian-welcome-capability-line claudian-welcome-capability-line--unsupported',
      text: t('chat.welcome.unavailableCapabilities', { capabilities: unsupported.join(' · ') }),
    });
  }
}

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'claudian-welcome-brand claudian-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'claudian-welcome-greeting claudian-welcome-text',
      text: greeting,
    });
  }

  if (providerSummary) {
    renderCapabilitySummary(welcomeEl, providerSummary);
  }
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
  providerSummary?: WelcomeProviderSummary,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'claudian-welcome' });
  renderWelcomeContent(welcomeEl, greeting, providerSummary);
  return welcomeEl;
}
