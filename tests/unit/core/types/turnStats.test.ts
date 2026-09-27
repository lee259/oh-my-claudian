import { createTurnStats, isTokenCount } from '@/core/types';

describe('turn statistics', () => {
  it('accepts only finite safe token counts and positive native durations', () => {
    expect(createTurnStats(12, 500)).toEqual({ outputTokens: 12, durationMs: 500 });
    expect(createTurnStats(12, 0)).toBeUndefined();
    expect(createTurnStats(-1, 500)).toBeUndefined();
    expect(createTurnStats(Number.MAX_SAFE_INTEGER + 1, 500)).toBeUndefined();
    expect(isTokenCount(0)).toBe(true);
    expect(isTokenCount(1.5)).toBe(false);
  });
});
