/** @jest-environment jsdom */

import { createChatFocusCommand } from '@/features/chat/controllers/ChatFocusCommand';

describe('Chat input focus command', () => {
  let host: HTMLDivElement;
  let inputs: HTMLTextAreaElement[];
  let preferred: HTMLTextAreaElement | null;
  let activeDoc: Document | null;

  function control(doc = document): HTMLTextAreaElement {
    const element = doc.createElement('textarea');
    element.getClientRects = () => [new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList;
    (doc === document ? host : doc.body).appendChild(element);
    return element;
  }

  const command = () => createChatFocusCommand({
    getInputs: () => inputs,
    getActiveDocument: () => activeDoc,
    getPreferredInput: () => preferred,
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    inputs = [control()];
    preferred = inputs[0];
    activeDoc = document;
  });

  afterEach(() => host.remove());

  it('returns to the original editor without changing either draft or selection', () => {
    const editor = control();
    editor.value = 'Existing note selection';
    editor.setSelectionRange(2, 9, 'backward');
    inputs[0].value = 'Unsent chat draft';
    editor.focus();
    const toggle = command().checkCallback!;
    expect(toggle(true)).toBe(true);
    expect(document.activeElement).toBe(editor);
    toggle(false);
    expect(document.activeElement).toBe(inputs[0]);
    toggle(false);
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([2, 9, 'backward']);
    expect(editor.value).toBe('Existing note selection');
    expect(inputs[0].value).toBe('Unsent chat draft');
    toggle(false);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('prefers the already focused composer over the preferred view', () => {
    inputs.push(control());
    const editor = control();
    editor.focus();
    preferred = inputs[1];
    const toggle = command().checkCallback!;
    toggle(false);
    preferred = inputs[0];
    toggle(false);
    expect(document.activeElement).toBe(editor);
  });

  it('chooses the preferred visible composer and falls back when it is hidden', () => {
    inputs.push(control());
    preferred = inputs[1];
    const toggle = command().checkCallback!;
    toggle(false);
    expect(document.activeElement).toBe(inputs[1]);
    inputs[1].style.display = 'none';
    toggle(false);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it.each(['display', 'visibility', 'opacity'])('excludes a composer inside a %s-hidden ancestor', property => {
    const parent = document.createElement('div');
    host.appendChild(parent);
    parent.appendChild(inputs[0]);
    parent.style.setProperty(property, property === 'display' ? 'none' : property === 'visibility' ? 'hidden' : '0');
    const editor = control();
    editor.focus();
    const toggle = command().checkCallback!;
    expect(toggle(true)).toBe(false);
    expect(toggle(false)).toBe(false);
    expect(document.activeElement).toBe(editor);
  });

  it('does not expose detached, disabled, or zero-layout inputs', () => {
    const toggle = command().checkCallback!;
    inputs[0].disabled = true;
    expect(toggle(true)).toBe(false);
    inputs[0].disabled = false;
    inputs[0].getClientRects = () => [] as unknown as DOMRectList;
    expect(toggle(true)).toBe(false);
    inputs[0].remove();
    expect(toggle(false)).toBe(false);
  });

  it.each(['removed', 'hidden'])('keeps focus in chat when the previous control is %s', condition => {
    const editor = control();
    editor.focus();
    const toggle = command().checkCallback!;
    toggle(false);
    if (condition === 'removed') editor.remove();
    else editor.style.display = 'none';
    toggle(false);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('does not carry a previous target into a replacement composer', () => {
    const editor = control();
    editor.focus();
    const toggle = command().checkCallback!;
    toggle(false);
    inputs[0].remove();
    inputs = [control()];
    inputs[0].focus();
    toggle(false);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('limits focus toggling to composers in the active window document', () => {
    const frame = document.createElement('iframe');
    host.appendChild(frame);
    const doc = frame.contentDocument!;
    const otherInput = control(doc);
    const editor = control(doc);
    inputs.push(otherInput);
    activeDoc = doc;
    editor.focus();
    const toggle = command().checkCallback!;
    toggle(false);
    expect(doc.activeElement).toBe(otherInput);
    toggle(false);
    expect(doc.activeElement).toBe(editor);
    inputs = [inputs[0]];
    expect(toggle(false)).toBe(false);
    expect(doc.activeElement).toBe(editor);
  });

  it('is unavailable without an active document or existing composer', () => {
    const toggle = command().checkCallback!;
    activeDoc = null;
    expect(toggle(true)).toBe(false);
    activeDoc = document;
    inputs = [];
    expect(toggle(false)).toBe(false);
  });
});
