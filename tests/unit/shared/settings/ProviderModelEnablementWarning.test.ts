/** @jest-environment jsdom */

import {
  renderLastEnabledProviderWarning,
  renderProviderModelEnablementWarning,
} from '@/shared/settings/ProviderModelEnablementWarning';

describe('renderProviderModelEnablementWarning', () => {
  it('tracks provider readiness, refreshes when models change, and unmounts on destroy', () => {
    let enabled = true;
    let hasModels = false;
    const container = document.createElement('div');
    document.body.append(container);
    const notifyProviderModelOptionsChanged = jest.fn();

    const warning = renderProviderModelEnablementWarning(
      container,
      { notifyProviderModelOptionsChanged } as any,
      {
        getHasEnabledModels: () => hasModels,
        getIsEnabled: () => enabled,
        providerId: 'codex',
        providerName: 'Codex',
      },
    );

    const notice = container.querySelector<HTMLElement>('.claudian-provider-model-warning');
    expect(notice?.textContent)
      .toBe('No Codex models are enabled. Go to Models below and enable at least one model.');
    expect(notice?.hidden).toBe(false);

    hasModels = true;
    warning.context.notifyProviderModelOptionsChanged('codex');
    expect(notifyProviderModelOptionsChanged).toHaveBeenCalledWith('codex');
    expect(notice?.hidden).toBe(true);

    hasModels = false;
    enabled = false;
    warning.refresh();
    expect(notice?.hidden).toBe(true);

    warning.destroy();
    expect(container.querySelector('.claudian-provider-warning-mount')).toBeNull();
    container.remove();
  });
});

describe('renderLastEnabledProviderWarning', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows accessibly for ten seconds, resets on repeated attempts, hides, and unmounts', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const warning = renderLastEnabledProviderWarning(container);
    const notice = container.querySelector<HTMLElement>('[role="status"]');

    expect(notice?.textContent)
      .toBe('At least one provider must remain enabled for Oh My Claudian to work.');
    expect(notice?.getAttribute('aria-live')).toBe('polite');
    expect(notice?.hidden).toBe(true);

    warning.showFor();
    expect(notice?.hidden).toBe(false);
    jest.advanceTimersByTime(9_000);
    warning.showFor();
    jest.advanceTimersByTime(9_999);
    expect(notice?.hidden).toBe(false);
    jest.advanceTimersByTime(1);
    expect(notice?.hidden).toBe(true);

    warning.showFor();
    warning.hide();
    expect(notice?.hidden).toBe(true);
    jest.advanceTimersByTime(10_000);
    expect(notice?.hidden).toBe(true);

    warning.destroy();
    expect(container.querySelector('[role="status"]')).toBeNull();
    container.remove();
  });
});
