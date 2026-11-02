import type { ProviderRequestedEventScope } from '@/core/execution';
import { adaptCodexStreamChunk } from '@/providers/codex/execution/CodexExecutionEventAdapter';

describe('CodexExecutionEventAdapter', () => {
  it('preserves yielded execution state', () => {
    const scope: ProviderRequestedEventScope = {
      kind: 'requested', sessionInstanceId: 'session-1', executionId: 'execution-1', turnId: 'turn-1', sequence: 1,
    };
    expect(adaptCodexStreamChunk({ type: 'tool_output', id: 'tool-1', content: '', continuesInBackground: true }, scope))
      .toEqual({ type: 'tool_output', scope, toolCallId: 'tool-1', toolScope: { kind: 'main' }, content: '', continuesInBackground: true });
  });
  it('adapts citation chunks without provider-owned tracking IDs', () => {
    const scope: ProviderRequestedEventScope = {
      kind: 'requested',
      sessionInstanceId: 'session-1',
      executionId: 'execution-1',
      turnId: 'turn-1',
      sequence: 1,
    };
    const citations = {
      kind: 'memory' as const,
      entries: [{
        path: 'MEMORY.md',
        lineStart: 10,
        lineEnd: 12,
        note: 'Used project conventions',
      }],
    };

    expect(adaptCodexStreamChunk({ type: 'citations', citations }, scope)).toEqual({
      type: 'citations',
      scope,
      citations,
    });
  });
});
