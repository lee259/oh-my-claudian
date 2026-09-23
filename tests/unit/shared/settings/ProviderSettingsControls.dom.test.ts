/** @jest-environment jsdom */

jest.mock('obsidian', () => {
  class MockToggleComponent {
    disabled = false;
    toggleEl = document.createElement('button');
    value = false;
    private callback: ((value: boolean) => Promise<void> | void) | null = null;

    onChange(callback: (value: boolean) => Promise<void> | void): this {
      this.callback = callback;
      return this;
    }

    setDisabled(disabled: boolean): this {
      this.disabled = disabled;
      this.toggleEl.disabled = disabled;
      return this;
    }

    setValue(value: boolean): this {
      this.value = value;
      return this;
    }

    async trigger(value: boolean): Promise<void> {
      await this.callback?.(value);
    }
  }

  class MockTextComponent {
    inputEl = document.createElement('input');
    value = '';
    private callback: ((value: string) => Promise<void> | void) | null = null;

    onChange(callback: (value: string) => Promise<void> | void): this {
      this.callback = callback;
      return this;
    }

    setPlaceholder(value: string): this {
      this.inputEl.placeholder = value;
      return this;
    }

    setValue(value: string): this {
      this.value = value;
      this.inputEl.value = value;
      return this;
    }

    async trigger(value: string): Promise<void> {
      this.inputEl.value = value;
      await this.callback?.(value);
    }
  }

  class MockSetting {
    controlEl = document.createElement('div');
    desc = '';
    descEl = document.createElement('div');
    infoEl = document.createElement('div');
    name = '';
    nameEl = document.createElement('div');
    settingEl = document.createElement('div');

    constructor(container: HTMLElement) {
      this.infoEl.append(this.nameEl, this.descEl);
      this.settingEl.append(this.infoEl);
      this.settingEl.append(this.controlEl);
      container.appendChild(this.settingEl);
    }

    addText(callback: (text: MockTextComponent) => void): this {
      callback(new MockTextComponent());
      return this;
    }

    addToggle(callback: (toggle: MockToggleComponent) => void): this {
      callback(new MockToggleComponent());
      return this;
    }

    setDesc(desc: string): this {
      this.desc = desc;
      this.descEl.textContent = desc;
      return this;
    }

    setName(name: string): this {
      this.name = name;
      this.nameEl.textContent = name;
      return this;
    }
  }

  return { Setting: MockSetting };
});

import {
  destroyHostnameCliPathSettings,
  renderHostnameCliPathSetting,
} from '@/shared/settings/HostnameCliPathSetting';
import {
  destroyProviderEnablementSettings,
  renderProviderEnablementSetting,
} from '@/shared/settings/ProviderEnablementSetting';

function getEnablementToggle(container: HTMLElement): HTMLInputElement {
  const toggle = container.querySelector<HTMLInputElement>('[role="switch"]');
  if (!toggle) throw new Error('Expected provider enablement switch');
  return toggle;
}

function dispatchToggle(toggle: HTMLInputElement, value: boolean): void {
  toggle.checked = value;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
}

function getCliPathInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.claudian-settings-cli-path-input');
  if (!input) throw new Error('Expected CLI path input');
  return input;
}

function dispatchInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('provider settings controls', () => {
  it('renders enablement state and resynchronizes after callback side effects', async () => {
    const events: string[] = [];
    let persisted = true;
    const container = document.createElement('div');
    const control = renderProviderEnablementSetting({
      container,
      description: 'Provider-specific description',
      getValue: () => {
        events.push('read');
        return persisted;
      },
      name: 'Enable Test Provider',
      onChange: async (enabled) => {
        events.push(`change:${enabled}`);
        persisted = enabled;
      },
    });
    const toggle = getEnablementToggle(container);

    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Enable Test Provider');
    expect(container.textContent).toContain('Provider-specific description');
    events.length = 0;

    dispatchToggle(toggle, false);
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['change:false', 'read']);
    expect(toggle.checked).toBe(false);
    control.dispose();
  });

  it('toggles provider enablement repeatedly from the switch track', async () => {
    const changes: boolean[] = [];
    let persisted = true;
    const container = document.createElement('div');
    const control = renderProviderEnablementSetting({
      container,
      description: 'Description',
      getValue: () => persisted,
      name: 'Enable Test Provider',
      onChange: async (enabled) => {
        changes.push(enabled);
        persisted = enabled;
      },
    });
    const track = container.querySelector<HTMLElement>('.checkbox-container');
    if (!track) throw new Error('Expected the provider switch track');

    track.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual([false]);

    track.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual([false, true]);
    expect(getEnablementToggle(container).checked).toBe(true);
    control.dispose();
  });

  it('does not invoke enablement callbacks while disabled', async () => {
    const onChange = jest.fn();
    const container = document.createElement('div');
    const control = renderProviderEnablementSetting({
      container,
      description: 'Description',
      disabled: true,
      getValue: () => true,
      name: 'Enable Test Provider',
      onChange,
    });
    const toggle = getEnablementToggle(container);

    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    dispatchToggle(toggle, false);
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle.checked).toBe(true);
    control.setDisabled(false);
    expect(toggle.disabled).toBe(false);
    control.dispose();
  });

  it('resynchronizes the switch when persistence does not accept the requested value', async () => {
    const persisted = true;
    const container = document.createElement('div');
    const control = renderProviderEnablementSetting({
      container,
      description: 'Description',
      getValue: () => persisted,
      name: 'Enable Test Provider',
      onChange: async () => {},
    });
    const toggle = getEnablementToggle(container);
    dispatchToggle(toggle, false);
    await Promise.resolve();
    await Promise.resolve();

    expect(toggle.checked).toBe(true);
    control.dispose();
  });

  it('unmounts all enablement views owned by a settings content host', () => {
    const container = document.createElement('div');
    renderProviderEnablementSetting({
      container,
      description: 'Description',
      getValue: () => true,
      name: 'Enable Test Provider',
      onChange: () => {},
    });

    expect(container.querySelector('[role="switch"]')).not.toBeNull();
    destroyProviderEnablementSettings(container);

    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it('renders and edits the current-host CLI path, including clearing', async () => {
    const changes: string[] = [];
    let persistedPath = '/initial/provider';
    const container = document.createElement('div');
    const control = renderHostnameCliPathSetting({
      container,
      description: 'Provider-specific CLI description',
      getValue: () => persistedPath,
      name: 'CLI path',
      onChange: async (value) => {
        changes.push(value);
        persistedPath = value;
      },
      placeholder: '/usr/local/bin/provider',
    });
    const input = getCliPathInput(container);

    expect(input.value).toBe('/initial/provider');
    expect(input.placeholder).toBe('/usr/local/bin/provider');
    expect(input.getAttribute('aria-label')).toBe('CLI path');

    dispatchInput(input, ' /custom/provider ');
    await Promise.resolve();
    await Promise.resolve();
    dispatchInput(input, '');
    await Promise.resolve();
    await Promise.resolve();

    expect(changes).toEqual(['/custom/provider', '']);
    expect(input.value).toBe('');
    control.dispose();
  });

  it('validates before callbacks and suppresses duplicate persistence', async () => {
    const events: string[] = [];
    let persistedPath = '/initial/provider';
    const container = document.createElement('div');
    const control = renderHostnameCliPathSetting({
      container,
      description: 'Description',
      getValue: () => persistedPath,
      name: 'CLI path',
      onChange: async (value) => {
        events.push(`change:${value}`);
        persistedPath = value;
      },
      placeholder: '/bin/provider',
      validate: (value) => {
        events.push(`validate:${value}`);
        return value.includes('invalid') ? 'Invalid path' : null;
      },
    });
    const input = getCliPathInput(container);
    events.length = 0;

    dispatchInput(input, '/initial/provider');
    dispatchInput(input, '/invalid/provider');
    await Promise.resolve();

    expect(events).toEqual([
      'validate:/initial/provider',
      'validate:/invalid/provider',
    ]);
    expect(control.validationEl.textContent).toBe('Invalid path');
    expect(control.validationEl.classList.contains('claudian-hidden')).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.classList.contains('claudian-input-error')).toBe(true);
    control.dispose();
  });

  it('supports disabled CLI controls and dynamic presentation updates', async () => {
    const onChange = jest.fn();
    const container = document.createElement('div');
    const enabledControl = renderHostnameCliPathSetting({
      container,
      description: 'Initial description',
      disabled: true,
      getValue: () => '',
      name: 'CLI path',
      onChange,
      placeholder: '/bin/provider',
    });
    const input = getCliPathInput(container);

    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    dispatchInput(input, '/custom/provider');
    expect(onChange).not.toHaveBeenCalled();

    enabledControl.setDisabled(false);
    enabledControl.setDescription('Updated description');
    enabledControl.setPlaceholder('/updated/provider');

    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-disabled')).toBe('false');
    expect(input.placeholder).toBe('/updated/provider');
    expect(container.textContent).toContain('Updated description');
    enabledControl.dispose();
  });

  it('restores the authoritative path when a save does not commit the draft', async () => {
    const container = document.createElement('div');
    const control = renderHostnameCliPathSetting({
      container,
      description: 'Description',
      getValue: () => '/saved/provider',
      name: 'CLI path',
      onChange: async () => {},
      placeholder: '/bin/provider',
    });
    const input = getCliPathInput(container);
    dispatchInput(input, '/unsaved/provider');
    await Promise.resolve();
    await Promise.resolve();

    expect(input.value).toBe('/saved/provider');
    control.dispose();
  });

  it('unmounts all CLI path views owned by a settings content host', () => {
    const container = document.createElement('div');
    renderHostnameCliPathSetting({
      container,
      description: 'Description',
      getValue: () => '/bin/provider',
      name: 'CLI path',
      onChange: () => {},
      placeholder: '/bin/provider',
    });

    expect(container.querySelector('.claudian-settings-cli-path-input')).not.toBeNull();
    destroyHostnameCliPathSettings(container);

    expect(container.querySelector('.claudian-settings-cli-path-input')).toBeNull();
  });
});
