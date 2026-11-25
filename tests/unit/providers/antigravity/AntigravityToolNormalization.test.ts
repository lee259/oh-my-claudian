import {
  TOOL_CLOSE_AGENT,
  TOOL_LIST_AGENTS,
  TOOL_SEND_MESSAGE,
  TOOL_SPAWN_AGENT,
  TOOL_WORKFLOW,
} from '@/core/tools/toolNames';
import {
  antigravityPermissionWarning,
  normalizeAntigravityToolInput,
  normalizeAntigravityToolName,
  normalizeAntigravityToolResult,
  presentAntigravityUpdate,
} from '@/providers/antigravity/normalization/antigravityToolNormalization';

describe('normalizeAntigravityToolName', () => {
  it('presents subagent and workflow tools as the shared tools that render them', () => {
    expect(normalizeAntigravityToolName('invoke_subagent', { Role: 'reviewer' })).toBe(TOOL_SPAWN_AGENT);
    expect(normalizeAntigravityToolName('send_message', { Message: 'go' })).toBe(TOOL_SEND_MESSAGE);
    expect(normalizeAntigravityToolName('run_workflow', { Script: 'print(1)' })).toBe(TOOL_WORKFLOW);
    expect(normalizeAntigravityToolName('manage_subagents', { Action: 'list' })).toBe(TOOL_LIST_AGENTS);
    expect(normalizeAntigravityToolName('manage_subagents', { Action: 'list_peers' })).toBe(TOOL_LIST_AGENTS);
    expect(normalizeAntigravityToolName('manage_subagents', { Action: 'kill' })).toBe(TOOL_CLOSE_AGENT);
    expect(normalizeAntigravityToolName('manage_subagents', { Action: 'kill_all' })).toBe(TOOL_CLOSE_AGENT);
  });
});

describe('normalizeAntigravityToolInput', () => {
  it('projects the arguments the shared presentations read', () => {
    expect(normalizeAntigravityToolInput('invoke_subagent', { Prompt: 'Check it', Role: 'reviewer' }))
      .toMatchObject({ message: 'Check it', target: 'reviewer' });
    // Recipients are conversation ids, so only the message is shown.
    expect(normalizeAntigravityToolInput('send_message', { Message: 'Go on', Target: 'sub-1' }))
      .toMatchObject({ message: 'Go on' });
    expect(normalizeAntigravityToolInput('run_workflow', { Description: 'Build the site', Script: 'print(1)' }))
      .toMatchObject({ code: 'print(1)', language: 'Python', title: 'Build the site' });
  });
});

describe('normalizeAntigravityToolResult', () => {
  it('drops receipts that carry only conversation ids', () => {
    expect(normalizeAntigravityToolResult('invoke_subagent', 'Created the following subagent:\nconversation_id: sub-1', undefined))
      .toEqual({ content: '', isError: false });
    expect(normalizeAntigravityToolResult('send_message', 'Message sent to "sub-1".', undefined))
      .toEqual({ content: '', isError: false });
  });

  it('lists subagents by role and state instead of raw JSON', () => {
    const content = 'You have 2 active subagent(s):\n'
      + '[{"conversation_id":"sub-1","role":"reviewer","state":"running"},'
      + '{"conversation_id":"sub-2","role":"writer","state":"completed"}]';
    expect(normalizeAntigravityToolResult('manage_subagents', content, undefined))
      .toEqual({ content: 'reviewer (running)\nwriter (completed)', isError: false });
    expect(normalizeAntigravityToolResult('manage_subagents', 'You have 0 active subagent(s):\n[]', undefined))
      .toEqual({ content: 'You have 0 active subagent(s):\n[]', isError: false });
  });
});

describe('presentAntigravityUpdate', () => {
  it('presents an unseen tool update as the call it completes', () => {
    const seen = new Set<string>();
    const update = {
      name: 'run_command',
      rawInput: { CommandLine: 'echo done' },
      sessionUpdate: 'tool_call_update' as const,
      status: 'completed' as const,
      toolCallId: 'background-command',
    };

    const presented = presentAntigravityUpdate(seen, update);

    expect(presented).toMatchObject({
      sessionUpdate: 'tool_call',
      title: 'run_command',
      toolCallId: 'background-command',
    });
    expect(seen).toEqual(new Set(['background-command']));
  });

  it('keeps later updates for a call the turn already saw', () => {
    const seen = new Set(['call-1']);
    const update = {
      name: 'write_file',
      sessionUpdate: 'tool_call_update' as const,
      status: 'completed' as const,
      toolCallId: 'call-1',
    };

    expect(presentAntigravityUpdate(seen, update)).toMatchObject({
      sessionUpdate: 'tool_call_update',
      title: 'write_file',
    });
  });

  it('exposes the provider warning attached to a persistent approval', () => {
    expect(antigravityPermissionWarning({
      _meta: {
        'agy.security.warning': {
          message: 'Future shell calls may run without asking.',
        },
      },
      kind: 'allow_always',
      name: 'Always allow',
      optionId: 'always',
    })).toBe('Future shell calls may run without asking.');
    expect(antigravityPermissionWarning({
      kind: 'allow_once',
      name: 'Allow once',
      optionId: 'once',
    })).toBeUndefined();
  });
});
