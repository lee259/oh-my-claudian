import { type App, Scope } from 'obsidian';

import { t } from '@/i18n/i18n';

import type { ImageAttachment } from '../../../core/types';

export function bindImagePreview(imageEl: HTMLImageElement, onPreview: (image: HTMLImageElement) => void): void {
  imageEl.classList.add('claudian-message-image-previewable');
  imageEl.setAttribute('role', 'button');
  imageEl.setAttribute('tabindex', '0');
  imageEl.setAttribute('aria-label', t('chat.images.previewNamed', { name: imageEl.alt || t('chat.images.image') }));
  const preview = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onPreview(imageEl);
  };
  imageEl.addEventListener('click', preview);
  imageEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') preview(event);
  });
}

function getFocusableActiveElement(ownerDocument: Document): HTMLElement | null {
  const activeElement = ownerDocument.activeElement;
  if (!activeElement || typeof (activeElement as HTMLElement).focus !== 'function') {
    return null;
  }
  return activeElement as HTMLElement;
}

/** Owns the DOM and focus lifecycle of one open image preview. */
export class ImagePreviewModal {
  private closeCurrent: (() => void) | null = null;

  constructor(private readonly app?: Pick<App, 'keymap' | 'scope'>) {}

  open(ownerDocument: Document, image: ImageAttachment): void {
    this.openSource(ownerDocument, `data:${image.mediaType};base64,${image.data}`, image.name);
  }

  openSource(ownerDocument: Document, src: string, name: string): void {
    this.close();

    const keyboardWindow = ownerDocument.defaultView;
    const keymap = this.app?.keymap;
    const scope = keymap ? new Scope(this.app?.scope) : null;
    const addKeyboardListener = (handler: (event: KeyboardEvent) => void) => {
      if (keyboardWindow) {
        keyboardWindow.addEventListener('keydown', handler, true);
      } else {
        ownerDocument.addEventListener('keydown', handler, true);
      }
    };
    const removeKeyboardListener = (handler: (event: KeyboardEvent) => void) => {
      if (keyboardWindow) {
        keyboardWindow.removeEventListener('keydown', handler, true);
      } else {
        ownerDocument.removeEventListener('keydown', handler, true);
      }
    };
    const previouslyFocusedElement = getFocusableActiveElement(ownerDocument);
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('chat.images.preview', { name }));

    modal.createEl('img', {
      attr: {
        src,
        alt: name,
      },
    });

    const closeButton = modal.createEl('button', {
      cls: 'claudian-image-modal-close',
      attr: {
        'aria-label': t('chat.images.close'),
        type: 'button',
      },
    });
    closeButton.setText('\u00D7');

    let isClosed = false;
    const close = () => {
      if (isClosed) return;
      isClosed = true;
      removeKeyboardListener(handleKeyDown);
      if (scope) keymap?.popScope(scope);
      overlay.remove();
      if (this.closeCurrent === close) {
        this.closeCurrent = null;
      }
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeButton.focus();
      }
    };

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    // Obsidian's key handler can run before DOM listeners registered by this
    // preview. Own Escape in its keymap so the chat scope cannot cancel a turn.
    if (scope) {
      scope.register([], 'Escape', (event) => {
        if (event.isComposing) return;
        handleKeyDown(event);
        return false;
      });
      keymap?.pushScope(scope);
    }
    addKeyboardListener(handleKeyDown);
    this.closeCurrent = close;
    closeButton.focus();
  }

  close(): void {
    this.closeCurrent?.();
  }
}
