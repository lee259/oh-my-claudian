/** @jest-environment jsdom */

import { VisibilityGatedPoller } from '@/features/chat/controllers/VisibilityGatedPoller';

function createHarness() {
  const ownerDocument = new EventTarget() as unknown as Document & {
    visibilityState: DocumentVisibilityState;
  };
  Object.defineProperty(ownerDocument, 'visibilityState', {
    configurable: true,
    value: 'visible',
    writable: true,
  });

  const ownerWindow = new EventTarget() as unknown as Window;
  const setInterval = jest.fn((callback: () => void, timeout: number) =>
    window.setInterval(callback, timeout));
  const clearInterval = jest.fn((handle: number) => window.clearInterval(handle));
  Object.assign(ownerWindow, { setInterval, clearInterval });

  return {
    clearInterval,
    ownerDocument,
    ownerWindow,
    poll: jest.fn(),
    setInterval,
  };
}

describe('VisibilityGatedPoller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts polling once while the document is visible', () => {
    const harness = createHarness();
    const poller = new VisibilityGatedPoller({
      intervalMs: 250,
      ownerDocument: harness.ownerDocument,
      ownerWindow: harness.ownerWindow,
      poll: harness.poll,
    });

    poller.start();
    poller.start();

    expect(poller.isPolling()).toBe(true);
    expect(harness.setInterval).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(250);
    expect(harness.poll).toHaveBeenCalledTimes(1);
  });

  it('pauses while the document is hidden and resumes when visible', () => {
    const harness = createHarness();
    const poller = new VisibilityGatedPoller({
      intervalMs: 250,
      ownerDocument: harness.ownerDocument,
      ownerWindow: harness.ownerWindow,
      poll: harness.poll,
    });

    poller.start();
    jest.advanceTimersByTime(250);
    expect(harness.poll).toHaveBeenCalledTimes(1);

    harness.ownerDocument.visibilityState = 'hidden';
    harness.ownerDocument.dispatchEvent(new Event('visibilitychange'));

    expect(poller.isPolling()).toBe(false);
    jest.advanceTimersByTime(1_000);
    expect(harness.poll).toHaveBeenCalledTimes(1);

    harness.ownerDocument.visibilityState = 'visible';
    harness.ownerDocument.dispatchEvent(new Event('visibilitychange'));

    expect(poller.isPolling()).toBe(true);
    jest.advanceTimersByTime(250);
    expect(harness.poll).toHaveBeenCalledTimes(2);
  });

  it('pauses while the window is blurred and resumes on focus', () => {
    const harness = createHarness();
    const poller = new VisibilityGatedPoller({
      intervalMs: 250,
      ownerDocument: harness.ownerDocument,
      ownerWindow: harness.ownerWindow,
      poll: harness.poll,
    });

    poller.start();
    harness.ownerWindow.dispatchEvent(new Event('blur'));

    expect(poller.isPolling()).toBe(false);
    jest.advanceTimersByTime(1_000);
    expect(harness.poll).not.toHaveBeenCalled();

    harness.ownerWindow.dispatchEvent(new Event('focus'));
    expect(poller.isPolling()).toBe(true);

    jest.advanceTimersByTime(250);
    expect(harness.poll).toHaveBeenCalledTimes(1);
  });

  it('stops polling and releases listeners when stopped', () => {
    const harness = createHarness();
    const poller = new VisibilityGatedPoller({
      intervalMs: 250,
      ownerDocument: harness.ownerDocument,
      ownerWindow: harness.ownerWindow,
      poll: harness.poll,
    });

    poller.start();
    poller.stop();

    expect(poller.isPolling()).toBe(false);
    jest.advanceTimersByTime(1_000);
    expect(harness.poll).not.toHaveBeenCalled();

    harness.ownerWindow.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(250);
    expect(harness.poll).not.toHaveBeenCalled();
  });
});
