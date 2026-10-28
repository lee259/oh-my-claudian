/** @jest-environment jsdom */
import { Text } from '@codemirror/state';
import { waitFor } from '@testing-library/dom';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { InlineEditSession } from '@/features/inline-edit/ui/InlineEditModal';

jest.mock('@/shared/components/SelectionHighlight', () => ({ hideSelectionHighlight: jest.fn(), showSelectionHighlight: jest.fn() }));
jest.mock('@/shared/mention/MentionDropdownController', () => ({ MentionDropdownController: jest.fn().mockImplementation(() => ({ handleKeydown: () => false, handleInputChange: jest.fn(), destroy: jest.fn() })) }));
jest.mock('@/shared/components/SlashCommandDropdown', () => ({ SlashCommandDropdown: jest.fn().mockImplementation(() => ({ handleKeydown: () => false, destroy: jest.fn() })) }));

it('previews and accepts a one-line edit in a long selection', async () => {
  const lines = Array.from({ length: 10000 }, (_, i) => `Line ${i}`);
  const before = lines.join('\n');
  lines[5000] = 'Changed line';
  const after = lines.join('\n');
  const doc = Text.of(before.split('\n'));
  const dom = document.createElement('div');
  document.body.append(dom);
  const dispatch = jest.fn();
  const editorView: any = { state: { doc }, dispatch, dom, focus: jest.fn() };
  const editor: any = { getSelection: () => before, getCursor: (which: string) => which === 'from' ? { line: 0, ch: 0 } : { line: 9999, ch: lines[9999].length }, replaceRange: jest.fn() };
  const service = { editText: jest.fn().mockResolvedValue({ success: true, editedText: after }), setModelOverride: jest.fn(), cancel: jest.fn(), resetConversation: jest.fn() };
  jest.spyOn(ProviderRegistry, 'createInlineEditService').mockReturnValue(service as any);
  const app: any = { vault: { getFiles: () => [], getAllLoadedFiles: () => [], getMarkdownFiles: () => [] }, metadataCache: {} };
  const plugin: any = { providerHost: {}, settings: { hiddenProviderCommands: {} } };
  const settled = jest.fn();
  const session = new InlineEditSession(app, plugin, editorView, editor, { mode: 'selection', selectedText: before }, 'note.md', () => [], settled, { providerId: 'claude' });
  const input = session.createInputDOM().querySelector('input')!;
  input.value = 'Improve';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => expect(dispatch).toHaveBeenCalled());
  const effects = dispatch.mock.calls.map(([transaction]) => transaction.effects?.value).find(value => value?.diffOps);
  expect(effects.diffOps).toEqual([
    { type: 'equal', text: `${before.split('\n').slice(0, 5000).join('\n')}\n` },
    { type: 'delete', text: 'Line 5000\n' },
    { type: 'insert', text: 'Changed line\n' },
    { type: 'equal', text: before.split('\n').slice(5001).join('\n') },
  ]);
  session.accept();
  expect(editor.replaceRange).toHaveBeenCalledWith(after, expect.anything(), expect.anything());
  expect(settled).toHaveBeenCalledWith({ decision: 'accept', editedText: after });
  jest.restoreAllMocks();
});
