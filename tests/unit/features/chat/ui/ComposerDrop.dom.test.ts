/** @jest-environment jsdom */
import { TFolder } from 'obsidian';

import { FileContextManager } from '@/features/chat/ui/FileContext';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';

jest.mock('@/shared/mention/VaultMentionDataProvider', () => ({ VaultMentionDataProvider: class { initializeInBackground() {} } }));
jest.mock('@/shared/mention/MentionDropdownController', () => ({ MentionDropdownController: class { destroy() {} } }));
jest.mock('@/features/chat/ui/file-context/view/FileChipsView', () => ({ FileChipsView: class { renderAttachedFiles() {} destroy() {} } }));
jest.mock('@/utils/path', () => ({ ...jest.requireActual('@/utils/path'), getVaultPath: () => '/vault' }));

describe('composer file drop', () => {
  it.each([['note.md', 'note.md', false], ['folder', 'folder/', true]])(
    'attaches %s and dismisses the overlay when dropped on an input child', (path, expected, isFolder) => {
      const container = document.createElement('div');
      const wrapper = container.createDiv({ cls: 'claudian-input-wrapper' });
      const input = wrapper.createDiv();
      const child = input.createDiv();
      const app = { vault: { on: jest.fn(), offref: jest.fn(), getAbstractFileByPath: jest.fn(() => isFolder ? new TFolder() : null) } } as any;
      const tray = { clearItems: jest.fn() } as any;
      const files = new FileContextManager(app, container, input as any, { getExcludedTags: () => [] }, container, tray);
      const images = new ImageContextManager(container, input as any, {}, undefined, tray);
      const transfer = { types: ['text/plain'], files: [], getData: (type: string) => type === 'text/plain' ? `obsidian://open?vault=vault&file=${path}` : '' };
      const dispatch = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        child.dispatchEvent(event);
      };
      dispatch('dragenter');
      const overlay = wrapper.querySelector('.claudian-file-drop-overlay')!;
      expect(overlay.classList.contains('claudian-hidden')).toBe(false);
      dispatch('drop');
      expect(overlay.classList.contains('claudian-hidden')).toBe(true);
      expect(files.getAttachedFiles()).toEqual(new Set([expected]));
      images.destroy();
      files.destroy();
    },
  );

  it('attaches dropped images once and dismisses the file overlay', async () => {
    const container = document.createElement('div');
    const wrapper = container.createDiv({ cls: 'claudian-input-wrapper' });
    const input = wrapper.createDiv();
    const child = input.createDiv();
    const app = { vault: { on: jest.fn(), offref: jest.fn(), getAbstractFileByPath: jest.fn() } } as any;
    const tray = { clearItems: jest.fn(), setItems: jest.fn() } as any;
    const files = new FileContextManager(app, container, input as any, { getExcludedTags: () => [] }, container, tray);
    const images = new ImageContextManager(container, input as any, {}, undefined, tray);
    const file = new File(['image'], 'picture.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/vault/picture.png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2]).buffer });
    const transfer = { types: ['Files'], files: [file], getData: () => '' };
    for (const type of ['dragenter', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      child.dispatchEvent(event);
    }
    expect(wrapper.querySelector('.claudian-file-drop-overlay')!.classList.contains('claudian-hidden')).toBe(true);
    expect(files.getAttachedFiles().size).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(images.getAttachedImages()).toHaveLength(1);
    images.destroy();
    files.destroy();
  });
});
