/** @jest-environment jsdom */
import type { App, WorkspaceLeaf } from 'obsidian';

import { ZenModeController, type ZenModeSource } from '@/features/chat/zen/ZenModeController';

function fixture() {
  const workspaceEl = document.body.appendChild(document.createElement('div'));
  const center = workspaceEl.appendChild(document.createElement('div'));
  center.className = 'workspace-split mod-root';
  const sidebar = { collapsed: false };
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const leaf = { getRoot: () => sidebar } as unknown as WorkspaceLeaf;
  const app = {
    workspace: {
      containerEl: workspaceEl,
      rightSplit: sidebar,
      leftSplit: {},
      getLeavesOfType: () => [leaf],
      onLayoutReady: (fn: () => void) => fn(),
      on: (event: string, fn: (...args: unknown[]) => void) => { listeners.set(event, fn); return { event }; },
      offref: jest.fn(),
    },
    keymap: { pushScope: jest.fn(), popScope: jest.fn() },
  } as unknown as App;
  const parent = document.body.appendChild(document.createElement('div'));
  const surface = parent.appendChild(document.createElement('div'));
  const input = surface.appendChild(document.createElement('textarea'));
  input.value = 'Keep my draft';
  const source: ZenModeSource = { leaf, surface, focusInput: () => input.focus(), getPreview: () => ({ text: 'Working', hasMessages: true, working: true, requiresAction: false }) };
  let enabled = true;
  const controller = new ZenModeController({ app, isEnabled: () => enabled, getPosition: () => null, savePosition: jest.fn() });
  controller.start();
  const release = controller.register(source);
  return { controller, release, source, parent, input, center, sidebar, app, listeners, disable: () => { enabled = false; controller.refresh(); } };
}

afterEach(() => { document.body.replaceChildren(); });

it('moves the same live surface on sidebar collapse and restores its draft when reopened', () => {
  const f = fixture();
  expect(f.source.surface.parentElement).toBe(f.parent);
  f.sidebar.collapsed = true;
  f.controller.refresh();
  expect(f.center.contains(f.input)).toBe(true);
  expect(f.input.value).toBe('Keep my draft');
  f.sidebar.collapsed = false;
  f.controller.refresh();
  expect(f.source.surface.parentElement).toBe(f.parent);
  expect(f.parent.querySelector('textarea')).toBe(f.input);
  expect(f.center.querySelector('.claudian-zen')).toBeNull();
  f.controller.dispose();
});

it('shows bounded live activity and expands for an interaction without replacing the input', () => {
  const f = fixture();
  let requiresAction = false;
  f.source.getPreview = () => ({ text: requiresAction ? 'Approval needed' : 'Reading note', hasMessages: true, working: true, requiresAction });
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const toggle = f.center.querySelector<HTMLButtonElement>('.claudian-zen-disclosure')!;
  expect(toggle.textContent).toContain('Reading note');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  toggle.click();
  requiresAction = true;
  f.controller.refresh();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(f.center.querySelector('textarea')).toBe(f.input);
  f.disable();
  expect(f.source.surface.parentElement).toBe(f.parent);
  f.controller.dispose();
});

it('restores on disable and unregister, disconnects observers and releases its focus scope', () => {
  const f = fixture();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  f.input.focus();
  expect(f.app.keymap.pushScope).toHaveBeenCalledTimes(1);
  f.release();
  expect(f.app.keymap.popScope).toHaveBeenCalledTimes(1);
  expect(f.parent.contains(f.input)).toBe(true);
  expect(f.center.querySelector('.claudian-zen')).toBeNull();
  f.controller.dispose();
  f.controller.dispose();
  expect(f.app.workspace.offref).toHaveBeenCalledTimes(3);
});

it('never floats a main-area or popout chat', () => {
  const f = fixture();
  f.source.leaf.getRoot = () => ({ collapsed: true }) as never;
  f.controller.refresh();
  expect(f.source.surface.parentElement).toBe(f.parent);
  expect(f.center.querySelector('.claudian-zen')).toBeNull();
  f.controller.dispose();
});

it('loads a deferred collapsed-sidebar chat once without revealing or creating a leaf', async () => {
  const f = fixture();
  f.release();
  const loadIfDeferred = jest.fn().mockRejectedValue(new Error('Unavailable'));
  Object.assign(f.source.leaf, { isDeferred: true, loadIfDeferred });
  f.sidebar.collapsed = true;
  f.controller.refresh();
  f.controller.refresh();
  await Promise.resolve();
  expect(loadIfDeferred).toHaveBeenCalledTimes(1);
  f.controller.dispose();
});

it('uses the most recently focused eligible sidebar and retains only one floating surface', () => {
  const f = fixture();
  const left = (f.app.workspace.leftSplit as unknown as { collapsed: boolean });
  left.collapsed = true;
  const otherParent = document.body.appendChild(document.createElement('div'));
  const surface = otherParent.appendChild(document.createElement('div'));
  const otherLeaf = { getRoot: () => left } as unknown as WorkspaceLeaf;
  const other = { ...f.source, surface, leaf: otherLeaf };
  const release = f.controller.register(other);
  f.sidebar.collapsed = true;
  f.listeners.get('active-leaf-change')?.(f.source.leaf);
  expect(f.center.contains(f.input)).toBe(true);
  f.listeners.get('active-leaf-change')?.(otherLeaf);
  expect(f.center.contains(surface)).toBe(true);
  expect(f.parent.contains(f.input)).toBe(true);
  expect(f.center.querySelectorAll('.claudian-zen')).toHaveLength(1);
  release();
  f.controller.dispose();
});

it('keeps the reading position chosen in the expanded transcript when returning to the sidebar', () => {
  const f = fixture();
  const messages = f.source.surface.appendChild(document.createElement('div'));
  messages.className = 'claudian-messages';
  messages.scrollTop = 40;
  f.sidebar.collapsed = true;
  f.controller.refresh();
  f.center.querySelector<HTMLButtonElement>('.claudian-zen-disclosure')!.click();
  messages.scrollTop = 120;
  f.sidebar.collapsed = false;
  f.controller.refresh();
  expect(messages.scrollTop).toBe(120);
  f.controller.dispose();
});

it('refreshes streamed preview text from the existing presentation without another execution', async () => {
  const f = fixture();
  let text = 'Reading';
  f.source.getPreview = () => ({ text, hasMessages: true, working: true, requiresAction: false });
  f.sidebar.collapsed = true;
  f.controller.refresh();
  text = 'Reading the next note';
  f.source.surface.appendChild(document.createTextNode('streamed output'));
  await Promise.resolve();
  expect(f.center.querySelector('.claudian-zen-preview')?.textContent).toBe('Reading the next note');
  f.controller.dispose();
});

it('reattaches to a replaced central workspace without duplicating the editor', () => {
  const f = fixture();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const nextHost = document.createElement('div');
  nextHost.className = 'workspace-split mod-root';
  f.center.replaceWith(nextHost);
  f.controller.refresh();
  expect(nextHost.contains(f.input)).toBe(true);
  expect(nextHost.querySelectorAll('.claudian-zen')).toHaveLength(1);
  f.controller.dispose();
});

it('retains controls, editor selection and native handlers across preview updates and remounts', () => {
  const f = fixture();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const disclosure = f.center.querySelector<HTMLButtonElement>('.claudian-zen-disclosure')!;
  const grip = f.center.querySelector<HTMLButtonElement>('.claudian-zen-grip')!;
  const onInput = jest.fn();
  f.input.addEventListener('input', onInput);
  f.input.focus();
  f.input.setSelectionRange(2, 6);
  for (const text of ['Reading', 'Editing', 'Done']) {
    f.source.getPreview = () => ({ text, hasMessages: true, working: text !== 'Done', requiresAction: false });
    f.controller.refresh();
    expect(f.center.querySelector('.claudian-zen-disclosure')).toBe(disclosure);
    expect(f.center.querySelector('.claudian-zen-grip')).toBe(grip);
    expect(document.activeElement).toBe(f.input);
    expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([2, 6]);
  }
  disclosure.click();
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  disclosure.click();
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  f.sidebar.collapsed = false;
  f.controller.refresh();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  expect(f.center.querySelector('textarea')).toBe(f.input);
  f.input.dispatchEvent(new Event('input'));
  expect(onInput).toHaveBeenCalledTimes(1);
  f.controller.dispose();
  expect(f.parent.querySelector('textarea')).toBe(f.input);
});

it('offers history only after the first message and hides it again when the conversation clears', () => {
  const f = fixture();
  let hasMessages = false;
  f.source.getPreview = () => ({ text: 'Chat', hasMessages, working: false, requiresAction: false });
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const root = f.center.querySelector('.claudian-zen')!;
  const toggle = root.querySelector<HTMLButtonElement>('.claudian-zen-disclosure')!;
  expect(toggle.hidden).toBe(true);
  expect(root.classList.contains('has-history')).toBe(false);
  hasMessages = true;
  f.controller.refresh();
  expect(toggle.hidden).toBe(false);
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  hasMessages = false;
  f.controller.refresh();
  expect(toggle.hidden).toBe(true);
  expect(root.classList.contains('has-history')).toBe(false);
  expect(f.input.value).toBe('Keep my draft');
  f.controller.dispose();
});

it('keeps a pending interaction accessible even before a message is rendered', () => {
  const f = fixture();
  f.source.getPreview = () => ({ text: 'Approval needed', hasMessages: false, working: false, requiresAction: true });
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const root = f.center.querySelector('.claudian-zen')!;
  expect(root.classList.contains('has-history')).toBe(true);
  expect(root.querySelector('.claudian-zen-disclosure')?.getAttribute('aria-expanded')).toBe('true');
  f.controller.dispose();
});

it('temporarily hides and restores the same composer through commands without changing the sidebar preference', () => {
  const f = fixture();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const command = f.controller.createCommands().find(command => command.id === 'toggle-zen-mode')!;
  const toggle = command.checkCallback!;
  expect(toggle(true)).toBe(true);
  expect(f.center.contains(f.input)).toBe(true);
  toggle(false);
  expect(f.center.querySelector('.claudian-zen')).toBeNull();
  expect(f.parent.contains(f.input)).toBe(true);
  f.controller.refresh();
  expect(f.center.querySelector('.claudian-zen')).toBeNull();
  toggle(false);
  expect(f.center.contains(f.input)).toBe(true);
  expect(document.activeElement).toBe(f.input);
  expect(f.input.value).toBe('Keep my draft');
  expect(f.sidebar.collapsed).toBe(true);
  toggle(false);
  f.sidebar.collapsed = false;
  f.controller.refresh();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  expect(f.center.contains(f.input)).toBe(true);
  f.release();
  expect(toggle(true)).toBe(false);
  f.controller.dispose();
});

it('toggles history without losing composer focus and remembers expansion across presentation changes', () => {
  const f = fixture();
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const command = f.controller.createCommands().find(command => command.id === 'toggle-zen-mode-history')!;
  const toggle = command.checkCallback!;
  f.input.focus();
  expect(toggle(true)).toBe(true);
  expect(f.center.querySelector('.claudian-zen-disclosure')?.getAttribute('aria-expanded')).toBe('false');
  toggle(false);
  expect(f.center.querySelector('.claudian-zen-disclosure')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(f.input);
  f.sidebar.collapsed = false;
  f.controller.refresh();
  expect(toggle(true)).toBe(false);
  f.sidebar.collapsed = true;
  f.controller.refresh();
  expect(f.center.querySelector('.claudian-zen-disclosure')?.getAttribute('aria-expanded')).toBe('true');
  toggle(false);
  expect(f.center.querySelector('.claudian-zen-disclosure')?.getAttribute('aria-expanded')).toBe('false');
  f.source.getPreview = () => ({ text: 'Chat', hasMessages: false, working: false, requiresAction: false });
  f.controller.refresh();
  expect(toggle(true)).toBe(false);
  f.controller.dispose();
});

it('returns focus to the disclosure before the history command hides a focused transcript', () => {
  const f = fixture();
  const history = f.source.surface.appendChild(document.createElement('div'));
  history.className = 'claudian-tab-content-container';
  const action = history.appendChild(document.createElement('button'));
  f.sidebar.collapsed = true;
  f.controller.refresh();
  const toggle = f.controller.createCommands().find(command => command.id === 'toggle-zen-mode-history')!.checkCallback!;
  toggle(false);
  action.focus();
  toggle(false);
  expect(document.activeElement).toBe(f.center.querySelector('.claudian-zen-disclosure'));
  f.controller.dispose();
});
