import { formatActivity } from '@/features/chat/utils/formatActivity';

describe('formatActivity', () => {
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);

  it.each([
    [2, '2 分'],
    [20, '20 分'],
    [60, '1 小时'],
    [4 * 60, '4 小时'],
    [2 * 24 * 60, '2 天'],
  ])('formats %s minutes as a compact Chinese label', (minutes, expected) => {
    expect(formatActivity(now - minutes * 60_000, now, 'zh-CN')).toBe(expected);
  });

  it('does not turn a recent message into zero days', () => {
    expect(formatActivity(now - 20_000, now, 'zh-CN')).toBe('刚刚');
  });
});
