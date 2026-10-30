/** @jest-environment jsdom */

import type * as ObsidianModule from 'obsidian';
import { Notice, type TextAreaComponent } from 'obsidian';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { EnvironmentScope } from '@/core/types/settings';
import { claudeProviderRegistration } from '@/providers/claude/registration';
import { deepseekProviderRegistration } from '@/providers/deepseek/registration';
import {
  destroyEnvironmentSettingsSections,
  renderEnvironmentSettingsSection,
} from '@/shared/settings/EnvironmentSettingsSection';

jest.mock('obsidian', () => {
  const actual = jest.requireActual<typeof ObsidianModule>('obsidian');
  class DomTextAreaSetting extends actual.Setting {
    constructor(container: HTMLElement) {
      super(container);
      this.addTextArea = (callback) => {
        const inputEl = document.createElement('textarea');
        container.append(inputEl);
        const component = {
          inputEl,
          setValue(value: string) { inputEl.value = value; return this; },
          setPlaceholder(value: string) { inputEl.placeholder = value; return this; },
        } as unknown as TextAreaComponent;
        callback(component);
        return this;
      };
    }
  }
  return { ...actual, Setting: DomTextAreaSetting };
});

describe('renderEnvironmentSettingsSection', () => {
  beforeAll(() => {
    ProviderRegistry.register('claude', claudeProviderRegistration);
    ProviderRegistry.register('deepseek', deepseekProviderRegistration);
  });

  beforeEach(() => {
    jest.mocked(Notice).mockClear();
    Object.assign(HTMLElement.prototype, {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
      setText(this: HTMLElement, text: string) {
        this.textContent = text;
      },
    });
  });

  it('reports a rejected Preact environment update without leaking its cause or refreshing success state', async () => {
    jest.mocked(Notice).mockClear();
    const renderCustomContextLimits = jest.fn();
    const plugin = {
      settings: { envSnippets: [] },
      getEnvironmentVariablesForScope: () => 'AUDIT_KEY=draft',
      applyEnvironmentVariables: jest.fn(async () => {
        throw new Error('Synthetic failure with TOKEN=private-sentinel');
      }),
    } as unknown as ProviderHost;
    const container = document.createElement('div');
    document.body.append(container);
    const handle = renderEnvironmentSettingsSection({
      container, plugin, scope: 'shared', name: 'Environment', desc: '', placeholder: '',
      renderCustomContextLimits,
    });
    try {
      const field = container.querySelector('textarea')!;
      field.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(jest.mocked(Notice).mock.calls).toEqual([['Could not complete environment update.']]);
      expect(field.value).toBe('AUDIT_KEY=draft');
      expect(renderCustomContextLimits).toHaveBeenCalledTimes(1);
    } finally {
      handle.destroy();
      container.remove();
    }
  });

  it.each([
    { label: 'Preact before commit', commitBeforeFailure: false, expectedPersisted: 'AUDIT_KEY=before' },
    { label: 'DeepSeek Preact before commit', commitBeforeFailure: false, expectedPersisted: 'AUDIT_KEY=before', scope: 'provider:deepseek' },
    { label: 'Preact after commit', commitBeforeFailure: true, expectedPersisted: 'AUDIT_KEY=draft' },
  ])('retains the draft and recovers on retry after $label failure', async ({ commitBeforeFailure, expectedPersisted, scope: testScope = 'shared' }) => {
    const scope = testScope as EnvironmentScope;
    let persistedValue = 'AUDIT_KEY=before';
    let failApply = true;
    const renderCustomContextLimits = jest.fn();
    const applyEnvironmentVariables = jest.fn(async (_actualScope: string, value: string) => {
      if (failApply) {
        if (commitBeforeFailure) persistedValue = value;
        throw new Error('Synthetic failure with TOKEN=private-sentinel');
      }
      persistedValue = value;
    });
    const plugin = { settings: { envSnippets: [] }, getEnvironmentVariablesForScope: () => 'AUDIT_KEY=draft', applyEnvironmentVariables } as unknown as ProviderHost;
    const container = document.createElement('div');
    document.body.append(container);
    const handle = renderEnvironmentSettingsSection({
      container, plugin, scope, name: 'Environment', desc: '', placeholder: '',
      renderCustomContextLimits,
    });
    try {
      const field = container.querySelector('textarea')!;
      field.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(jest.mocked(Notice).mock.calls).toEqual([['Could not complete environment update.']]);
      expect(field.value).toBe('AUDIT_KEY=draft');
      expect(persistedValue).toBe(expectedPersisted);
      expect(renderCustomContextLimits).toHaveBeenCalledTimes(1);

      failApply = false;
      field.value = 'AUDIT_KEY=retry';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      field.dispatchEvent(new Event('blur', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(persistedValue).toBe('AUDIT_KEY=retry');
      expect(applyEnvironmentVariables).toHaveBeenLastCalledWith(scope, 'AUDIT_KEY=retry');
      expect(field.value).toBe('AUDIT_KEY=retry');
      expect(renderCustomContextLimits).toHaveBeenCalledTimes(2);
      expect(jest.mocked(Notice).mock.calls).toEqual([['Could not complete environment update.']]);
    } finally {
      handle.destroy();
      container.remove();
    }
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

  it.each(['provider:claude', 'provider:deepseek'] as const)('keeps the %s Preact field in sync when a scoped snippet is inserted', async (scope) => {
    const key = scope === 'provider:claude' ? 'ANTHROPIC_API_KEY' : 'DSH_HOME';
    const savedSnippet = {
      id: 'claude-dev',
      name: 'Claude dev',
      description: 'Development credentials',
      envVars: `${key}=from-snippet`,
      scope,
    };
    const settings = {
      envSnippets: [savedSnippet, { ...savedSnippet, id: 'other', name: 'Other provider', scope: 'provider:codex' as const }],
      customContextLimits: {},
      customModelAliases: {},
    };
    const environmentValues = new Map<string, string>([[scope, `${key}=before`]]);
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
      scope,
      name: 'Provider environment variables',
      desc: 'Variables passed to the provider.',
      placeholder: 'CUSTOM_KEY=your-key',
    });

    const insertButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert: Claude dev"]',
    );
    expect(insertButton).not.toBeNull();
    expect(container.querySelector('button[aria-label="Insert: Other provider"]')).toBeNull();
    insertButton?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(applyEnvironmentVariables).toHaveBeenCalledWith(
      scope,
      `${key}=from-snippet`,
    );
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toBe(`${key}=from-snippet`);
    textarea?.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(applyEnvironmentVariables).toHaveBeenLastCalledWith(
      scope,
      `${key}=from-snippet`,
    );

    destroyEnvironmentSettingsSections(container);
    handle.destroy();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.claudian-snippet-header')).toBeNull();
    container.remove();
  });
});
