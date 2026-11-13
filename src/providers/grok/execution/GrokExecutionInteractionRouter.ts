import type {
  ProviderInteractionDismissReason,
  ProviderInteractionPort,
} from '../../../core/execution';
import { t } from '../../../i18n/i18n';

function getPlanPresentation() {
  return {
    allowAbandon: true,
    allowNewSession: false,
    approveLabel: t('chat.planApproval.implement'),
    dismissOnEscape: false,
    feedbackLabel: t('chat.planApproval.revise'),
    shiftTabDecision: 'abandon',
  } as const;
}

interface GrokQuestionOption {
  readonly description: string;
  readonly id?: string;
  readonly label: string;
  readonly preview?: string;
}

interface GrokQuestion {
  readonly id?: string;
  readonly multiSelect: boolean;
  readonly options: readonly GrokQuestionOption[];
  readonly question: string;
}

/** Grok's label for the typed answer every question offers. */
const OTHER_LABEL = 'Other';

export class GrokExecutionInteractionRouter {
  private sequence = 0;
  private readonly pending = new Map<string, AbortController>();
  private readonly detachCaller = new Map<string, () => void>();

  constructor(
    private readonly interactionPort: ProviderInteractionPort,
    private readonly sessionInstanceId: string,
    private readonly getTurnId: () => string | null,
    private readonly getSessionId: () => string | undefined,
  ) {}

  async handle(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const normalized = method.startsWith('_x.ai/') ? method.slice(1) : method;
    if (normalized === 'x.ai/ask_user_question') {
      return this.handleQuestion(params, signal);
    }
    if (normalized === 'x.ai/exit_plan_mode') {
      return this.handlePlan(params, signal);
    }
    throw new Error(`Unsupported Grok Build server request: ${method}`);
  }

  dismissAll(reason: ProviderInteractionDismissReason): void {
    for (const [interactionId, controller] of this.pending) {
      this.interactionPort.dismissInteraction(interactionId, reason);
      controller.abort();
    }
    for (const detach of this.detachCaller.values()) detach();
    this.detachCaller.clear();
    this.pending.clear();
  }

  private async handleQuestion(params: unknown, signal?: AbortSignal): Promise<unknown> {
    const turnId = this.getTurnId();
    const request = parseQuestionRequest(params, this.getSessionId());
    if (!turnId || !request || signal?.aborted) return { outcome: 'cancelled' };
    const interactionId = this.nextId('question');
    const controller = this.begin(interactionId, signal);
    let dismissReason: ProviderInteractionDismissReason = 'cancelled';
    try {
      const response = await this.interactionPort.askUserQuestion({
        input: {
          questions: request.questions.map((question, index) => ({
            header: `Q${index + 1}`,
            ...(question.id ? { id: question.id } : {}),
            // Grok gives every question a typed "Other" answer.
            isOther: true,
            multiSelect: question.multiSelect,
            options: question.options.map(option => ({
              description: option.description,
              label: option.label,
              ...(option.id ? { value: option.id } : {}),
            })),
            question: question.question,
          })),
        },
        interactionId,
        kind: 'question',
        nativeContext: { sessionId: request.sessionId, toolCallId: request.toolCallId },
        sessionInstanceId: this.sessionInstanceId,
        turnId,
      }, controller.signal);
      if (response.interactionId !== interactionId || this.getTurnId() !== turnId) {
        dismissReason = 'native-rejected';
        return { outcome: 'cancelled' };
      }
      dismissReason = 'resolved';
      return response.answers
        ? buildQuestionResponse(request.questions, response.answers)
        : { outcome: 'cancelled' };
    } catch {
      return { outcome: 'cancelled' };
    } finally {
      this.finish(interactionId, dismissReason);
    }
  }

  private async handlePlan(params: unknown, signal?: AbortSignal): Promise<unknown> {
    const turnId = this.getTurnId();
    if (!turnId || !matchesSession(params, this.getSessionId()) || signal?.aborted) {
      return { outcome: 'cancelled' };
    }
    const record = params as Record<string, unknown>;
    const interactionId = this.nextId('plan');
    const controller = this.begin(interactionId);
    let dismissReason: ProviderInteractionDismissReason = 'cancelled';
    try {
      const response = await this.interactionPort.requestPlanDecision({
        input: typeof record.planContent === 'string'
          ? { planContent: record.planContent }
          : {},
        interactionId,
        kind: 'plan-decision',
        nativeContext: { sessionId: record.sessionId, toolCallId: record.toolCallId },
        presentation: getPlanPresentation(),
        sessionInstanceId: this.sessionInstanceId,
        turnId,
      }, controller.signal);
      if (response.interactionId !== interactionId || this.getTurnId() !== turnId) {
        dismissReason = 'native-rejected';
        return { outcome: 'cancelled' };
      }
      dismissReason = 'resolved';
      switch (response.decision?.type) {
        case 'approve':
          return { outcome: 'approved' };
        case 'abandon':
          return { outcome: 'abandoned' };
        case 'feedback':
          return response.decision.text.trim()
            ? { feedback: response.decision.text.trim(), outcome: 'cancelled' }
            : { outcome: 'cancelled' };
        default:
          return { outcome: 'cancelled' };
      }
    } catch {
      return { outcome: 'cancelled' };
    } finally {
      this.finish(interactionId, dismissReason);
    }
  }

  private nextId(kind: string): string {
    return `${this.sessionInstanceId}:${kind}:${++this.sequence}`;
  }

  private begin(interactionId: string, signal?: AbortSignal): AbortController {
    this.dismissAll('superseded');
    const controller = new AbortController();
    if (signal?.aborted) {
      controller.abort();
      return controller;
    }
    if (signal) {
      const onCallerAbort = (): void => {
        this.finish(interactionId, 'cancelled');
        controller.abort();
      };
      signal.addEventListener('abort', onCallerAbort, { once: true });
      this.detachCaller.set(interactionId, () => signal.removeEventListener('abort', onCallerAbort));
    }
    this.pending.set(interactionId, controller);
    return controller;
  }

  private finish(
    interactionId: string,
    reason: ProviderInteractionDismissReason,
  ): void {
    const detachCaller = this.detachCaller.get(interactionId);
    this.detachCaller.delete(interactionId);
    detachCaller?.();
    if (!this.pending.has(interactionId)) return;
    this.pending.delete(interactionId);
    this.interactionPort.dismissInteraction(interactionId, reason);
  }
}

function parseQuestionRequest(
  value: unknown,
  sessionId: string | undefined,
): { questions: GrokQuestion[]; sessionId: string; toolCallId: string } | null {
  if (!matchesSession(value, sessionId)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.toolCallId !== 'string' || !Array.isArray(record.questions)) return null;
  const questions: GrokQuestion[] = [];
  for (const value of record.questions) {
    if (!isRecord(value) || typeof value.question !== 'string' || !Array.isArray(value.options)) {
      return null;
    }
    const options: GrokQuestionOption[] = [];
    for (const option of value.options) {
      if (!isRecord(option) || typeof option.label !== 'string') return null;
      options.push({
        description: typeof option.description === 'string' ? option.description : '',
        ...(typeof option.id === 'string' ? { id: option.id } : {}),
        label: option.label,
        ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
      });
    }
    questions.push({
      ...(typeof value.id === 'string' ? { id: value.id } : {}),
      multiSelect: value.multiSelect === true,
      options,
      question: value.question,
    });
  }
  return {
    questions,
    sessionId: sessionId!,
    toolCallId: record.toolCallId,
  };
}

function buildQuestionResponse(
  questions: readonly GrokQuestion[],
  rawAnswers: Record<string, string | string[]>,
): Record<string, unknown> {
  const answers: Record<string, string[]> = {};
  const annotations: Record<string, { notes?: string; preview?: string }> = {};
  for (const question of questions) {
    const key = question.id ?? question.question;
    const values = (Object.hasOwn(rawAnswers, key) ? rawAnswers[key] : undefined)
      ?? (Object.hasOwn(rawAnswers, question.question) ? rawAnswers[question.question] : undefined);
    if (values === undefined) continue;
    const selected: GrokQuestionOption[] = [];
    const typed: string[] = [];
    for (const value of (Array.isArray(values) ? values : [values]).filter(Boolean)) {
      const option = question.options.find(entry => entry.id === value || entry.label === value);
      if (option) selected.push(option);
      else typed.push(value);
    }
    if (selected.length === 0 && typed.length === 0) continue;
    setOwn(answers, question.question, selected.length > 0 ? selected.map(option => option.label) : [OTHER_LABEL]);
    const preview = !question.multiSelect && selected.length === 1 && typed.length === 0 ? selected[0].preview : undefined;
    const notes = typed.join('\n');
    if (preview || notes) {
      setOwn(annotations, question.question, { ...(preview ? { preview } : {}), ...(notes ? { notes } : {}) });
    }
  }
  return {
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    answers,
    outcome: 'accepted',
  };
}

/** Question text is native data and may be a prototype name such as `__proto__`. */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

function matchesSession(value: unknown, sessionId: string | undefined): boolean {
  return isRecord(value) && typeof value.sessionId === 'string' && value.sessionId === sessionId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
