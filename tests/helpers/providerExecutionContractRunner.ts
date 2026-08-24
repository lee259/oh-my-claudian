import type {
  ProviderExecutionEvent,
  ProviderExecutionRequest,
  ProviderExecutionSession,
} from '@/core/execution';

export interface ProviderExecutionContractFactory {
  createRequest(signal?: AbortSignal): ProviderExecutionRequest;
  createSession(): ProviderExecutionSession;
}

export function createProviderExecutionContractCases(
  factory: ProviderExecutionContractFactory,
): Array<[string, () => Promise<void>]> {
  return [
    ['represents streaming and one-shot output with one correlated event stream', async () => {
      const session = factory.createSession();
      const run = session.execute(factory.createRequest());
      const events = await collect(run.events);

      expect(events.map((event) => event.type)).toContain('turn_completed');
      expect(
        events.filter((event) => (
          event.type === 'turn_completed'
          || event.type === 'cancelled'
          || event.type === 'execution_error'
        )),
      ).toHaveLength(1);
      expect(events.every((event) => (
        event.scope.kind === 'requested'
        && event.scope.sessionInstanceId === session.sessionInstanceId
        && event.scope.executionId === run.executionId
        && event.scope.turnId === run.turnId
      ))).toBe(true);
      expect(session.getStatus()).toBe('idle');
      await session.dispose();
    }],
    ['rejects overlapping requested executions', async () => {
      const session = factory.createSession();
      const first = session.execute(factory.createRequest());

      expect(() => session.execute(factory.createRequest())).toThrow();

      await collect(first.events);
      expect(() => session.execute(factory.createRequest())).not.toThrow();
      await session.dispose();
    }],
    ['terminates cancellation through the run, request, and session controls', async () => {
      const runSession = factory.createSession();
      const run = runSession.execute(factory.createRequest());
      run.cancel();
      expectTerminal(await collect(run.events));
      await runSession.dispose();

      const requestSession = factory.createSession();
      const requestAbort = new AbortController();
      const requestRun = requestSession.execute(factory.createRequest(requestAbort.signal));
      requestAbort.abort();
      expectTerminal(await collect(requestRun.events));
      await requestSession.dispose();

      const session = factory.createSession();
      const sessionRun = session.execute(factory.createRequest());
      session.cancel();
      expectTerminal(await collect(sessionRun.events));
      await session.dispose();
    }],
  ];
}

async function collect(
  events: AsyncIterable<ProviderExecutionEvent>,
): Promise<ProviderExecutionEvent[]> {
  const collected: ProviderExecutionEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function expectTerminal(events: readonly ProviderExecutionEvent[]): void {
  const terminal = events.at(-1)?.type;
  expect(['cancelled', 'execution_error', 'turn_completed']).toContain(terminal);
  expect(events.filter((event) => (
    event.type === 'turn_completed'
    || event.type === 'cancelled'
    || event.type === 'execution_error'
  ))).toHaveLength(1);
}
