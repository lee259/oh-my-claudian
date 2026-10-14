/** @jest-environment jsdom */

import { Menu } from 'obsidian';

import { FollowUpQueue } from '@/features/chat/state/FollowUpQueue';
import { FollowUpQueueView } from '@/features/chat/ui/FollowUpQueueView';
import { setLocale } from '@/i18n/i18n';

const menuInstances = (Menu as unknown as {
  instances: { items: { icon: string; disabled: boolean; clickHandler: (() => void) | null }[] }[];
}).instances;

describe('FollowUpQueueView', () => {
  it('preserves keyed rows, expanded details and focus as the queue changes', () => {
    const queue = new FollowUpQueue();
    queue.enqueue('first', { content: 'Fix CSS', editorContext: null, canvasContext: null });
    const root = document.body.createDiv();
    const view = new FollowUpQueueView(root, queue, {
      onSteer: jest.fn(), onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn(),
    });
    const row = root.querySelector('[data-id="first"]');
    const details = row!.querySelector('details')!;
    details.open = true;
    const handle = row!.querySelector<HTMLButtonElement>('[data-action="reorder"]')!;
    handle.focus();
    queue.enqueue('second', { content: 'Run tests', editorContext: null, canvasContext: null });
    expect(root.querySelector('[data-id="first"]')).toBe(row);
    expect(row!.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    queue.move('first', 1);
    expect(root.querySelector('[data-id="first"]')).toBe(row);
    expect(document.activeElement).toBe(handle);
    view.destroy();
    queue.enqueue('third', { content: 'Review', editorContext: null, canvasContext: null });
    expect(root.childElementCount).toBe(0);
  });

  it('emits an edit intent to return the item to the main composer', () => {
    const queue = new FollowUpQueue();
    queue.enqueue('first', { content: 'Fix CSS', editorContext: null, canvasContext: null });
    const root = document.body.createDiv();
    const actions = { onSteer: jest.fn(), onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn() };
    const view = new FollowUpQueueView(root, queue, actions);
    (root.querySelector('[data-action="more"]') as HTMLButtonElement).click();
    menuInstances.at(-1)!.items.find(item => item.icon === 'pencil')!.clickHandler!();
    expect(actions.onEdit).toHaveBeenCalledWith('first');
    expect(root.querySelector('textarea')).toBeNull();
    view.destroy();
  });

  it('removes pending steering from the waiting tray while retaining it for reconciliation', () => {
    const queue = new FollowUpQueue();
    queue.enqueue('first', { content: 'Fix CSS', editorContext: null, canvasContext: null });
    const root = document.body.createDiv();
    const view = new FollowUpQueueView(root, queue, {
      onSteer: () => queue.setStatus('first', 'sending'), onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn(),
    });
    view.update(true);
    (root.querySelector('[data-action="steer"]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-id="first"]')).toBeNull();
    expect(queue.items[0].status).toBe('sending');
    queue.setStatus('first', 'queued');
    expect(root.querySelector('[data-id="first"]')).not.toBeNull();
    queue.setStatus('first', 'uncertain');
    expect(root.querySelector('[role="status"]')).not.toBeNull();
    view.destroy();
  });

  it('reorders by dragging the left handle and by keyboard without accepting external drags', () => {
    const queue = new FollowUpQueue();
    for (const id of ['first', 'second', 'third']) queue.enqueue(id, { content: id, editorContext: null, canvasContext: null });
    const root = document.body.createDiv();
    const view = new FollowUpQueueView(root, queue, {
      onSteer: jest.fn(), onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn(),
    });
    const target = root.querySelector('[data-id="third"]')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'clientY', { value: 10 });
    target.dispatchEvent(drop);
    expect(queue.items.map(item => item.id)).toEqual(['first', 'second', 'third']);
    const handle = root.querySelector('[data-id="first"] [data-action="reorder"]') as HTMLButtonElement;
    expect(handle.getAttribute('draggable')).toBe('true');
    handle.dispatchEvent(new Event('dragstart', { bubbles: true }));
    target.dispatchEvent(drop);
    expect(queue.items.map(item => item.id)).toEqual(['second', 'third', 'first']);
    const movedHandle = root.querySelector('[data-id="first"] [data-action="reorder"]') as HTMLButtonElement;
    movedHandle.focus();
    movedHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(queue.items.map(item => item.id)).toEqual(['second', 'first', 'third']);
    expect(document.activeElement?.getAttribute('data-focus')).toBe('first:reorder');
    view.destroy();
  });

  it('keeps compact rows and only offers editing in the more menu', () => {
    const queue = new FollowUpQueue();
    queue.enqueue('first', { content: 'Fix CSS', editorContext: null, canvasContext: null });
    queue.enqueue('second', { content: 'Run tests', editorContext: null, canvasContext: null });
    const root = document.body.createDiv();
    const view = new FollowUpQueueView(root, queue, {
      onSteer: jest.fn(), onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn(),
    });
    view.update(true);
    expect(root.querySelector('[data-action="toggle"]')).toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector('[data-action="edit"]')).toBeNull();
    expect(root.querySelector('[data-action="up"]')).toBeNull();
    expect(root.querySelector('[data-action="steer"]')!.textContent).toBe('Steer');
    (root.querySelector('[data-id="second"] [data-action="more"]') as HTMLButtonElement).click();
    const menu = menuInstances.at(-1)!;
    expect(menu.items.map(item => item.icon)).toEqual(['pencil']);
    const count = menuInstances.length;
    const handle = root.querySelector('[data-action="reorder"]') as HTMLButtonElement;
    handle.click();
    expect(menuInstances).toHaveLength(count);
    expect(handle.getAttribute('aria-haspopup')).toBeNull();
    expect(root.querySelector('[data-action="more"]')!.getAttribute('aria-haspopup')).toBe('menu');
    view.destroy();
  });

  afterEach(() => { document.body.replaceChildren(); setLocale('en'); });

  it('renders separate localized entries and exposes only safe actions', () => {
    setLocale('zh-CN');
    const queue = new FollowUpQueue();
    queue.enqueue('first', { content: 'Fix CSS', editorContext: null, canvasContext: null });
    queue.enqueue('second', { content: 'Run tests', editorContext: null, canvasContext: null });
    queue.setStatus('second', 'uncertain');
    const root = document.body.createDiv();
    const onSteer = jest.fn();
    const view = new FollowUpQueueView(root, queue, {
      onSteer, onRemove: jest.fn(), onResume: jest.fn(), onEdit: jest.fn(),
    });
    view.update(true);
    expect(root.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(root.textContent).toContain('投递待确认');
    (root.querySelector('[data-action="steer"]') as HTMLButtonElement).click();
    expect(onSteer).toHaveBeenCalledWith('first');
    expect(root.querySelector('[data-id="second"] [data-action="steer"]')).toBeNull();
    expect(root.querySelector('[data-id="second"] [data-action="remove"]')).toBeNull();
    view.destroy();
  });
});
