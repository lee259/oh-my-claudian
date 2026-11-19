import { getGrokStopHookFeedback } from '@/providers/grok/normalization/grokStopHook';

describe('getGrokStopHookFeedback', () => {
  it('extracts blocked Stop hook feedback while ignoring successful runs', () => {
    expect(getGrokStopHookFeedback({
      sessionUpdate: 'hook_execution',
      event_name: 'stop',
      prompt_id: 'prompt-1',
      runs: [
        { status: { blocked: true, error: 'blocked stop: Run the focused tests.' } },
        { status: { blocked: false, error: 'not blocking' } },
        { status: { blocked: true, error: 'Address the review.' } },
      ],
    })).toBe('Run the focused tests.\n\nAddress the review.');
  });

  it('ignores the session-end Stop fire and non-Stop hook executions', () => {
    expect(getGrokStopHookFeedback({
      sessionUpdate: 'hook_execution',
      event_name: 'stop',
      runs: [{ status: { blocked: true, error: 'blocked stop: Ignore this.' } }],
    })).toBeNull();
    expect(getGrokStopHookFeedback({
      sessionUpdate: 'hook_execution',
      event_name: 'session_end',
      prompt_id: 'prompt-1',
      runs: [{ status: { blocked: true, error: 'blocked stop: Ignore this.' } }],
    })).toBeNull();
  });
});
