/** @jest-environment jsdom */

import { isNestedScrollEvent, ScrollFollowController } from '@/features/chat/rendering/ScrollFollowController';

describe('nested transcript scrolling', () => {
  it.each(['visible', 'hidden'])('lets the transcript consume wheel input over an overflow-%s region', (overflow) => {
    const outer = document.createElement('div');
    const inner = outer.appendChild(document.createElement('div'));
    inner.className = 'claudian-thinking-content';
    inner.style.overflowY = overflow;
    Object.defineProperties(inner, {
      scrollHeight: { value: 1200 }, clientHeight: { value: 320 }, scrollTop: { value: 100 },
    });
    const wheel = new WheelEvent('wheel', { deltaY: 30 });
    Object.defineProperty(wheel, 'target', { value: inner });
    expect(isNestedScrollEvent(wheel, outer)).toBe(false);
  });

  it.each([[100, true], [880, false]])('consumes input only while the inner viewport can scroll from %s', (top, expected) => {
    const outer = document.createElement('div');
    const inner = outer.appendChild(document.createElement('div'));
    inner.className = 'claudian-activity-phase-details';
    inner.style.overflowY = 'auto';
    Object.defineProperties(inner, {
      scrollHeight: { value: 1200 }, clientHeight: { value: 320 }, scrollTop: { value: top },
    });
    const wheel = new WheelEvent('wheel', { deltaY: 30 });
    Object.defineProperty(wheel, 'target', { value: inner });
    expect(isNestedScrollEvent(wheel, outer)).toBe(expected);
  });
});

describe('streaming viewport content growth', () => {
  it('follows asynchronous child growth until the reader pauses, including when auto-scroll is disabled', async () => {
    const viewport = document.body.appendChild(document.createElement('div'));
    let height = 600;
    let enabled = true;
    Object.defineProperties(viewport, { scrollHeight: { get: () => height }, clientHeight: { value: 320 } });
    const controller = new ScrollFollowController(viewport, { scrollTop: 280, following: true }, () => enabled);
    try {
      viewport.scrollTop = 280;
      height = 900; viewport.appendChild(document.createElement('pre'));
      await Promise.resolve();
      expect(viewport.scrollTop).toBe(900);
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
      viewport.scrollTop = 100; viewport.dispatchEvent(new Event('scroll'));
      height = 1200; viewport.appendChild(document.createElement('pre'));
      await Promise.resolve();
      expect(viewport.scrollTop).toBe(100);
      controller.resume(); enabled = false;
      height = 1500; viewport.appendChild(document.createElement('pre'));
      await Promise.resolve();
      expect(viewport.scrollTop).toBe(100);
      enabled = true; controller.dispose();
      height = 1800; viewport.appendChild(document.createElement('pre'));
      await Promise.resolve();
      expect(viewport.scrollTop).toBe(100);
    } finally { controller.dispose(); viewport.remove(); }
  });
});
