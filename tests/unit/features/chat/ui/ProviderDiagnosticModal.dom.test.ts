/** @jest-environment jsdom */

import { getByRole } from '@testing-library/dom';

import type { ProviderDiagnosticReport } from '@/core/providers/ProviderDiagnostics';
import { ProviderDiagnosticModal } from '@/features/chat/ui/ProviderDiagnosticModal';

jest.mock('obsidian', () => {
  class MockModal {
    readonly contentEl = document.createElement('div');
    readonly modalEl = document.createElement('div');

    constructor(readonly app: unknown) {
      this.modalEl.append(this.contentEl);
    }

    onOpen(): void {}
    onClose(): void {}

    open(): void {
      document.body.append(this.modalEl);
      this.onOpen();
    }

    close(): void {
      this.onClose();
      this.modalEl.remove();
    }
  }

  return {
    Modal: MockModal,
    Notice: jest.fn(),
  };
});

HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };

it('copies a diagnostic report through the popout owner window', async () => {
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
  const report: ProviderDiagnosticReport = {
    createdAt: 1,
    providerId: 'claude',
    error: {
      category: 'timeout',
      message: 'Request timed out',
      recoverable: true,
    },
    platform: 'darwin',
    runtimeStatus: 'failed',
  };
  const modal = new ProviderDiagnosticModal({} as never, report);
  try {
    modal.open();
    const modalEl = (modal as unknown as { modalEl: HTMLElement }).modalEl;
    secondary.body.appendChild(secondary.adoptNode(modalEl));

    getByRole(modalEl, 'button', { name: 'Copy report' }).click();
    await Promise.resolve();

    expect(popoutWrite).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
    expect(mainWrite).not.toHaveBeenCalled();
  } finally {
    frame.remove();
    document.body.replaceChildren();
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
