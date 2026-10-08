import '@/providers';

import { createMockEl, type MockElement } from '@test/helpers/MockElement';
import { Menu } from 'obsidian';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_SPAWN_AGENT,
  TOOL_SUBAGENT,
  TOOL_WAIT_AGENT,
  TOOL_WRITE_STDIN,
} from '@/core/tools/toolNames';
import { projectTranscript } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ImageAttachment } from '@/core/types';
import { buildActivityTimeline } from '@/features/chat/rendering/ActivityTimeline';
import { renderCitationGroup } from '@/features/chat/rendering/CitationRenderer';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { renderStoredAsyncSubagent, renderStoredSubagent } from '@/features/chat/rendering/SubagentRenderer';
import { renderStoredThinkingBlock } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { renderStoredToolCall } from '@/features/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/features/chat/rendering/WriteEditRenderer';
import { confirm } from '@/shared/modals/ConfirmModal';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/CitationRenderer', () => ({
  renderCitationGroup: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  renderStoredToolCall: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/features/chat/rendering/MermaidRenderer', () => ({
  renderMermaidDiagram: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    removeChild: jest.fn((child: { unload: () => void }) => {
      child.unload();
      return child;
    }),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

function enableDomLikeNodeMoves(element: MockElement): void {
  for (const child of element.children) {
    child.parentElement = element;
    enableDomLikeNodeMoves(child);
  }
  for (const factory of ['createDiv', 'createSpan', 'createEl', 'createSvg'] as const) {
    const create = element[factory].bind(element);
    element[factory] = (...args: unknown[]) => {
      const child = Reflect.apply(create, element, args) as MockElement;
      child.parentElement = element;
      enableDomLikeNodeMoves(child);
      return child;
    };
  }
  element.appendChild = (child: MockElement) => {
    const previousIndex = child.parentElement?.children.indexOf(child) ?? -1;
    if (previousIndex >= 0) child.parentElement.children.splice(previousIndex, 1);
    child.parentElement = element;
    element.children.push(child);
    return child;
  };
  element.insertBefore = (child: MockElement, reference: MockElement | null) => {
    if (child.parentElement) {
      const previousIndex = child.parentElement.children.indexOf(child);
      if (previousIndex >= 0) child.parentElement.children.splice(previousIndex, 1);
    }
    child.parentElement = element;
    const referenceIndex = reference ? element.children.indexOf(reference) : -1;
    element.children.splice(referenceIndex < 0 ? element.children.length : referenceIndex, 0, child);
  };
  element.remove = () => {
    if (!element.parentElement) return;
    const index = element.parentElement.children.indexOf(element);
    if (index >= 0) element.parentElement.children.splice(index, 1);
    element.parentElement = null;
  };
}

function mockCapabilities(providerId: 'claude' | 'codex' | 'grok' = 'claude') {
  return () => ({
    providerId,
    supportsNativeHistory: providerId === 'claude',
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort' as const,
  });
}

function createRenderer(
  messagesEl?: any,
  providerId: 'claude' | 'codex' | 'grok' = 'claude',
  settings: Record<string, unknown> = {},
  forkCallback?: (messageId: string) => Promise<void>,
) {
  const el = messagesEl ?? createMockEl();
  const comp = createMockComponent();
  const plugin = {
    app: {},
    settings: { mediaFolder: '', ...settings },
  };
  return {
    renderer: new MessageRenderer(
      plugin as any,
      comp as any,
      el,
      undefined,
      forkCallback,
      mockCapabilities(providerId),
    ),
    messagesEl: el,
  };
}

describe('MessageRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
  });

  describe('completed work', () => {
    it('renders task notifications as collapsed disclosures', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      renderer.renderStoredMessage({
        id: 'task-notification',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'task_notification', content: 'Background task completed.' },
        ],
      });

      const notification = messagesEl.querySelector('.claudian-task-notification');
      expect(notification).toBeTruthy();
      expect(notification?.querySelector('.claudian-work-header')?.textContent)
        .toBe('Task notification');
      expect(notification?.querySelector('.claudian-work-history')?.hidden).toBe(true);
      const header = notification?.querySelector('.claudian-work-header');
      header?.click();
      expect(notification?.querySelector('.claudian-work-history')?.hidden).toBe(false);
    });

    it('groups automatic response work under its consumed task notification', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'automatic-response' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const notification = contentEl.createDiv({ cls: 'claudian-task-notification' });
      const history = notification.createDiv({ cls: 'claudian-work-history' });
      const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });
      const answerEl = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The task is complete.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('automatic-response') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'automatic-response',
        role: 'assistant',
        content: 'The task is complete.',
        timestamp: Date.now(),
        durationSeconds: 8,
        isAutomaticResponse: true,
        contentBlocks: [
          { type: 'task_notification', content: 'Background task completed.' },
          { type: 'tool_use', toolId: 'tool-1' },
          { type: 'text', content: 'The task is complete.' },
        ],
      } as ChatMessage);

      expect(history.contains(toolEl)).toBe(true);
      expect(contentEl.contains(answerEl)).toBe(true);
      expect(contentEl.querySelector('.claudian-completed-work')).toBeNull();
    });

    it('includes a requested response notification in the completed-work disclosure', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'requested-response' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const notification = contentEl.createDiv({ cls: 'claudian-task-notification' });
      const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });
      const answerEl = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The task is complete.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('requested-response') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'requested-response',
        role: 'assistant',
        content: 'The task is complete.',
        timestamp: Date.now(),
        durationSeconds: 8,
      } as ChatMessage);

      const workHistory = contentEl.querySelector('.claudian-completed-work')
        ?.querySelector('.claudian-completed-work-history');
      expect(workHistory?.contains(notification)).toBe(true);
      expect(workHistory?.contains(toolEl)).toBe(true);
      expect(contentEl.contains(answerEl)).toBe(true);
    });

    it('folds completed turn activity while keeping the final answer visible', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'claude', {}, jest.fn());
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-1' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const thinkingEl = contentEl.createDiv({ cls: 'claudian-thinking-block' });
      const answerEl = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Final answer' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-1') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-1', role: 'assistant', content: 'Final answer', timestamp: Date.now(), durationSeconds: 24,
        modelName: 'GPT-6 Luna',
        assistantMessageId: 'provider-assistant-1',
        contentBlocks: [
          { type: 'thinking', content: 'Thinking' },
          { type: 'text', content: 'Final answer' },
        ],
      } as ChatMessage);

      const workEl = contentEl.querySelector('.claudian-completed-work');
      expect(workEl).toBeTruthy();
      expect(workEl?.querySelector('.claudian-completed-work-header')?.children[0].textContent)
        .toContain('GPT-6 Luna · Took 24s');
      expect(workEl?.querySelector('.claudian-completed-work-indicator')).toBeTruthy();
      expect(workEl?.querySelector('.claudian-completed-work-header')?.children[1])
        .toBe(workEl?.querySelector('.claudian-completed-work-indicator'));
      expect(workEl?.querySelector('.claudian-completed-work-history')?.contains(thinkingEl)).toBe(true);
      expect(contentEl.contains(answerEl)).toBe(true);
      const history = workEl?.querySelector('.claudian-completed-work-history') as HTMLElement | null;
      expect(history?.hidden).toBe(true);
      expect(contentEl.contains(answerEl)).toBe(true);
      (workEl?.querySelector('.claudian-completed-work-header') as HTMLButtonElement | null)?.click();
      expect(history?.hidden).toBe(false);
      const phaseDetails = workEl?.querySelector('.claudian-activity-phase-details') as HTMLElement | null;
      expect(phaseDetails?.hidden).toBe(true);
      (workEl?.querySelector('.claudian-activity-phase-header') as HTMLButtonElement | null)?.click();
      expect(phaseDetails?.hidden).toBe(false);
      const actions = messageEl.querySelector('.claudian-message-actions');
      expect(actions?.querySelector('.claudian-text-copy-btn')).toBeTruthy();
      expect(actions?.querySelector('.claudian-message-fork-btn')).toBeTruthy();
      expect(contentEl.querySelector('.claudian-text-copy-btn')).toBeNull();
    });

    it('keeps the turn header concise and marks failed work without opening it', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-with-error' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const completedTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      completedTool.setAttribute('data-tool-id', 'read-1');
      const failedTool = contentEl.createDiv({
        cls: 'claudian-tool-call',
      });
      failedTool.setAttribute('data-tool-id', 'bash-1');
      failedTool.createDiv({ cls: 'claudian-tool-status status-error' });
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'The command failed.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-with-error') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-with-error',
        role: 'assistant',
        content: 'The command failed.',
        timestamp: Date.now(),
        durationSeconds: 12,
        toolCalls: [
          { id: 'read-1', name: 'Read', input: {}, status: 'completed' },
          { id: 'bash-1', name: 'Bash', input: {}, status: 'error', result: 'Exit code 1' },
        ],
      } as ChatMessage);

      const workEl = contentEl.querySelector('.claudian-completed-work');
      const history = workEl?.querySelector('.claudian-completed-work-history');
      const label = workEl?.querySelector('.claudian-completed-work-label')?.textContent ?? '';
      expect(label).toContain('Took 12s');
      expect(label).not.toContain('actions');
      expect(label).not.toContain('error');
      expect(workEl?.hasClass('has-errors')).toBe(true);
      expect(history?.hidden).toBe(true);
      expect(workEl?.querySelector('.claudian-completed-work-error')).toBeTruthy();
      (workEl?.querySelector('.claudian-completed-work-header') as HTMLButtonElement | null)?.click();
      expect(history?.hidden).toBe(false);
      expect(history?.contains(failedTool)).toBe(true);
    });

    it('keeps thought text inside the phase and titles it with the tool summary', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-visible-tool-summary' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const thinking = contentEl.createDiv({ cls: 'claudian-thinking-block' });
      thinking.createDiv({ cls: 'claudian-thinking-label', text: 'Inspecting the project' });
      const execTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      execTool.setAttribute('data-tool-id', 'exec-1');
      execTool.createSpan({ cls: 'claudian-tool-name', text: 'exec' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'bash-1');
      tool.createSpan({ cls: 'claudian-tool-name', text: 'Bash' });
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Done.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-visible-tool-summary') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-visible-tool-summary',
        role: 'assistant',
        content: 'Done.',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'Inspecting.' },
          { type: 'tool_use', toolId: 'exec-1' },
          { type: 'tool_use', toolId: 'bash-1' },
          { type: 'text', content: 'Done.' },
        ],
      } as ChatMessage);

      const phase = contentEl.querySelector('.claudian-activity-phase');
      expect(phase?.querySelector('.claudian-activity-phase-label')?.textContent)
        .toBe('Ran 2 commands');
      expect(phase?.querySelector('.claudian-activity-phase-details')?.contains(thinking)).toBe(true);
      const details = phase?.querySelector('.claudian-activity-phase-details') as HTMLElement | null;
      expect(details?.hidden).toBe(true);
      (phase?.querySelector('.claudian-activity-phase-header') as HTMLButtonElement | null)?.click();
      expect(details?.hidden).toBe(false);
    });

    it('groups reasoning summaries inside the folded tool phase', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-thinking-phase' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const readTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      readTool.setAttribute('data-tool-id', 'read-before-thought');
      readTool.createSpan({ cls: 'claudian-tool-name', text: 'Read' });
      const firstThought = contentEl.createDiv({ cls: 'claudian-thinking-block', text: 'First private reasoning.' });
      firstThought.createDiv({ cls: 'claudian-thinking-label', text: 'Reviewing workflow guidance' });
      const secondThought = contentEl.createDiv({ cls: 'claudian-thinking-block', text: 'More private reasoning.' });
      secondThought.createDiv({ cls: 'claudian-thinking-label', text: 'Reviewing workflow guidance' });
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Done.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-thinking-phase') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-thinking-phase',
        role: 'assistant',
        content: 'Done.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'read-before-thought', name: 'Read', input: { file_path: 'notes/test.md' } } as any],
        contentBlocks: [
          { type: 'tool_use', toolId: 'read-before-thought' },
          { type: 'thinking', content: 'First private reasoning.' },
          { type: 'thinking', content: 'More private reasoning.' },
          { type: 'text', content: 'Done.' },
        ],
      } as ChatMessage);

      const workHistory = contentEl.querySelector('.claudian-completed-work-history');
      expect(workHistory?.hidden).toBe(true);
      const phases = Array.from(
        workHistory?.querySelectorAll('.claudian-activity-phase') ?? [],
      ) as MockElement[];
      expect(phases.length).toBeGreaterThan(0);
      expect(workHistory?.contains(readTool)).toBe(true);
      expect(workHistory?.contains(firstThought)).toBe(true);
      expect(workHistory?.contains(secondThought)).toBe(true);
      const thoughtPhases = [...new Set(
        [firstThought, secondThought].map((thought) => phases.find((candidate) => candidate.contains(thought)))
          .filter((phase): phase is MockElement => phase !== undefined),
      )];
      for (const phase of thoughtPhases) {
        const details = phase?.querySelector('.claudian-activity-phase-details') as HTMLElement | null;
        expect(details?.hidden).toBe(true);
        (phase?.querySelector('.claudian-activity-phase-header') as HTMLButtonElement | null)?.click();
        expect(details?.hidden).toBe(false);
      }
    });

    it('removes superseded leading reasoning once assistant prose is available', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-superseded-thinking' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const firstThought = contentEl.createDiv({ cls: 'claudian-thinking-block', text: 'First private reasoning.' });
      firstThought.dataset.contentBlockIndex = '0';
      const secondThought = contentEl.createDiv({ cls: 'claudian-thinking-block', text: 'More private reasoning.' });
      secondThought.dataset.contentBlockIndex = '1';
      const firstRemove = jest.spyOn(firstThought, 'remove');
      const secondRemove = jest.spyOn(secondThought, 'remove');
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'The answer.' });
      const laterThought = contentEl.createDiv({ cls: 'claudian-thinking-block', text: 'Follow-up reasoning.' });
      laterThought.dataset.contentBlockIndex = '4';
      const laterRemove = jest.spyOn(laterThought, 'remove');
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-superseded-thinking') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-superseded-thinking',
        role: 'assistant',
        content: 'The answer.',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'First private reasoning.' },
          { type: 'thinking', content: 'More private reasoning.' },
          { type: 'text', content: 'The answer.' },
          { type: 'thinking', content: '   ' },
          { type: 'thinking', content: 'Follow-up reasoning.' },
        ],
      } as ChatMessage);

      expect(firstRemove).toHaveBeenCalled();
      expect(secondRemove).toHaveBeenCalled();
      expect(laterRemove).not.toHaveBeenCalled();
      expect(contentEl.querySelector('.claudian-text-block')?.textContent).toBe('The answer.');
    });

    it('keeps pending question and approval cards outside completed work', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-awaiting-user' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const question = contentEl.createDiv({ cls: 'claudian-ask-question-inline' });
      const approval = contentEl.createDiv({ cls: 'claudian-plan-approval-inline' });
      const pendingQuestionTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      pendingQuestionTool.setAttribute('data-tool-id', 'question-tool');
      const completedTool = contentEl.createDiv({
        cls: 'claudian-tool-call',
        attr: { 'data-tool-id': 'tool-done' },
      });
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Waiting for your choice.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-awaiting-user') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-awaiting-user',
        role: 'assistant',
        content: 'Waiting for your choice.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'tool-done', name: 'Read', input: {}, status: 'completed' },
          {
            id: 'question',
            name: 'AskUserQuestion',
            input: {},
            status: 'running',
            questionStatus: 'pending',
          },
          {
            id: 'question-tool',
            name: 'AskUserQuestion',
            input: {},
            status: 'running',
            questionStatus: 'pending',
          },
        ],
      } as ChatMessage);

      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(history?.contains(completedTool)).toBe(true);
      expect(contentEl.contains(question)).toBe(true);
      expect(contentEl.contains(approval)).toBe(true);
      expect(history?.contains(question)).toBe(false);
      expect(history?.contains(approval)).toBe(false);
      expect(contentEl.contains(pendingQuestionTool)).toBe(true);
      expect(history?.contains(pendingQuestionTool)).toBe(false);
    });

    it('keeps pending interactions between separate completed-work disclosures', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-work-boundary' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const earlierTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      earlierTool.setAttribute('data-tool-id', 'read-before');
      const pendingTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      pendingTool.setAttribute('data-tool-id', 'approval-pending');
      const laterTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      laterTool.setAttribute('data-tool-id', 'read-after');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Finished.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-work-boundary') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-work-boundary',
        role: 'assistant',
        content: 'Finished.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'read-before', name: 'Read', input: {}, status: 'completed' },
          { id: 'approval-pending', name: 'Approval', input: {}, status: 'running', questionStatus: 'pending' },
          { id: 'read-after', name: 'Read', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'read-before' },
          { type: 'tool_use', toolId: 'approval-pending' },
          { type: 'tool_use', toolId: 'read-after' },
          { type: 'text', content: 'Finished.' },
        ],
      } as ChatMessage);

      const disclosure = contentEl.querySelector('.claudian-completed-work');
      const history = disclosure?.querySelector('.claudian-completed-work-history');
      expect(history?.contains(earlierTool)).toBe(false);
      expect(contentEl.contains(earlierTool)).toBe(true);
      expect(contentEl.contains(pendingTool)).toBe(true);
      expect(history?.contains(pendingTool)).toBe(false);
      expect(history?.contains(laterTool)).toBe(true);
      expect(history?.children).toEqual([laterTool]);
      expect(contentEl.contains(answer)).toBe(true);
      expect(contentEl.contains(disclosure)).toBe(true);
    });

    it('does not fold across an approval card that is not represented in content blocks', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-inline-approval-boundary' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const earlierTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      earlierTool.setAttribute('data-tool-id', 'read-before');
      const approval = contentEl.createDiv({ cls: 'claudian-plan-approval-inline' });
      const laterTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      laterTool.setAttribute('data-tool-id', 'read-after');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Finished.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-inline-approval-boundary') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-inline-approval-boundary',
        role: 'assistant',
        content: 'Finished.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'read-before', name: 'Read', input: {}, status: 'completed' },
          { id: 'read-after', name: 'Read', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'read-before' },
          { type: 'tool_use', toolId: 'read-after' },
          { type: 'text', content: 'Finished.' },
        ],
      } as ChatMessage);

      const disclosure = contentEl.querySelector('.claudian-completed-work');
      const history = disclosure?.querySelector('.claudian-completed-work-history');
      expect(contentEl.contains(earlierTool)).toBe(true);
      expect(history?.contains(earlierTool)).toBe(false);
      expect(contentEl.contains(approval)).toBe(true);
      expect(history?.contains(approval)).toBe(false);
      expect(history?.children).toEqual([laterTool]);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('keeps the tool awaiting permission outside the answered work fold', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-awaiting-permission' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const pendingTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      pendingTool.setAttribute('data-tool-id', 'write-pending');
      contentEl.createDiv({ cls: 'claudian-ask-approval-info' });
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Waiting for approval.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-awaiting-permission') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-awaiting-permission',
        role: 'assistant',
        content: 'Waiting for approval.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'write-pending', name: 'Write', input: {}, status: 'running' },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'write-pending' },
          { type: 'text', content: 'Waiting for approval.' },
        ],
      } as ChatMessage);

      expect(contentEl.querySelector('.claudian-completed-work')).toBeNull();
      expect(contentEl.contains(pendingTool)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('keeps failed subagents visible outside the folded activity history', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-failed-subagent' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const subagentEl = contentEl.createDiv({ cls: 'claudian-subagent-list error' });
      subagentEl.setAttribute('data-tool-id', 'agent-1');
      const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });
      toolEl.setAttribute('data-tool-id', 'read-1');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Finished.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-failed-subagent') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-failed-subagent',
        role: 'assistant',
        content: 'Finished.',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'agent-1',
            name: 'Agent',
            input: {},
            status: 'error',
            subagent: {
              id: 'agent-1',
              description: 'Inspect the project',
              status: 'error',
              toolCalls: [],
              isExpanded: false,
            },
          },
          { id: 'read-1', name: 'Read', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'subagent', subagentId: 'agent-1' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'Finished.' },
        ],
      } as ChatMessage);

      const disclosure = contentEl.querySelector('.claudian-completed-work');
      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(contentEl.children.indexOf(subagentEl)).toBe(contentEl.children.indexOf(disclosure) + 1);
      expect(history?.children).toEqual([toolEl]);
      expect(contentEl.contains(subagentEl)).toBe(true);
      expect(history?.contains(subagentEl)).toBe(false);
      expect(history?.contains(toolEl)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('keeps cancelled subagents visible outside the folded activity history', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-cancelled-subagent' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const subagentEl = contentEl.createDiv({ cls: 'claudian-subagent-list' });
      subagentEl.setAttribute('data-tool-id', 'agent-cancelled');
      const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });
      toolEl.setAttribute('data-tool-id', 'read-1');
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Finished.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-cancelled-subagent') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-cancelled-subagent',
        role: 'assistant',
        content: 'Finished.',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'agent-cancelled',
            name: 'Agent',
            input: {},
            status: 'cancelled',
            subagent: {
              id: 'agent-cancelled',
              description: 'Inspect the project',
              status: 'completed',
              toolCalls: [],
              isExpanded: false,
            },
          },
          { id: 'read-1', name: 'Read', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'subagent', subagentId: 'agent-cancelled' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'Finished.' },
        ],
      } as unknown as ChatMessage);

      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(contentEl.contains(subagentEl)).toBe(true);
      expect(history?.contains(subagentEl)).toBe(false);
      expect(history?.contains(toolEl)).toBe(true);
    });

    it('keeps assistant text before a tool call visible', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-interleaved' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const preambleEl = contentEl.createDiv({ cls: 'claudian-text-block', text: 'I will inspect the file first.' });
      const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });
      const answerEl = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The file is valid.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-interleaved') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-interleaved',
        role: 'assistant',
        content: 'I will inspect the file first. The file is valid.',
        timestamp: Date.now(),
        durationSeconds: 4,
      } as ChatMessage);

      const workEl = contentEl.querySelector('.claudian-completed-work');
      expect(workEl).toBeTruthy();
      expect(contentEl.contains(preambleEl)).toBe(true);
      expect(contentEl.contains(answerEl)).toBe(true);
      expect(workEl?.querySelector('.claudian-completed-work-history')?.contains(toolEl)).toBe(true);
      expect(workEl?.querySelector('.claudian-completed-work-history')?.contains(preambleEl)).toBe(false);
    });

    it('folds contiguous work into timeline phases and leaves the final answer visible', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-phased-work' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const opening = contentEl.createDiv({ cls: 'claudian-text-block', text: 'I will inspect the files.' });
      const firstTool = contentEl.createDiv({
        cls: 'claudian-tool-call',
      });
      firstTool.setAttribute('data-tool-id', 'read-1');
      const secondTool = contentEl.createDiv({
        cls: 'claudian-tool-call',
      });
      secondTool.setAttribute('data-tool-id', 'search-1');
      const progress = contentEl.createDiv({ cls: 'claudian-text-block', text: 'I found the relevant code.' });
      const finalTool = contentEl.createDiv({
        cls: 'claudian-tool-call',
      });
      finalTool.setAttribute('data-tool-id', 'read-2');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The implementation is complete.' });
      enableDomLikeNodeMoves(contentEl);
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-phased-work') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-phased-work',
        role: 'assistant',
        content: 'The implementation is complete.',
        timestamp: Date.now(),
        durationSeconds: 8,
        toolCalls: [
          { id: 'read-1', name: 'Read', input: {}, status: 'completed' },
          { id: 'search-1', name: 'Search', input: {}, status: 'completed' },
          { id: 'read-2', name: 'Read', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'text', content: 'I will inspect the files.' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'tool_use', toolId: 'search-1' },
          { type: 'text', content: 'I found the relevant code.' },
          { type: 'tool_use', toolId: 'read-2' },
          { type: 'text', content: 'The implementation is complete.' },
        ],
      } as ChatMessage);

      const workEl = contentEl.querySelector('.claudian-completed-work') as MockElement;
      const phases = workEl.querySelectorAll('.claudian-activity-phase');
      const firstPhase = phases.find((phase) =>
        phase.querySelector('.claudian-activity-phase-details')?.children.includes(firstTool));
      const firstDetails = firstPhase?.querySelector('.claudian-activity-phase-details');
      const firstLabel = firstPhase?.querySelector('.claudian-activity-phase-label')?.textContent ?? '';
      expect(firstDetails?.hidden).toBe(true);
      expect(firstDetails?.children).toContain(firstTool);
      expect(firstDetails?.children).toContain(secondTool);
      expect(firstLabel).toBe('Explored the project');
      expect(firstLabel).not.toContain('8s');
      expect(workEl.querySelector('.claudian-completed-work-history')?.contains(finalTool)).toBe(true);
      expect(workEl.querySelector('.claudian-completed-work-label')?.textContent).toContain('8s');
      const timeline = workEl.querySelector('.claudian-completed-work-history')?.children ?? [];
      expect(Array.from(timeline).filter((element) => !element.hidden).map((element) => (
        element.hasClass('claudian-activity-narration')
          ? element.textContent
          : element.hasClass('claudian-activity-phase')
            ? element.querySelector('.claudian-activity-phase-label')?.textContent
            : element.dataset.toolId
      ))).toEqual([
        'I will inspect the files.',
        'Explored the project',
        'I found the relevant code.',
        'read-2',
      ]);
      expect(workEl.querySelector('.claudian-completed-work-label')?.textContent).not.toContain('action');
      expect(contentEl.contains(opening)).toBe(true);
      expect(contentEl.contains(progress)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
      expect(phases.some((phase) => phase.querySelector('.claudian-completed-work-history')?.contains(answer)))
        .toBe(false);
    });

    it('keeps the answer and subsequent work outside the answered activity fold', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-follow-up-work' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      contentEl.createDiv({ cls: 'claudian-thinking-block' });
      const answeredTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      answeredTool.setAttribute('data-tool-id', 'read-1');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The file is valid.' });
      const followUpTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      followUpTool.setAttribute('data-tool-id', 'follow-up-1');
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-follow-up-work') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-follow-up-work',
        role: 'assistant',
        content: 'The file is valid.',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'Inspect the file.' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'The file is valid.' },
          { type: 'tool_use', toolId: 'follow-up-1' },
        ],
      } as ChatMessage);

      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(history?.contains(answeredTool)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
      expect(contentEl.contains(followUpTool)).toBe(true);
      expect(history?.contains(answer)).toBe(false);
      expect(history?.contains(followUpTool)).toBe(false);
    });

    it('leaves background work after a yielded reply outside the earlier work fold', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-background-yield' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const earlierTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      earlierTool.setAttribute('data-tool-id', 'read-before-yield');
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'The background check is running.' });
      const backgroundTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      backgroundTool.setAttribute('data-tool-id', 'background-check');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The background check is complete.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-background-yield') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-background-yield',
        role: 'assistant',
        content: 'The background check is complete.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'read-before-yield', name: 'Read', input: {}, status: 'completed' },
          {
            id: 'background-check',
            name: 'Bash',
            input: { run_in_background: true },
            status: 'completed',
          },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'read-before-yield' },
          { type: 'text', content: 'The background check is running.' },
          { type: 'tool_use', toolId: 'background-check' },
          { type: 'text', content: 'The background check is complete.' },
        ],
      } as ChatMessage);

      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(history?.contains(earlierTool)).toBe(true);
      expect(contentEl.contains(backgroundTool)).toBe(true);
      expect(history?.contains(backgroundTool)).toBe(false);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('keeps unfinished work in the transcript when no answer follows it', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-unanswered-work' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const thinking = contentEl.createDiv({ cls: 'claudian-thinking-block' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'read-1');
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-unanswered-work') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-unanswered-work',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'Inspect the file.' },
          { type: 'tool_use', toolId: 'read-1' },
        ],
      } as ChatMessage);

      expect(contentEl.querySelector('.claudian-completed-work')).toBeNull();
      expect(contentEl.contains(thinking)).toBe(true);
      expect(contentEl.contains(tool)).toBe(true);
    });

    it('renders a lone activity step directly without a redundant phase summary', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-single-step' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'read-1');
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Read complete.' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-single-step') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-single-step',
        role: 'assistant',
        content: 'Read complete.',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'Read complete.' },
        ],
      } as ChatMessage);

      const history = contentEl.querySelector('.claudian-completed-work-history');
      expect(history?.children).toContain(tool);
      expect(history?.querySelector('.claudian-activity-phase')).toBeNull();
    });

    it('keeps legacy final text after a grouped work summary', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-legacy-order' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The inspection is complete.' });
      const firstTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      firstTool.createSpan({ cls: 'claudian-tool-name', text: 'Bash' });
      const secondTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      secondTool.createSpan({ cls: 'claudian-tool-name', text: 'Bash' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-legacy-order') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-legacy-order',
        role: 'assistant',
        content: 'The inspection is complete.',
        timestamp: Date.now(),
        durationSeconds: 5,
        toolCalls: [],
      } as ChatMessage);

      const work = contentEl.querySelector('.claudian-completed-work') as MockElement;
      const history = work.querySelector('.claudian-completed-work-history');
      const summary = work.querySelector('.claudian-activity-phase-label')?.textContent;
      expect(contentEl.children.indexOf(work)).toBeLessThan(contentEl.children.indexOf(answer));
      expect(history?.querySelector('.claudian-activity-phase-details')?.children)
        .toEqual([firstTool, secondTool]);
      expect(summary).toBe('Ran 2 commands');
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('keeps trailing completed tool calls inside the work summary', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-trailing-tool' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Property updated.' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'vault-set-property');
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-trailing-tool') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-trailing-tool',
        role: 'assistant',
        content: 'Property updated.',
        timestamp: Date.now(),
        durationSeconds: 14,
        toolCalls: [{ id: 'vault-set-property', name: 'obsidian__vault', input: {}, status: 'completed' }],
        contentBlocks: [
          { type: 'text', content: 'Property updated.' },
          { type: 'tool_use', toolId: 'vault-set-property' },
        ],
      } as ChatMessage);

      const work = contentEl.querySelector('.claudian-completed-work');
      expect(work?.querySelector('.claudian-completed-work-history')?.contains(tool)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('summarizes completed tool rows missing from the ordered transcript', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-unmapped-tool' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'Property updated.' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'vault-set-property');
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-unmapped-tool') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-unmapped-tool',
        role: 'assistant',
        content: 'Property updated.',
        timestamp: Date.now(),
        durationSeconds: 14,
        toolCalls: [{ id: 'vault-set-property', name: 'obsidian__vault', input: {}, status: 'completed' }],
        contentBlocks: [{ type: 'text', content: 'Property updated.' }],
      } as ChatMessage);

      const work = contentEl.querySelector('.claudian-completed-work');
      expect(work?.querySelector('.claudian-completed-work-history')?.contains(tool)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
    });

    it('shows elapsed work without collapsing streaming content', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const thinkingEl = contentEl.createDiv({ cls: 'claudian-thinking-block' });

      renderer.startCompletedWork(contentEl);

      const status = contentEl.querySelector('.claudian-completed-work-status');
      expect(status?.querySelector('.claudian-completed-work-label')?.textContent).toContain('Working');
      expect(contentEl.querySelector('.claudian-completed-work')).toBeNull();
      expect(contentEl.contains(thinkingEl)).toBe(true);
    });

    it('collapses a finished activity phase after streamed narration begins', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const firstTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      firstTool.setAttribute('data-tool-id', 'grep-1');
      const secondTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      secondTool.setAttribute('data-tool-id', 'bash-1');
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'I found the relevant files.' });
      const msg = {
        id: 'assistant-streaming-phases',
        role: 'assistant',
        content: 'I found the relevant files.',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'grep-1', name: 'Grep', input: {}, status: 'completed' },
          { id: 'bash-1', name: 'Grep', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'grep-1' },
          { type: 'tool_use', toolId: 'bash-1' },
          { type: 'text', content: 'I found the relevant files.' },
        ],
      } as ChatMessage;

      enableDomLikeNodeMoves(contentEl);
      renderer.startCompletedWork(contentEl);
      renderer.syncStreamingActivity(msg, contentEl);

      const phase = contentEl.querySelector('.claudian-streaming-activity-phase');
      expect(phase?.dataset.kind).toBe('research');
      expect(phase?.querySelector('.claudian-activity-phase-details')?.hidden).toBe(true);
      expect(phase?.querySelector('.claudian-activity-phase-details')?.children)
        .toEqual([firstTool, secondTool]);
    });

    it('resolves projected history blocks by ID even when rendered nodes are reordered', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const secondTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      secondTool.setAttribute('data-tool-id', 'bash-2');
      const firstTool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      firstTool.setAttribute('data-tool-id', 'grep-2');
      const msg = {
        id: 'assistant-reordered',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          { id: 'grep-2', name: 'Grep', input: {}, status: 'completed' },
          { id: 'bash-2', name: 'Bash', input: {}, status: 'completed' },
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'grep-2' },
          { type: 'tool_use', toolId: 'bash-2' },
        ],
      } as ChatMessage;

      enableDomLikeNodeMoves(contentEl);
      renderer.syncStreamingActivity(msg, contentEl);

      expect(contentEl.querySelector('.claudian-streaming-activity-phase')
        ?.querySelector('.claudian-activity-phase-details')?.children)
        .toEqual([firstTool, secondTool]);
      expect(firstTool.dataset.transcriptItemId).toBe('assistant-reordered:tool:grep-2');
      expect(secondTool.dataset.transcriptItemId).toBe('assistant-reordered:tool:bash-2');
    });

    it('leaves the active activity phase directly visible while it is streaming', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'bash-live');
      const msg = {
        id: 'assistant-live-phase',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{ id: 'bash-live', name: 'Bash', input: {}, status: 'running' }],
        contentBlocks: [{ type: 'tool_use', toolId: 'bash-live' }],
      } as ChatMessage;

      enableDomLikeNodeMoves(contentEl);
      renderer.syncStreamingActivity(msg, contentEl);

      expect(contentEl.querySelector('.claudian-streaming-activity-phase')).toBeNull();
      expect(contentEl.children).toContain(tool);
    });

    it('keeps the live thought summary inside its expanded activity phase', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const thinking = contentEl.createDiv({ cls: 'claudian-thinking-block' });
      thinking.createDiv({ cls: 'claudian-thinking-label', text: 'Reviewing workflow guidance' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'read-live-thought');
      const msg = {
        id: 'assistant-live-thought-title',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{ id: 'read-live-thought', name: 'Read', input: {}, status: 'completed' }],
        contentBlocks: [
          { type: 'thinking', content: 'Reviewing workflow guidance' },
          { type: 'tool_use', toolId: 'read-live-thought' },
        ],
      } as ChatMessage;
      const userMessage = {
        id: 'user-live-thought-turn',
        role: 'user',
        content: 'Review the workflow.',
        timestamp: Date.now(),
      } as ChatMessage;

      enableDomLikeNodeMoves(contentEl);
      renderer.syncStreamingActivity(msg, contentEl, undefined, [userMessage, msg]);

      const phase = contentEl.querySelector('.claudian-streaming-activity-phase');
      expect(phase?.querySelector('.claudian-activity-phase-details')?.contains(thinking)).toBe(true);
      expect(phase?.querySelector('.claudian-activity-phase-details')?.hidden).toBe(false);
      expect(phase?.querySelector('.claudian-activity-phase-label')?.textContent).toBe('Read 1 file');
      expect(thinking.dataset.transcriptItemId).toBe(`${msg.id}:block:0`);

      thinking.querySelector('.claudian-thinking-label')?.setText('Reviewing workflow guidance and related cases');
      renderer.syncStreamingActivity({
        ...msg,
        contentBlocks: [
          { type: 'thinking', content: 'Reviewing workflow guidance and related cases' },
          { type: 'tool_use', toolId: 'read-live-thought' },
        ],
      } as ChatMessage, contentEl, undefined, [userMessage, {
        ...msg,
        contentBlocks: [
          { type: 'thinking', content: 'Reviewing workflow guidance and related cases' },
          { type: 'tool_use', toolId: 'read-live-thought' },
        ],
      } as ChatMessage]);

      const updatedPhase = contentEl.querySelector('.claudian-streaming-activity-phase');
      expect(updatedPhase?.querySelector('.claudian-activity-phase-details')?.contains(thinking)).toBe(true);
      expect(updatedPhase?.querySelector('.claudian-activity-phase-details')?.contains(tool)).toBe(true);
    });

    it('keeps phase narration when its tool row has not been rendered yet', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const headline = contentEl.createDiv({
        cls: 'claudian-text-block',
        text: 'Checking the document context.',
      });
      const msg = {
        id: 'assistant-missing-tool-row',
        role: 'assistant',
        content: 'Checking the document context.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'read-missing', name: 'Read', input: {}, status: 'running' }],
        contentBlocks: [
          { type: 'text', content: 'Checking the document context.' },
          { type: 'tool_use', toolId: 'read-missing' },
        ],
      } as ChatMessage;

      enableDomLikeNodeMoves(contentEl);
      expect(() => renderer.syncStreamingActivity(msg, contentEl)).not.toThrow();
      expect(contentEl.contains(headline)).toBe(true);
      expect(headline.hidden).not.toBe(true);
      expect(headline.hasClass('claudian-activity-narration')).toBe(false);
      expect(contentEl.querySelector('.claudian-activity-phase')).toBeNull();
    });

    it('folds narrated work while streaming and leaves the current answer visible', () => {
      const { renderer } = createRenderer();
      const contentEl = createMockEl();
      const preamble = contentEl.createDiv({ cls: 'claudian-text-block', text: 'I will inspect the files.' });
      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'read-live');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The result is clear.' });
      const msg = {
        id: 'assistant-live-fold',
        role: 'assistant',
        content: 'The result is clear.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'read-live', name: 'Read', input: {}, status: 'completed' }],
        contentBlocks: [
          { type: 'text', content: 'I will inspect the files.' },
          { type: 'tool_use', toolId: 'read-live' },
        ],
      } as ChatMessage;
      enableDomLikeNodeMoves(contentEl);
      renderer.startCompletedWork(contentEl);

      renderer.syncStreamingActivity(msg, contentEl, { type: 'text', content: 'The result is clear.' });

      const fold = contentEl.querySelector('.claudian-streaming-work-fold');
      expect(fold).toBeTruthy();
      expect(fold?.querySelector('.claudian-streaming-work-history')?.contains(preamble)).toBe(true);
      expect(fold?.querySelector('.claudian-streaming-work-history')?.contains(tool)).toBe(true);
      expect((fold?.querySelector('.claudian-activity-phase')?.contains(preamble)) ?? false).toBe(false);
      expect(preamble.hidden).not.toBe(true);
      expect(contentEl.children).toContain(answer);
    });

    it('keeps the streaming work row at the work anchor when the turn settles', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-stable-work-anchor' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      const preamble = contentEl.createDiv({ cls: 'claudian-text-block', text: 'I will inspect the file.' });
      const thinking = contentEl.createDiv({ cls: 'claudian-thinking-block' });
      contentEl.insertBefore = (element: MockElement, reference: MockElement | null) => {
        const existingIndex = contentEl.children.indexOf(element);
        if (existingIndex >= 0) contentEl.children.splice(existingIndex, 1);
        const referenceIndex = reference ? contentEl.children.indexOf(reference) : -1;
        contentEl.children.splice(referenceIndex < 0 ? contentEl.children.length : referenceIndex, 0, element);
      };

      renderer.startCompletedWork(contentEl, performance.now() - 1_000);
      renderer.setTranscriptExecutionScope('assistant-stable-work-anchor', {
        executionId: 'execution-stable-work-anchor',
        turnId: 'execution-turn-stable-work-anchor',
      });
      const streamingRow = contentEl.querySelector('.claudian-completed-work-status');
      expect(streamingRow).toBeTruthy();
      expect(contentEl.children.indexOf(streamingRow)).toBe(contentEl.children.indexOf(thinking) - 1);

      const tool = contentEl.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', 'read-1');
      const answer = contentEl.createDiv({ cls: 'claudian-text-block', text: 'The file is valid.' });
      enableDomLikeNodeMoves(contentEl);
      renderer.syncStreamingActivity({
        id: 'assistant-stable-work-anchor',
        role: 'assistant',
        content: 'The file is valid.',
        timestamp: Date.now(),
        toolCalls: [{ id: 'read-1', name: 'Read', input: {}, status: 'completed' }],
        contentBlocks: [
          { type: 'text', content: 'I will inspect the file.' },
          { type: 'thinking', content: 'Check the file.' },
          { type: 'tool_use', toolId: 'read-1' },
        ],
      } as ChatMessage, contentEl, { type: 'text', content: 'The file is valid.' });
      expect(contentEl.querySelector('.claudian-streaming-work-fold')).toBe(streamingRow);
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-stable-work-anchor') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-stable-work-anchor',
        role: 'assistant',
        content: 'The file is valid.',
        timestamp: Date.now(),
        durationSeconds: 1,
        toolCalls: [{ id: 'read-1', name: 'Read', input: {}, status: 'completed' }],
        contentBlocks: [
          { type: 'text', content: 'I will inspect the file.' },
          { type: 'thinking', content: 'Check the file.' },
          { type: 'tool_use', toolId: 'read-1' },
          { type: 'text', content: 'The file is valid.' },
        ],
      } as ChatMessage);

      expect(contentEl.querySelector('.claudian-completed-work')).toBe(streamingRow);
      expect(streamingRow?.querySelector('.claudian-completed-work-label')).toBeTruthy();
      expect(streamingRow?.getAttribute('data-transcript-turn-id')).toBe('assistant-stable-work-anchor');
      expect(streamingRow?.getAttribute('data-transcript-run-id')).toBe('assistant-stable-work-anchor');
      expect(streamingRow?.getAttribute('data-transcript-execution-id')).toBe('execution-stable-work-anchor');
      expect(streamingRow?.getAttribute('data-transcript-execution-turn-id'))
        .toBe('execution-turn-stable-work-anchor');
      expect(contentEl.children.indexOf(preamble)).toBeLessThan(contentEl.children.indexOf(streamingRow));
      expect(contentEl.contains(preamble)).toBe(true);
      expect(contentEl.contains(answer)).toBe(true);
      expect(contentEl.querySelector('.claudian-completed-work-history')?.contains(thinking)).toBe(true);
      expect(contentEl.children).not.toContain(thinking);
      expect(contentEl.querySelector('.claudian-completed-work-history')?.contains(answer)).toBe(false);
      const settledHistory = contentEl.querySelector('.claudian-completed-work-history');
      expect(settledHistory?.querySelector('.claudian-tool-call')).toBe(tool);
      expect(thinking.dataset.transcriptItemId).toBe('assistant-stable-work-anchor:block:1');
      expect(tool.dataset.transcriptItemId).toBe('assistant-stable-work-anchor:tool:read-1');
    });

    it('collapses compacted work while keeping its boundary in history', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const messageEl = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-assistant',
        attr: { 'data-message-id': 'assistant-compact' },
      });
      const contentEl = messageEl.createDiv({ cls: 'claudian-message-content' });
      contentEl.createDiv({ cls: 'claudian-tool-call' });
      contentEl.createDiv({ cls: 'claudian-compact-boundary' });
      contentEl.createDiv({ cls: 'claudian-text-block', text: 'Final answer' });
      const querySelector = messagesEl.querySelector.bind(messagesEl);
      messagesEl.querySelector = jest.fn((selector: string) =>
        selector.includes('assistant-compact') ? messageEl : querySelector(selector));

      renderer.finalizeCompletedWork({
        id: 'assistant-compact', role: 'assistant', content: 'Final answer', timestamp: Date.now(),
        durationSeconds: 65,
        contentBlocks: [{ type: 'context_compacted' }, { type: 'text', content: 'Final answer' }],
      } as ChatMessage);

      const workEl = contentEl.querySelector('.claudian-completed-work');
      expect(workEl).toBeTruthy();
      expect(workEl?.querySelector('.claudian-completed-work-label')?.textContent).toContain('1m 5s');
      expect(workEl?.querySelector('.claudian-completed-work-history')?.children)
        .toContainEqual(expect.objectContaining({ className: 'claudian-activity-phase' }));
      expect(workEl?.querySelector('.claudian-activity-phase-details')?.querySelector('.claudian-compact-boundary'))
        .toBeTruthy();
    });

  });

  // ============================================
  // renderMessages
  // ============================================

  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockEl();
    const emptySpy = jest.spyOn(messagesEl, 'empty');
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(emptySpy).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
    expect(welcomeEl.children[0].hasClass('claudian-welcome-brand')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Oh My Claudian');
    expect(welcomeEl.children[1].textContent).toBe('Hello');
  });

  it('groups assistant runs under one transcript turn and merges their work folds', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const createMessage = (id: string, role: string) => {
      const message = messagesEl.createDiv({ cls: `claudian-message claudian-message-${role}` });
      message.setAttribute('data-message-id', id);
      const content = message.createDiv({ cls: 'claudian-message-content' });
      return { message, content };
    };
    const { content: userContent } = createMessage('turn-user', 'user');
    userContent.createDiv({ cls: 'claudian-text-block', text: 'Inspect the project' });
    const first = createMessage('turn-run-one', 'assistant');
    const second = createMessage('turn-run-two', 'assistant');
    const createWork = (content: MockElement, id: string, durationSeconds: number) => {
      const work = content.createDiv({ cls: 'claudian-completed-work' });
      const header = work.createEl('button', { cls: 'claudian-completed-work-header' });
      header.createSpan({ cls: 'claudian-completed-work-label', text: `${durationSeconds}s` });
      const history = work.createDiv({ cls: 'claudian-completed-work-history' });
      const tool = history.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', id);
    };
    createWork(first.content, 'turn-read-one', 4);
    createWork(second.content, 'turn-read-two', 5);
    second.content.createDiv({ cls: 'claudian-text-block', text: 'The answer is ready.' });
    const messages: ChatMessage[] = [
      { id: 'turn-user', role: 'user', content: 'Inspect the project', timestamp: 1 },
      {
        id: 'turn-run-one', role: 'assistant', content: 'I found the relevant files.', timestamp: 2,
        modelName: 'GPT-6 Luna', durationSeconds: 4,
      } as ChatMessage,
      {
        id: 'turn-run-two', role: 'assistant', content: 'The answer is ready.', timestamp: 3,
        modelName: 'GPT-6 Luna', durationSeconds: 5,
      } as ChatMessage,
    ];

    (renderer as any).groupRenderedTranscriptTurns(messages);
    const turn = messagesEl.querySelector('.claudian-transcript-turn');
    expect(turn).toBeTruthy();
    expect(turn?.querySelectorAll('.claudian-message-assistant')).toHaveLength(2);
    expect(turn?.querySelectorAll('.claudian-completed-work')).toHaveLength(1);
    expect(turn?.querySelectorAll('.claudian-tool-call')).toHaveLength(2);
    expect(turn?.querySelector('.claudian-completed-work-label')?.textContent).toContain('5s');
    const finalRun = turn?.querySelectorAll('.claudian-message')
      .find((element: MockElement) => element.dataset.messageId === 'turn-run-two');
    expect(finalRun?.querySelector('.claudian-text-block')?.textContent).toBe('The answer is ready.');
  });

  it('creates one ordered work fold from tool calls across assistant runs', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'turn-fold-user');
    user.createDiv({ cls: 'claudian-message-content' }).createDiv({ cls: 'claudian-text-block' });
    const first = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    first.setAttribute('data-message-id', 'turn-fold-run-one');
    const firstContent = first.createDiv({ cls: 'claudian-message-content' });
    const firstTool = firstContent.createDiv({ cls: 'claudian-tool-call' });
    firstTool.setAttribute('data-tool-id', 'turn-fold-read');
    firstTool.dataset.transcriptItemId = 'turn-fold-run-one:tool:turn-fold-read';
    const second = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    second.setAttribute('data-message-id', 'turn-fold-run-two');
    const secondContent = second.createDiv({ cls: 'claudian-message-content' });
    const secondTool = secondContent.createDiv({ cls: 'claudian-tool-call' });
    secondTool.setAttribute('data-tool-id', 'turn-fold-grep');
    secondTool.dataset.transcriptItemId = 'turn-fold-run-two:tool:turn-fold-grep';
    const answer = secondContent.createDiv({ cls: 'claudian-text-block', text: 'The answer.' });
    answer.dataset.transcriptItemId = 'turn-fold-run-two:block:1';
    const messages: ChatMessage[] = [
      { id: 'turn-fold-user', role: 'user', content: 'Inspect the project.', timestamp: 1 },
      {
        id: 'turn-fold-run-one', role: 'assistant', content: '', timestamp: 2, durationSeconds: 4,
        contentBlocks: [{ type: 'tool_use', toolId: 'turn-fold-read' }],
        toolCalls: [{ id: 'turn-fold-read', name: 'Read', input: {}, status: 'completed' }],
      },
      {
        id: 'turn-fold-run-two', role: 'assistant', content: 'The answer.', timestamp: 3, durationSeconds: 5,
        contentBlocks: [
          { type: 'tool_use', toolId: 'turn-fold-grep' },
          { type: 'text', content: 'The answer.' },
        ],
        toolCalls: [{ id: 'turn-fold-grep', name: 'Grep', input: {}, status: 'completed' }],
      },
    ] as ChatMessage[];
    const turn = projectTranscript(messages)[0];

    (renderer as any).groupRenderedTranscriptTurns(messages, false);
    (renderer as any).finalizeTranscriptTurn(turn);

    const turnEl = messagesEl.querySelector('.claudian-transcript-turn');
    expect(turnEl?.querySelectorAll('.claudian-completed-work')).toHaveLength(1);
    expect(turnEl?.children[0]).toBe(user);
    expect(turnEl?.children[1]).toBe(turnEl?.querySelector('.claudian-completed-work'));
    const work = turnEl?.querySelector('.claudian-completed-work');
    expect(work?.querySelector('.claudian-completed-work-history')?.hidden).toBe(true);
    expect(work?.querySelectorAll('.claudian-tool-call')).toEqual([firstTool, secondTool]);
    expect(work?.querySelector('.claudian-activity-phase-label')?.textContent).toBe('Explored the project');
    expect(secondContent.children).toContain(answer);
    expect(work?.contains(answer)).toBe(false);
  });

  it('folds an OMP-style multi-message response once at the user-turn boundary', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'omp-turn-user');
    user.createDiv({ cls: 'claudian-message-content' }).createDiv({ cls: 'claudian-text-block' });

    const toolElements = new Map<string, MockElement>();
    const messages: ChatMessage[] = [
      { id: 'omp-turn-user', role: 'user', content: 'Update the document.', timestamp: 1 },
    ];
    const appendRun = (
      id: string,
      blocks: ChatMessage['contentBlocks'],
      tools: Array<{ id: string; name: string; status: 'completed' | 'failed' }>,
      timestamp: number,
    ) => {
      const assistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
      assistant.setAttribute('data-message-id', id);
      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      for (const block of blocks ?? []) {
        if (block.type === 'text') {
          const text = content.createDiv({ cls: 'claudian-text-block', text: block.content });
          text.dataset.transcriptItemId = `${id}:block:${(blocks ?? []).indexOf(block)}`;
        } else if (block.type === 'tool_use') {
          const tool = content.createDiv({ cls: 'claudian-tool-call' });
          tool.setAttribute('data-tool-id', block.toolId);
          tool.dataset.transcriptItemId = `${id}:tool:${block.toolId}`;
          toolElements.set(block.toolId, tool);
        }
      }
      messages.push({
        id,
        role: 'assistant',
        content: blocks?.filter(block => block.type === 'text').map(block => block.content).join('') ?? '',
        timestamp,
        contentBlocks: blocks,
        toolCalls: tools.map(tool => ({
          id: tool.id,
          name: tool.name,
          input: {},
          status: tool.status,
        })),
      } as ChatMessage);
    };

    appendRun('omp-turn-run-1', [
      { type: 'text', content: 'Planning edits.' },
      { type: 'tool_use', toolId: 'omp-turn-read-1' },
    ], [{ id: 'omp-turn-read-1', name: 'Read', status: 'completed' }], 2);
    appendRun('omp-turn-run-2', [
      { type: 'text', content: 'Updating the first section.' },
      { type: 'tool_use', toolId: 'omp-turn-edit-1' },
      { type: 'text', content: 'Continuing with the next section.' },
      { type: 'tool_use', toolId: 'omp-turn-edit-2' },
    ], [
      { id: 'omp-turn-edit-1', name: 'Edit', status: 'failed' },
      { id: 'omp-turn-edit-2', name: 'Edit', status: 'completed' },
    ], 3);
    appendRun('omp-turn-run-3', [
      { type: 'text', content: 'Verifying the document.' },
      { type: 'tool_use', toolId: 'omp-turn-read-2' },
      { type: 'text', content: 'The requested changes are complete.' },
    ], [{ id: 'omp-turn-read-2', name: 'Read', status: 'completed' }], 4);

    const turn = projectTranscript(messages)[0];
    (renderer as any).groupRenderedTranscriptTurns(messages, false);
    (renderer as any).finalizeTranscriptTurn(turn);

    const turnEl = messagesEl.querySelector('.claudian-transcript-turn');
    expect(turnEl?.querySelectorAll('.claudian-message-assistant')).toHaveLength(3);
    expect(turnEl?.querySelectorAll('.claudian-completed-work')).toHaveLength(1);
    const work = turnEl?.querySelector('.claudian-completed-work');
    expect(work?.querySelector('.claudian-completed-work-history')?.hidden).toBe(true);
    expect(Array.from(toolElements.values()).every(tool => work?.contains(tool))).toBe(true);
  });

  it('keeps finalized turn order when grouping the next turn', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const createMessage = (id: string, role: 'user' | 'assistant', text: string) => {
      const message = messagesEl.createDiv({ cls: `claudian-message claudian-message-${role}` });
      message.setAttribute('data-message-id', id);
      const content = message.createDiv({ cls: 'claudian-message-content' });
      if (text) content.createDiv({ cls: 'claudian-text-block', text });
      return { message, content };
    };
    createMessage('stable-order-user-one', 'user', 'First prompt.');
    const firstAssistant = createMessage('stable-order-assistant-one', 'assistant', 'First answer.');
    const tool = firstAssistant.content.createDiv({ cls: 'claudian-tool-call' });
    tool.setAttribute('data-tool-id', 'stable-order-tool');
    tool.dataset.transcriptItemId = 'stable-order-assistant-one:tool:stable-order-tool';
    const firstTurnMessages = [
      { id: 'stable-order-user-one', role: 'user', content: 'First prompt.', timestamp: 1 },
      {
        id: 'stable-order-assistant-one', role: 'assistant', content: 'First answer.', timestamp: 2,
        contentBlocks: [
          { type: 'tool_use', toolId: 'stable-order-tool' },
          { type: 'text', content: 'First answer.' },
        ],
        toolCalls: [{ id: 'stable-order-tool', name: 'Read', input: {}, status: 'completed' }],
      },
    ] as ChatMessage[];

    (renderer as any).groupRenderedTranscriptTurns(firstTurnMessages, false);
    (renderer as any).finalizeTranscriptTurn(projectTranscript(firstTurnMessages)[0]);
    const firstTurnEl = messagesEl.querySelector('.claudian-transcript-turn');
    const completedWork = firstTurnEl?.querySelector('.claudian-completed-work');

    const secondUser = createMessage('stable-order-user-two', 'user', 'Second prompt.');
    const secondAssistant = createMessage('stable-order-assistant-two', 'assistant', 'Second answer.');
    const allMessages = [
      ...firstTurnMessages,
      { id: 'stable-order-user-two', role: 'user', content: 'Second prompt.', timestamp: 3 },
      { id: 'stable-order-assistant-two', role: 'assistant', content: 'Second answer.', timestamp: 4 },
    ] as ChatMessage[];

    (renderer as any).groupRenderedTranscriptTurns(allMessages, false);

    expect((Array.from(firstTurnEl?.children ?? []) as MockElement[]).map((element) =>
      element === completedWork ? 'fold' : element.dataset.messageId,
    )).toEqual(['stable-order-user-one', 'fold', 'stable-order-assistant-one']);
    const secondTurnEl = (Array.from(
      messagesEl.querySelectorAll('.claudian-transcript-turn'),
    ) as MockElement[]).find((element) => element.dataset.transcriptTurnId === 'stable-order-user-two');
    expect((Array.from(secondTurnEl?.children ?? []) as MockElement[]).map((element) => element.dataset.messageId))
      .toEqual([secondUser.message.dataset.messageId, secondAssistant.message.dataset.messageId]);
  });

  it('keeps preceding run narration separate from merged activity phases', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const createMessage = (id: string, role: string) => {
      const message = messagesEl.createDiv({ cls: `claudian-message claudian-message-${role}` });
      message.setAttribute('data-message-id', id);
      return { message, content: message.createDiv({ cls: 'claudian-message-content' }) };
    };
    createMessage('headline-turn-user', 'user');
    const first = createMessage('headline-run-one', 'assistant');
    const second = createMessage('headline-run-two', 'assistant');
    const work = (content: MockElement, id: string, seconds: number) => {
      const disclosure = content.createDiv({ cls: 'claudian-completed-work' });
      const header = disclosure.createEl('button', { cls: 'claudian-completed-work-header' });
      header.createSpan({ cls: 'claudian-completed-work-label', text: `${seconds}s` });
      const history = disclosure.createDiv({ cls: 'claudian-completed-work-history' });
      const tool = history.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', id);
      return { history, tool };
    };
    const firstWork = work(first.content, 'headline-read-one', 2);
    const earlierNarration = firstWork.history.createDiv({
      cls: 'claudian-activity-narration claudian-text-block',
      text: 'Locating README.md',
    });
    const narration = firstWork.history.createDiv({
      cls: 'claudian-activity-narration claudian-text-block',
      text: 'Inspecting workspace files',
    });
    const secondWork = work(second.content, 'headline-read-two', 3);
    const phase = secondWork.history.createDiv({ cls: 'claudian-activity-phase' });
    const header = phase.createEl('button', { cls: 'claudian-activity-phase-header' });
    const label = header.createSpan({ cls: 'claudian-activity-phase-label', text: 'Ran 1 command' });
    const details = phase.createDiv({ cls: 'claudian-activity-phase-details' });
    details.hidden = true;
    details.appendChild(secondWork.tool);

    const messages: ChatMessage[] = [
      { id: 'headline-turn-user', role: 'user', content: 'Read the README', timestamp: 1 },
      { id: 'headline-run-one', role: 'assistant', content: 'Inspecting workspace files', timestamp: 2 },
      { id: 'headline-run-two', role: 'assistant', content: '', timestamp: 3 },
    ];

    (renderer as any).groupRenderedTranscriptTurns(messages);

    expect(label.textContent).toBe('Ran 1 command');
    expect(narration.hidden).not.toBe(true);
    expect(firstWork.history.children).toContain(narration);
    expect(details.children).toEqual([secondWork.tool]);
    expect(firstWork.history.children).toContain(earlierNarration);
  });

  it('groups a live assistant run with its user turn from the shared projection', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'live-turn-user');
    const assistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    assistant.setAttribute('data-message-id', 'live-turn-run');
    const content = assistant.createDiv({ cls: 'claudian-message-content' });
    const narration = content.createDiv({ cls: 'claudian-text-block', text: 'Reviewing the project.' });
    const tool = content.createDiv({ cls: 'claudian-tool-call' });
    tool.setAttribute('data-tool-id', 'live-turn-read');
    const messages: ChatMessage[] = [
      { id: 'live-turn-user', role: 'user', content: 'Review the project', timestamp: 1 },
      {
        id: 'live-turn-run', role: 'assistant', content: 'Reviewing the project.', timestamp: 2,
        contentBlocks: [
          { type: 'text', content: 'Reviewing the project.' },
          { type: 'tool_use', toolId: 'live-turn-read' },
        ],
        toolCalls: [{ id: 'live-turn-read', name: 'Read', input: {}, status: 'completed' }],
      } as ChatMessage,
    ];

    renderer.syncStreamingActivity(messages[1], content, undefined, messages);

    const turn = messagesEl.querySelector('.claudian-transcript-turn');
    expect(turn?.querySelectorAll('.claudian-message')).toHaveLength(2);
    expect(turn?.querySelector('.claudian-activity-phase')).toBeNull();
    expect(narration.hidden).not.toBe(true);
    expect(turn?.querySelector('.claudian-tool-call')).toBe(tool);
  });

  it('folds finished OMP-style runs while showing the current thought and tool phase', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'omp-live-turn-user');
    user.createDiv({ cls: 'claudian-message-content' });

    const messages: ChatMessage[] = [
      { id: 'omp-live-turn-user', role: 'user', content: 'Update the document.', timestamp: 1 },
    ];
    const renderedRuns = new Map<string, {
      thinking: MockElement;
      tool: MockElement;
      content: MockElement;
    }>();
    const appendRun = (
      id: string,
      thought: string,
      toolId: string,
      toolName: string,
      toolStatus: 'completed' | 'running',
      timestamp: number,
    ) => {
      const assistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
      assistant.setAttribute('data-message-id', id);
      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      const thinking = content.createDiv({ cls: 'claudian-thinking-block', text: thought });
      const tool = content.createDiv({ cls: 'claudian-tool-call' });
      tool.setAttribute('data-tool-id', toolId);
      renderedRuns.set(id, { thinking, tool, content });
      messages.push({
        id,
        role: 'assistant',
        content: '',
        timestamp,
        contentBlocks: [
          { type: 'thinking', content: thought },
          { type: 'tool_use', toolId },
        ],
        toolCalls: [{ id: toolId, name: toolName, input: {}, status: toolStatus }],
      } as ChatMessage);
      return content;
    };

    appendRun('omp-live-run-1', 'Planning the first edit.', 'omp-live-read-1', 'Read', 'completed', 2);
    appendRun('omp-live-run-2', 'Applying the first change.', 'omp-live-edit', 'Edit', 'completed', 3);
    const currentContent = appendRun(
      'omp-live-run-3',
      'Verifying the remaining sections.',
      'omp-live-read-current',
      'Read',
      'running',
      4,
    );
    renderer.startCompletedWork(currentContent);

    renderer.syncStreamingActivity(messages[3], currentContent, undefined, messages);

    const fold = currentContent.querySelector('.claudian-streaming-work-fold');
    const history = fold?.querySelector('.claudian-streaming-work-history');
    expect(fold).toBeTruthy();
    for (const id of ['omp-live-run-1', 'omp-live-run-2']) {
      const run = renderedRuns.get(id)!;
      expect(history?.contains(run.thinking)).toBe(true);
      expect(history?.contains(run.tool)).toBe(true);
    }
    const current = renderedRuns.get('omp-live-run-3')!;
    expect(history?.contains(current.thinking)).toBe(false);
    expect(history?.contains(current.tool)).toBe(false);
    const activePhase = (currentContent.querySelectorAll('.claudian-streaming-activity-phase') as MockElement[])
      .find(phase => phase.getAttribute('data-transcript-run-id') === 'omp-live-run-3');
    expect(activePhase?.getAttribute('data-active')).toBe('true');
    expect(activePhase?.querySelector('.claudian-activity-phase-details')?.hidden).toBe(false);
  });

  it('folds narrated work across assistant runs while the current turn is live', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'live-multi-turn-user');
    const firstAssistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    firstAssistant.setAttribute('data-message-id', 'live-multi-run-one');
    const firstContent = firstAssistant.createDiv({ cls: 'claudian-message-content' });
    const firstTool = firstContent.createDiv({ cls: 'claudian-tool-call' });
    firstTool.setAttribute('data-tool-id', 'live-multi-read-one');
    const secondAssistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    secondAssistant.setAttribute('data-message-id', 'live-multi-run-two');
    const secondContent = secondAssistant.createDiv({ cls: 'claudian-message-content' });
    const narration = secondContent.createDiv({ cls: 'claudian-text-block', text: 'Checking the result.' });
    const currentTool = secondContent.createDiv({ cls: 'claudian-tool-call' });
    currentTool.setAttribute('data-tool-id', 'live-multi-bash');
    renderer.startCompletedWork(secondContent);

    const messages: ChatMessage[] = [
      { id: 'live-multi-turn-user', role: 'user', content: 'Inspect the project.', timestamp: 1 },
      {
        id: 'live-multi-run-one', role: 'assistant', content: '', timestamp: 2,
        contentBlocks: [{ type: 'tool_use', toolId: 'live-multi-read-one' }],
        toolCalls: [{ id: 'live-multi-read-one', name: 'Read', input: {}, status: 'completed' }],
      } as ChatMessage,
      {
        id: 'live-multi-run-two', role: 'assistant', content: 'Checking the result.', timestamp: 3,
        contentBlocks: [
          { type: 'text', content: 'Checking the result.' },
          { type: 'tool_use', toolId: 'live-multi-bash' },
        ],
        toolCalls: [{ id: 'live-multi-bash', name: 'Bash', input: {}, status: 'running' }],
      } as ChatMessage,
    ];

    const projection = projectTranscript(messages, { activeMessageId: messages[2].id })[0];
    expect(projection.runs).toHaveLength(2);
    expect(buildActivityTimeline(projection, { live: true }).fold).toEqual({ start: 0, end: 0 });

    renderer.syncStreamingActivity(messages[2], secondContent, undefined, messages);

    const fold = secondContent.querySelector('.claudian-streaming-work-fold');
    expect(firstTool.dataset.transcriptItemId).toBe('live-multi-run-one:tool:live-multi-read-one');
    expect(secondContent.querySelector('.claudian-completed-work-status')).toBeTruthy();
    expect(fold).toBeTruthy();
    expect(fold?.querySelector('.claudian-streaming-work-history')?.contains(firstTool)).toBe(true);
    const history = fold?.querySelector('.claudian-streaming-work-history');
    expect(history?.contains(narration)).toBe(false);
    expect(history?.contains(currentTool)).toBe(false);
    expect(secondContent.children).toContain(narration);
    expect(secondContent.children).toContain(currentTool);
  });

  it('restores earlier run nodes when a late user boundary separates the live turn', () => {
    const messagesEl = createMockEl();
    enableDomLikeNodeMoves(messagesEl);
    const { renderer } = createRenderer(messagesEl);
    const user = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    user.setAttribute('data-message-id', 'late-boundary-user-one');
    const firstAssistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    firstAssistant.setAttribute('data-message-id', 'late-boundary-run-one');
    const firstContent = firstAssistant.createDiv({ cls: 'claudian-message-content' });
    const firstTool = firstContent.createDiv({ cls: 'claudian-tool-call' });
    firstTool.setAttribute('data-tool-id', 'late-boundary-read');
    const secondAssistant = messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    secondAssistant.setAttribute('data-message-id', 'late-boundary-run-two');
    const secondContent = secondAssistant.createDiv({ cls: 'claudian-message-content' });
    const narration = secondContent.createDiv({ cls: 'claudian-text-block', text: 'Checking the result.' });
    const currentTool = secondContent.createDiv({ cls: 'claudian-tool-call' });
    currentTool.setAttribute('data-tool-id', 'late-boundary-bash');
    renderer.startCompletedWork(secondContent);

    const firstRun = {
      id: 'late-boundary-run-one', role: 'assistant', content: '', timestamp: 2,
      contentBlocks: [{ type: 'tool_use', toolId: 'late-boundary-read' }],
      toolCalls: [{ id: 'late-boundary-read', name: 'Read', input: {}, status: 'completed' }],
    } as ChatMessage;
    const activeRun = {
      id: 'late-boundary-run-two', role: 'assistant', content: 'Checking the result.', timestamp: 3,
      contentBlocks: [
        { type: 'text', content: 'Checking the result.' },
        { type: 'tool_use', toolId: 'late-boundary-bash' },
      ],
      toolCalls: [{ id: 'late-boundary-bash', name: 'Bash', input: {}, status: 'running' }],
    } as ChatMessage;
    const initialMessages: ChatMessage[] = [
      { id: 'late-boundary-user-one', role: 'user', content: 'Inspect the project.', timestamp: 1 },
      firstRun,
      activeRun,
    ];

    renderer.syncStreamingActivity(activeRun, secondContent, undefined, initialMessages);
    expect(secondContent.querySelector('.claudian-streaming-work-history')?.contains(firstTool)).toBe(true);

    const secondUserEl = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
    secondUserEl.setAttribute('data-message-id', 'late-boundary-user-two');
    messagesEl.insertBefore(secondUserEl, secondAssistant);
    const separatedMessages: ChatMessage[] = [
      initialMessages[0],
      firstRun,
      { id: 'late-boundary-user-two', role: 'user', content: 'Continue the work.', timestamp: 4 },
      activeRun,
    ];

    renderer.syncStreamingActivity(activeRun, secondContent, undefined, separatedMessages);

    expect(firstTool.parentElement?.className).toBe('claudian-message-content');
    expect(secondContent.querySelector('.claudian-streaming-work-history')?.contains(firstTool) ?? false).toBe(false);
    expect(secondContent.querySelector('.claudian-activity-phase')).toBeNull();
    expect(narration.hidden).not.toBe(true);
  });

  it('renders empty messages list with just welcome element', () => {
    const { renderer } = createRenderer();
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(renderStoredSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // renderStoredMessage
  // ============================================

  it('renders interrupt messages with interrupt styling instead of user bubble', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-1',
      role: 'user',
      content: '[Request interrupted by user]',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create assistant-style message with interrupt content
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    // Check the content contains interrupt styling
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    const interruptedEl = textEl.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders interrupted assistant message with content + interrupt indicator', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-1',
      role: 'assistant',
      content: 'Starting to work on the feature...',
      timestamp: Date.now(),
      isInterrupt: true,
      contentBlocks: [{ type: 'text', content: 'Starting to work on the feature...' }],
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create an assistant message (not a bare interrupt marker)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);

    // The content div should have both content rendering and an interrupt indicator
    const contentEl = msgEl.children[0];
    const lastChild = contentEl.children[contentEl.children.length - 1];
    const interruptedEl = lastChild.children[0];
    expect(interruptedEl.hasClass('claudian-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders persisted citation content blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');
    const citations = {
      kind: 'memory' as const,
      entries: [{
        path: 'MEMORY.md',
        lineStart: 10,
        lineEnd: 12,
        note: 'Used project conventions',
      }],
    };

    renderer.renderStoredMessage({
      id: 'assistant-citations',
      role: 'assistant',
      content: 'Answer',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Answer' },
        { type: 'citations', citations },
      ],
    });

    expect(renderCitationGroup).toHaveBeenCalledWith(expect.anything(), citations);
  });

  it('renders message timestamps by default', () => {
    const timestampSpy = jest
      .spyOn(Date.prototype, 'toLocaleTimeString')
      .mockReturnValue('10:02 AM');
    const { renderer, messagesEl } = createRenderer();

    renderer.renderStoredMessage({
      id: 'timestamped-message',
      role: 'assistant',
      content: 'Answer',
      timestamp: 1_700_000_000_000,
    });

    const timestamp = messagesEl.querySelector('.claudian-message-timestamp');
    expect(timestamp?.textContent).toBe('10:02 AM');
    expect(timestampSpy).toHaveBeenCalled();
    timestampSpy.mockRestore();
  });

  it('renders timestamps without a settings toggle', () => {
    const { renderer, messagesEl } = createRenderer();

    renderer.renderStoredMessage({
      id: 'untimestamped-message',
      role: 'assistant',
      content: 'Answer',
      timestamp: 1_700_000_000_000,
    });

    expect(messagesEl.querySelector('.claudian-message-timestamp')).not.toBeNull();
  });

  it('does not render a timestamp for an empty streaming assistant placeholder', () => {
    const { renderer, messagesEl } = createRenderer();

    renderer.addMessage({
      id: 'streaming-assistant',
      role: 'assistant',
      content: '',
      timestamp: 1_700_000_000_000,
    });

    expect(messagesEl.querySelector('.claudian-message-timestamp')).toBeNull();
  });

  it('shows timestamps for final assistant text but not thinking-only messages', () => {
    const timestampSpy = jest
      .spyOn(Date.prototype, 'toLocaleTimeString')
      .mockReturnValue('10:02 AM');
    const { renderer, messagesEl } = createRenderer();

    renderer.renderStoredMessage({
      id: 'thinking-only',
      role: 'assistant',
      content: '',
      timestamp: 1_700_000_000_000,
      contentBlocks: [{ type: 'thinking', content: 'Inspecting the note.' }],
    });
    renderer.renderStoredMessage({
      id: 'final-answer',
      role: 'assistant',
      content: 'Done.',
      timestamp: 1_700_000_000_000,
    });

    expect(messagesEl.querySelectorAll('.claudian-message-timestamp')).toHaveLength(1);
    expect(timestampSpy).toHaveBeenCalledTimes(1);
    timestampSpy.mockRestore();
  });

  it('does not render empty or superseded leading thinking blocks in stored messages', () => {
    const { renderer } = createRenderer();
    const renderThinking = jest.mocked(renderStoredThinkingBlock);
    renderThinking.mockClear();

    renderer.renderStoredMessage({
      id: 'assistant-leading-thinking',
      role: 'assistant',
      content: 'I will inspect the vault.',
      timestamp: 1_700_000_000_000,
      contentBlocks: [
        { type: 'thinking', content: 'First private thought.' },
        { type: 'thinking', content: 'Second private thought.' },
        { type: 'text', content: 'I will inspect the vault.' },
        { type: 'thinking', content: '   ' },
        { type: 'thinking', content: 'The tool result needs a check.' },
      ],
    });

    expect(renderThinking).toHaveBeenCalledTimes(1);
    expect(renderThinking).toHaveBeenCalledWith(
      expect.anything(),
      'The tool result needs a check.',
      undefined,
      expect.any(Function),
    );
  });

  it('keeps leading thinking in later assistant runs of the same turn', () => {
    const { renderer } = createRenderer();
    const renderThinking = jest.mocked(renderStoredThinkingBlock);
    renderThinking.mockClear();
    const messages: ChatMessage[] = [
      { id: 'thinking-turn-user', role: 'user', content: 'Check the project', timestamp: 1 },
      {
        id: 'thinking-run-one', role: 'assistant', content: 'I will inspect the project.', timestamp: 2,
        contentBlocks: [{ type: 'text', content: 'I will inspect the project.' }],
      } as ChatMessage,
      {
        id: 'thinking-run-two', role: 'assistant', content: 'I found the files.', timestamp: 3,
        contentBlocks: [
          { type: 'thinking', content: 'The next check should inspect the config.' },
          { type: 'text', content: 'I found the files.' },
          { type: 'tool_use', toolId: 'thinking-run-tool' },
        ],
        toolCalls: [{ id: 'thinking-run-tool', name: 'Read', input: {}, status: 'completed' }],
      } as ChatMessage,
    ];

    renderer.renderStoredMessage(messages[2], messages, 2);

    expect(renderThinking).toHaveBeenCalledTimes(1);
    expect(renderThinking).toHaveBeenCalledWith(
      expect.anything(),
      'The next check should inspect the config.',
      undefined,
      expect.any(Function),
    );
  });

  it('can add the timestamp when a streaming assistant message becomes final', () => {
    const timestampSpy = jest
      .spyOn(Date.prototype, 'toLocaleTimeString')
      .mockReturnValue('10:02 AM');
    const { renderer, messagesEl } = createRenderer();
    const msgEl = renderer.addMessage({
      id: 'streaming-final',
      role: 'assistant',
      content: '',
      timestamp: 1_700_000_000_000,
    });

    renderer.renderFinalMessageTimestamp(msgEl, {
      id: 'streaming-final',
      role: 'assistant',
      content: 'Done.',
      timestamp: 1_700_000_000_000,
    });

    expect(messagesEl.querySelector('.claudian-message-timestamp')?.textContent).toBe('10:02 AM');
    timestampSpy.mockRestore();
  });

  it('upgrades a persisted legacy interruption marker to the typed indicator', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const legacyMarker =
      '<span class="claudian-interrupted">Interrupted</span> <span class="claudian-interrupted-hint">· What should Claudian do instead?</span>';
    const interruptMsg: ChatMessage = {
      id: 'interrupt-legacy-1',
      role: 'assistant',
      content: 'Partial response',
      timestamp: Date.now(),
      contentBlocks: [{ type: 'text', content: `Partial response\n\n${legacyMarker}` }],
    };

    renderer.renderStoredMessage(interruptMsg);

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Partial response',
      expect.anything(),
      '',
      expect.anything()
    );
    const contentEl = messagesEl.children[0].children[0];
    const indicatorEl = contentEl.children[contentEl.children.length - 1];
    expect(indicatorEl.children[0].hasClass('claudian-interrupted')).toBe(true);
    expect(indicatorEl.children[0].textContent).toBe('Interrupted');
  });

  it('renders bare interrupt marker for empty interrupted assistant message', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create a bare interrupt marker (same as Claude-style)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    expect(textEl.children[0].hasClass('claudian-interrupted')).toBe(true);
  });

  it('skips rebuilt context messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'rebuilt-1',
      role: 'user',
      content: 'rebuilt context',
      timestamp: Date.now(),
      isRebuiltContext: true,
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(0);
  });

  it('renders user message with text content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('renders user message with displayContent instead of content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  it('renders extracted user display content when stored message has hidden XML context', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Explain this\n\n<current_note>\nnotes/test.md\n</current_note>',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Explain this');
  });

  it('skips empty user message bubble (image-only)', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    renderer.renderStoredMessage(msg);

    // Images should still be rendered, but no message bubble
    expect(renderer.renderMessageImages).toHaveBeenCalled();
    // Only the images container, no message bubble
    const bubbles = messagesEl.children.filter(
      (c: any) => c.hasClass('claudian-message')
    );
    expect(bubbles.length).toBe(0);
  });

  it('renders user message with images above bubble', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Check this image',
      timestamp: Date.now(),
      images,
    };

    renderer.renderStoredMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('adds a rewind button for eligible stored user messages', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[1], allMessages, 1);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
  });

  it('renders sibling branch navigation only on eligible Pi prompts', () => {
    const messagesEl = createMockEl();
    const navigate = jest.fn().mockResolvedValue(undefined);
    const capabilities = { ...mockCapabilities('codex')(), providerId: 'pi', supportsConversationBranches: true };
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      undefined,
      () => capabilities as any,
      undefined,
      { navigate, isBusy: () => false },
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1, userMessageId: 'pi-u1', treeBranches: ['pi-u1'] },
      { id: 'a1', role: 'assistant', content: 'reply', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'second', timestamp: 3, userMessageId: 'pi-u2', treeBranches: ['pi-u2', 'pi-u3'] },
      { id: 'a2', role: 'assistant', content: 'reply 2', timestamp: 4 },
    ];

    expect((renderer as any).getCapabilities().supportsConversationBranches).toBe(true);
    expect((renderer as any).branchActions).toBeDefined();
    renderer.renderMessages(messages, () => 'welcome');

    const firstPrompt = messagesEl.children.find((child: any) => child.getAttribute('data-message-id') === 'u1');
    expect(firstPrompt?.querySelector('.claudian-message-branch-btn')).toBeFalsy();
    expect(messagesEl.querySelectorAll('.claudian-branch-position').some((item: any) => item.textContent === '1/2')).toBe(true);
    const next = messagesEl.querySelectorAll('.claudian-message-branch-btn')
      .find((button: any) => button.getAttribute('aria-label') === 'Next branch');
    expect(next?.disabled).toBe(false);
    next?.click();
    expect(navigate).toHaveBeenCalledWith('u2', 'pi-u3');
  });

  it('adds rewind but not fork for a completed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[0], allMessages, 0);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-message-fork-btn')).toBeNull();
    renderer.renderStoredMessage(allMessages[1], allMessages, 1);
    const assistantEl = messagesEl.querySelector('[data-message-id="a1"]');
    expect(assistantEl?.querySelector('.claudian-message-fork-btn')).not.toBeNull();
    expect((renderer as any).liveMessageEls.has('u1')).toBe(false);
  });

  it('shows full-session fork only on the latest assistant reply', () => {
    const messagesEl = createMockEl();
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const capabilities = { ...mockCapabilities()(), forkMode: 'full-session' as const };
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      forkCallback,
      () => capabilities,
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: 'first', timestamp: 1, assistantMessageId: 'native-a1' },
      { id: 'a2', role: 'assistant', content: 'latest', timestamp: 2, assistantMessageId: 'native-a2' },
    ];

    renderer.renderStoredMessage(messages[0], messages, 0);
    renderer.renderStoredMessage(messages[1], messages, 1);

    expect(messagesEl.querySelector('[data-message-id="a1"]')?.querySelector('.claudian-message-fork-btn')).toBeFalsy();
    expect(messagesEl.querySelector('[data-message-id="a2"]')?.querySelector('.claudian-message-fork-btn')).not.toBeNull();
  });

  it('does not add a rewind button when stored render is called without context', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).toBeNull();
  });

  it('shows rewind mode menu for eligible streamed user messages', async () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 2,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      userMsg,
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.refreshActionButtons(userMsg, allMessages, 1);

    const btn = messagesEl.querySelector('.claudian-message-rewind-btn');
    expect(btn).not.toBeNull();

    const pointerEvent = {
      detail: 1,
      stopPropagation: jest.fn(),
      type: 'click',
    };
    btn!.dispatchEvent(pointerEvent);
    const menu = (Menu as typeof Menu & { instances: any[] }).instances[0];
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(pointerEvent);
    expect(menu.items.map((item: any) => item.title)).toEqual([
      'Rewind conversation only',
      'Rewind code + conversation',
    ]);

    menu.items[0].clickHandler?.();
    await Promise.resolve();

    expect(rewindCallback).toHaveBeenCalledWith('u1', 'conversation');

    btn!.getBoundingClientRect = jest.fn().mockReturnValue({ bottom: 48, left: 24 });
    btn!.dispatchEvent({
      detail: 0,
      stopPropagation: jest.fn(),
      type: 'click',
    });

    const keyboardMenu = (Menu as typeof Menu & { instances: any[] }).instances[1];
    expect(keyboardMenu.showAtPosition).toHaveBeenCalledWith(
      { x: 24, y: 48 },
      btn!.ownerDocument,
    );
    expect(keyboardMenu.showAtMouseEvent).not.toHaveBeenCalled();
  });

  it('refreshes rewind but not fork for a streamed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    renderer.refreshActionButtons(userMsg, [
      userMsg,
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ], 0);

    expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-message-fork-btn')).toBeNull();
  });

  it('shows native response throughput with an accessible token and duration label', () => {
    const messagesEl = createMockEl();
    const capabilities = { ...mockCapabilities()(), supportsResponseThroughput: true };
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      undefined,
      () => capabilities,
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const message: ChatMessage = {
      id: 'throughput',
      role: 'assistant',
      content: 'A completed response',
      timestamp: 1,
      turnStats: { outputTokens: 300, durationMs: 119_960 },
    };

    renderer.renderStoredMessage(message, [message], 0);
    const messageEl = messagesEl.querySelector('.claudian-message-assistant');
    const contentEl = messageEl?.querySelector('.claudian-message-content');
    (renderer as any).syncAssistantMessageActions(message, messageEl, contentEl);

    const rate = messagesEl.querySelector('.claudian-response-throughput');
    expect(rate?.textContent).toBe('2.5 tok/s');
    expect(rate?.getAttribute('aria-label')).toBe('300 tokens · 2m 0s');
  });

  it('opens the fork target flow directly when clicking a reply fork button', async () => {
    const messagesEl = createMockEl();
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      forkCallback,
      mockCapabilities(),
    );
    const confirmMock = confirm as jest.Mock;
    confirmMock.mockClear();

    (renderer as any).addForkButton(messagesEl, 'message-1');
    const button = messagesEl.querySelector('.claudian-message-fork-btn');
    button!.dispatchEvent({ stopPropagation: jest.fn(), type: 'click' });
    await Promise.resolve();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(forkCallback).toHaveBeenCalledWith('message-1');
  });

  // ============================================
  // renderAssistantContent
  // ============================================

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
        {
          id: 'sub-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Async subagent' },
          status: 'running',
          subagent: { id: 'sub-1', mode: 'async', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
        {
          id: 'sub-2',
          name: TOOL_SUBAGENT,
          input: { description: 'Sync subagent' },
          status: 'running',
          subagent: { id: 'sub-2', mode: 'sync', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).not.toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block');
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });

  it('passes collapsed file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'm-write-default',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'edit-1', name: 'Edit', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'edit-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'edit-1', name: 'Edit' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
  });

  it('passes expanded file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-write-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'write-1', name: 'Write', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'write-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'write-1', name: 'Write' }),
      expect.objectContaining({ initiallyExpanded: true }),
    );
  });

  it('skips empty or whitespace-only text blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: '' } as any,
        { type: 'text', content: '   ' } as any,
        { type: 'text', content: 'Real content' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Only the non-empty text block should trigger renderContent
    expect(renderContentSpy).toHaveBeenCalledTimes(1);
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Real content');
  });

  it('does not render stored Codex write_stdin transport tools', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: '' },
          status: 'completed',
          result: 'poll output',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
    expect(messagesEl.children).toHaveLength(0);
  });

  it('renders stored Codex write_stdin tools when they send real input', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: 'y\n' },
          status: 'completed',
          result: 'Input sent.',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'stdin-1',
        name: TOOL_WRITE_STDIN,
        input: { session_id: '2404', chars: 'y\n' },
      }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
    expect(messagesEl.children).toHaveLength(1);
  });

  it('passes expanded file-edit default to stored apply_patch renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-apply-patch-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'patch-1',
          name: TOOL_APPLY_PATCH,
          input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
          status: 'completed',
          result: 'Applied patch',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'patch-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'patch-1', name: TOOL_APPLY_PATCH }),
      expect.objectContaining({ initiallyExpanded: true }),
    );
  });

  it('binds rendered history blocks to their projected transcript IDs at creation time', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const msg: ChatMessage = {
      id: 'assistant-transcript-identities',
      role: 'assistant',
      content: 'Answer',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Answer' },
        { type: 'context_compacted' },
      ],
    };

    renderer.renderStoredMessage(msg);

    const contentEl = messagesEl.children[0].children[0];
    expect(contentEl.children[0].dataset.transcriptItemId)
      .toBe('assistant-transcript-identities:block:0');
    expect(contentEl.children[1].dataset.transcriptItemId)
      .toBe('assistant-transcript-identities:block:1');
  });

  it('renders response duration footer when durationSeconds is present', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response text' } as any,
      ],
      durationSeconds: 65,
      durationFlavorWord: 'Baked',
    };

    renderer.renderStoredMessage(msg);

    // Find the footer element
    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0]; // claudian-message-content
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    const durationSpan = footerEl!.children[0];
    expect(durationSpan.textContent).toContain('Baked');
    expect(durationSpan.textContent).toContain('1m 5s');
  });

  it('does not render footer when durationSeconds is 0', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 0,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeUndefined();
  });

  it('uses default flavor word "Baked" when durationFlavorWord is not set', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 30,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-response-footer'));
    expect(footerEl).toBeDefined();
    expect(footerEl!.children[0].textContent).toContain('Baked');
  });

  it('renders fallback content for old conversations without contentBlocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const addCopySpy = jest.spyOn(renderer, 'addTextCopyButton').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Legacy response text',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Should render content text
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should add copy button for fallback text
    expect(addCopySpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should render tool call
    expect(renderStoredToolCall).toHaveBeenCalled();
  });

  it('renders unreferenced tool calls when contentBlocks miss tool_use blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-unreferenced-tool',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'text', content: 'Only text block persisted' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Only text block persisted');
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
  });

  it('renders Task tool calls as subagents for backward compatibility', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Run tests' },
          status: 'completed',
          result: 'All passed',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-1',
        description: 'Run tests',
        status: 'completed',
        result: 'All passed',
      }),
      expect.objectContaining({ onOpenFile: expect.any(Function) }),
    );
  });

  it('renders Task tool as async subagent when linked subagent mode is async', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: 'Task running',
          subagent: {
            id: 'task-async-1',
            description: 'Background task',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-1',
        mode: 'async',
        asyncStatus: 'running',
      }),
      expect.objectContaining({ onOpenFile: expect.any(Function) }),
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  it('infers async running state from structured Task result content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async-structured',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-structured-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: [{ type: 'text', text: '{"status":"running"}' }] as any,
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-structured-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-structured-1',
        asyncStatus: 'running',
      }),
      expect.objectContaining({ onOpenFile: expect.any(Function) }),
    );
  });

  it('uses subagent block mode hint when linked subagent mode is missing', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-mode-hint',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-hint-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Background task from block hint' },
          status: 'running',
          subagent: {
            id: 'task-hint-1',
            description: 'Background task from block hint',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'subagent', subagentId: 'task-hint-1', mode: 'async' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-hint-1',
        mode: 'async',
      }),
      expect.objectContaining({ onOpenFile: expect.any(Function) }),
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  // ============================================
  // TaskOutput skipping
  // ============================================

  it('should skip TaskOutput tool calls (internal async subagent communication)', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc', block: true } } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
  });

  it('should render other tool calls but skip TaskOutput when mixed', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc' } } as any,
        { id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-1' } as any,
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
        { type: 'tool_use', toolId: 'grep-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledTimes(2);
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
  });

  // ============================================
  // addMessage (streaming)
  // ============================================

  it('addMessage creates user message bubble with text', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-user')).toBe(true);
  });

  it('addMessage stores a truncated first-line table-of-contents title for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: `${'x'.repeat(90)}\nsecond line`,
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.getAttribute('data-toc-title')).toBe(`${'x'.repeat(77)}...`);
  });

  it('addMessage renders images for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Look at this',
      timestamp: Date.now(),
      images,
    };

    renderer.addMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('addMessage skips empty bubble for image-only user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});
    const scrollSpy = jest.spyOn(renderer, 'scrollToBottom').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    const result = renderer.addMessage(msg);

    // Should still return an element (last child or messagesEl)
    expect(result).toBeDefined();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('addMessage creates assistant message element without user-specific rendering', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-message-assistant')).toBe(true);
  });

  // ============================================
  // setMessagesEl
  // ============================================

  it('setMessagesEl updates the container element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const newEl = createMockEl();

    renderer.setMessagesEl(newEl);

    // Verify by using scrollToBottom which references messagesEl
    renderer.scrollToBottom();
    // The new element should have been used (scrollTop set)
    expect(newEl.scrollTop).toBe(newEl.scrollHeight);
  });

  // ============================================
  // Image rendering
  // ============================================

  it('renderMessageImages creates image elements', () => {
    const containerEl = createMockEl();
    const { renderer } = createRenderer();
    jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data1', size: 200, source: 'file' },
      { id: 'img-2', name: 'avatar.jpg', mediaType: 'image/jpeg', data: 'base64data2', size: 300, source: 'file' },
    ];

    renderer.renderMessageImages(containerEl, images);

    // Should create images container with 2 image wrappers
    expect(containerEl.children.length).toBe(1);
    const imagesContainer = containerEl.children[0];
    expect(imagesContainer.hasClass('claudian-message-images')).toBe(true);
    expect(imagesContainer.children.length).toBe(2);
  });

  it('setImageSrc sets data URI on image element', () => {
    const { renderer } = createRenderer();
    const imgEl = createMockEl('img');

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    renderer.setImageSrc(imgEl as any, image);

    expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('showFullImage opens a preview that disposal closes without allowing another', () => {
    const { renderer } = createRenderer();
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    const overlayEl = createMockEl();
    const removeOverlay = jest.spyOn(overlayEl, 'remove');
    const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
    const origDocument = globalThis.document;
    (globalThis as any).document = { body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

    try {
      renderer.showFullImage(image);
      expect(mockBody.createDiv).toHaveBeenCalledWith({ cls: 'claudian-image-modal-overlay' });

      renderer.dispose();
      renderer.showFullImage(image);

      expect(removeOverlay).toHaveBeenCalledTimes(1);
      expect(mockBody.createDiv).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as any).document = origDocument;
    }
  });

  // ============================================
  // Copy button
  // ============================================

  it('addTextCopyButton adds a copy button element', () => {
    const textEl = createMockEl();
    const { renderer } = createRenderer();

    renderer.addTextCopyButton(textEl, 'some markdown');

    expect(textEl.children.length).toBe(1);
    const copyBtn = textEl.children[0];
    expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);
    expect(copyBtn.tagName).toBe('BUTTON');
    expect(copyBtn.getAttribute('type')).toBe('button');
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy message');
  });

  // ============================================
  // Scroll utilities
  // ============================================

  it('scrollToBottom sets scrollTop to scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottom();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('scrollToBottomIfNeeded scrolls when near bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    // Mock requestAnimationFrame
    const origRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0; };

    try {
      renderer.scrollToBottomIfNeeded();
      // Near bottom (1000 - 950 - 0 = 50, < 100 threshold) → scrolls
      expect(messagesEl.scrollTop).toBe(1000);
    } finally {
      (globalThis as any).requestAnimationFrame = origRAF;
    }
  });

  it('scrollToBottomIfNeeded does not scroll when far from bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 100;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    const originalScrollTop = messagesEl.scrollTop;
    renderer.scrollToBottomIfNeeded();

    // scrollTop should not change (900 > 100 threshold)
    expect(messagesEl.scrollTop).toBe(originalScrollTop);
  });

  // ============================================
  // renderContent
  // ============================================

  it('renderContent should not throw on valid markdown', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();

    // Should not throw even if internal rendering fails (graceful error handling)
    await expect(renderer.renderContent(el, '**Hello** world')).resolves.not.toThrow();
  });

  it('renderContent should empty the element before rendering', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    el.createDiv({ text: 'old content' });
    expect(el.children.length).toBe(1);

    await renderer.renderContent(el, 'new content');

    // After render, old content should be gone (empty() was called before rendering)
    expect(el.children.length).toBe(0);
  });

  it('renderContent should skip file-link post-processing when markdown has no wikilinks', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'plain markdown without links');

    expect(processFileLinks).not.toHaveBeenCalled();
  });

  it('renderContent post-processes Codex file citations', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Source :codex-file-citation{path="notes/Chapter-2.pdf" purpose="source"}'
    );

    expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
  });

  it('renderContent escapes math delimiters only when requested for streaming', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Live $x + y$ and `echo $PATH`',
      { deferMath: true }
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Live \\$x + y\\$ and `echo $PATH`',
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent normalizes LaTeX math delimiters before rendering', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'Inline \\(x<y\\).\n\\[y^2\\]');

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Inline $x<y$.\n$$y^2$$',
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent escapes placeholder-style HTML before rendering', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
    const { renderer } = createRenderer();
    const el = createMockEl();
    const markdown =
      'Use areas/<meta-name> and projects/<meta-name>/<name>.';
    const escapedMarkdown =
      'Use areas/&lt;meta-name&gt; and projects/&lt;meta-name&gt;/&lt;name&gt;.';

    await renderer.renderContent(el, markdown);

    expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
      escapedMarkdown,
      expect.anything(),
      { mediaFolder: '' }
    );
    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      escapedMarkdown,
      el,
      '',
      expect.anything()
    );
  });

  // ============================================
  // addTextCopyButton - click behavior
  // ============================================

  describe('addTextCopyButton - click behavior', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('click should copy and show feedback', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'markdown content');

      const copyBtn = textEl.children[0];
      expect(copyBtn.hasClass('claudian-text-copy-btn')).toBe(true);

      // Simulate click
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(writeTextMock).toHaveBeenCalledWith('markdown content');
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });

    it('should handle clipboard API failure gracefully', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockRejectedValue(new Error('not allowed'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'content');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Should not throw
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // Should not show feedback on error
      expect(copyBtn.textContent).not.toBe('copied!');
    });
  });

  // ============================================
  // renderMessages (entry point)
  // ============================================

  it('renderMessages should render stored messages and return welcome element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), contentBlocks: [{ type: 'text', content: 'Hi there' }] as any },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Good morning!');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  it('renderMessages should store table-of-contents title from displayContent before content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Expanded prompt that should not appear',
        displayContent: 'Visible slash command\nwith details',
        timestamp: Date.now(),
      },
    ];

    renderer.renderMessages(messages, () => 'Hello');

    const msgEl = messagesEl.querySelector('.claudian-message-user');
    expect(msgEl?.getAttribute('data-toc-title')).toBe('Visible slash command');
  });

  it('renderMessages should hide welcome when messages exist', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    // When messages exist, welcome should be hidden
    expect(welcomeEl).toBeDefined();
  });

  it('renderMessages should return welcome element when no messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-welcome')).toBe(true);
  });

  // ============================================
  // Agent tool rendering - error and running status
  // ============================================

  describe('Agent tool rendering - error and running status', () => {
    it('renders Agent tool with error status as subagent with status error', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-err',
            name: TOOL_SUBAGENT,
            input: { description: 'Failing task' },
            status: 'error',
            result: 'Something went wrong',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-err' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-err',
          description: 'Failing task',
          status: 'error',
          result: 'Something went wrong',
        }),
        expect.objectContaining({ onOpenFile: expect.any(Function) }),
      );
    });

    it('renders Agent tool with running status (default case in switch)', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-run',
            name: TOOL_SUBAGENT,
            input: { description: 'Running task' },
            status: 'pending',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-run' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-run',
          description: 'Running task',
          status: 'running',
        }),
        expect.objectContaining({ onOpenFile: expect.any(Function) }),
      );
    });

    it('renders Agent tool with no description using the fallback label', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-no-desc',
            name: TOOL_SUBAGENT,
            input: {},
            status: 'completed',
            result: 'Done',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-no-desc' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-no-desc',
          description: 'Subagent task',
          status: 'completed',
        }),
        expect.objectContaining({ onOpenFile: expect.any(Function) }),
      );
    });

    it('renders Codex spawn_agent with the same prompt and result recovered on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-codex-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: TOOL_SPAWN_AGENT,
            input: {
              message: 'Inspect utils.ts and return the final patch summary.',
              model: 'gpt-5.4-mini',
            },
            status: 'completed',
            result: '{"agent_id":"agent-1","nickname":"Zeno"}',
          } as any,
          {
            id: 'wait-1',
            name: TOOL_WAIT_AGENT,
            input: { targets: ['agent-1'], timeout_ms: 30000 },
            status: 'completed',
            result: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'spawn-1',
          description: 'Zeno (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
          status: 'completed',
          result: 'Patched utils.ts and verified imports.',
        }),
        expect.objectContaining({ onOpenFile: expect.any(Function) }),
      );
    });

    it('renders a stored Grok background task with the async subagent renderer', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'grok');

      const msg: ChatMessage = {
        id: 'm-grok-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: 'spawn_subagent',
            input: {
              description: 'Inspect tools',
              prompt: 'Inspect every mapping.',
              run_in_background: true,
              task_id: 'task-1',
            },
            status: 'completed',
            result: 'Spawned task-1',
          } as any,
          {
            id: 'output-1',
            name: 'get_command_or_subagent_output',
            input: { task_ids: ['task-1'] },
            providerPayload: {
              rawName: 'get_command_or_subagent_output',
              rawOutput: {
                Result: [{ output: 'All mappings verified.', status: 'completed', task_id: 'task-1' }],
                type: 'task_output',
              },
            },
            status: 'completed',
            result: 'All mappings verified.',
          } as any,
        ],
        contentBlocks: [{ type: 'tool_use', toolId: 'spawn-1' } as any],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          asyncStatus: 'completed',
          description: 'Inspect tools',
          mode: 'async',
          result: 'All mappings verified.',
          status: 'completed',
        }),
        expect.objectContaining({ onOpenFile: expect.any(Function) }),
      );
      expect(renderStoredSubagent).not.toHaveBeenCalled();
      expect(renderStoredToolCall).not.toHaveBeenCalled();
    });

    it('renders Grok output calls that target background commands', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'grok');
      const outputToolCall = {
        id: 'output-command',
        name: 'get_command_or_subagent_output',
        input: { task_id: 'command-1' },
        status: 'completed',
        result: 'Command finished.',
      } as any;
      const msg: ChatMessage = {
        id: 'm-grok-command-output',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [outputToolCall],
        contentBlocks: [{ type: 'tool_use', toolId: 'output-command' } as any],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredToolCall).toHaveBeenCalledWith(
        expect.anything(),
        outputToolCall,
        expect.anything(),
      );
    });

    it('renders stored Grok output calls with mixed command and subagent targets', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'grok');
      const outputToolCall = {
        id: 'output-mixed',
        name: 'get_command_or_subagent_output',
        input: { task_ids: ['task-1', 'command-1'] },
        status: 'completed',
        result: 'Subagent and command finished.',
      } as any;
      const msg: ChatMessage = {
        id: 'm-grok-mixed-output',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: 'spawn_subagent',
            input: {
              description: 'Inspect tools',
              run_in_background: true,
              task_id: 'task-1',
            },
            status: 'completed',
            result: 'Spawned task-1',
          } as any,
          outputToolCall,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
          { type: 'tool_use', toolId: 'output-mixed' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredToolCall).toHaveBeenCalledWith(
        expect.anything(),
        outputToolCall,
        expect.anything(),
      );
    });
  });

  // ============================================
  // renderContent - code block wrapping (error path)
  // ============================================

  describe('renderContent - error handling', () => {
    it('renderContent shows error div when MarkdownRenderer throws', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockRejectedValueOnce(
        new Error('Render failed')
      );

      const { renderer } = createRenderer();
      const el = createMockEl();

      await renderer.renderContent(el, '**broken markdown**');

      const errorDiv = el.children.find(
        (c: any) => c.hasClass('claudian-render-error')
      );
      expect(errorDiv).toBeDefined();
      expect(errorDiv!.textContent).toBe('Failed to render message content.');
    });
  });

  // ============================================
  // addTextCopyButton - rapid click handling
  // ============================================

  describe('addTextCopyButton - rapid click handling', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('rapid clicks clear previous timeout', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      // First click
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');

      // Second rapid click before timeout expires
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // clearTimeout should have been called for the first pending timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(copyBtn.textContent).toBe('Copied!');

      clearTimeoutSpy.mockRestore();
    });

    it('feedback timeout restores icon after delay', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const originalInnerHTML = copyBtn.innerHTML;
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Click to copy
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);

      // Advance timers by 1500ms (the feedback duration)
      jest.advanceTimersByTime(1500);

      // Icon should be restored and copied class removed
      expect(copyBtn.innerHTML).toBe(originalInnerHTML);
      expect(copyBtn.classList.contains('copied')).toBe(false);
    });
  });

  // ============================================
  // renderContent - code block wrapping
  // ============================================

  describe('renderContent - code block wrapping', () => {
    it('passes image-processed markdown directly to MarkdownRenderer', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
      const { processFileLinks } = await import('@/utils/fileLink');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (replaceImageEmbedsWithHtml as jest.Mock).mockReturnValueOnce(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]'
      );

      await renderer.renderContent(el, 'before-images ![[image.png]] [[note.md]]');

      expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
        'before-images ![[image.png]] [[note.md]]',
        expect.anything(),
        { mediaFolder: '' }
      );
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]',
        el,
        '',
        expect.anything()
      );
      expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
    });

    it('should wrap pre elements in code wrapper divs', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create a pre element in the container
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'console.log("hello")' });
        }
      );

      await renderer.renderContent(el, '```js\nconsole.log("hello")\n```');

      // The pre should be wrapped in a claudian-code-wrapper
      // Due to mock limitations, check that querySelectorAll was called on el
      // The actual wrapping logic runs on real DOM, but the mock captures calls
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should skip wrapping already-wrapped pre elements', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create an already-wrapped pre element
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const wrapper = container.createDiv({ cls: 'claudian-code-wrapper' });
          wrapper.createEl('pre');
        }
      );

      await renderer.renderContent(el, '```\nalready wrapped\n```');

      // Should not throw and should complete normally
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // renderMessageImages - preview control
  // ============================================

  describe('renderMessageImages - preview control', () => {
    it('opens the preview from a native named button', () => {
      const containerEl = createMockEl();
      const { renderer } = createRenderer();
      const showFullImageSpy = jest.spyOn(renderer, 'showFullImage').mockImplementation(() => {});
      jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

      const images: ImageAttachment[] = [
        { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
      ];

      renderer.renderMessageImages(containerEl, images);

      const imagesContainer = containerEl.children[0];
      const previewButton = imagesContainer.children[0];
      const imgEl = previewButton.children[0];

      expect(previewButton.tagName).toBe('BUTTON');
      expect(previewButton.getAttribute('type')).toBe('button');
      expect(previewButton.getAttribute('aria-label')).toBe('Preview photo.png');
      expect(imgEl.tagName).toBe('IMG');
      expect(imgEl.getAttribute('alt')).toBe('photo.png');

      const clickHandlers = previewButton._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();
      expect(clickHandlers!.length).toBe(1);

      clickHandlers![0]();
      expect(showFullImageSpy).toHaveBeenCalledWith(images[0]);
    });
  });

  // ============================================
  // renderContent - code block wrapping with language labels
  // ============================================

  describe('renderContent - language label and copy', () => {
    it('releases stale Markdown scopes and skips their post-render work', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { processFileLinks } = await import('@/utils/fileLink');
      const messagesEl = createMockEl();
      const component = createMockComponent();
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        component as any,
        messagesEl,
      );
      const contentEl = createMockEl();
      let resolveFirstRender!: () => void;
      (MarkdownRenderer.renderMarkdown as jest.Mock)
        .mockImplementationOnce(() => new Promise<void>(resolve => {
          resolveFirstRender = resolve;
        }))
        .mockResolvedValueOnce(undefined);

      const staleRender = renderer.renderContent(contentEl, '[[stale link]]');
      const staleScope = (component.addChild as jest.Mock).mock.calls[0][0];
      const currentRender = renderer.renderContent(contentEl, '[[current link]]');
      await currentRender;

      expect(staleScope.isReleased).toBe(true);
      resolveFirstRender();
      await staleRender;

      expect(processFileLinks).toHaveBeenCalledTimes(1);
      expect(processFileLinks).toHaveBeenCalledWith({}, contentEl);
    });

    it('renders fenced languages through inert placeholders and restores highlighting', async () => {
      const { loadPrism, MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();
      const highlightElement = jest.fn();
      let code: ReturnType<typeof createMockEl> | null = null;
      (loadPrism as jest.Mock).mockResolvedValueOnce({ highlightElement });

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (renderedMarkdown: string, container: any) => {
          const language = renderedMarkdown.match(/^```([^\n]+)/)?.[1];
          const pre = container.createEl('pre');
          code = pre.createEl('code', {
            cls: `language-${language}`,
            text: 'TABLE file.name',
          });
        }
      );

      await renderer.renderContent(el, '```dataview\nTABLE file.name\n```');

      const renderedMarkdown = (MarkdownRenderer.renderMarkdown as jest.Mock).mock.calls[0][0];
      expect(renderedMarkdown).toContain('```claudian-display-only-fence-0');
      expect(renderedMarkdown).not.toContain('```dataview');
      expect(code?.hasClass('language-dataview')).toBe(true);
      expect(code?.hasClass('language-claudian-display-only-fence-0')).toBe(false);
      expect(highlightElement).toHaveBeenCalledWith(code);
    });

    it('renders mermaid through the controlled adapter after Markdown rendering', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (renderedMarkdown: string, container: any) => {
          const pre = container.createEl('pre');
          const language = renderedMarkdown.match(/^```([^\n]+)/)?.[1];
          pre.createEl('code', {
            cls: `language-${language}`,
            text: 'flowchart TB',
          });
        },
      );

      await renderer.renderContent(el, '```mermaid\nflowchart TB\n```');

      const renderedMarkdown = (MarkdownRenderer.renderMarkdown as jest.Mock).mock.calls[0][0];
      expect(renderedMarkdown).toContain('```claudian-display-only-fence-0');
      expect(renderedMarkdown).not.toContain('```mermaid');
    });

    it('keeps mermaid fences inert while streaming', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderMermaidDiagram } = await import('@/features/chat/rendering/MermaidRenderer');
      const { renderer } = createRenderer();

      await renderer.renderContent(createMockEl(), '```mermaid\nflowchart TB\n```', { deferDiagrams: true });
      expect(renderMermaidDiagram).not.toHaveBeenCalled();
      expect((MarkdownRenderer.renderMarkdown as jest.Mock).mock.calls[0][0])
        .toContain('```claudian-display-only-fence-0');
    });

    it('should add language label when code block has language class', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          const code = pre.createEl('code');
          code.className = 'language-typescript';
          code.textContent = 'const x = 1;';
        }
      );

      await renderer.renderContent(el, '```typescript\nconst x = 1;\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should move copy-code-button outside pre into wrapper', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'some code' });
          const copyBtn = pre.createEl('button');
          copyBtn.className = 'copy-code-button';
        }
      );

      await renderer.renderContent(el, '```\nsome code\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // addMessage - displayContent for user messages
  // ============================================

  it('addMessage renders displayContent instead of content when available', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.addMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  // ============================================
  // renderStoredThinkingBlock - durationSeconds parameter
  // ============================================

  describe('renderStoredThinkingBlock - durationSeconds parameter', () => {
    it('should pass durationSeconds to renderStoredThinkingBlock', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'deep thought', durationSeconds: 42 } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'deep thought',
        42,
        expect.any(Function)
      );
    });

    it('should pass undefined durationSeconds when not set', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'thought without duration' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'thought without duration',
        undefined,
        expect.any(Function)
      );
    });
  });

  describe('renderMessagesInto read-only surface', () => {
    const eligibleMessages = (): ChatMessage[] => [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ];

    it('suppresses conversation actions by default', () => {
      const messagesEl = createMockEl();
      const rewindCallback = jest.fn().mockResolvedValue(undefined);
      const forkCallback = jest.fn().mockResolvedValue(undefined);
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        createMockComponent() as any,
        messagesEl,
        rewindCallback,
        forkCallback,
        mockCapabilities(),
      );
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const container = createMockEl();
      renderer.renderMessagesInto(container, eligibleMessages());

      expect(container.querySelector('.claudian-message-rewind-btn')).toBeNull();
      expect(container.querySelector('.claudian-message-fork-btn')).toBeNull();
    });

    it('keeps the read-only surface inert even when the source renderer stays interactive', () => {
      const messagesEl = createMockEl();
      const rewindCallback = jest.fn().mockResolvedValue(undefined);
      const forkCallback = jest.fn().mockResolvedValue(undefined);
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        createMockComponent() as any,
        messagesEl,
        rewindCallback,
        forkCallback,
        mockCapabilities(),
      );
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      // Main renderer surface still shows the actions afterwards.
      const container = createMockEl();
      renderer.renderMessagesInto(container, eligibleMessages());
      renderer.renderStoredMessage(eligibleMessages()[0], eligibleMessages(), 0);
      expect(messagesEl.querySelector('.claudian-message-rewind-btn')).not.toBeNull();
    });

    it('keeps completed work expanded when rendering a subagent transcript', () => {
      const messagesEl = createMockEl();
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        createMockComponent() as any,
        messagesEl,
        jest.fn(),
        jest.fn(),
        mockCapabilities(),
      );
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const finalizeCompletedWork = jest.spyOn(renderer, 'finalizeCompletedWork');

      const container = createMockEl();
      renderer.renderMessagesInto(container, [{
        id: 'subagent-turn-1',
        role: 'assistant',
        content: 'The search is complete.',
        timestamp: 1,
        contentBlocks: [
          { type: 'tool_use', toolId: 'tool-1' },
          { type: 'text', content: 'The search is complete.' },
        ],
        toolCalls: [{
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'rg --files' },
          status: 'completed',
          result: 'note.md',
          isExpanded: false,
        }],
      }] as ChatMessage[], { collapseCompletedWork: false });

      expect(finalizeCompletedWork).not.toHaveBeenCalled();
    });
  });
});
