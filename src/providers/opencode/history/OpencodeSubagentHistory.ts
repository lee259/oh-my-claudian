import { TOOL_SUBAGENT } from '../../../core/tools/toolNames';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { opencodeTaskResultInterpreter } from '../runtime/OpencodeTaskResultInterpreter';
import { loadOpencodeSessionMessages } from './OpencodeHistoryStore';

const MAX_CHILD_DEPTH = 3;

/** Restores OpenCode V2 child-session tool history while hydrating a conversation. */
export async function hydrateOpencodeV2Subagents(
  messages: ChatMessage[],
  readChildMessages: (sessionId: string) => Promise<ChatMessage[]>,
  depth = 0,
): Promise<void> {
  if (depth >= MAX_CHILD_DEPTH) return;
  const spawnsBySession = new Map<string, ToolCallInfo[]>();
  for (const spawn of messages.flatMap(message => message.toolCalls ?? [])) {
    if (spawn.name !== TOOL_SUBAGENT) continue;
    const sessionId = getChildSessionId(spawn);
    if (sessionId) spawnsBySession.set(sessionId, [...spawnsBySession.get(sessionId) ?? [], spawn]);
  }
  await Promise.all([...spawnsBySession].map(async ([sessionId, spawns]) => {
    let child: ChatMessage[];
    try {
      child = await readChildMessages(sessionId);
    } catch {
      return;
    }
    await hydrateOpencodeV2Subagents(child, readChildMessages, depth + 1);
    const turns = assignChildTurns(spawns, splitChildTurns(child));
    spawns.forEach((spawn, index) => {
      const turn = turns[index];
      if (turn) spawn.subagent = buildSubagentInfo(spawn, sessionId, turn);
    });
  }));
}

function splitChildTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(message);
  }
  return turns;
}

function assignChildTurns(spawns: ToolCallInfo[], turns: ChatMessage[][]): Array<ChatMessage[] | undefined> {
  let next = 0;
  return spawns.map(spawn => {
    const prompt = typeof spawn.input.prompt === 'string' ? spawn.input.prompt.trim() : '';
    const matched = prompt ? turns.findIndex((turn, index) => index >= next
      && turn[0]?.role === 'user' && turn[0].content.trim() === prompt) : -1;
    const index = matched >= 0 ? matched : next;
    if (index >= turns.length) return undefined;
    next = index + 1;
    return turns[index];
  });
}

function getChildSessionId(spawn: ToolCallInfo): string | null {
  const rawOutput = spawn.providerPayload?.rawOutput;
  if (isRecord(rawOutput) && isRecord(rawOutput.metadata)
    && typeof rawOutput.metadata.sessionID === 'string' && rawOutput.metadata.sessionID) {
    return rawOutput.metadata.sessionID;
  }
  return opencodeTaskResultInterpreter.extractAgentId(spawn.result);
}

function buildSubagentInfo(spawn: ToolCallInfo, sessionId: string, child: ChatMessage[]): SubagentInfo {
  const current = spawn.subagent;
  const isError = spawn.status === 'error' || spawn.status === 'blocked';
  const isAsync = spawn.input.run_in_background === true
    || opencodeTaskResultInterpreter.hasAsyncLaunchMarker(spawn.result);
  const status = opencodeTaskResultInterpreter.resolveTerminalStatus(
    spawn.result,
    isError ? 'error' : spawn.status === 'running' ? 'error' : 'completed',
  );
  const result = opencodeTaskResultInterpreter.extractStructuredResult(spawn.result)
    ?? [...child].reverse().find(message => message.role === 'assistant' && message.content.trim())?.content;
  return {
    ...current,
    id: spawn.id,
    agentId: sessionId,
    description: current?.description || (typeof spawn.input.description === 'string' ? spawn.input.description : 'Subagent task'),
    prompt: typeof spawn.input.prompt === 'string' ? spawn.input.prompt : current?.prompt ?? '',
    mode: isAsync ? 'async' : 'sync',
    isExpanded: current?.isExpanded ?? false,
    status: spawn.status === 'running' ? 'running' : status,
    ...(isAsync ? { asyncStatus: spawn.status === 'running' ? 'running' : status } : {}),
    toolCalls: child.flatMap(message => message.toolCalls ?? []),
    ...(result ? { result } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function hydrateOpenCodeV2Children(
  messages: ChatMessage[],
  databasePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await hydrateOpencodeV2Subagents(messages, sessionId => loadOpencodeSessionMessages(
    sessionId,
    { databasePath, nativeVersion: 2 },
    environment,
  ));
}
