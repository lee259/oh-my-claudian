import {
  createOmpToolStreamAdapter,
  normalizeOmpToolInput,
  normalizeOmpToolName,
  normalizeOmpToolUseResult,
  resolveOmpRawToolName,
} from '@/providers/omp/normalization/ompToolNormalization';
import { extractDiffData } from '@/utils/diff';

describe('OMP tool normalization', () => {
  it('maps ACP read presentation titles to the shared Read tool', () => {
    expect(resolveOmpRawToolName(undefined, {
      kind: 'read',
      title: 'Reading 分享文档 README for context',
    })).toEqual({ provenance: 'mapped-kind', rawName: 'Read' });
    expect(normalizeOmpToolName('Reading 分享文档 README for context')).toBe('Read');
  });

  it('normalizes OMP path input for the shared file renderer', () => {
    expect(normalizeOmpToolInput('edit', {
      input: '[notes/report.md#0027]\nPUT 11:\n+written_by: assisted',
    })).toMatchObject({ file_path: 'notes/report.md' });
  });

  it('projects a snapshot-pruned ACP edit result into a numbered diff', () => {
    const adapter = createOmpToolStreamAdapter();
    const rawInput = { input: '[notes/report.md#0027]\nPUT 11:\n+written_by: assisted' };
    const rawOutput = { details: {
      path: '/vault/notes/report.md',
      diff: ' 9|updated: today\n 10|status: draft\n-11|written_by: ai\n+11|written_by: assisted\n+12|reviewed_by:\n 12|---\n\n 40|End',
      snapshotsPruned: true,
    } };
    const start = adapter.normalizeToolCall({ kind: 'edit', title: 'Editing report for context', rawInput, toolCallId: 'edit-1' }, [
      { type: 'tool_use', id: 'edit-1', name: 'edit', input: rawInput },
    ])[0];
    expect(start).toMatchObject({ name: 'Edit', input: { file_path: 'notes/report.md' } });
    const chunks = adapter.normalizeToolCallUpdate({ rawOutput, status: 'completed', toolCallId: 'edit-1' }, [
      { type: 'tool_result', id: 'edit-1', content: 'Updated' },
    ]);
    const result = chunks.find(chunk => chunk.type === 'tool_result');
    if (result?.type !== 'tool_result') throw new Error('Expected a tool result');
    const diff = extractDiffData(result.toolUseResult, {
      id: 'edit-1', name: 'Edit', input: rawInput, status: 'completed',
    });
    expect(diff).toMatchObject({ filePath: '/vault/notes/report.md', stats: { added: 2, removed: 1 } });
    expect(diff?.diffLines).toEqual([
      { type: 'equal', text: 'updated: today', oldLineNum: 9, newLineNum: 9 },
      { type: 'equal', text: 'status: draft', oldLineNum: 10, newLineNum: 10 },
      { type: 'delete', text: 'written_by: ai', oldLineNum: 11 },
      { type: 'insert', text: 'written_by: assisted', newLineNum: 11 },
      { type: 'insert', text: 'reviewed_by:', newLineNum: 12 },
      { type: 'equal', text: '---', oldLineNum: 12, newLineNum: 13 },
      { type: 'equal', text: 'End', oldLineNum: 40, newLineNum: 41 },
    ]);
    expect(result.toolUseResult).toMatchObject({ providerPayload: { rawInput, rawOutput } });
  });

  it('handles a single per-file result without attributing multi-file diffs to the first path', () => {
    const file = { path: '/vault/report.md', diff: '-2|old\n+2|new', snapshotsPruned: true };
    expect(normalizeOmpToolUseResult('Edit', {}, { details: { perFileResults: [file] } })).toMatchObject({
      filePath: '/vault/report.md', structuredPatch: [{ lines: ['-old', '+new'] }],
    });
    expect(normalizeOmpToolUseResult('Edit', { file_path: 'report.md' }, {
      details: { diff: file.diff, perFileResults: [file, { ...file, path: '/vault/other.md' }] },
    }).structuredPatch).toBeUndefined();
  });

  it('leaves non-edit results and malformed diff rows as opaque provider data', () => {
    expect(normalizeOmpToolUseResult('Read', {}, { details: { diff: '-1|old' } }).structuredPatch).toBeUndefined();
    expect(normalizeOmpToolUseResult('Edit', {}, { details: { diff: 'Error: could not edit' } }).structuredPatch).toBeUndefined();
    expect(normalizeOmpToolUseResult('Edit', {}, { details: { isError: true, diff: '-1|old' } }).structuredPatch).toBeUndefined();
  });

  it('does not reinterpret custom tools that happen to start with a tool verb', () => {
    expect(normalizeOmpToolName('Write release notes')).toBe('Write release notes');
    expect(resolveOmpRawToolName(undefined, {
      title: 'Write release notes',
    })).toEqual({ provenance: 'title', rawName: 'Write release notes' });
  });
});
