import { syncComposerAutoScroll } from '@/features/chat/controllers/ComposerAutoScroll';

describe('syncComposerAutoScroll', () => {
  it('does not schedule scrolling when auto scroll is disabled', () => {
    const requestAnimationFrame = jest.fn();
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestAnimationFrame });

    syncComposerAutoScroll(() => false, () => true, () => ({}) as HTMLElement);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('rechecks state before scrolling in the animation frame', () => {
    let active = true;
    let callback!: FrameRequestCallback;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: jest.fn((next: FrameRequestCallback) => { callback = next; return 1; }),
    });
    const messages = { scrollHeight: 80, scrollTop: 10 } as HTMLElement;

    syncComposerAutoScroll(() => true, () => active, () => messages);
    active = false;
    callback(0);

    expect(messages.scrollTop).toBe(10);
  });
});
