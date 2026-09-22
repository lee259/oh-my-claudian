/** @jest-environment jsdom */

jest.mock('obsidian', () => ({
  Setting: class MockSetting {
    setName(): this { return this; }
    setDesc(): this { return this; }
    setHeading(): this { return this; }
  },
}));

import { renderProviderReadinessPanel } from '@/shared/settings/ProviderReadinessPanel';

Object.defineProperty(HTMLElement.prototype, 'setText', {
  configurable: true,
  value(this: HTMLElement, text: string): void {
    this.textContent = text;
  },
});

describe('renderProviderReadinessPanel', () => {
  it('renders the readiness content inside a collapsible CLI installation card', async () => {
    const container = document.createElement('div');

    const controller = renderProviderReadinessPanel({
      container,
      providerName: 'Test',
      getSnapshot: async () => ({ status: 'ready', checks: [] }),
    });

    const card = container.querySelector<HTMLElement>('.claudian-cli-installation');
    const header = card?.querySelector<HTMLButtonElement>('.claudian-cli-installation-header');
    const body = card?.querySelector<HTMLElement>('.claudian-cli-installation-body');
    const management = card?.querySelector<HTMLElement>('.claudian-cli-installation-management');

    expect(controller.root).toBe(card);
    expect(controller.management).toBe(management);
    expect(management).not.toBeNull();
    expect(header?.textContent).toContain('Test');
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hidden).toBe(false);
    expect(header?.id).toBe(body?.id ? `${body.id}-header` : undefined);
    expect(body?.getAttribute('role')).toBe('region');
    expect(body?.getAttribute('aria-labelledby')).toBe(header?.id);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(card?.dataset.state).toBe('ready');
    expect(header?.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    header?.click();

    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
  });

  it('shows an actionable hint for each blocked or attention check', async () => {
    const container = document.createElement('div');

    renderProviderReadinessPanel({
      container,
      providerName: 'Test',
      getSnapshot: async () => ({
        status: 'blocked',
        checks: [
          { id: 'enabled', status: 'ready' },
          { id: 'cli', status: 'blocked', remediation: 'configureCli' },
          { id: 'models', status: 'attention', remediation: 'refreshModels' },
          { id: 'selection', status: 'blocked', remediation: 'selectModel' },
        ],
      }),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const hints = [...container.querySelectorAll('.claudian-provider-readiness-check-hint')]
      .map((element) => element.textContent);
    expect(hints).toEqual([
      "Set a valid CLI path or make the CLI available on Obsidian's PATH.",
      'Check the provider login or session, then check again to load models.',
      'Select at least one chat model below.',
    ]);
  });

  it('shows checking feedback in the summary while a refresh is in flight', async () => {
    const container = document.createElement('div');
    let finishRefresh!: () => void;
    const onRefresh = jest.fn(() => new Promise<void>(resolve => { finishRefresh = resolve; }));

    const controller = renderProviderReadinessPanel({
      container,
      providerName: 'Test',
      getSnapshot: async () => ({ status: 'ready', checks: [] }),
      onRefresh,
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const summary = container.querySelector<HTMLElement>('.claudian-provider-readiness-summary');
    expect(summary?.textContent).toBe('Ready');

    void controller.refresh(true);
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(summary?.textContent).toBe('Checking provider readiness…');

    finishRefresh();
    await new Promise<void>(resolve => setTimeout(resolve, 140));

    expect(summary?.textContent).toBe('Ready');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('preserves provider-owned body content when the card status rerenders', async () => {
    const container = document.createElement('div');
    const controller = renderProviderReadinessPanel({
      container,
      providerName: 'Test',
      getSnapshot: async () => ({ status: 'ready', checks: [] }),
    });
    const management = controller.management;

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await controller.refresh();

    expect(controller.root.contains(management)).toBe(true);
  });

  it('destroys the card and its rendering root through the controller', () => {
    const container = document.createElement('div');
    const controller = renderProviderReadinessPanel({
      container,
      providerName: 'Test',
      getSnapshot: async () => ({ status: 'ready', checks: [] }),
    });

    controller.destroy();

    expect(container.childElementCount).toBe(0);
  });
});
