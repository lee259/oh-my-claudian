/** @jest-environment jsdom */

import '@/providers';

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

function createHarness(action: 'save' | 'update', fail: boolean) {
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
  managers.push(new EnvSnippetManager(container, host, 'shared'));
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

function createButtonTypeHarness() {
  const saved: EnvSnippet = {
    id: 'saved', name: 'Saved configuration', description: '', envVars: 'DEMO_KEY=value', scope: 'shared',
  };
  const settings = { envSnippets: [saved], customContextLimits: {}, customModelAliases: {} };
  const host = {
    app: {},
    settings,
    getEnvironmentVariablesForScope: () => saved.envVars,
  } as unknown as ProviderHost;
  const container = document.body.createDiv();
  managers.push(new EnvSnippetManager(container, host, 'shared'));
  return container;
}

it('renders the supported Preact list by default', () => {
  const container = document.body.createDiv();
  const host = { settings: { envSnippets: [{ id: 'one', name: 'Example', envVars: 'X=1', scope: 'shared' }] } } as unknown as ProviderHost;
  managers.push(new EnvSnippetManager(container, host, 'shared'));
  expect(within(container).getByRole('listitem').textContent).toContain('Example');
});

it('declares snippet list actions as non-submit buttons', () => {
  const container = createButtonTypeHarness();
  const buttons = [
    within(container).getByRole('button', { name: t('settings.envSnippets.addBtn') }),
    within(container).getByRole('button', { name: new RegExp(`^${t('settings.envSnippets.insertBtn')}`) }),
    within(container).getByRole('button', { name: new RegExp(`^${t('settings.envSnippets.editBtn')}`) }),
    within(container).getByRole('button', { name: new RegExp(`^${t('settings.envSnippets.deleteBtn')}`) }),
  ];

  for (const button of buttons) expect(button.getAttribute('type')).toBe('button');
});

it('declares snippet modal actions as non-submit buttons', () => {
  const container = createButtonTypeHarness();
  fireEvent.click(within(container).getByRole('button', { name: t('settings.envSnippets.addBtn') }));
  let dialog = within(document.body).getByRole('dialog');

  expect(within(dialog).getByRole('button', { name: t('settings.envSnippets.modal.cancel') }).getAttribute('type'))
    .toBe('button');
  expect(within(dialog).getByRole('button', { name: t('settings.envSnippets.modal.save') }).getAttribute('type'))
    .toBe('button');

  fireEvent.click(within(dialog).getByRole('button', { name: t('settings.envSnippets.modal.cancel') }));
  fireEvent.click(within(container).getByRole('button', {
    name: new RegExp(`^${t('settings.envSnippets.editBtn')}`),
  }));
  dialog = within(document.body).getByRole('dialog');

  expect(within(dialog).getByRole('button', { name: t('settings.envSnippets.modal.cancel') }).getAttribute('type'))
    .toBe('button');
  expect(within(dialog).getByRole('button', { name: t('settings.envSnippets.modal.update') }).getAttribute('type'))
    .toBe('button');
});

describe('environment snippet persistence', () => {
  it.each(['save', 'update'] as const)('reports a failed %s without publishing success or exposing environment data', async action => {
    const { container, persist, saved, settings } = createHarness(action, true);
    await waitFor(() => expect(Notice).toHaveBeenCalledWith(
      action === 'save' ? 'Could not save environment snippet' : 'Could not update environment snippet',
    ));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(settings.envSnippets).toEqual(action === 'save' ? [] : [saved]);
    expect(container.textContent).not.toContain('New configuration');
    const dialog = within(document.body).getByRole('dialog');
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: t('settings.envSnippets.modal.name') }).value)
      .toBe('New configuration');
    expect(jest.mocked(Notice).mock.calls).toHaveLength(1);
    persist.mockResolvedValueOnce(undefined);
    fireEvent.click(within(dialog).getByRole('button', {
      name: t(action === 'save' ? 'settings.envSnippets.modal.save' : 'settings.envSnippets.modal.update'),
    }));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(settings.envSnippets).toHaveLength(1);
    expect(settings.envSnippets[0].name).toBe('New configuration');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it.each(['save', 'update'] as const)('publishes a successful %s after persistence', async action => {
    const { container, persist, settings } = createHarness(action, false);
    await waitFor(() => expect(container.textContent).toContain('New configuration'));
    expect(settings.envSnippets).toHaveLength(1);
    expect(settings.envSnippets[0].name).toBe('New configuration');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith(`Environment snippet "New configuration" ${action === 'save' ? 'saved' : 'updated'}`);
  });
});


it.each([['Save', '64k'], ['Update', '64k'], ['Enter', '64k'], ['Update', ''], ['Update', '   ']] as const)(
  'keeps invalid context drafts through %s and saves corrected value %p', async (action, corrected) => {
  const envVars = 'ANTHROPIC_MODEL=custom\nANTHROPIC_DEFAULT_SONNET_MODEL=sibling';
  const saved: EnvSnippet = { id: 'saved', name: 'Saved configuration', description: 'Before', envVars,
    scope: 'provider:claude', contextLimits: { custom: 200000, sibling: 100000 } };
  const settings = { envSnippets: action === 'Save' ? [] : [saved], customContextLimits: {}, customModelAliases: {} };
  const persist = jest.fn().mockResolvedValue(undefined);
  const coordinator = new SettingsCoordinator(settings, persist);
  const host = { app: {}, settings, getEnvironmentVariablesForScope: () => envVars,
    mutateSettings: (mutation: Parameters<typeof coordinator.mutate>[0]) => coordinator.mutate(mutation),
  } as unknown as ProviderHost;
  const container = document.body.createDiv();
  managers.push(new EnvSnippetManager(container, host, 'provider:claude'));
  fireEvent.click(within(container).getByRole('button', { name: action === 'Save'
    ? t('settings.envSnippets.addBtn') : new RegExp(`^${t('settings.envSnippets.editBtn')}`) }));
  const dialog = within(document.body).getByRole('dialog');
  const fields = within(dialog);
  const name = fields.getByRole<HTMLInputElement>('textbox', { name: t('settings.envSnippets.modal.name') });
  fireEvent.input(name, { target: { value: 'Draft configuration' } });
  const custom = fields.getByRole<HTMLInputElement>('textbox', { name: 'Context window for custom' });
  const sibling = fields.getByRole<HTMLInputElement>('textbox', { name: 'Context window for sibling' });
  fireEvent.input(custom, { target: { value: 'abc' } });
  fireEvent.input(sibling, { target: { value: '128k' } });
  const submit = () => action === 'Enter' ? fireEvent.keyDown(name, { key: 'Enter' })
    : fireEvent.click(fields.getByRole('button', { name: t(action === 'Save'
      ? 'settings.envSnippets.modal.save' : 'settings.envSnippets.modal.update') }));
  submit();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(Notice).toHaveBeenCalledWith(t('settings.customContextLimits.invalid'));
  expect(persist).not.toHaveBeenCalled();
  expect(settings.envSnippets).toEqual(action === 'Save' ? [] : [saved]);
  expect(dialog.isConnected).toBe(true);
  expect(name.value).toBe('Draft configuration');
  expect(custom.value).toBe('abc');
  expect(sibling.value).toBe('128k');
  fireEvent.input(custom, { target: { value: corrected } });
  submit();
  await waitFor(() => expect(settings.envSnippets[0]?.name).toBe('Draft configuration'));
  expect(settings.envSnippets[0].contextLimits).toEqual(corrected.trim()
    ? { custom: 64000, sibling: 128000 } : { sibling: 128000 });
  expect(persist).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(dialog.isConnected).toBe(false));
});

it.each(['save', 'update'] as const)('prevents duplicate %s while persistence is pending', async action => {
  let settle!: () => void;
  const saved: EnvSnippet = { id: 'saved', name: 'Saved', description: '', envVars: 'KEY=value', scope: 'shared' };
  const settings = { envSnippets: action === 'update' ? [saved] : [], customContextLimits: {}, customModelAliases: {} };
  const persist = jest.fn(() => new Promise<void>(resolve => { settle = resolve; }));
  const coordinator = new SettingsCoordinator(settings, persist);
  const host = { app: {}, settings, getEnvironmentVariablesForScope: () => 'KEY=value',
    mutateSettings: (mutation: Parameters<typeof coordinator.mutate>[0]) => coordinator.mutate(mutation),
  } as unknown as ProviderHost;
  const container = document.body.createDiv();
  managers.push(new EnvSnippetManager(container, host, 'shared'));
  fireEvent.click(within(container).getByRole('button', { name: action === 'save'
    ? t('settings.envSnippets.addBtn') : new RegExp(`^${t('settings.envSnippets.editBtn')}`) }));
  const dialog = within(document.body).getByRole('dialog');
  const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: t('settings.envSnippets.modal.name') });
  fireEvent.input(name, { target: { value: 'Draft' } });
  const submit = within(dialog).getByRole<HTMLButtonElement>('button', { name: t(action === 'save'
    ? 'settings.envSnippets.modal.save' : 'settings.envSnippets.modal.update') });
  fireEvent.click(submit);
  fireEvent.keyDown(name, { key: 'Enter' });
  await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  expect(dialog.isConnected).toBe(true);
  expect(name.disabled).toBe(true);
  expect(submit.disabled).toBe(true);
  settle();
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(settings.envSnippets).toHaveLength(1);
});

it.each(['save', 'update'] as const)('reports committed %s without offering a duplicate retry', async action => {
  const saved: EnvSnippet = { id: 'saved', name: 'Saved', description: '', envVars: 'KEY=value', scope: 'shared' };
  const settings = { envSnippets: action === 'update' ? [saved] : [], customContextLimits: {}, customModelAliases: {} };
  const coordinator = new SettingsCoordinator(settings, async () => undefined);
  const host = { app: {}, settings, getEnvironmentVariablesForScope: () => 'KEY=value',
    mutateSettings: (mutation: Parameters<typeof coordinator.mutate>[0]) => coordinator.mutate(mutation, () => { throw new Error('publish failed'); }),
  } as unknown as ProviderHost;
  const container = document.body.createDiv();
  managers.push(new EnvSnippetManager(container, host, 'shared'));
  fireEvent.click(within(container).getByRole('button', { name: action === 'save'
    ? t('settings.envSnippets.addBtn') : new RegExp(`^${t('settings.envSnippets.editBtn')}`) }));
  const dialog = within(document.body).getByRole('dialog');
  fireEvent.input(within(dialog).getByRole('textbox', { name: t('settings.envSnippets.modal.name') }), { target: { value: 'Draft' } });
  fireEvent.click(within(dialog).getByRole('button', { name: t(action === 'save'
    ? 'settings.envSnippets.modal.save' : 'settings.envSnippets.modal.update') }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(Notice).toHaveBeenCalledWith(t('settings.envSnippets.savedRefreshFailed'));
  expect(settings.envSnippets).toHaveLength(1);
  expect(settings.envSnippets[0].name).toBe('Draft');
  expect(container.textContent).toContain('Draft');
});
