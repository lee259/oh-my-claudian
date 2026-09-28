import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { parseClaudeTaskNotification } from '../normalization/claudeTaskNotification';

/** Delays notification presentation until Claude's native transcript shows consumption. */
export class ClaudeTaskNotificationQueue {
  private readonly backgroundModes = new Map<string, boolean>();
  private readonly pending = new Map<string, { content: string }>();
  private turnNotifications = new Map<string, { content: string }>();

  observe(message: SDKMessage): void {
    if (message.type !== 'system') return;
    if (message.subtype === 'init') {
      this.turnNotifications = new Map(this.pending);
    } else if (message.subtype === 'task_started' && message.is_backgrounded !== undefined) {
      this.backgroundModes.set(message.task_id, message.is_backgrounded);
    } else if (message.subtype === 'task_updated' && message.patch.is_backgrounded !== undefined) {
      this.backgroundModes.set(message.task_id, message.patch.is_backgrounded);
    }
  }

  complete(message: SDKMessage, content: string | undefined): void {
    if (message.type !== 'system' || message.subtype !== 'task_notification') return;
    const backgrounded = this.backgroundModes.get(message.task_id) !== false;
    this.backgroundModes.delete(message.task_id);
    if (backgrounded && !message.skip_transcript && content) {
      this.pending.set(message.task_id, { content });
    }
  }

  consume(content: unknown): string | null {
    const notification = parseClaudeTaskNotification(content);
    if (!notification) return null;
    this.pending.delete(notification.taskId);
    this.turnNotifications.delete(notification.taskId);
    return notification.content;
  }

  takeTurnNotifications(): string[] {
    const contents: string[] = [];
    for (const [taskId, notification] of this.turnNotifications) {
      contents.push(notification.content);
      if (this.pending.get(taskId) === notification) this.pending.delete(taskId);
    }
    this.turnNotifications.clear();
    return contents;
  }

  reset(): void {
    this.pending.clear();
    this.backgroundModes.clear();
    this.turnNotifications.clear();
  }
}
