/** @jest-environment jsdom */

import { fireEvent, getByRole, queryByRole } from '@testing-library/dom';
import { h, render } from 'preact';

import { ScenePromptView } from '@/features/chat/ui/ScenePromptView';

describe('ScenePromptView', () => {
  it('offers selection actions first and fills a draft without sending', () => {
    const host = document.createElement('div');
    const onChoose = jest.fn();
    document.body.append(host);
    render(h(ScenePromptView, { hasSelection: true, hasCurrentNote: true, hasMessages: false, draft: '', onChoose }), host);

    fireEvent.click(getByRole(host, 'button', { name: 'Explain selection' }));
    expect(onChoose).toHaveBeenCalledWith('Explain the selected text in clear, plain language.');
    expect(queryByRole(host, 'button', { name: 'Summarize note' })).toBeNull();
    render(null, host);
    host.remove();
  });

  it('shows note actions only in a blank conversation with an empty draft', () => {
    const host = document.createElement('div');
    const onChoose = jest.fn();
    const props = { hasSelection: false, hasCurrentNote: true, hasMessages: false, draft: '', onChoose };
    render(h(ScenePromptView, props), host);
    expect(getByRole(host, 'button', { name: 'Summarize note' })).toBeTruthy();
    render(h(ScenePromptView, { ...props, draft: 'Draft' }), host);
    expect(queryByRole(host, 'button', { name: 'Summarize note' })).toBeNull();
    render(h(ScenePromptView, { ...props, hasMessages: true }), host);
    expect(queryByRole(host, 'button', { name: 'Summarize note' })).toBeNull();
    render(h(ScenePromptView, { ...props, hasCurrentNote: false }), host);
    expect(queryByRole(host, 'button', { name: 'Summarize note' })).toBeNull();
    render(null, host);
  });
});
