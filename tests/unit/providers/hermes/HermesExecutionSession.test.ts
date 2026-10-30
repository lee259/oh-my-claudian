import { HermesExecutionSession } from '@/providers/hermes/execution/HermesExecutionSession';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function setup(openSession = jest.fn().mockResolvedValue({ sessionId: 'session-1' })) {
  let callbacks: any;
  const kernel = { connect: jest.fn().mockResolvedValue(undefined), dispose: jest.fn().mockResolvedValue(undefined),
    openSession, prompt: jest.fn().mockResolvedValue({}), setModel: jest.fn().mockResolvedValue(undefined),
    setMode: jest.fn().mockResolvedValue(undefined), cancel: jest.fn() };
  const session = new HermesExecutionSession({ settings: {} } as never, {
    interactionPort: {} as never, lifecycle: 'persistent', nativePersistence: 'provider-default', vaultWorkingDirectory: '/vault',
  }, { createKernel: options => { callbacks = options; return kernel; } });
  const request = { configuration: { model: 'hermes:openrouter:acme/model', permissionMode: 'plan' },
    input: [{ type: 'text', text: 'Hello' }], signal: new AbortController().signal } as never;
  return { session, request, kernel, callbacks: () => callbacks };
}
describe('HermesExecutionSession', () => {
  it.each(['default', 'accept_edits', 'dont_ask'])('applies the selected Hermes approval mode %s', async mode => {
    const { session, request, kernel } = setup();
    (request as any).configuration.permissionMode = mode;
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn_completed' }));
    expect(kernel.setMode).toHaveBeenCalledWith({ modeId: mode, sessionId: 'session-1' });
    await session.dispose();
  });
  it('uses the provider-qualified model and safe Hermes mode for each turn', async () => {
    const { session, request, kernel } = setup();
    const run = session.execute(request);
    const events = []; for await (const event of run.events) events.push(event);
    expect(kernel.setModel).toHaveBeenCalledWith({ modelId: 'openrouter:acme/model', sessionId: 'session-1' });
    expect(kernel.setMode).toHaveBeenCalledWith({ modeId: 'default', sessionId: 'session-1' });
    expect(kernel.prompt).toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn_completed' }));
    await session.dispose();
  });
  it('does not send a prompt after cancellation during session creation', async () => {
    let resolve!: (value: { sessionId: string }) => void;
    const open = jest.fn().mockReturnValue(new Promise(next => { resolve = next; }));
    const { session, request, kernel } = setup(open);
    const run = session.execute(request); await tick(); run.cancel();
    resolve({ sessionId: 'session-1' }); await tick();
    expect(kernel.prompt).not.toHaveBeenCalled();
    expect(kernel.setModel).not.toHaveBeenCalled();
    await session.dispose();
  });
  it('closes an unreported tool result before Hermes streams the next answer', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: {
        sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'read: probe.txt', kind: 'read', status: 'in_progress',
      } });
      callbacks().onNotification({ sessionId: 'session-1', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Read finished.' },
      } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_started', toolCallId: 'read-1' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_completed', toolCallId: 'read-1', outcomeUnknown: true, content: expect.stringContaining('did not report') }));
    expect(events.findIndex(event => event.type === 'tool_completed')).toBeLessThan(events.findIndex(event => event.type === 'text_delta'));
    await session.dispose();
  });
  it('closes missing results when Hermes begins the next reasoning step', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'search-1', title: 'search', kind: 'search', status: 'in_progress' } });
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Considering results' } } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events.findIndex(event => event.type === 'tool_completed')).toBeLessThan(events.findIndex(event => event.type === 'thinking_delta'));
    await session.dispose();
  });
  it('accepts input when Hermes emits tool activity before the prompt returns', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'write-1', title: 'write', kind: 'edit', status: 'in_progress' } });
      throw new Error('connection closed');
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events.findIndex(event => event.type === 'turn_started' && event.accepted)).toBeLessThan(events.findIndex(event => event.type === 'tool_started'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn_started', accepted: true }));
    await session.dispose();
  });
  it('correlates the native user message ID even after early input acceptance', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } } });
      return { stopReason: 'end_turn', userMessageId: 'native-user' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'turn_started', accepted: true, nativeUserMessageId: 'native-user' }));
    await session.dispose();
  });
  it('does not treat replayed history as acceptance of the next turn', async () => {
    const { session, request, kernel, callbacks } = setup();
    const first = []; for await (const event of session.execute(request).events) first.push(event);
    kernel.openSession.mockImplementationOnce(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Previous answer' } } });
      throw new Error('session load failed');
    });
    const second = []; for await (const event of session.execute(request).events) second.push(event);
    expect(second.some(event => event.type === 'turn_started')).toBe(false);
    expect(second.at(-1)).toMatchObject({ type: 'execution_error' });
    await session.dispose();
  });
  it('keeps the provider result when Hermes reports tool completion', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: {
        sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'read: probe.txt', kind: 'read', status: 'in_progress',
      } });
      callbacks().onNotification({ sessionId: 'session-1', update: {
        sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed', rawOutput: 'File content',
      } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    const completed = events.filter(event => event.type === 'tool_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ toolCallId: 'read-1', isError: false });
    await session.dispose();
  });
  it('finishes only the missing results from a parallel tool batch', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      for (const [id, kind] of [['one', 'read'], ['two', 'edit'], ['three', 'execute']]) {
        callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: id, title: id, kind, status: 'in_progress' } });
      }
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'two', status: 'failed', rawOutput: 'denied' } });
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    const completed = events.filter(event => event.type === 'tool_completed');
    expect(completed.map(event => event.toolCallId)).toEqual(['two', 'one', 'three']);
    expect(completed[0]).toMatchObject({ toolCallId: 'two', isError: true });
    await session.dispose();
  });
  it('marks unfinished tools as interrupted when the user cancels', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(() => new Promise(() => undefined));
    const run = session.execute(request); await tick();
    callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'shell-1', title: 'terminal', kind: 'execute', status: 'in_progress' } });
    run.cancel();
    const events = []; for await (const event of run.events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_completed', toolCallId: 'shell-1', isError: true, content: expect.stringContaining('interrupted') }));
    expect(events.at(-1)).toMatchObject({ type: 'cancelled' });
    expect(session.getStatus()).toBe('idle');
    await session.dispose();
  });
  it('can start a new turn after a cancelled turn', async () => {
    const { session, request, kernel } = setup();
    kernel.prompt.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce({ stopReason: 'end_turn' });
    const first = session.execute(request); await tick(); first.cancel();
    const firstEvents = []; for await (const event of first.events) firstEvents.push(event);
    const secondEvents = []; for await (const event of session.execute(request).events) secondEvents.push(event);
    expect(firstEvents.at(-1)).toMatchObject({ type: 'cancelled' });
    expect(secondEvents.at(-1)).toMatchObject({ type: 'turn_completed' });
    expect(session.getStatus()).toBe('idle');
    await session.dispose();
  });
  it('marks unfinished tools as interrupted when the process fails', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'edit-1', title: 'edit', kind: 'edit', status: 'in_progress' } });
      throw new Error('process exited');
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_completed', toolCallId: 'edit-1', isError: true, content: expect.stringContaining('interrupted') }));
    expect(events.at(-1)).toMatchObject({ type: 'execution_error' });
    await session.dispose();
  });
  it('closes unfinished tools if Hermes ends without another message', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'search-1', title: 'search', kind: 'search', status: 'in_progress' } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_completed', toolCallId: 'search-1' }));
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed' });
    await session.dispose();
  });
  it('ignores tool notifications belonging to a different session', async () => {
    const { session, request, kernel, callbacks } = setup();
    kernel.prompt.mockImplementation(async () => {
      callbacks().onNotification({ sessionId: 'another-session', update: { sessionUpdate: 'tool_call', toolCallId: 'other', title: 'read', kind: 'read', status: 'in_progress' } });
      return { stopReason: 'end_turn' };
    });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events.some(event => event.type === 'tool_started' || event.type === 'tool_completed')).toBe(false);
    await session.dispose();
  });
  it('reports a cancelled ACP turn as cancelled', async () => {
    const { session, request, kernel } = setup();
    kernel.prompt.mockResolvedValue({ stopReason: 'cancelled' });
    const events = []; for await (const event of session.execute(request).events) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'cancelled' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'turn_completed' }));
    await session.dispose();
  });
});
