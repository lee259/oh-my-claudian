import { DeferredReviewableSettlement } from '@/features/chat/controllers/DeferredReviewableSettlement';

describe('DeferredReviewableSettlement', () => {
  it('keeps a deferred reporter available for its original conversation', () => {
    const settlement = new DeferredReviewableSettlement();
    const report = jest.fn();

    settlement.defer('conversation-a', report);

    expect(settlement.hasFor('conversation-a')).toBe(true);
    settlement.takeFor('conversation-a')?.();

    expect(report).toHaveBeenCalledTimes(1);
    expect(settlement.hasFor('conversation-a')).toBe(false);
  });

  it('discards a reporter after switching conversations', () => {
    const settlement = new DeferredReviewableSettlement();
    const report = jest.fn();

    settlement.defer('conversation-a', report);

    expect(settlement.takeFor('conversation-b')).toBeNull();
    expect(settlement.takeFor('conversation-a')).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });
});
