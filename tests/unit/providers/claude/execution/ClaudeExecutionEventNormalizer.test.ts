import { buildSDKMessage } from '@test/helpers/sdkMessages';

import { TOOL_TODO_WRITE } from '@/core/tools/toolNames';
import { ClaudeExecutionEventNormalizer } from '@/providers/claude/execution/ClaudeExecutionEventNormalizer';

const msg = buildSDKMessage;

describe('ClaudeExecutionEventNormalizer task tools', () => {
  it('normalizes prompt suggestions as a separate provider event', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize({
      type: 'prompt_suggestion',
      suggestion: 'Show me the relevant tests',
    } as any, 'requested');

    expect(events).toEqual([{
      type: 'prompt_suggestion',
      event: {
        type: 'prompt_suggestion',
        suggestion: 'Show me the relevant tests',
      },
    }]);
  });

  it('normalizes Claude task progress as a provider-neutral ephemeral event', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'agent-1',
      tool_use_id: 'task-tool-1',
      summary: 'Searching the vault',
      last_tool_name: 'Grep',
      usage: { tool_uses: 3, total_tokens: 1200, duration_ms: 4500 },
    } as any, 'requested');

    expect(events).toContainEqual({
      type: 'subagent_progress',
      event: {
        type: 'subagent_progress',
        progress: {
          toolCallId: 'task-tool-1',
          summary: 'Searching the vault',
          lastToolName: 'Grep',
          toolUses: 3,
          totalTokens: 1200,
          durationMs: 4500,
        },
      },
    });
  });

  it('preserves a blocked decision for the matching native tool result', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();
    normalizer.markToolBlocked('tool-1', 'requested');

    const events = normalizer.normalize(msg({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'The tool was not run.',
          is_error: true,
        }],
      },
    }), 'requested');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({
        type: 'tool_completed',
        toolCallId: 'tool-1',
        isError: true,
        isBlocked: true,
      }),
    }));
  });

  it('adapts main-thread task mutations and preserves native payloads', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();

    const createEvents = normalizer.normalize(msg({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'create-1',
          name: 'TaskCreate',
          input: { subject: 'Implement fix', activeForm: 'Implementing fix' },
        }],
      },
    }), 'requested');
    expect(createEvents).toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({
        type: 'tool_started',
        toolCallId: 'create-1',
        name: TOOL_TODO_WRITE,
        input: {
          todos: [{
            content: 'Implement fix',
            activeForm: 'Implementing fix',
            status: 'pending',
          }],
        },
        providerPayload: {
          rawName: 'TaskCreate',
          rawInput: { subject: 'Implement fix', activeForm: 'Implementing fix' },
        },
      }),
    }));

    const resultEvents = normalizer.normalize(msg({
      type: 'user',
      tool_use_result: { task: { id: '1', subject: 'Implement fix' } },
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'create-1',
          content: 'Task #1 created successfully: Implement fix',
        }],
      },
    }), 'requested');
    expect(resultEvents).toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({
        type: 'tool_started',
        toolCallId: 'create-1',
        name: TOOL_TODO_WRITE,
        input: {
          todos: [{
            id: '1',
            content: 'Implement fix',
            activeForm: 'Implementing fix',
            status: 'pending',
          }],
        },
        providerPayload: expect.objectContaining({
          rawName: 'TaskCreate',
          rawOutput: { task: { id: '1', subject: 'Implement fix' } },
        }),
      }),
    }));
    expect(resultEvents).toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({
        type: 'tool_completed',
        toolCallId: 'create-1',
      }),
    }));
  });

  it('does not add subagent task mutations to the main TodoWrite list', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();
    const events = normalizer.normalize(msg({
      type: 'assistant',
      parent_tool_use_id: 'agent-1',
      message: {
        content: [{
          type: 'tool_use',
          id: 'create-1',
          name: 'TaskCreate',
          input: { subject: 'Subagent work' },
        }],
      },
    }), 'requested');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({
        type: 'tool_started',
        toolCallId: 'create-1',
        name: 'TaskCreate',
        toolScope: { kind: 'subagent', subagentId: 'agent-1' },
      }),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({ name: TOOL_TODO_WRITE }),
    }));
  });
});

describe('ClaudeExecutionEventNormalizer API errors', () => {
  const resetText = "You've hit your session limit · resets 4:10pm (Europe/Berlin)";

  const apiErrorMessage = () => msg({
    type: 'assistant',
    error: 'rate_limit',
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    message: {
      model: '<synthetic>',
      content: [{ type: 'text', text: resetText }],
    },
  });

  it('uses synthetic API error text for the native error', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize(
      apiErrorMessage(),
      'requested',
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: 'native_error',
      message: resetText,
    }));
  });

  it('does not render synthetic API error text twice', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize(
      apiErrorMessage(),
      'requested',
    );

    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'output',
      event: expect.objectContaining({ type: 'text_delta', text: resetText }),
    }));
  });
});

describe('Claude authentication conflict guidance', () => {
  const normalize = (content: unknown[], synthetic = true, error = 'authentication_failed') => (
    new ClaudeExecutionEventNormalizer().normalize(msg({
      type: 'assistant', error,
      ...(synthetic ? { isApiErrorMessage: true, apiErrorStatus: 401 } : {}),
      message: { model: synthetic ? '<synthetic>' : 'claude-sonnet-4-5', content },
    }), 'requested')
  );
  const diagnostic = (events: ReturnType<typeof normalize>) => {
    const event = events.find(candidate => candidate.type === 'native_error');
    if (event?.type !== 'native_error') throw new Error('Missing native error');
    return event.message;
  };
  const expectGuidance = (text: string) => {
    expect(text).toContain('If the same CLI works with a subscription');
    expect(text).toContain('Settings → Providers → Claude → Custom variables');
    expect(text).toContain('only for the conflicting credential you intend to disable');
    expect(text).toContain('ANTHROPIC_API_KEY=');
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN=');
    expect(text).toContain('shared environment');
  };

  it('preserves native prose and adds Claude-only guidance without leaking credentials', () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-for-display';
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token-not-for-display';
    try {
      const events = normalize([{ type: 'text', text: 'API Error: 401 Invalid credentials' }]);
      const text = diagnostic(events);
      expect(text.startsWith('API Error: 401 Invalid credentials')).toBe(true);
      expectGuidance(text);
      expect(text).not.toContain('test-key-not-for-display');
      expect(text).not.toContain('test-token-not-for-display');
      expect(process.env.ANTHROPIC_API_KEY).toBe('test-key-not-for-display');
      expect(events.filter(event => event.type === 'output')).toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
      if (previousToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousToken;
    }
  });

  it.each([['empty', []], ['whitespace', [{ type: 'text', text: '  \n\t ' }]]])('handles %s authentication prose', (_label, content) => {
    const events = normalize(content);
    const text = diagnostic(events);
    expect(text.startsWith('Claude authentication failed.')).toBe(true);
    expectGuidance(text);
    expect(events.filter(event => event.type === 'output')).toEqual([]);
  });

  it('preserves a real partial reply separately from the authentication diagnostic', () => {
    const events = normalize([{ type: 'text', text: 'Partial reply' }], false);
    expectGuidance(diagnostic(events));
    expect(diagnostic(events)).not.toContain('Partial reply');
    expect(events).toContainEqual(expect.objectContaining({ type: 'output',
      event: expect.objectContaining({ type: 'text_delta', text: 'Partial reply' }) }));
  });

  it.each(['rate_limit', 'billing_error', 'server_error'])('leaves %s errors unchanged', error => {
    expect(diagnostic(normalize([{ type: 'text', text: 'Native diagnostic' }], true, error)))
      .toBe('Native diagnostic');
  });
});

describe('Claude task notification presentation', () => {
  it('keeps completion separate from the later native consumption boundary', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
      summary: 'Background work finished.',
      session_id: 'session-1',
    } as any, 'background');

    expect(events).toContainEqual(expect.objectContaining({ type: 'async_subagent_completion' }));
    expect(events.filter(event => event.type === 'output')).toEqual([]);
  });

  it('does not expose notifications excluded from the transcript', () => {
    const events = new ClaudeExecutionEventNormalizer().normalize({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'watcher',
      status: 'completed',
      summary: 'Watcher update.',
      session_id: 'session-1',
      skip_transcript: true,
    } as any, 'background');

    expect(events.filter(event => event.type === 'output')).toEqual([]);
  });
});
