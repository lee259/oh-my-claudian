/** @jest-environment jsdom */

import { h, render } from 'preact';

import { GeneralGettingStartedView } from '@/shared/settings/GeneralGettingStartedView';

describe('GeneralGettingStartedView', () => {
  it('renders ordered steps and an accessible chat action', () => {
    const onOpenChat = jest.fn();
    const container = document.createElement('div');

    render(h(GeneralGettingStartedView, {
      steps: ['Choose a provider.', 'Check readiness.', 'Open chat.'],
      actionLabel: 'Open chat',
      actionDescription: 'Start a conversation.',
      onOpenChat,
    }), container);

    expect(container.querySelector('ol')?.className).toBe('claudian-getting-started-steps');
    expect([...container.querySelectorAll('li')].map(item => item.textContent)).toEqual([
      'Choose a provider.',
      'Check readiness.',
      'Open chat.',
    ]);

    const button = container.querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.textContent).toBe('Open chat');
    expect(container.querySelector('.claudian-getting-started-action-description')?.textContent)
      .toBe('Start a conversation.');

    button?.click();
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });
});
