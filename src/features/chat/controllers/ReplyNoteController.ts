import type { App } from 'obsidian';

import type { ReplyNoteWriter } from '@/core/obsidian/ReplyNoteWriter';

import { SaveReplyNoteModal } from '../ui/SaveReplyNoteModal';

/** Owns one save dialog for this presentation, including repeated action clicks. */
export class ReplyNoteController {
  private modal?: SaveReplyNoteModal;

  constructor(private readonly app: App, private readonly writer: ReplyNoteWriter) {}

  open(markdown: string): void {
    if (this.modal) return;
    this.modal = new SaveReplyNoteModal(this.app, this.writer, markdown, () => { this.modal = undefined; });
    this.modal.open();
  }

  dispose(): void {
    this.modal?.close();
  }
}
