/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import type { UsageInfo } from '@/core/types';
import { ContextUsageMeter } from '@/features/chat/ui/InputToolbar';

jest.mock('obsidian', () => ({ Notice: jest.fn(), setIcon: jest.fn() }));

it('updates one meter in place and releases its Preact root on destroy', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const meter = new ContextUsageMeter(host);
  const usage = { inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    contextWindow: 200000, contextTokens: 50000, percentage: 25 };
  meter.update(usage);
  const element = host.querySelector('.claudian-context-meter');
  const fill = host.querySelector('.claudian-meter-fill');
  meter.update({ ...usage, contextTokens: 170000, percentage: 85 });
  expect(host.querySelector('.claudian-context-meter')).toBe(element);
  expect(host.querySelector('.claudian-meter-fill')).toBe(fill);
  expect(element?.classList.contains('warning')).toBe(true);
  meter.destroy();
  meter.update(usage);
  expect(host.childElementCount).toBe(0);
  host.remove();
});

function makeUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 200000,
    contextTokens: 0,
    percentage: 0,
    ...overrides,
  };
}

describe('ContextUsageMeter', () => {
  let parentEl: any;
  let meter: ContextUsageMeter;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = document.createElement('div');
    document.body.append(parentEl);
    meter = new ContextUsageMeter(parentEl);
  });

  afterEach(() => { meter.destroy(); parentEl.remove(); });

  it('should create a container with context-meter class', () => {
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container).not.toBeNull();
  });

  it('should be hidden initially', () => {
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.classList.contains('claudian-hidden')).toBe(true);
  });

  it('should remain hidden when update called with null', () => {
    meter.update(null);
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.classList.contains('claudian-hidden')).toBe(true);
  });

  it('should show a known context window even when contextTokens is 0', () => {
    meter.update(makeUsage({ contextTokens: 0, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.classList.contains('claudian-hidden')).toBe(false);
  });

  it('should become visible when contextTokens > 0', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.classList.contains('claudian-hidden')).toBe(false);
  });

  it('updates the gauge and hides invalid usage while retaining the last presentation', () => {
    meter.update(makeUsage({ contextTokens: 80000, contextWindow: 200000, percentage: 40 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    const fill = parentEl.querySelector('.claudian-meter-fill');
    const circumference = Number(fill?.getAttribute('stroke-dasharray'));
    expect(Number(fill?.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.6);
    meter.update(makeUsage({ contextWindow: 0, percentage: 99 }));
    expect(container?.classList.contains('claudian-hidden')).toBe(true);
    expect(container?.getAttribute('aria-valuenow')).toBe('40');
    meter.update(null);
    expect(container?.classList.contains('claudian-hidden')).toBe(true);
    meter.setVisible(true);
    expect(container?.classList.contains('claudian-hidden')).toBe(false);
  });

  it('should render percentage text for responsive styling', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const percent = parentEl.querySelector('.claudian-context-meter-percent');
    expect(percent?.textContent).toBe('25%');
  });

  it('should expose usage details to assistive technology', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('role')).toBe('progressbar');
    expect(container?.getAttribute('aria-label')).toBe('Context usage');
    expect(container?.getAttribute('aria-valuemin')).toBe('0');
    expect(container?.getAttribute('aria-valuemax')).toBe('100');
    expect(container?.getAttribute('aria-valuenow')).toBe('25');
    expect(container?.getAttribute('aria-valuetext')).toBe('50k / 200k');
  });

  it('should add warning class when usage > 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.hasClass('warning')).toBe(true);
  });

  it('should remove warning class when usage drops below 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.hasClass('warning')).toBe(false);
  });

  it('should set tooltip with formatted token counts', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('50k / 200k');
  });

  it('should format small token counts without k suffix', () => {
    meter.update(makeUsage({ contextTokens: 500, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('500 / 200k');
  });

  it('should add compact reminder to tooltip when usage > 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('170k / 200k (Approaching limit, run `/compact` to continue)');
  });

  it('should not add compact reminder to tooltip when usage ≤ 80%', () => {
    meter.update(makeUsage({ contextTokens: 160000, contextWindow: 200000, percentage: 80 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('160k / 200k');
  });
});
