import type {
  ProviderApprovalInteractionRequest,
  ProviderApprovalInteractionResponse,
  ProviderInteractionDismissReason,
  ProviderInteractionPort,
  ProviderPlanInteractionRequest,
  ProviderPlanInteractionResponse,
  ProviderQuestionInteractionRequest,
  ProviderQuestionInteractionResponse,
} from '@/core/execution/ProviderInteractionPort';
import type { AskUserAnswers } from '@/core/types';

export type PlanApprovalDecision =
  | { type: 'implement' }
  | { type: 'revise'; text: string }
  | { type: 'cancel' };

export interface LocalPlanInteractionRequest {
  readonly kind: 'local-plan';
  readonly interactionId: string;
}

export interface LocalPlanInteractionResponse {
  readonly interactionId: string;
  readonly decision: PlanApprovalDecision | null;
  readonly invalidated: boolean;
}

export interface AsyncQuestionInteractionRequest {
  readonly kind: 'async-question';
  readonly interactionId: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** Delivery must succeed before the widget can acknowledge the answer. */
  readonly onSubmit: (answers: AskUserAnswers) => Promise<void>;
}

export interface AsyncQuestionInteractionResponse {
  readonly interactionId: string;
  readonly answers: AskUserAnswers | null;
}

export interface ChatInteractionPresentation extends ProviderInteractionPort {
  requestAsyncQuestion(request: AsyncQuestionInteractionRequest, signal: AbortSignal): Promise<AsyncQuestionInteractionResponse>;
  requestLocalPlanApproval(request: LocalPlanInteractionRequest, signal: AbortSignal): Promise<LocalPlanInteractionResponse>;
}

export type PendingChatInteraction =
  | ProviderApprovalInteractionRequest
  | ProviderQuestionInteractionRequest
  | ProviderPlanInteractionRequest
  | LocalPlanInteractionRequest
  | AsyncQuestionInteractionRequest;

type InteractionResponse =
  | ProviderApprovalInteractionResponse
  | ProviderQuestionInteractionResponse
  | ProviderPlanInteractionResponse
  | LocalPlanInteractionResponse
  | AsyncQuestionInteractionResponse;

interface PendingEntry {
  request: PendingChatInteraction;
  signal: AbortSignal;
  submitting?: boolean;
  abort: () => void;
  resolve: (response: InteractionResponse) => void;
  reject: (error: Error) => void;
}

interface Presentation {
  port: ChatInteractionPresentation;
  active: { entry: PendingEntry; controller: AbortController } | null;
}

/** Owns request promises independently of the optional, replaceable presentation. */
export class PendingChatInteractions implements ProviderInteractionPort {
  private readonly entries = new Map<string, PendingEntry>();
  private presentation: Presentation | null = null;

  constructor(private readonly onPendingChange: (id: string, pending: boolean) => void = () => undefined) {}

  get pending(): readonly PendingChatInteraction[] {
    return [...this.entries.values()].map(entry => entry.request);
  }

  attachPresentation(port: ChatInteractionPresentation): () => void {
    this.detachPresentation();
    const presentation: Presentation = { port, active: null };
    this.presentation = presentation;
    this.presentNext();
    return () => {
      if (this.presentation === presentation) this.detachPresentation();
    };
  }

  requestApproval(request: ProviderApprovalInteractionRequest, signal: AbortSignal): Promise<ProviderApprovalInteractionResponse> {
    return this.enqueue(request, signal);
  }

  askUserQuestion(request: ProviderQuestionInteractionRequest, signal: AbortSignal): Promise<ProviderQuestionInteractionResponse> {
    return this.enqueue(request, signal);
  }

  requestPlanDecision(request: ProviderPlanInteractionRequest, signal: AbortSignal): Promise<ProviderPlanInteractionResponse> {
    return this.enqueue(request, signal);
  }

  requestAsyncQuestion(request: AsyncQuestionInteractionRequest, signal: AbortSignal): Promise<AsyncQuestionInteractionResponse> {
    return this.enqueue(request, signal);
  }

  requestLocalPlanApproval(request: LocalPlanInteractionRequest, signal: AbortSignal): Promise<LocalPlanInteractionResponse> {
    return this.enqueue(request, signal);
  }

  dismissInteraction(id: string, reason: ProviderInteractionDismissReason): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.finish(entry, this.cancelledResponse(entry.request), undefined, reason);
  }

  dismissAll(reason: ProviderInteractionDismissReason): void {
    for (const id of [...this.entries.keys()]) this.dismissInteraction(id, reason);
  }

  private enqueue<T extends InteractionResponse>(request: PendingChatInteraction, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.resolve(this.cancelledResponse(request) as T);
    if (this.entries.has(request.interactionId)) return Promise.reject(new Error(`Duplicate provider interaction: ${request.interactionId}`));
    return new Promise<T>((resolve, reject) => {
      const entry: PendingEntry = {
        request, signal, reject,
        resolve: response => resolve(response as T),
        abort: () => this.dismissInteraction(request.interactionId, 'cancelled'),
      };
      this.entries.set(request.interactionId, entry);
      signal.addEventListener('abort', entry.abort, { once: true });
      this.onPendingChange(request.interactionId, true);
      this.presentNext();
    });
  }

  private detachPresentation(): void {
    const presentation = this.presentation;
    this.presentation = null;
    if (!presentation?.active) return;
    const { entry, controller } = presentation.active;
    presentation.active = null;
    controller.abort();
    presentation.port.dismissInteraction(entry.request.interactionId, 'superseded');
  }

  private presentNext(): void {
    const presentation = this.presentation;
    if (!presentation || presentation.active) return;
    const entry = this.entries.values().next().value;
    if (!entry) return;
    const active = { entry, controller: new AbortController() };
    presentation.active = active;
    const isCurrent = () => this.presentation === presentation && presentation.active === active
      && this.entries.get(entry.request.interactionId) === entry;
    let response: Promise<InteractionResponse>;
    try {
      const request = entry.request;
      switch (request.kind) {
        case 'approval': response = presentation.port.requestApproval(request, active.controller.signal); break;
        case 'question': response = presentation.port.askUserQuestion(request, active.controller.signal); break;
        case 'plan-decision': response = presentation.port.requestPlanDecision(request, active.controller.signal); break;
        case 'async-question':
          response = presentation.port.requestAsyncQuestion({
            ...request,
            onSubmit: async answers => {
              if (!isCurrent() || entry.signal.aborted) throw new Error('This question is no longer active.');
              if (entry.submitting) throw new Error('The answer is already being sent.');
              entry.submitting = true;
              try {
                await request.onSubmit(answers);
                // Accepted delivery belongs to the request, even if its widget was replaced.
                this.finish(entry, { interactionId: request.interactionId, answers });
              } finally { entry.submitting = false; }
            },
          }, active.controller.signal);
          break;
        case 'local-plan': response = presentation.port.requestLocalPlanApproval(request, active.controller.signal); break;
      }
    } catch (error) {
      response = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void response.then(result => {
      if (!isCurrent()) return;
      if (result.interactionId !== entry.request.interactionId) {
        this.finish(entry, undefined, new Error('Provider interaction response identity does not match its request.'));
      } else this.finish(entry, result);
    }, error => {
      if (isCurrent()) this.finish(entry, undefined, error instanceof Error ? error : new Error(String(error)));
    });
  }

  private finish(entry: PendingEntry, response?: InteractionResponse, error?: Error, reason: ProviderInteractionDismissReason = 'resolved'): void {
    if (this.entries.get(entry.request.interactionId) !== entry) return;
    this.entries.delete(entry.request.interactionId);
    entry.signal.removeEventListener('abort', entry.abort);
    const presentation = this.presentation;
    if (presentation?.active?.entry === entry) {
      const active = presentation.active;
      presentation.active = null;
      active.controller.abort();
      presentation.port.dismissInteraction(entry.request.interactionId, reason);
    }
    this.onPendingChange(entry.request.interactionId, false);
    if (error) entry.reject(error);
    else entry.resolve(response!);
    // Let the settled turn apply plan/settings changes before showing the next request.
    void Promise.resolve().then(() => this.presentNext());
  }

  private cancelledResponse(request: PendingChatInteraction): InteractionResponse {
    if (request.kind === 'local-plan') return { interactionId: request.interactionId, decision: null, invalidated: true };
    if (request.kind === 'question' || request.kind === 'async-question') return { interactionId: request.interactionId, answers: null };
    if (request.kind === 'approval') return { interactionId: request.interactionId, decision: 'cancel' };
    return { interactionId: request.interactionId, decision: null };
  }
}
