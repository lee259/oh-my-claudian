import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeTaskNotificationQueue } from '@/providers/claude/execution/ClaudeTaskNotificationQueue';

function systemMessage(value: Record<string, unknown>): SDKMessage {
  return { type: 'system', ...value } as unknown as SDKMessage;
}

describe('ClaudeTaskNotificationQueue', () => {
  it('places completions at the native consumption boundary and snapshots pending work at init', () => {
    const queue = new ClaudeTaskNotificationQueue();
    queue.observe(systemMessage({ subtype: 'task_started', task_id: 'task-1', is_backgrounded: true }));
    queue.complete(systemMessage({ subtype: 'task_notification', task_id: 'task-1' }), 'first result');
    queue.observe(systemMessage({ subtype: 'init' }));
    queue.observe(systemMessage({ subtype: 'task_started', task_id: 'task-2', is_backgrounded: true }));
    queue.complete(systemMessage({ subtype: 'task_notification', task_id: 'task-2' }), 'later result');

    expect(queue.takeTurnNotifications()).toEqual(['first result']);
    expect(queue.consume('<task-notification><task-id>task-2</task-id><status>completed</status><result>later result</result></task-notification>'))
      .toBe('later result');
    expect(queue.takeTurnNotifications()).toEqual([]);
  });

  it('does not queue foreground or transcript-suppressed task completions', () => {
    const queue = new ClaudeTaskNotificationQueue();
    queue.observe(systemMessage({ subtype: 'task_started', task_id: 'foreground', is_backgrounded: false }));
    queue.complete(systemMessage({ subtype: 'task_notification', task_id: 'foreground' }), 'foreground result');
    queue.observe(systemMessage({ subtype: 'task_started', task_id: 'hidden', is_backgrounded: true }));
    queue.complete(systemMessage({ subtype: 'task_notification', task_id: 'hidden', skip_transcript: true }), 'hidden result');
    queue.observe(systemMessage({ subtype: 'init' }));

    expect(queue.takeTurnNotifications()).toEqual([]);
  });

  it('resets process-scoped notification state', () => {
    const queue = new ClaudeTaskNotificationQueue();
    queue.observe(systemMessage({ subtype: 'task_started', task_id: 'task', is_backgrounded: true }));
    queue.complete(systemMessage({ subtype: 'task_notification', task_id: 'task' }), 'result');
    queue.reset();
    queue.observe(systemMessage({ subtype: 'init' }));
    expect(queue.takeTurnNotifications()).toEqual([]);
  });
});
