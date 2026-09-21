/** @jest-environment jsdom */

import { setIcon } from 'obsidian';
import { h, render } from 'preact';

import { IconButton } from '@/shared/ui/IconButton';

describe('IconButton', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders an accessible icon button and contains click events', () => {
    const host = document.createElement('div');
    const onClick = jest.fn();
    const onParentClick = jest.fn();
    host.addEventListener('click', onParentClick);

    render(h(IconButton, {
      className: 'claudian-test-action',
      icon: 'settings',
      label: 'Open settings',
      onClick,
    }), host);

    const button = host.querySelector<HTMLButtonElement>('button');
    const icon = host.querySelector<HTMLElement>('span');
    button?.click();

    expect(button?.className).toBe('claudian-test-action');
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe('Open settings');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(setIcon).toHaveBeenCalledWith(icon, 'settings');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('preserves an optional icon class for surface-specific styling', () => {
    const host = document.createElement('div');

    render(h(IconButton, {
      className: 'claudian-test-action',
      icon: 'history',
      iconClassName: 'claudian-test-icon',
      label: 'Open history',
    }), host);

    expect(host.querySelector('span')?.className).toBe('claudian-test-icon');
  });
});
