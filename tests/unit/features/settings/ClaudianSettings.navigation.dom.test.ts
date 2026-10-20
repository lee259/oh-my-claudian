/** @jest-environment jsdom */

import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { parseNavMappings } from '@/features/settings/keyboardNavigation';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};
HTMLElement.prototype.setText = function setText(text: string): void {
  this.textContent = text;
};

it('provides a valid navigation example that can be pasted and saved', async () => {
  const settings = { ...DEFAULT_CLAUDIAN_SETTINGS };
  settings.keyboardNavigation = { scrollUpKey: 'u', scrollDownKey: 'd', focusInputKey: 'f' };
  const plugin = {
    settings,
    getActiveEnvironmentVariables: () => '',
    mutateSettings: jest.fn(async (mutate: (value: typeof settings) => void) => { mutate(settings); }),
    getAllViews: () => [],
    storage: { getAdapter: () => ({}) },
    providerHost: { settings, getEnvironmentVariablesForScope: () => '', applyEnvironmentVariables: jest.fn() },
  };
  const tab = new ClaudianSettingTab({} as any, plugin as any);
  tab.containerEl = document.createElement('div');
  tab.display();
  const textarea = tab.containerEl.querySelector<HTMLTextAreaElement>('.claudian-settings-nav-mappings-textarea');
  if (!textarea) throw new Error('Expected navigation mappings');

  expect(parseNavMappings(textarea.placeholder)).toEqual({
    settings: { scrollUp: 'u', scrollDown: 'd', focusInput: 'f' },
  });
  textarea.value = textarea.placeholder;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('blur'));
  await new Promise(resolve => window.setTimeout(resolve, 0));
  expect(plugin.mutateSettings).toHaveBeenCalledTimes(1);
  expect(settings.keyboardNavigation).toEqual({ scrollUpKey: 'u', scrollDownKey: 'd', focusInputKey: 'f' });
});
