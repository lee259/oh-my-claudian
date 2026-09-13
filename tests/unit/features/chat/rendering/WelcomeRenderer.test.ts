import { createMockEl } from '@test/helpers/MockElement';

import {
  createWelcomeElement,
  renderWelcomeContent,
} from '@/features/chat/rendering/WelcomeRenderer';

const PROVIDER_SUMMARY = {
  displayName: 'Codex',
  capabilities: {
    providerId: 'codex' as const,
    supportsNativeHistory: false,
    supportsPlanMode: true,
    supportsRewind: false,
    supportsFork: true,
    supportsProviderCommands: false,
    supportsImageAttachments: true,
    supportsInstructionMode: false,
    supportsMcpTools: false,
    supportsTurnSteer: false,
    reasoningControl: 'none' as const,
  },
};

describe('Welcome', () => {
  it('renders Oh My Claudian branding before the dynamic greeting', () => {
    const parentEl = createMockEl();

    const welcomeEl = createWelcomeElement(parentEl, 'Good morning');

    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.children[0].hasClass('claudian-welcome-brand')).toBe(true);
    expect(welcomeEl.children[0].hasClass('claudian-welcome-text')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Oh My Claudian');
    expect(welcomeEl.children[1].hasClass('claudian-welcome-greeting')).toBe(true);
    expect(welcomeEl.children[1].hasClass('claudian-welcome-text')).toBe(true);
    expect(welcomeEl.children[1].textContent).toBe('Good morning');
  });

  it('replaces existing welcome content instead of duplicating branding', () => {
    const welcomeEl = createMockEl();

    renderWelcomeContent(welcomeEl, 'Hello');
    renderWelcomeContent(welcomeEl, 'Welcome back');

    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.querySelectorAll('.claudian-welcome-brand')).toHaveLength(1);
    expect(welcomeEl.querySelector('.claudian-welcome-greeting')?.textContent)
      .toBe('Welcome back');
  });

  it('can render the brand before a greeting is available', () => {
    const parentEl = createMockEl();

    const welcomeEl = createWelcomeElement(parentEl);

    expect(welcomeEl.children).toHaveLength(1);
    expect(welcomeEl.children[0].textContent).toBe('Oh My Claudian');
  });

  it('explains the current provider capabilities on an empty conversation', () => {
    const parentEl = createMockEl();

    const welcomeEl = createWelcomeElement(parentEl, undefined, PROVIDER_SUMMARY);

    expect(welcomeEl.querySelector('.claudian-welcome-provider-name')?.textContent).toBe('Codex');
    expect(welcomeEl.querySelector('.claudian-welcome-capability-line--supported')?.textContent)
      .toContain('Plan mode · Fork · Image attachments');
    expect(welcomeEl.querySelector('.claudian-welcome-capability-line--unsupported')?.textContent)
      .toContain('Rewind · Provider commands · MCP tools · Turn steering');
  });
});
