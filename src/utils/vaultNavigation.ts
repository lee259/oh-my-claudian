import type { App, PaneType, TAbstractFile } from 'obsidian';
import { Notice } from 'obsidian';

import { t } from '@/i18n/i18n';

/** Reveal an existing vault item without leaking host errors or changing chip state. */
export async function revealVaultItem(app: App, target: TAbstractFile | null): Promise<void> {
  if (!target) return;
  try {
    await Promise.all(app.workspace.getLeavesOfType('file-explorer').map(async leaf => {
      const view = leaf.view as unknown as { revealInFolder?: (item: TAbstractFile) => void | Promise<void> };
      await view.revealInFolder?.(target);
    }));
  } catch {
    new Notice(t('chat.composer.contextRevealFailed'));
  }
}

/** Open an ordinary vault link, retaining Obsidian's heading/block resolution. */
export async function openVaultLink(app: App, target: string, pane: PaneType | boolean = 'tab'): Promise<void> {
  try {
    await app.workspace.openLinkText(target, '', pane);
  } catch {
    new Notice(t('chat.composer.fileOpenFailed'));
  }
}
