import { cloneQueuedMessage } from '../controllers/QueuedTurn';
import type { QueuedMessage } from './types';

export type FollowUpStatus = 'queued' | 'sending' | 'accepted' | 'uncertain';

export interface FollowUpItem {
  readonly id: string;
  readonly message: QueuedMessage;
  readonly status: FollowUpStatus;
}

/** Conversation-owned follow-ups; presentation detach never discards waiting input. */
export class FollowUpQueue {
  private entries: FollowUpItem[] = [];
  private readonly priorityEntryIds = new Set<string>();
  private isPaused = false;
  private composerMessage: QueuedMessage | null = null;
  private readonly listeners = new Set<() => void>();

  get items(): readonly FollowUpItem[] { return this.entries; }
  get editingMessage(): QueuedMessage | null { return this.composerMessage; }
  get paused(): boolean { return this.isPaused; }
  get next(): FollowUpItem | null {
    return this.entries.find(item => item.status === 'queued') ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause(): void { this.isPaused = true; this.notify(); }
  resume(): void { this.isPaused = false; this.notify(); }
  clear(): void {
    this.entries = [];
    this.priorityEntryIds.clear();
    this.composerMessage = null;
    this.isPaused = false;
    this.notify();
  }

  enqueue(id: string, message: QueuedMessage): FollowUpItem {
    const item: FollowUpItem = { id, message: cloneQueuedMessage(message), status: 'queued' };
    this.entries.push(item);
    this.notify();
    return item;
  }

  enqueuePriority(id: string, message: QueuedMessage): FollowUpItem {
    const item: FollowUpItem = { id, message: cloneQueuedMessage(message), status: 'queued' };
    this.priorityEntryIds.add(id);
    const firstOrdinaryQueuedIndex = this.entries.findIndex(entry =>
      entry.status === 'queued' && !this.priorityEntryIds.has(entry.id));
    if (firstOrdinaryQueuedIndex < 0) this.entries.push(item);
    else this.entries.splice(firstOrdinaryQueuedIndex, 0, item);
    this.notify();
    return item;
  }

  withdrawForEditing(id: string): QueuedMessage | null {
    const item = this.entries.find(entry => entry.id === id && entry.status === 'queued');
    if (!item) return null;
    this.composerMessage = cloneQueuedMessage(item.message);
    this.remove(id);
    return this.composerMessage;
  }

  finishEditing(expected: QueuedMessage | null): void {
    if (this.composerMessage === expected) this.composerMessage = null;
  }

  restoreEditingContext(message: QueuedMessage): void {
    this.composerMessage ??= cloneQueuedMessage(message);
  }

  moveTo(id: string, targetId: string, after = false): boolean {
    const waiting = this.entries.filter(item => item.status === 'queued');
    const source = waiting.find(item => item.id === id);
    const target = waiting.find(item => item.id === targetId);
    if (!source || !target || source === target) return false;
    const reordered = waiting.filter(item => item !== source);
    reordered.splice(reordered.indexOf(target) + (after ? 1 : 0), 0, source);
    if (!this.preservesPriorityOrder(reordered)) return false;
    let index = 0;
    this.entries = this.entries.map(item => waiting.includes(item) ? reordered[index++] : item);
    this.notify();
    return true;
  }

  takeNext(): FollowUpItem | null {
    if (this.paused || this.entries.some(item => item.status === 'sending')) return null;
    return this.takeNextPriority() ?? this.takeNextQueued(item => !this.priorityEntryIds.has(item.id));
  }

  takeNextPriority(): FollowUpItem | null {
    if (this.entries.some(item => item.status === 'sending')) return null;
    return this.takeNextQueued(item => this.priorityEntryIds.has(item.id));
  }

  isPriority(id: string): boolean {
    return this.priorityEntryIds.has(id);
  }

  private takeNextQueued(predicate: (item: FollowUpItem) => boolean): FollowUpItem | null {
    const item = this.entries.find(entry => entry.status === 'queued' && predicate(entry)) ?? null;
    if (!item || item.status !== 'queued') return null;
    this.setStatus(item.id, 'sending');
    return this.entries.find(entry => entry.id === item.id) ?? null;
  }

  setStatus(id: string, status: FollowUpStatus): void {
    this.entries = this.entries.map(item => item.id === id ? { ...item, status } : item);
    this.notify();
  }

  move(id: string, direction: -1 | 1): boolean {
    const waiting = this.entries.filter(item => item.status === 'queued');
    const index = waiting.findIndex(item => item.id === id);
    const otherIndex = index + direction;
    if (index < 0 || otherIndex < 0 || otherIndex >= waiting.length) return false;
    const reordered = [...waiting];
    [reordered[index], reordered[otherIndex]] = [reordered[otherIndex], reordered[index]];
    if (!this.preservesPriorityOrder(reordered)) return false;
    let cursor = 0;
    this.entries = this.entries.map(item => waiting.includes(item) ? reordered[cursor++] : item);
    this.notify();
    return true;
  }

  private preservesPriorityOrder(items: readonly FollowUpItem[]): boolean {
    let hasSeenOrdinaryItem = false;
    for (const item of items) {
      if (this.priorityEntryIds.has(item.id)) {
        if (hasSeenOrdinaryItem) return false;
      } else {
        hasSeenOrdinaryItem = true;
      }
    }
    return true;
  }

  remove(id: string): void {
    this.priorityEntryIds.delete(id);
    this.entries = this.entries.filter(item => item.id !== id);
    this.notify();
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
