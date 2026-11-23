/** @jest-environment jsdom */

import type { ProviderSessionEvent } from '@/core/execution';
import { AntigravityBackgroundTurn } from '@/providers/antigravity/execution/AntigravityBackgroundTurn';

function backgroundScope(event: ProviderSessionEvent) {
  return event.scope.kind === 'background' ? event.scope : null;
}

describe('AntigravityBackgroundTurn', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('streams a late reply and settles one second after its usage report', () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });

    turn.handleUpdate({
      content: { text: 'Late reply', type: 'text' },
      messageId: 'late-message',
      sessionUpdate: 'agent_message_chunk',
    });
    turn.handleUpdate({ sessionUpdate: 'usage_update', size: 1_000, used: 120 });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ kind: 'background', turnId: turn.turnId }),
      type: 'background_turn_started',
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Late reply',
      type: 'text_delta',
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'usage_updated',
    }));

    jest.advanceTimersByTime(999);
    expect(onSettled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSettled).toHaveBeenCalledTimes(1);

    turn.close('completed');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'completed',
      scope: expect.objectContaining({ kind: 'background', turnId: turn.turnId }),
      type: 'background_turn_completed',
    }));
    expect(backgroundScope(notify.mock.calls.at(-1)![0])).not.toBeNull();
  });

  it('presents an unseen tool update as that call and keeps the turn open until usage', () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });

    turn.handleUpdate({
      name: 'run_command',
      rawInput: { CommandLine: 'sleep 5 && echo done' },
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'background-command',
    });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bash',
      toolCallId: 'background-command',
      type: 'tool_started',
    }));
    expect(onSettled).not.toHaveBeenCalled();

    turn.handleUpdate({ sessionUpdate: 'usage_update', size: 1_000, used: 200 });
    jest.advanceTimersByTime(1_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('closes a reply when a denied call fails without a usage report', () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });

    turn.handleUpdate({
      name: 'write_file',
      rawInput: { Path: 'note.md' },
      sessionUpdate: 'tool_call',
      status: 'pending',
      title: 'Write note.md',
      toolCallId: 'denied-write',
    });
    turn.toolDenied('denied-write');
    turn.handleUpdate({
      sessionUpdate: 'tool_call_update',
      status: 'failed',
      toolCallId: 'denied-write',
    });

    jest.advanceTimersByTime(1_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('releases a quiet reply after two minutes when no tool is still open', () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });

    turn.handleUpdate({
      content: { text: 'Quiet reply', type: 'text' },
      messageId: 'quiet-message',
      sessionUpdate: 'agent_message_chunk',
    });
    jest.advanceTimersByTime(119_999);
    expect(onSettled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('keeps a quiet reply open while a tool or client request is pending', async () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });
    let finishRequest!: () => void;
    const pending = new Promise<void>(resolve => { finishRequest = resolve; });

    turn.handleUpdate({
      name: 'read_file',
      rawInput: { Path: 'README.md' },
      sessionUpdate: 'tool_call',
      status: 'in_progress',
      title: 'Read README.md',
      toolCallId: 'open-read',
    });
    const held = turn.holdForRequest(pending);
    jest.advanceTimersByTime(120_000);
    expect(onSettled).not.toHaveBeenCalled();

    finishRequest();
    await held;
    jest.advanceTimersByTime(120_000);
    expect(onSettled).not.toHaveBeenCalled();

    turn.handleUpdate({
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'open-read',
    });
    jest.advanceTimersByTime(119_999);
    expect(onSettled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('records why a reply with a tool still open never settles', () => {
    const notify = jest.fn();
    const onSettled = jest.fn();
    const onCompletionDropped = jest.fn();
    const turn = new AntigravityBackgroundTurn({
      notify,
      onCompletionDropped,
      onSettled,
      providerSessionId: 'session-1',
      sessionInstanceId: 'instance-1',
    });

    turn.handleUpdate({
      name: 'read_file',
      rawInput: { Path: 'README.md' },
      sessionUpdate: 'tool_call',
      status: 'in_progress',
      title: 'Read README.md',
      toolCallId: 'stuck-read',
    });

    jest.advanceTimersByTime(119_999);
    expect(onCompletionDropped).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onSettled).not.toHaveBeenCalled();
    expect(onCompletionDropped).toHaveBeenCalledTimes(1);
    expect(onCompletionDropped).toHaveBeenCalledWith('open-tools');
  });
});
