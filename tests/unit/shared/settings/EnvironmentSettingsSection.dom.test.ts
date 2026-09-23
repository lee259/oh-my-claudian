/** @jest-environment jsdom */

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { claudeProviderRegistration } from '@/providers/claude/registration';
import {
  renderEnvironmentSettingsSection,
} from '@/shared/settings/EnvironmentSettingsSection';

describe('renderEnvironmentSettingsSection', () => {
  beforeAll(() => {
    ProviderRegistry.register('claude', claudeProviderRegistration);
  });

  beforeEach(() => {
    Object.assign(HTMLElement.prototype, {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
      setText(this: HTMLElement, text: string) {
        this.textContent = text;
      },
    });
  });

  it('renders and saves the Preact environment field, then unmounts it on destroy', async () => {
    const applyEnvironmentVariables = jest.fn(() => Promise.resolve());
    const plugin = {
      settings: { envSnippets: [] },
      getEnvironmentVariablesForScope: jest.fn(() => 'PATH=/usr/bin'),
      applyEnvironmentVariables,
    } as unknown as ProviderHost;
    const container = document.createElement('div');
    document.body.append(container);
    const handle = renderEnvironmentSettingsSection({
      container,
      plugin,
      scope: 'provider:claude',
      name: 'Claude environment variables',
      desc: 'Variables passed to Claude.',
      placeholder: 'ANTHROPIC_API_KEY=your-key',
      usePreactEnvironmentField: true,
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toBe('PATH=/usr/bin');
    expect(textarea?.getAttribute('data-env-scope')).toBe('provider:claude');

    if (!textarea) throw new Error('Expected Preact environment textarea');
    textarea.value = 'FOO=bar';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe('Review environment ownership for: FOO');

    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(applyEnvironmentVariables).toHaveBeenCalledWith('provider:claude', 'FOO=bar');

    handle.destroy();
    expect(container.querySelector('.claudian-environment-field-host')?.childElementCount).toBe(0);
    container.remove();
  });

  it('keeps a Preact environment field in sync when a saved snippet is inserted', async () => {
    const savedSnippet = {
      id: 'claude-dev',
      name: 'Claude dev',
      description: 'Development credentials',
      envVars: 'ANTHROPIC_API_KEY=from-snippet',
      scope: 'provider:claude' as const,
    };
    const settings = {
      envSnippets: [savedSnippet],
      customContextLimits: {},
      customModelAliases: {},
    };
    const environmentValues = new Map([['provider:claude', 'ANTHROPIC_API_KEY=before']]);
    const applyEnvironmentVariables = jest.fn(async (scope: string, value: string) => {
      environmentValues.set(scope, value);
    });
    const plugin = {
      settings,
      app: { workspace: { getLeavesOfType: jest.fn(() => []) } },
      getEnvironmentVariablesForScope: jest.fn((scope: string) => environmentValues.get(scope) ?? ''),
      applyEnvironmentVariables,
      mutateSettings: jest.fn(async (mutator: (value: typeof settings) => void) => mutator(settings)),
    } as unknown as ProviderHost;
    const container = document.createElement('div');
    document.body.append(container);
    const handle = renderEnvironmentSettingsSection({
      container,
      plugin,
      scope: 'provider:claude',
      name: 'Claude environment variables',
      desc: 'Variables passed to Claude.',
      placeholder: 'ANTHROPIC_API_KEY=your-key',
      usePreactEnvironmentField: true,
      usePreactSnippetList: true,
    });

    const insertButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert: Claude dev"]',
    );
    expect(insertButton).not.toBeNull();
    insertButton?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(applyEnvironmentVariables).toHaveBeenCalledWith(
      'provider:claude',
      'ANTHROPIC_API_KEY=from-snippet',
    );
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toBe('ANTHROPIC_API_KEY=from-snippet');
    textarea?.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(applyEnvironmentVariables).toHaveBeenLastCalledWith(
      'provider:claude',
      'ANTHROPIC_API_KEY=from-snippet',
    );

    handle.destroy();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.claudian-snippet-header')).toBeNull();
    container.remove();
  });
});
