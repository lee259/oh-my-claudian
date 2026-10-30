/** @jest-environment jsdom */
import '@test/helpers/ObsidianSettingsDOM';

import { setImmediate } from 'node:timers';
import { TextEncoder } from 'node:util';

import { createMockEl } from '@test/helpers/MockElement';
import { Notice } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { ImageContextManager } from '@/features/chat/ui/ImageContext';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn(),
}));

function attachRealTrayHost(container: any): void {
  const createDiv = container.createDiv.bind(container);
  const querySelector = container.querySelector.bind(container);
  let tray: HTMLElement | null = null;
  container.createDiv = (options?: { cls?: string }) => {
    if (options?.cls === 'claudian-context-row') {
      tray = document.createElement('div');
      tray.className = options.cls;
      document.body.append(tray);
      return tray;
    }
    return createDiv(options);
  };
  container.querySelector = (selector: string) => selector === '.claudian-context-row' ? tray : querySelector(selector);
}

afterEach(() => document.body.replaceChildren());

function createMockCallbacks() {
  return {
    onImagesChanged: jest.fn(),
  };
}

function createContainerWithInputWrapper(): { container: any; inputWrapper: any } {
  const container = createMockEl();
  attachRealTrayHost(container);
  const inputWrapper = container.createDiv({ cls: 'claudian-input-wrapper' });
  return { container, inputWrapper };
}

function createMockTextArea(): any {
  const el = createMockEl('textarea');
  el.value = '';
  return el;
}

function createImageAttachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: 'img-test-1',
    name: 'test.png',
    mediaType: 'image/png',
    data: 'dGVzdA==',
    size: 1024,
    source: 'paste',
    ...overrides,
  };
}

describe('ImageContextManager', () => {
  let container: any;
  let inputEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let manager: ImageContextManager;

  beforeEach(() => {
    jest.clearAllMocks();
    const { container: c } = createContainerWithInputWrapper();
    container = c;
    inputEl = createMockTextArea();
    callbacks = createMockCallbacks();
    manager = new ImageContextManager(container, inputEl, callbacks);
  });

  it.each(['', 'image/png'])('attaches a PNG through the drop event with MIME %s', async mime => {
    const file = { name: 'probe.png', type: mime, size: 4,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
    const wrapper = container.querySelector('.claudian-input-wrapper');
    wrapper.dispatchEvent({ type: 'drop', preventDefault: jest.fn(), stopPropagation: jest.fn(),
      dataTransfer: { files: [file] } });
    await new Promise(resolve => setImmediate(resolve));
    try { expect(manager.getAttachedImages()).toHaveLength(1); }
    finally { manager.destroy(); }
  });

  it.each([
    ['probe.png', 'text/plain'], ['probe.bmp', ''],
  ])('rejects an unsupported dropped image combination: %s / %s', async (name, type) => {
    const file = { name, type, size: 4, arrayBuffer: jest.fn() };
    container.querySelector('.claudian-input-wrapper').dispatchEvent({
      type: 'drop', preventDefault: jest.fn(), stopPropagation: jest.fn(), dataTransfer: { files: [file] },
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(manager.getAttachedImages()).toHaveLength(0);
    manager.destroy();
  });

  it('keeps MIME-less drop reads disabled for an unsupported provider', async () => {
    manager.setEnabled(false);
    const file = { name: 'probe.png', type: '', size: 4, arrayBuffer: jest.fn() };
    container.querySelector('.claudian-input-wrapper').dispatchEvent({
      type: 'drop', preventDefault: jest.fn(), stopPropagation: jest.fn(), dataTransfer: { files: [file] },
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(manager.getAttachedImages()).toHaveLength(0);
    manager.destroy();
  });

  it('does not restore a MIME-less drop after the user clears images during a read', async () => {
    let release!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const file = { name: 'probe.png', type: '', size: 4, arrayBuffer: jest.fn(() => pending) };
    container.querySelector('.claudian-input-wrapper').dispatchEvent({
      type: 'drop', preventDefault: jest.fn(), stopPropagation: jest.fn(), dataTransfer: { files: [file] },
    });
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    manager.clearImages();
    release(new ArrayBuffer(4));
    await new Promise(resolve => setImmediate(resolve));
    expect(manager.getAttachedImages()).toHaveLength(0);
    manager.destroy();
  });

  describe('initial state', () => {
    it('should start with no images', () => {
      expect(manager.hasImages()).toBe(false);
      expect(manager.getAttachedImages()).toEqual([]);
    });
  });

  describe('getAttachedImages', () => {
    it('should return empty array when no images attached', () => {
      expect(manager.getAttachedImages()).toEqual([]);
    });

    it('should return all attached images after setImages', () => {
      const images = [
        createImageAttachment({ id: 'img-1', name: 'a.png' }),
        createImageAttachment({ id: 'img-2', name: 'b.jpg' }),
      ];
      manager.setImages(images);

      const result = manager.getAttachedImages();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('img-1');
      expect(result[1].id).toBe('img-2');
    });
  });

  describe('hasImages', () => {
    it('should return false when no images', () => {
      expect(manager.hasImages()).toBe(false);
    });

    it('should return true after setting images', () => {
      manager.setImages([createImageAttachment()]);
      expect(manager.hasImages()).toBe(true);
    });

    it('should return false after clearing images', () => {
      manager.setImages([createImageAttachment()]);
      manager.clearImages();
      expect(manager.hasImages()).toBe(false);
    });
  });

  describe('clearImages', () => {
    it('should remove all images', () => {
      manager.setImages([
        createImageAttachment({ id: 'img-1' }),
        createImageAttachment({ id: 'img-2' }),
      ]);
      expect(manager.hasImages()).toBe(true);

      manager.clearImages();
      expect(manager.hasImages()).toBe(false);
      expect(manager.getAttachedImages()).toEqual([]);
    });

    it('should invoke onImagesChanged callback', () => {
      manager.setImages([createImageAttachment()]);
      callbacks.onImagesChanged.mockClear();

      manager.clearImages();
      expect(callbacks.onImagesChanged).toHaveBeenCalledTimes(1);
    });
  });

  describe('setImages', () => {
    it('should replace existing images', () => {
      manager.setImages([createImageAttachment({ id: 'old' })]);

      const newImages = [
        createImageAttachment({ id: 'new-1', name: 'new1.png' }),
        createImageAttachment({ id: 'new-2', name: 'new2.jpg' }),
      ];
      manager.setImages(newImages);

      const result = manager.getAttachedImages();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('new-1');
      expect(result[1].id).toBe('new-2');
    });

    it('should invoke onImagesChanged callback', () => {
      manager.setImages([createImageAttachment()]);
      expect(callbacks.onImagesChanged).toHaveBeenCalledTimes(1);
    });

    it('should handle empty array', () => {
      manager.setImages([createImageAttachment()]);
      manager.setImages([]);

      expect(manager.hasImages()).toBe(false);
      expect(manager.getAttachedImages()).toEqual([]);
    });

    it('should deduplicate by id (last wins)', () => {
      const images = [
        createImageAttachment({ id: 'same', name: 'first.png' }),
        createImageAttachment({ id: 'same', name: 'second.png' }),
      ];
      manager.setImages(images);

      const result = manager.getAttachedImages();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('second.png');
    });
  });

  describe('constructor with previewContainerEl', () => {
    it('should use previewContainerEl when provided', () => {
      const previewContainer = createMockEl();
      attachRealTrayHost(previewContainer);
      const { container: c } = createContainerWithInputWrapper();
      const input = createMockTextArea();
      const cb = createMockCallbacks();

      const mgr = new ImageContextManager(c, input, cb, previewContainer);
      expect(mgr).toBeDefined();
      const trayEl = previewContainer.querySelector('.claudian-context-row');
      expect(trayEl).not.toBeNull();
    });

    it('should preserve existing preview container content', () => {
      const previewContainer = createMockEl();
      attachRealTrayHost(previewContainer);
      const existingContent = previewContainer.createDiv({ cls: 'existing-preview-content' });

      const { container: c } = createContainerWithInputWrapper();
      const input = createMockTextArea();
      const cb = createMockCallbacks();

      new ImageContextManager(c, input, cb, previewContainer);
      expect(previewContainer.children).toContain(existingContent);
      expect(previewContainer.querySelector('.claudian-context-row')).not.toBeNull();
    });
  });
});

// Test private helper methods via their observable effects.
// We access privates through any cast, matching the project's pattern.
describe('ImageContextManager - Private Helpers', () => {
  let manager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    const { container } = createContainerWithInputWrapper();
    const inputEl = createMockTextArea();
    const callbacks = createMockCallbacks();
    manager = new ImageContextManager(container, inputEl, callbacks);
  });

  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(manager['formatSize'](500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(manager['formatSize'](2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(manager['formatSize'](5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('should format fractional KB', () => {
      expect(manager['formatSize'](1536)).toBe('1.5 KB');
    });

    it('should format 0 bytes', () => {
      expect(manager['formatSize'](0)).toBe('0 B');
    });
  });

  describe('getMediaType', () => {
    it('should return correct media type for .jpg', () => {
      expect(manager['getMediaType']('photo.jpg')).toBe('image/jpeg');
    });

    it('should return correct media type for .jpeg', () => {
      expect(manager['getMediaType']('photo.jpeg')).toBe('image/jpeg');
    });

    it('should return correct media type for .png', () => {
      expect(manager['getMediaType']('image.png')).toBe('image/png');
    });

    it('should return correct media type for .gif', () => {
      expect(manager['getMediaType']('animation.gif')).toBe('image/gif');
    });

    it('should return correct media type for .webp', () => {
      expect(manager['getMediaType']('photo.webp')).toBe('image/webp');
    });

    it('should return null for unsupported extension', () => {
      expect(manager['getMediaType']('document.pdf')).toBeNull();
    });

    it('should return null for no extension', () => {
      expect(manager['getMediaType']('noextension')).toBeNull();
    });

    it('should handle uppercase extensions', () => {
      expect(manager['getMediaType']('PHOTO.JPG')).toBe('image/jpeg');
    });

    it('should handle mixed case extensions', () => {
      expect(manager['getMediaType']('image.Png')).toBe('image/png');
    });
  });

  describe('isImageFile', () => {
    it('should return true for valid image file', () => {
      const file = { type: 'image/png', name: 'test.png' } as File;
      expect(manager['isImageFile'](file)).toBe(true);
    });

    it('should return false for non-image file', () => {
      const file = { type: 'application/pdf', name: 'doc.pdf' } as File;
      expect(manager['isImageFile'](file)).toBe(false);
    });

    it('should return false for image type but unsupported extension', () => {
      const file = { type: 'image/bmp', name: 'test.bmp' } as File;
      expect(manager['isImageFile'](file)).toBe(false);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = manager['generateId']();
      const id2 = manager['generateId']();
      expect(id1).not.toBe(id2);
    });

    it('should start with img- prefix', () => {
      const id = manager['generateId']();
      expect(id.startsWith('img-')).toBe(true);
    });
  });

  describe('notifyImageError', () => {
    it('should create a Notice with the message', () => {
      manager['notifyImageError']('Test error');
      expect(Notice).toHaveBeenCalledWith('Test error');
    });

    it('should append file not found for ENOENT error', () => {
      const error = new Error('ENOENT: no such file or directory');
      manager['notifyImageError']('Failed to load image.', error);
      expect(Notice).toHaveBeenCalledWith('Failed to load image. (File not found)');
    });

    it('should append permission denied for EACCES error', () => {
      const error = new Error('EACCES: permission denied');
      manager['notifyImageError']('Failed to load image.', error);
      expect(Notice).toHaveBeenCalledWith('Failed to load image. (Permission denied)');
    });

    it('should use original message for non-Error objects', () => {
      manager['notifyImageError']('Test error', 'not an error object');
      expect(Notice).toHaveBeenCalledWith('Test error');
    });

    it('should use original message for errors without recognized patterns', () => {
      const error = new Error('Some other error');
      manager['notifyImageError']('Test error', error);
      expect(Notice).toHaveBeenCalledWith('Test error');
    });
  });

  describe('addImageFromFile', () => {
    it('should reject files exceeding size limit', async () => {
      const file = {
        name: 'huge.png',
        type: 'image/png',
        size: 6 * 1024 * 1024, // 6MB > 5MB limit
        arrayBuffer: jest.fn(),
      } as unknown as File;

      const result = await manager['addImageFromFile'](file, 'paste');
      expect(result).toBe(false);
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining('limit'));
    });

    it.each(['', 'image/bmp', 'image/svg+xml'])('should reject unsupported MIME type %s before reading bytes', async (type) => {
      const file = {
        name: 'test.bmp',
        type,
        size: 1024,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(4)),
      } as unknown as File;

      const result = await manager['addImageFromFile'](file, 'paste');
      expect(result).toBe(false);
      expect(Notice).toHaveBeenCalledWith('Unsupported image type.');
      expect(file.arrayBuffer).not.toHaveBeenCalled();
      expect(manager.getAttachedImages()).toEqual([]);
      expect(manager.callbacks.onImagesChanged).not.toHaveBeenCalled();
    });

    it('should add valid image file and invoke callback', async () => {
      const mockBuffer = new ArrayBuffer(4);
      const file = {
        name: 'test.png',
        type: 'image/png',
        size: 1024,
        arrayBuffer: jest.fn().mockResolvedValue(mockBuffer),
      } as unknown as File;

      const callbacks = createMockCallbacks();
      const { container } = createContainerWithInputWrapper();
      const inputEl = createMockTextArea();
      const mgr: any = new ImageContextManager(container, inputEl, callbacks);

      const result = await mgr['addImageFromFile'](file, 'paste');
      expect(result).toBe(true);
      expect(mgr.hasImages()).toBe(true);
      expect(callbacks.onImagesChanged).toHaveBeenCalled();

      const images = mgr.getAttachedImages();
      expect(images).toHaveLength(1);
      expect(images[0].name).toBe('test.png');
      expect(images[0].mediaType).toBe('image/png');
      expect(images[0].size).toBe(1024);
      expect(images[0].source).toBe('paste');
    });

    it('should handle arrayBuffer failure gracefully', async () => {
      const file = {
        name: 'test.png',
        type: 'image/png',
        size: 1024,
        arrayBuffer: jest.fn().mockRejectedValue(new Error('Read failed')),
      } as unknown as File;

      const result = await manager['addImageFromFile'](file, 'drop');
      expect(result).toBe(false);
      expect(Notice).toHaveBeenCalledWith('Failed to attach image.');
    });

    it('should generate default name when file has no name', async () => {
      const mockBuffer = new ArrayBuffer(4);
      const file = {
        name: '',
        type: 'image/png',
        size: 512,
        arrayBuffer: jest.fn().mockResolvedValue(mockBuffer),
      } as unknown as File;

      const callbacks = createMockCallbacks();
      const { container } = createContainerWithInputWrapper();
      const inputEl = createMockTextArea();
      const mgr: any = new ImageContextManager(container, inputEl, callbacks);

      await mgr['addImageFromFile'](file, 'paste');
      const images = mgr.getAttachedImages();
      expect(images[0].name).toMatch(/^image-\d+\.png$/);
    });

    it.each([
      ['image/jpeg', 'image/jpeg'],
      ['image/jpg', 'image/jpeg'],
      ['image/png', 'image/png'],
      ['image/gif', 'image/gif'],
      ['image/webp', 'image/webp'],
    ])('should normalize supported fallback MIME type %s to %s', async (type, mediaType) => {
      const file = {
        name: 'clipboard',
        type,
        size: 5,
        arrayBuffer: jest.fn().mockResolvedValue(new TextEncoder().encode('hello').buffer),
      } as unknown as File;

      const result = await manager['addImageFromFile'](file, 'paste');
      expect(result).toBe(true);
      expect(manager.getAttachedImages()).toEqual([
        expect.objectContaining({ mediaType, data: 'aGVsbG8=' }),
      ]);
    });
  });

  describe('Drag and Drop handlers', () => {
    it('handleDragEnter should show overlay when dragging files', () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['Files'] },
      };

      manager['handleDragEnter'](event as any);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(manager['dropOverlay']?.hasClass('visible')).toBe(true);
    });

    it('handleDragEnter should not show overlay when not dragging files', () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['text/plain'] },
      };

      manager['handleDragEnter'](event as any);

      expect(manager['dropOverlay']?.hasClass('visible')).toBeFalsy();
    });

    it('handleDragOver should prevent default', () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      };

      manager['handleDragOver'](event as any);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('handleDragLeave should hide overlay when cursor leaves input wrapper', () => {
      // Show overlay first
      manager['dropOverlay']?.addClass('visible');

      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: -1, // Outside bounds
        clientY: -1,
      };

      manager['handleDragLeave'](event as any);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(manager['dropOverlay']?.hasClass('visible')).toBe(false);
    });

    it('handleDrop should hide overlay and process image files', async () => {
      manager['dropOverlay']?.addClass('visible');
      const addImageSpy = jest.spyOn(manager as any, 'addImageFromFile').mockResolvedValue(true);

      const mockFile = { type: 'image/png', name: 'test.png', size: 1024 };
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: { length: 1, 0: mockFile, [Symbol.iterator]: function* () { yield mockFile; } } },
      };

      await manager['handleDrop'](event as any);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(manager['dropOverlay']?.hasClass('visible')).toBe(false);
      expect(addImageSpy).toHaveBeenCalledWith(mockFile, 'drop');

      addImageSpy.mockRestore();
    });

    it('handleDrop should skip non-image files', async () => {
      const addImageSpy = jest.spyOn(manager as any, 'addImageFromFile').mockResolvedValue(true);
      jest.spyOn(manager as any, 'isImageFile').mockReturnValue(false);

      const mockFile = { type: 'application/pdf', name: 'doc.pdf', size: 1024 };
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: { length: 1, 0: mockFile } },
      };

      await manager['handleDrop'](event as any);

      expect(addImageSpy).not.toHaveBeenCalled();
      addImageSpy.mockRestore();
    });

    it('handleDrop should handle no files gracefully', async () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: undefined },
      };

      await manager['handleDrop'](event as any);
      // Should not throw and still call preventDefault
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Paste handler', () => {
    it('setupPasteHandler should register paste event on inputEl', () => {
      const input = manager['inputEl'];
      expect(input.getEventListenerCount('paste')).toBe(1);
    });

    it('paste handler should process image items', async () => {
      const addImageSpy = jest.spyOn(manager as any, 'addImageFromFile').mockResolvedValue(true);
      const mockFile = { name: 'pasted.png', type: 'image/png', size: 1024 };
      const pasteEvent = {
        type: 'paste',
        preventDefault: jest.fn(),
        clipboardData: {
          items: {
            length: 1,
            0: {
              type: 'image/png',
              getAsFile: () => mockFile,
            },
          },
        },
      };

      manager['inputEl'].dispatchEvent(pasteEvent);
      // Wait for async paste handler
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(pasteEvent.preventDefault).toHaveBeenCalled();
      expect(addImageSpy).toHaveBeenCalledWith(mockFile, 'paste');
      addImageSpy.mockRestore();
    });

    it('paste handler should ignore non-image items', async () => {
      const addImageSpy = jest.spyOn(manager as any, 'addImageFromFile').mockResolvedValue(true);
      const pasteEvent = {
        type: 'paste',
        preventDefault: jest.fn(),
        clipboardData: {
          items: {
            length: 1,
            0: {
              type: 'text/plain',
              getAsFile: () => null,
            },
          },
        },
      };

      manager['inputEl'].dispatchEvent(pasteEvent);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
      expect(addImageSpy).not.toHaveBeenCalled();
      addImageSpy.mockRestore();
    });

    it('paste handler should handle null clipboardData', async () => {
      const addImageSpy = jest.spyOn(manager as any, 'addImageFromFile').mockResolvedValue(true);
      const pasteEvent = {
        type: 'paste',
        preventDefault: jest.fn(),
        clipboardData: null,
      };

      manager['inputEl'].dispatchEvent(pasteEvent);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(addImageSpy).not.toHaveBeenCalled();
      addImageSpy.mockRestore();
    });
  });

  describe('Image context rendering', () => {
    it('updateImagePreview should hide preview when no images', () => {
      manager['updateImagePreview']();
      expect(manager['contextTray']['containerEl'].hasClass('has-content')).toBe(false);
    });

    it('updateImagePreview should show preview when images exist', () => {
      manager.setImages([createImageAttachment()]);
      expect(manager['contextTray']['containerEl'].hasClass('has-content')).toBe(true);
    });

    it('renders a compact image pill without a thumbnail preview', () => {
      manager.setImages([createImageAttachment({ id: 'img-1', name: 'photo.png', size: 2048 })]);

      const trayEl = manager['contextTray']['containerEl'];
      const chipEl = trayEl.querySelector('.claudian-context-chip--image');
      expect(chipEl).not.toBeNull();

      const thumbEl = chipEl.querySelector('.claudian-context-chip-thumbnail');
      expect(thumbEl).toBeNull();

      const labelEl = chipEl.querySelector('.claudian-context-chip-label');
      expect(labelEl?.textContent).toBe('Image');

      const removeEl = chipEl.querySelector('.claudian-context-chip-remove');
      expect(removeEl).not.toBeNull();
    });

    it('numbers image pills in attachment order when more than one image is attached', () => {
      manager.setImages([
        createImageAttachment({ id: 'img-1', name: 'first.png' }),
        createImageAttachment({ id: 'img-2', name: 'second.png' }),
      ]);

      const trayEl = manager['contextTray']['containerEl'];
      const labels = trayEl.querySelectorAll('.claudian-context-chip-label');

      expect(Array.from(labels, (label: any) => label.textContent)).toEqual(['Image 1', 'Image 2']);
    });

    it('remove button should delete the image and update preview', () => {
      const cb = createMockCallbacks();
      const { container } = createContainerWithInputWrapper();
      const input = createMockTextArea();
      const mgr: any = new ImageContextManager(container, input, cb);

      mgr.setImages([
        createImageAttachment({ id: 'img-1', name: 'a.png' }),
        createImageAttachment({ id: 'img-2', name: 'b.png' }),
      ]);
      expect(mgr.getAttachedImages()).toHaveLength(2);

      cb.onImagesChanged.mockClear();

      const trayEl = mgr['contextTray']['containerEl'];
      const firstChip = trayEl.querySelector('.claudian-context-chip--image');
      const removeEl = firstChip.querySelector('.claudian-context-chip-remove');
      removeEl.click();

      expect(mgr.getAttachedImages()).toHaveLength(1);
      expect(mgr.getAttachedImages()[0].id).toBe('img-2');
      expect(cb.onImagesChanged).toHaveBeenCalled();
    });

    it('opens an image preview from the rendered attachment control and closes it on destroy', () => {
      const overlayEl = createMockEl();
      const removeOverlay = jest.spyOn(overlayEl, 'remove');
      const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
      const originalDocument = manager['containerEl'].ownerDocument;
      manager['containerEl'].ownerDocument = { activeElement: null, body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

      try {
        manager.setImages([createImageAttachment({ name: 'photo.png' })]);
        const previewButton = manager['contextTray']['containerEl']
          .querySelector('.claudian-context-chip-main');

        expect(previewButton.tagName).toBe('BUTTON');
        previewButton.click();
        expect(mockBody.createDiv).toHaveBeenCalledWith({
          cls: 'claudian-image-modal-overlay',
        });

        manager.destroy();
        expect(removeOverlay).toHaveBeenCalledTimes(1);
      } finally {
        manager['containerEl'].ownerDocument = originalDocument;
      }
    });
  });

  describe('fileToBase64', () => {
    it('should convert file to base64 string', async () => {
      const textEncoder = new TextEncoder();
      const bytes = textEncoder.encode('hello');
      const mockBuffer = bytes.buffer;
      const file = {
        arrayBuffer: jest.fn().mockResolvedValue(mockBuffer),
      } as unknown as File;

      const result = await manager['fileToBase64'](file);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Verify it's valid base64
      const decoded = Buffer.from(result, 'base64').toString();
      expect(decoded).toBe('hello');
    });
  });
});
