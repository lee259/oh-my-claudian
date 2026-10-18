/** @jest-environment jsdom */

import { fireEvent, waitFor, within } from '@testing-library/dom';
import { Notice } from 'obsidian';
import { deserialize, serialize } from 'v8';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { EnvSnippet } from '@/core/types';
import { setLocale, t } from '@/i18n/i18n';
import { EnvSnippetManager } from '@/shared/settings/EnvSnippetManager';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  class MockModal {
    contentEl = document.createElement('div');
    modalEl = document.createElement('div');
    constructor(public app: unknown) { this.modalEl.append(this.contentEl); }
    setTitle(title: string): void {
      this.modalEl.setAttribute('role', 'dialog');
      this.modalEl.setAttribute('aria-label', title);
    }
    onOpen(): void {}
    onClose(): void {}
    open(): void { document.body.append(this.modalEl); this.onOpen(); }
    close(): void { this.onClose(); this.modalEl.remove(); }
  }
  class MockText {
    constructor(public inputEl: HTMLInputElement | HTMLTextAreaElement) {}
    setValue(value: string): this { this.inputEl.value = value; return this; }
  }
  class MockSetting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    private name = '';
    constructor(container: HTMLElement) {
      this.settingEl = container.createDiv();
      this.controlEl = this.settingEl.createDiv();
    }
    setName(name: string): this { this.name = name; return this; }
    setDesc(): this { return this; }
    addText(callback: (text: MockText) => void): this {
      const input = this.controlEl.createEl('input');
      input.setAttribute('aria-label', this.name);
      callback(new MockText(input));
      return this;
    }
    addTextArea(callback: (text: MockText) => void): this {
      const input = this.controlEl.createEl('textarea');
      input.setAttribute('aria-label', this.name);
      callback(new MockText(input));
      return this;
    }
  }
  return { ...actual, Modal: MockModal, Setting: MockSetting, Notice: jest.fn() };
});

const originalEmpty = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'empty');
const originalSetText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setText');
const originalClone = globalThis.structuredClone;
const managers: EnvSnippetManager[] = [];

beforeAll(() => {
  HTMLElement.prototype.empty = function (): void { this.replaceChildren(); };
  HTMLElement.prototype.setText = function (text: string): void { this.textContent = text; };
  globalThis.structuredClone = value => deserialize(serialize(value));
});

afterAll(() => {
  for (const [name, descriptor] of [['empty', originalEmpty], ['setText', originalSetText]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
  globalThis.structuredClone = originalClone;
});

afterEach(async () => {
  // Join the modal's deferred focus before releasing its DOM.
  await new Promise(resolve => setTimeout(resolve, 60));
  for (const manager of managers.splice(0)) manager.destroy();
  document.body.replaceChildren();
  jest.clearAllMocks();
  setLocale('en');
});

function createHarness(usePreactView: boolean, action: 'save' | 'update', fail: boolean) {
  const saved: EnvSnippet = {
    id: 'saved', name: 'Saved configuration', description: '', envVars: 'DEMO_KEY=old', scope: 'shared',
  };
  const settings = { envSnippets: action === 'update' ? [saved] : [], customContextLimits: {}, customModelAliases: {} };
  const persist = jest.fn(async () => {
    if (fail) throw new Error('write failed; DEMO_KEY=private-environment-value');
  });
  const coordinator = new SettingsCoordinator(settings, persist);
  const host = {
    app: {}, settings,
    getEnvironmentVariablesForScope: () => 'DEMO_KEY=private-environment-value',
    mutateSettings: (mutation: Parameters<typeof coordinator.mutate>[0]) => coordinator.mutate(mutation),
  } as unknown as ProviderHost;
  const container = document.body.createDiv();
  managers.push(new EnvSnippetManager(container, host, 'shared', undefined, { usePreactView }));
  const buttonName = action === 'save'
    ? t('settings.envSnippets.addBtn')
    : new RegExp(`^${t('settings.envSnippets.editBtn')}`);
  fireEvent.click(within(container).getByRole('button', { name: buttonName }));
  const dialog = within(document.body).getByRole('dialog');
  fireEvent.input(within(dialog).getByRole('textbox', { name: t('settings.envSnippets.modal.name') }), {
    target: { value: 'New configuration' },
  });
  fireEvent.click(within(dialog).getByRole('button', {
    name: t(action === 'save' ? 'settings.envSnippets.modal.save' : 'settings.envSnippets.modal.update'),
  }));
  return { container, persist, saved, settings };
}

describe.each([false, true])('environment snippet persistence (Preact: %s)', usePreactView => {
  it.each(['save', 'update'] as const)('reports a failed %s without publishing success or exposing environment data', async action => {
    const { container, persist, saved, settings } = createHarness(usePreactView, action, true);
    await waitFor(() => expect(Notice).toHaveBeenCalledWith(
      action === 'save' ? 'Could not save environment snippet' : 'Could not update environment snippet',
    ));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(settings.envSnippets).toEqual(action === 'save' ? [] : [saved]);
    expect(container.textContent).not.toContain('New configuration');
    expect(jest.mocked(Notice).mock.calls).toHaveLength(1);
  });

  it.each(['save', 'update'] as const)('publishes a successful %s after persistence', async action => {
    const { container, persist, settings } = createHarness(usePreactView, action, false);
    await waitFor(() => expect(container.textContent).toContain('New configuration'));
    expect(settings.envSnippets).toHaveLength(1);
    expect(settings.envSnippets[0].name).toBe('New configuration');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith(`Environment snippet "New configuration" ${action === 'save' ? 'saved' : 'updated'}`);
  });
});
