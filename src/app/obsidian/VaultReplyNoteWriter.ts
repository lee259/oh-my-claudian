import { type App, TFile } from 'obsidian';

import {
  ReplyNoteWriteError,
  type ReplyNoteWriter,
  type ReplyNoteWriteReceipt,
  type ReplyNoteWriteRequest,
} from '@/core/obsidian/ReplyNoteWriter';

/** Writes user-reviewed replies through Obsidian, independently of provider execution. */
export class VaultReplyNoteWriter implements ReplyNoteWriter {
  constructor(private readonly app: App) {}

  async save(request: ReplyNoteWriteRequest): Promise<ReplyNoteWriteReceipt> {
    const path = request.path.trim();
    if (!path.toLowerCase().endsWith('.md')
      || /[\\:*?"<>|\p{Cc}]/u.test(path)
      || path.split('/').some(part => !part || part.startsWith('.') || part !== part.trim())) {
      throw new ReplyNoteWriteError('invalidPath');
    }
    if (!request.content.trim()) throw new ReplyNoteWriteError('emptyContent');
    let prefix = '';
    let suffix = request.content;
    let file: TFile;
    if (request.mode === 'create') {
      if (this.app.vault.getAbstractFileByPath(path)) throw new ReplyNoteWriteError('exists');
      file = await this.app.vault.create(path, request.content);
    } else {
      const target = this.app.vault.getAbstractFileByPath(path);
      if (!(target instanceof TFile) || target.extension.toLowerCase() !== 'md') throw new ReplyNoteWriteError('missingNote');
      file = target;
      await this.app.vault.process(file, (current) => {
        prefix = current;
        const separator = !current || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
        suffix = `${separator}${request.content}${request.content.endsWith('\n') ? '' : '\n'}`;
        return prefix + suffix;
      });
    }
    let undone = false;
    let undoPending: Promise<void> | undefined;
    return {
      get path() { return file.path; },
      undo: () => {
        if (undone) return Promise.resolve();
        undoPending ??= (async () => {
          if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new ReplyNoteWriteError('missingNote');
          await this.app.vault.process(file, (current) => {
            if (!current.startsWith(prefix + suffix)) throw new ReplyNoteWriteError('conflict');
            return prefix + current.slice(prefix.length + suffix.length);
          });
          undone = true;
        })().finally(() => { undoPending = undefined; });
        return undoPending;
      },
    };
  }
}
