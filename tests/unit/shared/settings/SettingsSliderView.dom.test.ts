/** @jest-environment jsdom */

import { h, render } from 'preact';

import { SettingsSliderView } from '@/shared/settings/SettingsSliderView';

const saveLabels = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
};

const baseProps = {
  name: 'Warm sessions',
  description: 'Maximum number of ready agents.',
  min: 1,
  max: 8,
  step: 1,
  value: 3,
  saveLabels,
};

describe('SettingsSliderView', () => {
  it('updates the filled track position while the slider moves', async () => {
    const container = document.createElement('div');
    render(h(SettingsSliderView, { ...baseProps, onChange: jest.fn() }), container);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('Expected a warm sessions slider');

    const initialProgress = slider.style.getPropertyValue('--claudian-settings-slider-progress');
    slider.value = '6';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(slider.style.getPropertyValue('--claudian-settings-slider-progress')).not.toBe(initialProgress);
    expect(slider.style.getPropertyValue('--claudian-settings-slider-progress')).toBe('71.42857142857143%');
    expect(container.querySelector('.claudian-settings-slider-value')?.textContent).toBe('6');
  });

  it('shows progress while saving and success after the latest change commits', async () => {
    let resolveChange!: () => void;
    const onChange = jest.fn(() => new Promise<void>((resolve) => {
      resolveChange = resolve;
    }));
    const container = document.createElement('div');

    render(h(SettingsSliderView, { ...baseProps, onChange }), container);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('Expected a warm sessions slider');

    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');

    resolveChange();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  });

  it('restores the last committed value and announces a failed save', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('Pool is busy'));
    const container = document.createElement('div');

    render(h(SettingsSliderView, { ...baseProps, onChange }), container);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('Expected a warm sessions slider');

    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(slider.value).toBe('3');
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not save: Pool is busy');
  });

  it('keeps the latest value and feedback when saves resolve out of order', async () => {
    const pendingChanges: Array<{
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    const onChange = jest.fn(() => new Promise<void>((resolve, reject) => {
      pendingChanges.push({ resolve, reject });
    }));
    const container = document.createElement('div');

    render(h(SettingsSliderView, { ...baseProps, onChange }), container);
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('Expected a warm sessions slider');

    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.value = '5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    pendingChanges[0].reject(new Error('An older save failed'));
    await Promise.resolve();
    expect(slider.value).toBe('5');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');

    pendingChanges[1].resolve();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(slider.value).toBe('5');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
