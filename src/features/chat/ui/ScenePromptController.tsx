import type { ComposerInputElement } from '@/shared/components/ComposerInput';
import { createPreactRoot } from '@/shared/ui/PreactRoot';

import { dispatchComposerInputEvent } from './ComposerInputEvents';
import { ScenePromptView } from './ScenePromptView';

export interface ScenePromptContext {
  hasSelection: boolean;
  hasCurrentNote: boolean;
  hasMessages: boolean;
}

export class ScenePromptController {
  private readonly host: HTMLElement;
  private readonly root: ReturnType<typeof createPreactRoot>;
  private readonly observer: MutationObserver | null;

  constructor(container: HTMLElement, private readonly input: ComposerInputElement, messages: HTMLElement,
    private readonly getContext: () => ScenePromptContext) {
    this.host = container.createDiv();
    container.insertBefore(this.host, container.firstChild);
    this.root = createPreactRoot(this.host);
    input.addEventListener('input', this.refresh);
    const Observer = container.ownerDocument.defaultView?.MutationObserver;
    this.observer = Observer ? new Observer(this.refresh) : null;
    this.observer?.observe(messages, { childList: true });
    this.refresh();
  }

  readonly refresh = (): void => {
    this.root.render(<ScenePromptView {...this.getContext()} draft={this.input.value} onChoose={this.choose} />);
  };

  destroy(): void {
    this.observer?.disconnect();
    this.input.removeEventListener('input', this.refresh);
    this.root.unmount();
    this.host.remove();
  }

  private readonly choose = (prompt: string): void => {
    if (this.input.value || this.getContext().hasMessages) return;
    this.input.value = prompt;
    this.input.setSelectionRange(prompt.length, prompt.length);
    dispatchComposerInputEvent(this.input);
    this.input.focus();
  };
}
