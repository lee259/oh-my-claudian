/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import { getByRole } from '@testing-library/dom';
import { Component } from 'obsidian';

import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import type { FeatureHost } from '@/features/FeatureHost';
import { CODEX_PROVIDER_CAPABILITIES } from '@/providers/codex/capabilities';
import { parseCodexSessionContent } from '@/providers/codex/history/CodexHistoryStore';
import { appendContextFiles, appendCurrentNote } from '@/utils/context';
import { appendEditorContext } from '@/utils/editor';
import * as obsidianCompat from '@/utils/obsidianCompat';

it('renders recovered attachment and selection snapshots through the shared history UI', () => {
  const notePath = 'Notes/Article.md';
  const selectedText = 'Historical <b>selection</b>\nwith a second line';
  const prompt = appendContextFiles(appendEditorContext(appendCurrentNote('Explain this', notePath), {
    notePath, mode: 'selection', selectedText, startLine: 70, lineCount: 2,
  }), [notePath, 'Notes/Reference.md']);
  const [message] = parseCodexSessionContent(JSON.stringify({ type: 'response_item', payload: {
    type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }],
  } }));
  const app = {} as FeatureHost['app'];
  const component = new Component();
  const container = document.body.appendChild(document.createElement('div'));
  const openFile = jest.spyOn(obsidianCompat, 'openVaultFile').mockResolvedValue(true);
  const renderer = new MessageRenderer({ app, settings: {} } as FeatureHost, component, container,
    undefined, undefined, () => CODEX_PROVIDER_CAPABILITIES);
  try {
    renderer.renderStoredMessage(message);
    const context = container.querySelector<HTMLElement>('.claudian-message-input-context')!;
    expect(context).not.toBeNull();
    expect(context.querySelectorAll('.claudian-message-input-context-file')).toHaveLength(2);
    const selection = context.querySelector<HTMLDetailsElement>('details')!;
    selection.open = true;
    expect(selection.querySelector('pre')?.textContent).toBe(selectedText);
    expect(selection.querySelector('b')).toBeNull();
    getByRole(context, 'button', { name: 'Notes/Article.md:70' }).click();
    expect(openFile).toHaveBeenCalledWith(app, { path: notePath, lineStart: 70 });
    getByRole(context, 'button', { name: 'Notes/Reference.md' }).click();
    expect(openFile).toHaveBeenLastCalledWith(app, { path: 'Notes/Reference.md' });
    expect(message.executionInput?.context?.editorSelection?.selectedText).toBe(selectedText);
  } finally {
    renderer.dispose(); component.unload(); container.remove(); openFile.mockRestore();
  }
});
