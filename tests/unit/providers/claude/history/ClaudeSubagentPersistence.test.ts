import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Conversation, SubagentInfo } from '@/core/types';
import { ClaudeConversationHistoryService } from '@/providers/claude/history/ClaudeConversationHistoryService';
import { encodeVaultPathForSDK } from '@/providers/claude/history/ClaudeHistoryStore';

describe('Claude subagent save and reopen', () => {
  let root: string;
  const vault = '/vault';
  const sessionId = 'parent-session';
  const agentId = 'child-agent';
  const taskId = 'task-call';
  const time = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000).toISOString();

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-subagent-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const conversation = (providerState?: Record<string, unknown>): Conversation => ({
    id: 'conversation', providerId: 'claude', title: 'History', createdAt: 1, lastActivityAt: 1,
    sessionId, providerState, messages: [],
  });
  const child = (mode: 'sync' | 'async', status: SubagentInfo['status'] = 'completed'): SubagentInfo => ({
    id: taskId, agentId, mode, status, ...(mode === 'async' ? { asyncStatus: status } : {}),
    description: 'Inspect notes', prompt: 'Read the note', isExpanded: false,
    result: status === 'error' ? 'Failure observed only by Claudian' : 'Full child report', toolCalls: [],
  });
  const context = () => ({ environment: { CLAUDE_CONFIG_DIR: root }, vaultPath: vault });
  const options = () => ({ preserveProviderState: true,
    getNativeHistory: () => ({ vaultPath: vault, pathContext: context() }),
  });

  function nativeFiles(mode: 'sync' | 'async', notice: 'full' | 'summary' | 'missing' = 'full') {
    const project = path.join(root, 'projects', encodeVaultPathForSDK(vault));
    const sidecar = path.join(project, sessionId, 'subagents');
    fs.mkdirSync(sidecar, { recursive: true });
    const records = [
      { type: 'user', uuid: 'user', timestamp: time(0), message: { role: 'user', content: 'Inspect notes' } },
      { type: 'assistant', uuid: 'assistant', parentUuid: 'user', timestamp: time(1), message: { role: 'assistant', content: [
        { type: 'tool_use', id: taskId, name: 'Agent', input: { description: 'Inspect notes', prompt: 'Read the note', run_in_background: mode === 'async' } },
      ] } },
      { type: 'user', uuid: 'result', parentUuid: 'assistant', timestamp: time(4), toolUseResult: {
        agentId, ...(mode === 'async' ? { isAsync: true, status: 'async_launched' } : { status: 'completed' }),
      }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: taskId,
        content: mode === 'async' ? 'Agent launched in background' : 'Full child report' }] } },
    ];
    const sidecarRecords = [
      { type: 'assistant', timestamp: time(2), message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'note.md' } },
      ] } },
      { type: 'user', timestamp: time(3), message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'read-1', content: 'Found note' },
      ] } },
      { type: 'assistant', timestamp: time(4), message: { role: 'assistant', content: [{ type: 'text', text: 'Full child report' }] } },
    ];
    fs.writeFileSync(path.join(project, sessionId + '.jsonl'), records.map(r => JSON.stringify(r)).join('\n')
      + (mode === 'async' && notice !== 'missing' ? '\n' + JSON.stringify({ type: 'queue-operation', operation: 'enqueue',
        content: `<task-notification><task-id>${agentId}</task-id><status>completed</status><${notice === 'full' ? 'result' : 'summary'}>${notice === 'full' ? 'Full child report' : 'Short summary'}</${notice === 'full' ? 'result' : 'summary'}></task-notification>`,
      }) : ''));
    const file = path.join(sidecar, 'agent-' + agentId + '.jsonl');
    fs.writeFileSync(file, sidecarRecords.map(r => JSON.stringify(r)).join('\n'));
    return { sidecar, file };
  }

  it.each(['sync', 'async'] as const)('projects and reopens a %s child without losing its report or tool calls', async mode => {
    nativeFiles(mode);
    const service = new ClaudeConversationHistoryService();
    const input = conversation({ subagentData: { [taskId]: child(mode) } });
    const saved = service.buildPersistedProviderState(input, options());
    const cached = (saved?.subagentData as Record<string, unknown> | undefined)?.[taskId];
    expect(cached).toEqual(mode === 'sync' ? undefined : {
      id: taskId, agentId, mode: 'async', status: 'completed', asyncStatus: 'completed',
    });
    expect(input.providerState?.subagentData).toEqual({ [taskId]: child(mode) });
    const reopened = conversation(saved);
    await service.hydrateConversationHistory(reopened, vault, context());
    const task = reopened.messages.flatMap(m => m.toolCalls ?? []).find(t => t.id === taskId);
    expect(task?.subagent).toMatchObject({ agentId, mode, status: 'completed', result: 'Full child report',
      toolCalls: [{ id: 'read-1', result: 'Found note' }] });
    expect(service.buildPersistedProviderState(reopened, { getNativeHistory: options().getNativeHistory })).toEqual(saved);
  });

  it.each(['summary', 'missing'] as const)('recovers a full report when the completion notice is %s', async notice => {
    nativeFiles('async', notice);
    const service = new ClaudeConversationHistoryService();
    const saved = service.buildPersistedProviderState(conversation({ subagentData: { [taskId]: child('async') } }), options());
    const reopened = conversation(saved);
    await service.hydrateConversationHistory(reopened, vault, context());
    const task = reopened.messages.flatMap(m => m.toolCalls ?? []).find(t => t.id === taskId);
    expect(task?.subagent).toMatchObject({ status: 'completed', asyncStatus: 'completed', result: 'Full child report' });
  });

  it('retains an async failure explanation that native history lacks', async () => {
    nativeFiles('async', 'missing');
    const service = new ClaudeConversationHistoryService();
    const saved = service.buildPersistedProviderState(conversation({ subagentData: { [taskId]: child('async', 'error') } }), options());
    expect((saved?.subagentData as Record<string, SubagentInfo>)[taskId].result).toBe('Failure observed only by Claudian');
    const reopened = conversation(saved);
    await service.hydrateConversationHistory(reopened, vault, context());
    expect(reopened.messages.flatMap(m => m.toolCalls ?? []).find(t => t.id === taskId)?.subagent)
      .toMatchObject({ status: 'error', asyncStatus: 'error', result: 'Failure observed only by Claudian' });
  });

  it('keeps the full record without a sidecar or while a sync task is running', () => {
    const service = new ClaudeConversationHistoryService();
    const full = child('sync');
    expect(service.buildPersistedProviderState(conversation({ subagentData: { [taskId]: full } }), options())?.subagentData)
      .toEqual({ [taskId]: full });
    nativeFiles('sync');
    const running = child('sync', 'running');
    expect(service.buildPersistedProviderState(conversation({ subagentData: { [taskId]: running } }), options())?.subagentData)
      .toEqual({ [taskId]: running });
  });

  it('uses the native toolUseId index for legacy records without an agentId', () => {
    const { sidecar } = nativeFiles('sync');
    fs.writeFileSync(path.join(sidecar, 'agent-' + agentId + '.meta.json'), JSON.stringify({ toolUseId: taskId }));
    const legacy = child('sync'); delete legacy.agentId;
    const service = new ClaudeConversationHistoryService();
    expect(service.buildPersistedProviderState(conversation({ subagentData: { [taskId]: legacy } }), options())?.subagentData)
      .toBeUndefined();
  });

  it('preserves existing overlays, and removes stale subagent state after rewind', () => {
    const service = new ClaudeConversationHistoryService();
    const overlay = { id: taskId, mode: 'async', agentId, status: 'completed', asyncStatus: 'completed' };
    const input = conversation({ subagentData: { [taskId]: overlay } });
    expect(service.buildPersistedProviderState(input, options())?.subagentData).toEqual({ [taskId]: overlay });
    expect(service.buildPersistedProviderState(input)?.subagentData).toBeUndefined();
  });

  it('limits a reused sync sidecar to the original invocation', async () => {
    const { file } = nativeFiles('sync');
    fs.appendFileSync(file, '\n' + JSON.stringify({ type: 'assistant', timestamp: time(8), message: { content: [
      { type: 'tool_use', id: 'later-write', name: 'Write', input: { file_path: 'later.md', content: 'Later run' } },
    ] } }));
    const reopened = conversation();
    await new ClaudeConversationHistoryService().hydrateConversationHistory(reopened, vault, context());
    expect(reopened.messages.flatMap(m => m.toolCalls ?? []).find(t => t.id === taskId)?.subagent?.toolCalls.map(t => t.id))
      .toEqual(['read-1']);
  });
  it.each(['missing-parent', 'directory-sidecar'])('keeps the full cached copy when native history has %s', failure => {
    const { file } = nativeFiles('sync');
    if (failure === 'missing-parent') fs.unlinkSync(path.join(path.dirname(path.dirname(path.dirname(file))), sessionId + '.jsonl'));
    else { fs.unlinkSync(file); fs.mkdirSync(file); }
    const full = child('sync');
    expect(new ClaudeConversationHistoryService().buildPersistedProviderState(
      conversation({ subagentData: { [taskId]: full } }), options())?.subagentData).toEqual({ [taskId]: full });
  });

  it('does not anchor an overlay to a rewind that excludes its invocation', async () => {
    nativeFiles('async');
    const reopened = conversation({ subagentData: { [taskId]: {
      id: taskId, agentId, mode: 'async', status: 'completed', asyncStatus: 'completed',
    } } });
    reopened.resumeAtMessageId = 'user';
    await new ClaudeConversationHistoryService().hydrateConversationHistory(reopened, vault, context());
    expect(reopened.messages.flatMap(m => m.toolCalls ?? [])).toEqual([]);
  });

  it('rehydrates structured answers from the child sidecar', async () => {
    const { file } = nativeFiles('sync');
    fs.writeFileSync(file, [
      { type: 'assistant', timestamp: time(2), message: { content: [{ type: 'tool_use', id: 'ask', name: 'AskUserQuestion', input: { questions: [{ question: 'Continue?' }] } }] } },
      { type: 'user', timestamp: time(3), toolUseResult: { answers: { 'Continue?': 'Yes' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'ask', content: 'Answered' }] } },
    ].map(r => JSON.stringify(r)).join('\n'));
    const reopened = conversation();
    await new ClaudeConversationHistoryService().hydrateConversationHistory(reopened, vault, context());
    expect(reopened.messages.flatMap(m => m.toolCalls ?? []).find(t => t.id === taskId)?.subagent?.toolCalls[0])
      .toMatchObject({ id: 'ask', resolvedAnswers: { 'Continue?': 'Yes' } });
  });

  it('preserves legacy full records whose execution mode is unknown', () => {
    nativeFiles('sync');
    const full = child('sync'); delete full.mode;
    expect(new ClaudeConversationHistoryService().buildPersistedProviderState(
      conversation({ subagentData: { [taskId]: full } }), options())?.subagentData).toEqual({ [taskId]: full });
  });

});
