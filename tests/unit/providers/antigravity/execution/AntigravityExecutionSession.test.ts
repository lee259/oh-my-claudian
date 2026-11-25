/** @jest-environment jsdom */

import type {
  ProviderApprovalInteractionRequest,
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderInteractionPort,
  ProviderSessionConfig,
  ProviderSessionEvent,
} from '@/core/execution';
import type { ProviderRuntimeHost } from '@/core/providers/ProviderRuntimeHost';
import type { ACPRequestPermissionRequest } from '@/providers/acp';

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)) as typeof value;
}

const mockNativeConnections: Array<{
  cancels: number;
  emit(update: Record<string, unknown>): void;
  finishPrompt(response?: Record<string, unknown>): void;
  options: {
    requestPermission(request: ACPRequestPermissionRequest): Promise<unknown>;
  };
  prompts: number;
  requestPermission(request: ACPRequestPermissionRequest): Promise<unknown>;
}> = [];

jest.mock('@/providers/antigravity/execution/AntigravityNativeConnection', () => {
  class MockAntigravityNativeConnection {
    readonly launch: { command: string; env: Record<string, string>; cwd: string };
    private readonly closeListeners = new Set<() => void>();
    private readonly notificationListeners = new Set<(notification: {
      sessionId: string;
      update: Record<string, unknown>;
    }) => void>();
    private promptResolve: ((response: Record<string, unknown>) => void) | null = null;
    prompts = 0;
    cancels = 0;

    constructor(readonly options: {
      requestPermission(request: ACPRequestPermissionRequest): Promise<unknown>;
    }) {
      this.launch = { command: 'agy', cwd: '/vault', env: {} };
      mockNativeConnections.push(this);
    }

    async initialize(): Promise<void> {}
    async newSession(): Promise<Record<string, unknown>> {
      return { configOptions: [], models: null, sessionId: 'session-1' };
    }
    async resumeSession(): Promise<Record<string, unknown>> {
      return { configOptions: [], models: null };
    }
    async setConfigOption(): Promise<Record<string, unknown>> {
      return { configOptions: [] };
    }
    prompt(): Promise<Record<string, unknown>> {
      this.prompts += 1;
      return new Promise(resolve => { this.promptResolve = resolve; });
    }
    cancel(): void {
      this.cancels += 1;
      this.promptResolve?.({ stopReason: 'cancelled' });
    }
    isAlive(): boolean {
      return true;
    }
    onClose(listener: () => void): () => void {
      this.closeListeners.add(listener);
      return () => this.closeListeners.delete(listener);
    }
    onNotification(listener: (notification: {
      sessionId: string;
      update: Record<string, unknown>;
    }) => void): () => void {
      this.notificationListeners.add(listener);
      return () => this.notificationListeners.delete(listener);
    }
    async shutdown(): Promise<void> {
      for (const listener of this.closeListeners) listener();
    }
    emit(update: Record<string, unknown>): void {
      for (const listener of this.notificationListeners) {
        listener({ sessionId: 'session-1', update });
      }
    }
    finishPrompt(response: Record<string, unknown> = { stopReason: 'end_turn' }): void {
      this.promptResolve?.(response);
    }
    requestPermission(request: ACPRequestPermissionRequest): Promise<unknown> {
      return this.options.requestPermission(request);
    }
  }

  return {
    ANTIGRAVITY_ACP_ARGS: ['acp'],
    ANTIGRAVITY_SKIP_PERMISSIONS_FLAG: '--dangerously-skip-permissions',
    AntigravityNativeConnection: MockAntigravityNativeConnection,
  };
});

jest.mock('@/providers/antigravity/runtime/AntigravityExecutionContext', () => ({
  resolveAntigravityLaunchSpec: jest.fn(async () => ({
    command: 'agy',
    cwd: '/vault',
    env: {},
  })),
}));

jest.mock('@/providers/antigravity/runtime/AntigravityAgentFiles', () => ({
  ANTIGRAVITY_INLINE_EDIT_TOOLS: ['read_file', 'search_web'],
  prepareAntigravityAgentFile: jest.fn(async () => undefined),
}));

import {
  AntigravityExecutionSession,
  type AntigravityExecutionSessionOptions,
} from '@/providers/antigravity/execution/AntigravityExecutionSession';

function createInteractionPort() {
  return {
    askUserQuestion: jest.fn(),
    dismissInteraction: jest.fn(),
    requestApproval: jest.fn(async (request: ProviderApprovalInteractionRequest) => ({
      decision: 'allow' as const,
      interactionId: request.interactionId,
    })),
    requestPlanDecision: jest.fn(async request => ({
      decision: null,
      interactionId: request.interactionId,
    })),
  } satisfies ProviderInteractionPort;
}

function createSession(options: AntigravityExecutionSessionOptions = {}) {
  const host = {
    clientVersion: 'test',
    config: {},
    environmentText: '',
    notifyChatOptionsChanged: jest.fn(),
    resolveCliPath: async () => '/usr/local/bin/agy',
    selection: { referencedModelIds: [] },
    updateConfig: async () => false,
    workingDirectory: '/vault',
  } satisfies ProviderRuntimeHost;
  const interactionPort = createInteractionPort();
  const config = {
    interactionPort,
    lifecycle: 'persistent',
    nativePersistence: 'enabled',
    vaultWorkingDirectory: '/vault',
  } satisfies ProviderSessionConfig;
  return {
    interactionPort,
    session: new AntigravityExecutionSession(host, config, options),
  };
}

function request(text = 'hello'): ProviderExecutionRequest {
  return {
    configuration: {
      permissionMode: 'normal',
      systemInstructions: { instructions: 'Be exact.', kind: 'explicit', purpose: 'main' },
    },
    input: [{ text, type: 'text' }],
    signal: new AbortController().signal,
    toolPolicy: { kind: 'provider-default' },
  };
}

function titleRequest(): ProviderExecutionRequest {
  return {
    ...request('title'),
    configuration: {
      permissionMode: 'normal',
      systemInstructions: { instructions: 'Title only.', kind: 'explicit', purpose: 'title' },
    },
    toolPolicy: { kind: 'passive' },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => { setTimeout(resolve, 0); });
  }
  throw new Error('Condition was not reached.');
}

async function collect(events: AsyncIterable<ProviderExecutionEvent>): Promise<ProviderExecutionEvent[]> {
  const collected: ProviderExecutionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('AntigravityExecutionSession agy 1.5.10 streaming', () => {
  beforeEach(() => {
    mockNativeConnections.length = 0;
  });

  it('streams the prompt reply without waiting for an echo', async () => {
    const { session } = createSession();
    const run = session.execute(request());
    const events = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);

    mockNativeConnections[0].emit({
      content: { text: 'Direct reply', type: 'text' },
      messageId: 'assistant-1',
      sessionUpdate: 'agent_message_chunk',
    });
    mockNativeConnections[0].finishPrompt();

    expect(await events).toContainEqual(expect.objectContaining({
      text: 'Direct reply',
      type: 'text_delta',
    }));
    await session.dispose();
  });

  it('streams late output as one background turn and closes it after usage settles', async () => {
    const { session } = createSession();
    const background: ProviderSessionEvent[] = [];
    session.onEvent(event => {
      if (event.scope.kind === 'background') background.push(event);
    });
    const run = session.execute(request());
    const completed = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await completed;

    jest.useFakeTimers();
    try {
      mockNativeConnections[0].emit({
        content: { text: 'Late reply', type: 'text' },
        messageId: 'late-1',
        sessionUpdate: 'agent_message_chunk',
      });
      mockNativeConnections[0].emit({ sessionUpdate: 'usage_update', size: 1_000, used: 100 });

      expect(background.map(event => event.type)).toEqual([
        'background_turn_started',
        'assistant_message_started',
        'text_delta',
        'usage_updated',
      ]);
      jest.advanceTimersByTime(1_000);
      expect(background.at(-1)).toMatchObject({
        reason: 'completed',
        type: 'background_turn_completed',
      });
    } finally {
      jest.useRealTimers();
      await session.dispose();
    }
  });

  it('routes a late approval to the background turn under the last run policy', async () => {
    const { interactionPort, session } = createSession();
    const run = session.execute(request());
    const completed = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await completed;

    const started = await new Promise<ProviderSessionEvent>(resolve => {
      const unsubscribe = session.onEvent(event => {
        if (event.type !== 'background_turn_started') return;
        unsubscribe();
        resolve(event);
      });
      mockNativeConnections[0].emit({
        kind: 'edit',
        name: 'write_file',
        rawInput: { Content: 'x', Path: 'note.md' },
        sessionUpdate: 'tool_call',
        status: 'pending',
        title: 'Write note.md',
        toolCallId: 'late-write',
      });
    });

    expect(started.scope.kind).toBe('background');
    const response = await mockNativeConnections[0].requestPermission({
      options: [
        { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
        { kind: 'reject_once', name: 'Deny', optionId: 'reject' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'edit',
        name: 'write_file',
        title: 'Write note.md',
        toolCallId: 'late-write',
      } as ACPRequestPermissionRequest['toolCall'],
    });

    expect(response).toEqual({ outcome: { optionId: 'allow', outcome: 'selected' } });
    expect(interactionPort.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Write',
        turnId: started.scope.kind === 'background' ? started.scope.turnId : undefined,
      }),
      expect.any(AbortSignal),
    );
    await session.dispose();
  });

  it('stops late work between runs and ignores the calls its cancel ends', async () => {
    const { session } = createSession();
    const events: ProviderSessionEvent[] = [];
    session.onEvent(event => {
      if (event.scope.kind === 'background') events.push(event);
    });
    const first = session.execute(request());
    const firstEvents = collect(first.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await firstEvents;

    mockNativeConnections[0].emit({
      content: { text: 'Late reply', type: 'text' },
      messageId: 'late-stop',
      sessionUpdate: 'agent_message_chunk',
    });
    session.cancel();

    expect(mockNativeConnections[0].cancels).toBe(1);
    expect(events.at(-1)).toMatchObject({
      reason: 'interrupted',
      type: 'background_turn_completed',
    });
    const starts = events.filter(event => event.type === 'background_turn_started').length;

    mockNativeConnections[0].emit({
      sessionUpdate: 'tool_call_update',
      status: 'failed',
      toolCallId: 'cancelled-command',
    });
    expect(events.filter(event => event.type === 'background_turn_started')).toHaveLength(starts);
    await session.dispose();
  });

  it('keeps a cancelled run\'s late call failure in the stopped turn', async () => {
    const { session } = createSession();
    const events: ProviderSessionEvent[] = [];
    session.onEvent(event => {
      if (event.scope.kind === 'background') events.push(event);
    });
    const run = session.execute(request());
    const runEvents = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].emit({
      name: 'run_command',
      rawInput: { CommandLine: 'sleep 5' },
      sessionUpdate: 'tool_call',
      status: 'in_progress',
      toolCallId: 'run-command',
    });

    session.cancel();
    await runEvents;
    expect(mockNativeConnections[0].cancels).toBe(1);

    // agy reports the call its cancel ended after the prompt settles; it belongs to the stopped turn.
    mockNativeConnections[0].emit({
      sessionUpdate: 'tool_call_update',
      status: 'failed',
      toolCallId: 'run-command',
    });
    expect(events.filter(event => event.type === 'background_turn_started')).toHaveLength(0);
    await session.dispose();
  });

  it('holds the next prompt until the late reply closes', async () => {
    const { session } = createSession();
    const first = session.execute(request());
    const firstEvents = collect(first.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await firstEvents;

    jest.useFakeTimers();
    try {
      mockNativeConnections[0].emit({
        content: { text: 'Late part', type: 'text' },
        messageId: 'late-hold',
        sessionUpdate: 'agent_message_chunk',
      });
      const second = session.execute(request('next'));
      const secondEvents = collect(second.events);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockNativeConnections[0].prompts).toBe(1);

      mockNativeConnections[0].emit({ sessionUpdate: 'usage_update', size: 1_000, used: 200 });
      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockNativeConnections[0].prompts).toBe(2);

      mockNativeConnections[0].finishPrompt();
      await secondEvents;
    } finally {
      jest.useRealTimers();
      await session.dispose();
    }
  });

  it('never opens a background turn for an auxiliary session', async () => {
    const { session } = createSession();
    const events: ProviderSessionEvent[] = [];
    session.onEvent(event => {
      if (event.scope.kind === 'background') events.push(event);
    });
    const run = session.execute(titleRequest());
    const completed = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await completed;

    mockNativeConnections[0].emit({
      content: { text: 'Late reply', type: 'text' },
      messageId: 'auxiliary-late',
      sessionUpdate: 'agent_message_chunk',
    });
    expect(events).toEqual([]);
    await session.dispose();
  });

  it('authorizes Obsidian workspace tools for the late reply and revokes them when it closes', async () => {
    const allowed: string[][] = [];
    const bridge = {
      createConnection: jest.fn(async () => ({ endpoint: 'http://127.0.0.1', token: 'token-1' })),
      releaseConnection: jest.fn(),
      setAllowedOperations: jest.fn((_token: string, operations: readonly string[]) => {
        allowed.push([...operations]);
      }),
    };
    const { session } = createSession({ obsidianWorkspaceToolBridge: bridge });
    const run = session.execute(request());
    const completed = collect(run.events);
    await until(() => mockNativeConnections[0]?.prompts === 1);
    mockNativeConnections[0].finishPrompt();
    await completed;
    expect(allowed.at(-1)).toEqual([]);

    jest.useFakeTimers();
    try {
      mockNativeConnections[0].emit({
        content: { text: 'Late reply with tools', type: 'text' },
        messageId: 'late-tools',
        sessionUpdate: 'agent_message_chunk',
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(allowed.at(-1)?.length).toBeGreaterThan(0);

      mockNativeConnections[0].emit({ sessionUpdate: 'usage_update', size: 1_000, used: 200 });
      await jest.advanceTimersByTimeAsync(1_000);
      expect(allowed.at(-1)).toEqual([]);
    } finally {
      jest.useRealTimers();
      await session.dispose();
    }
  });
});
