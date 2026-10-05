import {
  createPiEventNormalizationState,
  normalizePiRpcEvent,
} from '@/providers/pi/normalizations/piEventNormalization';

describe('Pi event normalization', () => {
  it('normalizes text and thinking deltas', () => {
    const state = createPiEventNormalizationState();
    expect(normalizePiRpcEvent({
      assistantMessageEvent: { text_delta: 'hello' },
      type: 'message_update',
    }, state)).toEqual([{ type: 'text', content: 'hello' }]);
    expect(normalizePiRpcEvent({
      assistantMessageEvent: { thinking_delta: 'hmm' },
      type: 'message_update',
    }, state)).toEqual([{ type: 'thinking', content: 'hmm' }]);
  });

  it('dedupes tool use and maps output/result chunks', () => {
    const state = createPiEventNormalizationState();
    expect(normalizePiRpcEvent({
      id: 'tool-1',
      input: { path: 'a.md' },
      name: 'read',
      type: 'toolcall_end',
    }, state)).toEqual([{
      id: 'tool-1',
      input: { file_path: 'a.md', path: 'a.md' },
      name: 'Read',
      type: 'tool_use',
    }]);
    expect(normalizePiRpcEvent({
      id: 'tool-1',
      input: { path: 'a.md' },
      name: 'read',
      type: 'tool_execution_start',
    }, state)).toEqual([]);
    expect(normalizePiRpcEvent({
      id: 'tool-1',
      partialResult: { content: [{ text: 'partial', type: 'text' }] },
      type: 'tool_execution_update',
    }, state)).toEqual([{ id: 'tool-1', content: 'partial', type: 'tool_output' }]);
    expect(normalizePiRpcEvent({
      id: 'tool-1',
      result: { content: [{ text: 'done', type: 'text' }] },
      type: 'tool_execution_end',
    }, state)).toEqual([{
      id: 'tool-1',
      content: 'done',
      isError: false,
      toolUseResult: { content: [{ text: 'done', type: 'text' }] },
      type: 'tool_result',
    }]);
  });

  it('retains generated tool-result images in normalized stream details', () => {
    const state = createPiEventNormalizationState();
    expect(normalizePiRpcEvent({
      result: {
        content: [
          { data: 'aW1hZ2U=', mimeType: 'image/png', type: 'image' },
        ],
      },
      toolCallId: 'image-1',
      toolName: 'draw',
      type: 'tool_execution_end',
    }, state)).toEqual([{
      content: '',
      id: 'image-1',
      isError: false,
      toolUseResult: {
        content: [{ data: 'aW1hZ2U=', mimeType: 'image/png', type: 'image' }],
        resultImages: [{ data: 'aW1hZ2U=', kind: 'data', mediaType: 'image/png' }],
      },
      type: 'tool_result',
    }]);
  });

  it('emits only the new suffix when Pi reports cumulative tool-output snapshots', () => {
    const state = createPiEventNormalizationState();
    const update = (partialResult: string) => normalizePiRpcEvent({
      partialResult: { content: [{ text: partialResult, type: 'text' }] },
      toolCallId: 'bash-1',
      toolName: 'bash',
      type: 'tool_execution_update',
    }, state);

    expect(update('one')).toEqual([{ content: 'one', id: 'bash-1', type: 'tool_output' }]);
    expect(update('one\ntwo')).toEqual([{ content: '\ntwo', id: 'bash-1', type: 'tool_output' }]);
    expect(update('one\ntwo')).toEqual([]);
  });

  it('stops appending after a rolling snapshot changes and accepts the authoritative result', () => {
    const state = createPiEventNormalizationState();
    const update = (partialResult: string) => normalizePiRpcEvent({
      partialResult: { content: [{ text: partialResult, type: 'text' }] },
      toolCallId: 'bash-rolling',
      toolName: 'bash',
      type: 'tool_execution_update',
    }, state);

    expect(update('line 1\nline 2\n')).toEqual([{
      content: 'line 1\nline 2\n', id: 'bash-rolling', type: 'tool_output',
    }]);
    expect(update('line 2\nline 3\n')).toEqual([]);
    expect(update('line 2\nline 3\nline 4\n')).toEqual([]);
    expect(normalizePiRpcEvent({
      result: { content: [{ text: 'line 3\nline 4\nline 5\n', type: 'text' }] },
      toolCallId: 'bash-rolling',
      type: 'tool_execution_end',
    }, state)).toEqual([expect.objectContaining({
      content: 'line 3\nline 4\nline 5\n', id: 'bash-rolling', type: 'tool_result',
    })]);
  });

  it('normalizes Pi RPC toolName and args to shared renderer tool shapes', () => {
    const state = createPiEventNormalizationState();

    expect(normalizePiRpcEvent({
      args: { command: 'pwd' },
      toolCallId: 'bash-1',
      toolName: 'bash',
      type: 'tool_execution_start',
    }, state)).toEqual([{
      id: 'bash-1',
      input: { command: 'pwd' },
      name: 'Bash',
      type: 'tool_use',
    }]);

    expect(normalizePiRpcEvent({
      args: { pattern: 'src/**/*.ts' },
      toolCallId: 'find-1',
      toolName: 'find',
      type: 'tool_execution_start',
    }, state)).toEqual([{
      id: 'find-1',
      input: { pattern: 'src/**/*.ts' },
      name: 'Glob',
      type: 'tool_use',
    }]);
  });

  it('maps Pi web extension tools to shared renderer names', () => {
    const state = createPiEventNormalizationState();

    expect(normalizePiRpcEvent({
      args: { count: 5, query: 'provider protocol' },
      toolCallId: 'web-search-1',
      toolName: 'web_search',
      type: 'tool_execution_start',
    }, state)).toEqual([{
      id: 'web-search-1',
      input: { count: 5, query: 'provider protocol' },
      name: 'WebSearch',
      type: 'tool_use',
    }]);

    expect(normalizePiRpcEvent({
      args: { url: 'https://example.com/reference' },
      toolCallId: 'web-fetch-1',
      toolName: 'web_fetch',
      type: 'tool_execution_start',
    }, state)).toEqual([{
      id: 'web-fetch-1',
      input: { url: 'https://example.com/reference' },
      name: 'WebFetch',
      type: 'tool_use',
    }]);
  });

  it('preserves Pi write/edit result payloads for diff extraction', () => {
    const state = createPiEventNormalizationState();

    expect(normalizePiRpcEvent({
      args: { content: 'new text', path: 'notes/a.md' },
      toolCallId: 'write-1',
      toolName: 'write',
      type: 'tool_execution_start',
    }, state)).toEqual([{
      id: 'write-1',
      input: { content: 'new text', file_path: 'notes/a.md', path: 'notes/a.md' },
      name: 'Write',
      type: 'tool_use',
    }]);

    expect(normalizePiRpcEvent({
      isError: false,
      result: {
        content: [{ text: 'Edited notes/a.md', type: 'text' }],
        details: { diff: '--- a/notes/a.md\n+++ b/notes/a.md\n@@ -1 +1 @@\n-old\n+new' },
      },
      toolCallId: 'write-1',
      toolName: 'write',
      type: 'tool_execution_end',
    }, state)).toEqual([{
      id: 'write-1',
      content: 'Edited notes/a.md',
      isError: false,
      toolUseResult: {
        content: [{ text: 'Edited notes/a.md', type: 'text' }],
        details: { diff: '--- a/notes/a.md\n+++ b/notes/a.md\n@@ -1 +1 @@\n-old\n+new' },
      },
      type: 'tool_result',
    }]);
  });

  it('maps compaction and extension errors', () => {
    const state = createPiEventNormalizationState();
    expect(normalizePiRpcEvent({ type: 'compaction_end' }, state)).toEqual([{ type: 'context_compacted' }]);
    expect(normalizePiRpcEvent({ error: 'extension failed', type: 'extension_error' }, state)).toEqual([{
      content: 'extension failed',
      level: 'warning',
      type: 'notice',
    }]);
  });

  it('reports automatic retries as in-progress notices rather than blocked warnings', () => {
    const state = createPiEventNormalizationState();

    expect(normalizePiRpcEvent({ type: 'auto_retry_start' }, state)).toEqual([{
      content: 'Pi is retrying the turn.',
      level: 'info',
      type: 'notice',
    }]);
  });

  it('surfaces terminal Pi stop-reason errors', () => {
    const state = createPiEventNormalizationState();

    expect(normalizePiRpcEvent({
      errorMessage: 'Invalid image',
      stopReason: 'error',
      type: 'message_end',
    }, state)).toEqual([{ type: 'error', content: 'Invalid image' }]);

    expect(normalizePiRpcEvent({
      assistant_message_event: {
        error_message: 'Authentication failed',
        stop_reason: 'error',
      },
      type: 'turn_end',
    }, state)).toEqual([{ type: 'error', content: 'Authentication failed' }]);
  });
});
