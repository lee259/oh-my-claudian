import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  ClaudeTurnInputs,
  getReplayedUserMessageId,
} from '@/providers/claude/execution/ClaudeTurnInputs';

function resultMessage(fields: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: '',
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: 'result',
    session_id: 'session',
    ...fields,
  } as unknown as SDKMessage;
}

describe('ClaudeTurnInputs', () => {
  it('settles the run after Claude consumes its primary input', () => {
    const inputs = new ClaudeTurnInputs('primary');

    inputs.observe(resultMessage({ user_message_uuid: 'primary' }));

    expect(inputs.settled).toBe(true);
    expect(inputs.wasConsumed('primary')).toBe(true);
  });

  it('keeps a requested run open while a queued steer remains unconsumed', () => {
    const inputs = new ClaudeTurnInputs('primary');
    inputs.addSteer('steer');

    inputs.observe(resultMessage({
      queued_turn_count: 1,
      user_message_uuid: 'primary',
    }));

    expect(inputs.settled).toBe(false);
    expect(inputs.wasConsumed('primary')).toBe(true);
    expect(inputs.wasConsumed('steer')).toBe(false);
  });

  it('uses replay events as delivery acknowledgement for a steer', () => {
    const inputs = new ClaudeTurnInputs('primary');
    const steerId = '00000000-0000-4000-8000-000000000001';
    inputs.addSteer(steerId);
    const replay = {
      type: 'user',
      isReplay: true,
      message: { role: 'user', content: 'Continue' },
      parent_tool_use_id: null,
      uuid: steerId,
      session_id: 'session',
    } as unknown as SDKMessage;

    expect(getReplayedUserMessageId(replay)).toBe(steerId);
    expect(inputs.observe(replay)).toBe(steerId);
    expect(inputs.hasUndeliveredSteers()).toBe(false);
    expect(inputs.settled).toBe(false);
  });

  it('settles consumed inputs when a result reports no queued turns', () => {
    const inputs = new ClaudeTurnInputs('primary');
    inputs.addSteer('steer');

    inputs.observe(resultMessage({
      queued_turn_count: 0,
      user_message_uuid: 'primary',
    }));

    expect(inputs.settled).toBe(true);
  });

  it('settles on the first result from producers without consumption echoes', () => {
    const inputs = new ClaudeTurnInputs('primary');

    inputs.observe(resultMessage());

    expect(inputs.settled).toBe(true);
  });
});
