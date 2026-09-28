import { TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { AskUserAnswers, ToolCallInfo } from '../../../core/types';

interface PendingQuestion {
  tool: ToolCallInfo;
  abort: AbortController;
  conversationId: string | null;
}

export interface AsyncQuestionPromptsDeps {
  showQuestion: (
    tool: ToolCallInfo,
    signal: AbortSignal,
    onSubmit: (answers: AskUserAnswers) => Promise<void>,
  ) => Promise<AskUserAnswers | null>;
  answer: (tool: ToolCallInfo, answers: AskUserAnswers, conversationId: string | null) => Promise<void>;
  onChange: (tool: ToolCallInfo) => void;
  onPendingChange: (interactionId: string, pending: boolean) => void;
  getConversationId: () => string | null;
}

/** Tracks live async provider questions and presents one inline prompt at a time. */
export class AsyncQuestionPrompts {
  private readonly pending = new Map<string, PendingQuestion>();
  private readonly queue: string[] = [];
  private activeId: string | null = null;

  constructor(private readonly deps: AsyncQuestionPromptsDeps) {}

  update(tool: ToolCallInfo): void {
    if (tool.name !== TOOL_ASK_USER_QUESTION || tool.input.replyMode !== 'user-message') return;

    const current = this.pending.get(tool.id);
    const expired = tool.questionStatus === 'expired' || tool.status === 'error' || tool.status === 'blocked';
    if (current) {
      current.tool = tool;
      if (expired || tool.resolvedAnswers) this.finish(tool.id, current, !tool.resolvedAnswers);
      return;
    }
    if (expired || tool.resolvedAnswers || !Array.isArray(tool.input.questions) || tool.input.questions.length === 0) return;

    const entry = { tool, abort: new AbortController(), conversationId: this.deps.getConversationId() };
    this.pending.set(tool.id, entry);
    tool.questionStatus = 'pending';
    this.deps.onPendingChange(this.interactionId(tool.id), true);
    this.deps.onChange(tool);
    this.queue.push(tool.id);
    this.showNext();
  }

  expireAll(): void {
    for (const [id, entry] of [...this.pending]) this.finish(id, entry, true);
  }

  private showNext(): void {
    if (this.activeId) return;
    while (this.queue.length > 0) {
      const id = this.queue.shift();
      const entry = id ? this.pending.get(id) : undefined;
      if (!id || !entry) continue;
      this.activeId = id;
      void this.deps.showQuestion(entry.tool, entry.abort.signal, answers => (
        this.deps.answer(entry.tool, answers, entry.conversationId)
      )).then((answers) => {
        if (this.pending.get(id) !== entry) return;
        if (answers) {
          entry.tool.resolvedAnswers = answers;
          this.finish(id, entry, false);
        } else {
          this.finish(id, entry, true);
        }
      }).catch(() => {
        if (this.pending.get(id) === entry) this.finish(id, entry, true);
      }).finally(() => {
        if (this.activeId === id) this.activeId = null;
        this.showNext();
      });
      return;
    }
  }

  private finish(id: string, entry: PendingQuestion, expired: boolean): void {
    if (this.pending.get(id) !== entry) return;
    this.pending.delete(id);
    if (expired && !entry.tool.resolvedAnswers) entry.tool.questionStatus = 'expired';
    else entry.tool.questionStatus = undefined;
    entry.abort.abort();
    this.deps.onPendingChange(this.interactionId(id), false);
    this.deps.onChange(entry.tool);
    if (this.activeId !== id) this.showNext();
  }

  private interactionId(id: string): string {
    return `async-question:${id}`;
  }
}
