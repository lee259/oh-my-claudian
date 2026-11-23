import { resolveApprovalSelection } from '@/features/chat/controllers/approvalSelection';

describe('resolveApprovalSelection', () => {
  it('returns the exact selected option value when the provider requires native options', () => {
    const decisions = new Map([['allow-once', 'allow' as const]]);

    expect(resolveApprovalSelection('allow-once', decisions, true)).toEqual({
      type: 'select-option',
      value: 'allow-once',
    });
  });

  it('keeps semantic approval decisions for providers that do not require native options', () => {
    const decisions = new Map([['allow-once', 'allow' as const]]);

    expect(resolveApprovalSelection('allow-once', decisions, false)).toBe('allow');
  });
});
