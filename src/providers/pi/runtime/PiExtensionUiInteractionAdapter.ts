import type { ProviderInteractionPort } from '../../../core/execution';
import type { AskUserQuestionOption } from '../../../core/types';
import type {
  PiExtensionUiConfirmRequest,
  PiExtensionUiEditorRequest,
  PiExtensionUiInputRequest,
  PiExtensionUiNotifyRequest,
  PiExtensionUiRenderer,
  PiExtensionUiSelectRequest,
  PiExtensionUiSetEditorTextRequest,
  PiExtensionUiSetStatusRequest,
  PiExtensionUiSetTitleRequest,
  PiExtensionUiSetWidgetRequest,
} from './PiExtensionUiBridge';

export type { PiExtensionUiRenderer } from './PiExtensionUiBridge';

interface PiExtensionUiInteractionAdapterOptions {
  readonly getTurnId: () => string | null;
  readonly interactionPort: ProviderInteractionPort;
  readonly sessionInstanceId: string;
}

/**
 * Keeps Pi extension RPC semantics provider-owned while routing select prompts
 * through the provider-neutral chat interaction presentation.
 */
export class PiExtensionUiInteractionAdapter implements PiExtensionUiRenderer {
  constructor(
    private readonly fallback: PiExtensionUiRenderer,
    private readonly options: PiExtensionUiInteractionAdapterOptions,
  ) {}

  async select(
    request: PiExtensionUiSelectRequest,
    signal: AbortSignal,
  ): Promise<{ cancelled?: boolean; value?: string }> {
    const turnId = this.options.getTurnId();
    if (!turnId) {
      return { cancelled: true };
    }

    const question = createQuestion(request);
    if (!question) {
      return this.fallback.select(request, signal);
    }

    const response = await this.options.interactionPort.askUserQuestion({
      kind: 'question',
      interactionId: createInteractionId(this.options.sessionInstanceId, request.id),
      input: { questions: [question] },
      nativeContext: { extensionRequestId: request.id },
      sessionInstanceId: this.options.sessionInstanceId,
      turnId,
    }, signal);
    const answer = response.answers?.[question.id];
    const value = typeof answer === 'string' ? answer : null;
    return value === null ? { cancelled: true } : { value };
  }

  confirm(
    request: PiExtensionUiConfirmRequest,
    signal: AbortSignal,
  ): Promise<{ cancelled?: boolean; confirmed?: boolean }> {
    return this.fallback.confirm(request, signal);
  }

  editor(
    request: PiExtensionUiEditorRequest,
    signal: AbortSignal,
  ): Promise<{ cancelled?: boolean; value?: string }> {
    return this.fallback.editor(request, signal);
  }

  input(
    request: PiExtensionUiInputRequest,
    signal: AbortSignal,
  ): Promise<{ cancelled?: boolean; value?: string }> {
    return this.fallback.input(request, signal);
  }

  notify(request: PiExtensionUiNotifyRequest): void {
    this.fallback.notify(request);
  }

  setEditorText(request: PiExtensionUiSetEditorTextRequest): void {
    this.fallback.setEditorText(request);
  }

  setStatus(request: PiExtensionUiSetStatusRequest): void {
    this.fallback.setStatus(request);
  }

  setTitle(request: PiExtensionUiSetTitleRequest): void {
    this.fallback.setTitle(request);
  }

  setWidget(request: PiExtensionUiSetWidgetRequest): void {
    this.fallback.setWidget(request);
  }
}

function createInteractionId(sessionInstanceId: string, requestId: string): string {
  return `pi-extension:${sessionInstanceId}:${requestId}`;
}

function createQuestion(request: PiExtensionUiSelectRequest): {
  header: string;
  id: string;
  isOther: false;
  multiSelect: false;
  options: AskUserQuestionOption[];
  question: string;
} | null {
  const options = getOptions(request);
  if (options.length === 0) {
    return null;
  }

  const title = getString(request.title) ?? 'Pi extension';
  return {
    header: title,
    id: `pi-extension-ui-${request.id}`,
    isOther: false,
    multiSelect: false,
    options,
    question: getString(request.message) ?? title,
  };
}

function getOptions(request: Record<string, unknown>): AskUserQuestionOption[] {
  const rawOptions = Array.isArray(request.options) ? request.options : [];
  return rawOptions.flatMap((option): AskUserQuestionOption[] => {
    if (typeof option === 'string' && option.trim()) {
      const value = option.trim();
      return [{ description: '', label: value, value }];
    }
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      return [];
    }

    const record = option as Record<string, unknown>;
    const value = getString(record.value);
    if (!value) {
      return [];
    }
    return [{ description: '', label: getString(record.label) ?? value, value }];
  });
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
