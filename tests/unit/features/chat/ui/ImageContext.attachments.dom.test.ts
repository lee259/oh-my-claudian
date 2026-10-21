/** @jest-environment jsdom */

import { Notice } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';

HTMLElement.prototype.empty = function empty(): void {
  this.replaceChildren();
};

function createImage(name: string, read = async (): Promise<ArrayBuffer> => new Uint8Array([1, 2]).buffer): File {
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: read });
  return file;
}

function paste(input: HTMLElement, files: File[]): Event {
  let dispatching = true;
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: files.flatMap(file => [
      { type: 'text/plain', getAsFile: () => null },
      { type: file.type, getAsFile: () => dispatching ? file : null },
    ]) },
  });
  input.dispatchEvent(event);
  dispatching = false;
  return event;
}

function attach(source: 'paste' | 'drop', input: HTMLElement, files: File[]): Event {
  if (source === 'paste') return paste(input, files);
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  input.dispatchEvent(event);
  return event;
}

const restored: ImageAttachment = {
  id: 'restored', name: 'restored.png', mediaType: 'image/png', data: 'AQ==', size: 1, source: 'paste',
};

const flush = (): Promise<void> => new Promise(resolve => window.setTimeout(resolve, 0));

describe('ImageContextManager attachment lifetime', () => {
  let manager: ImageContextManager;
  let input: HTMLTextAreaElement;
  let container: HTMLElement;
  let onUserImagesChanged: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    const wrapper = container.createDiv({ cls: 'claudian-input-wrapper' });
    input = wrapper.createEl('textarea');
    document.body.append(container);
    onUserImagesChanged = jest.fn();
    manager = new ImageContextManager(container, input, { onUserImagesChanged });
  });

  afterEach(() => {
    manager.destroy();
    container.remove();
  });

  it('attaches every pasted image in order before clipboard files become unavailable', async () => {
    const event = paste(input, [createImage('first.png'), createImage('second.png')]);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(manager.getAttachedImages().map(image => image.name)).toEqual(['first.png', 'second.png']);
    expect(onUserImagesChanged).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('[data-context-slot="images"]')).toHaveLength(2);
  });

  describe.each(['paste', 'drop'] as const)('%s batches', source => {
    it.each(['clear', 'replace', 'disable', 'reenable', 'destroy'] as const)(
      'discards a pending read and the remaining batch after %s', async action => {
        let finish!: (value: ArrayBuffer) => void;
        const nextRead = jest.fn(async (): Promise<ArrayBuffer> => new Uint8Array([2]).buffer);
        attach(source, input, [
          createImage('stale.png', () => new Promise(resolve => { finish = resolve; })),
          createImage('later.png', nextRead),
        ]);
        switch (action) {
          case 'clear': manager.clearImages(); break;
          case 'replace': manager.setImages([restored]); break;
          case 'disable': manager.setEnabled(false); break;
          case 'reenable': manager.setEnabled(false); manager.setEnabled(true); break;
          case 'destroy': manager.destroy(); break;
        }
        finish(new Uint8Array([1]).buffer);
        await flush();

        expect(manager.getAttachedImages()).toEqual(action === 'replace' ? [restored] : []);
        expect(nextRead).not.toHaveBeenCalled();
        expect(onUserImagesChanged).not.toHaveBeenCalled();
        expect(Notice).not.toHaveBeenCalled();
      },
    );

    it('silences a rejected file read after the batch is cleared', async () => {
      let reject!: (error: Error) => void;
      attach(source, input, [createImage('stale.png', () => new Promise((_resolve, fail) => { reject = fail; }))]);
      manager.clearImages();
      reject(new Error('File no longer available'));
      await flush();
      expect(manager.getAttachedImages()).toEqual([]);
      expect(Notice).not.toHaveBeenCalled();
    });

    it('continues after a current read fails and reports the failure', async () => {
      attach(source, input, [
        createImage('bad.png', async () => { throw new Error('Unreadable file'); }),
        createImage('good.png'),
      ]);
      await flush();
      expect(manager.getAttachedImages().map(image => image.name)).toEqual(['good.png']);
      expect(Notice).toHaveBeenCalledTimes(1);
    });

    it('ignores attachment events after destruction', async () => {
      manager.destroy();
      const read = jest.fn();
      const event = attach(source, input, [createImage('late.png', read)]);
      await flush();
      expect(event.defaultPrevented).toBe(false);
      expect(read).not.toHaveBeenCalled();
      expect(onUserImagesChanged).not.toHaveBeenCalled();
    });
  });

  it('keeps screenshot MIME fallback and skips unsupported or oversized images individually', async () => {
    const oversized = createImage('oversized.png');
    Object.defineProperty(oversized, 'size', { value: 6 * 1024 * 1024 });
    const unsupported = new File(['bmp'], 'bad.bmp', { type: 'image/bmp' });
    paste(input, [oversized, unsupported, createImage('')]);
    await flush();
    const images = manager.getAttachedImages();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ mediaType: 'image/png', data: 'AQI=', source: 'paste' });
    expect(images[0].name).toMatch(/^image-.*\.png$/);
    expect(Notice).toHaveBeenCalledTimes(2);
  });

  it('allows plain text paste and consumes an image clipboard even when its file is unavailable', async () => {
    const text = paste(input, []);
    expect(text.defaultPrevented).toBe(false);
    const image = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(image, 'clipboardData', {
      value: { items: [{ type: 'image/png', getAsFile: () => null }] },
    });
    input.dispatchEvent(image);
    await flush();
    expect(image.defaultPrevented).toBe(true);
    expect(manager.getAttachedImages()).toEqual([]);
  });
});
