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
  private pendingCustomInputValue: string | null = null;

  constructor(
    private readonly fallback: PiExtensionUiRenderer,
    private readonly options: PiExtensionUiInteractionAdapterOptions,
  ) {}

  async select(
    request: PiExtensionUiSelectRequest,
    signal: AbortSignal,
  ): Promise<{ cancelled?: boolean; value?: string }> {
    this.pendingCustomInputValue = null;
    const turnId = this.options.getTurnId();
    if (!turnId) {
      return { cancelled: true };
    }

    const presentation = createQuestionPresentation(request);
    if (!presentation) {
      return this.fallback.select(request, signal);
    }

    const response = await this.options.interactionPort.askUserQuestion({
      kind: 'question',
      interactionId: createInteractionId(this.options.sessionInstanceId, request.id),
      input: { questions: [presentation.question] },
      nativeContext: { extensionRequestId: request.id },
      sessionInstanceId: this.options.sessionInstanceId,
      turnId,
    }, signal);
    const answer = response.answers?.[presentation.question.id];
    const value = typeof answer === 'string' ? answer : null;
    if (value === null) {
      return { cancelled: true };
    }
    if (
      presentation.customInputOptionValue
      && !presentation.optionValues.has(value)
    ) {
      this.pendingCustomInputValue = value;
      return { value: presentation.customInputOptionValue };
    }
    return { value };
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
    const pendingCustomInputValue = this.pendingCustomInputValue;
    this.pendingCustomInputValue = null;
    if (pendingCustomInputValue !== null) {
      return Promise.resolve(signal.aborted
        ? { cancelled: true }
        : { value: pendingCustomInputValue });
    }
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

interface PiSelectQuestionPresentation {
  readonly customInputOptionValue: string | null;
  readonly optionValues: ReadonlySet<string>;
  readonly question: {
  header: string;
  id: string;
  isOther: boolean;
  multiSelect: false;
  options: AskUserQuestionOption[];
  question: string;
  };
}

function createQuestionPresentation(
  request: PiExtensionUiSelectRequest,
): PiSelectQuestionPresentation | null {
  const options = getOptions(request);
  const customInputOption = options.find(isCustomInputOption) ?? null;
  const visibleOptions = customInputOption
    ? options.filter(option => option !== customInputOption)
    : options;
  if (visibleOptions.length === 0 && !customInputOption) {
    return null;
  }

  const title = getString(request.title) ?? 'Pi extension';
  return {
    customInputOptionValue: customInputOption?.value ?? null,
    optionValues: new Set(visibleOptions.map(option => option.value ?? option.label)),
    question: {
      header: title,
      id: `pi-extension-ui-${request.id}`,
      isOther: customInputOption !== null,
      multiSelect: false,
      options: visibleOptions,
      question: getString(request.message) ?? title,
    },
  };
}

function isCustomInputOption(option: AskUserQuestionOption): boolean {
  return option.label.trim().toLowerCase() === 'type something.';
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
