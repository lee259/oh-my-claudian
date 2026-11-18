/** @jest-environment jsdom */

import { StatusPanel } from '@/features/chat/ui/StatusPanel';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn((element: HTMLElement, icon: string) => {
    element.setAttribute('data-icon', icon);
  }),
}));

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };

it('copies the latest Bash output through the popout owner window', async () => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const secondary = frame.contentDocument!;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const mainWrite = jest.fn().mockResolvedValue(undefined);
  const popoutWrite = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mainWrite } });
  Object.defineProperty(frame.contentWindow!.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: popoutWrite },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new StatusPanel();
  try {
    panel.mount(container);
    panel.addBashOutput({
      id: 'bash-1',
      command: 'echo hello',
      status: 'completed',
      output: 'hello',
      exitCode: 0,
    });
    secondary.body.appendChild(secondary.adoptNode(container));

    container.querySelector<HTMLElement>('.claudian-status-panel-bash-action-copy')!.click();
    await Promise.resolve();

    expect(popoutWrite).toHaveBeenCalledWith('$ echo hello\nhello');
    expect(mainWrite).not.toHaveBeenCalled();
  } finally {
    panel.destroy();
    frame.remove();
    document.body.replaceChildren();
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
