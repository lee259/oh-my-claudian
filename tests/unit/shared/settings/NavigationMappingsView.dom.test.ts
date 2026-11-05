/** @jest-environment jsdom */

import { h, render } from 'preact';

import { NavigationMappingsView } from '@/shared/settings/NavigationMappingsView';

describe('NavigationMappingsView', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces valid edits and resets invalid blur edits to the last saved value', async () => {
    jest.useFakeTimers();
    const onSave = jest.fn(() => Promise.resolve('map w scrollUp\nmap s scrollDown\nmap i focusInput'));
    const onInvalid = jest.fn();
    const container = document.createElement('div');

    render(h(NavigationMappingsView, {
      name: 'Navigation mappings',
      description: 'Customize keyboard navigation.',
      placeholder: 'Map w scrollup',
      initialValue: 'map w scrollUp\nmap s scrollDown\nmap i focusInput',
      validate: value => value.includes('invalid') ? 'Invalid mapping' : null,
      onSave,
      onInvalid,
    }), container);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toContain('map w scrollUp');
    if (!textarea) {
      throw new Error('Expected navigation mapping textarea');
    }

    textarea.value = 'map a scrollUp\nmap s scrollDown\nmap i focusInput';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onSave).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith('map a scrollUp\nmap s scrollDown\nmap i focusInput');

    textarea.value = 'invalid';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    await Promise.resolve();

    expect(onInvalid).toHaveBeenCalledWith('Invalid mapping');
    expect(textarea.value).toBe('map w scrollUp\nmap s scrollDown\nmap i focusInput');
  });

  it('keeps a newer draft when an earlier save resolves', async () => {
    jest.useFakeTimers();
    let resolveSave!: (value: string) => void;
    const onSave = jest.fn(() => new Promise<string>((resolve) => { resolveSave = resolve; }));
    const container = document.createElement('div');
    const initial = 'map w scrollUp';

    render(h(NavigationMappingsView, {
      name: 'Navigation mappings',
      description: 'Customize keyboard navigation.',
      placeholder: 'Map w scrollup',
      initialValue: initial,
      validate: () => null,
      onSave,
      onInvalid: jest.fn(),
    }), container);
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('Expected navigation mapping textarea');

    textarea.value = 'map b scrollUp';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(500);
    textarea.value = 'map c scrollUp';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    resolveSave('map b scrollUp\nmap s scrollDown');
    await Promise.resolve();
    await Promise.resolve();

    expect(textarea.value).toBe('map c scrollUp');
  });
});
