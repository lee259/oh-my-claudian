/** @jest-environment jsdom */

import '@/providers';

import type { ProviderApprovalInteractionRequest } from '@/core/execution/ProviderInteractionPort';
import type { ToolCallInfo } from '@/core/types';
import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';
import { setLocale } from '@/i18n/i18n';

HTMLElement.prototype.empty = function (): void { this.replaceChildren(); };
HTMLElement.prototype.setText = function (text: string): void { this.textContent = text; };
HTMLElement.prototype.scrollIntoView ??= () => undefined;

function fixture(attached = true) {
  const parent = document.body.createDiv();
  const composer = document.createElement('div');
  if (attached) parent.appendChild(composer);
  const state = new ChatState();
  state.currentConversationId = 'conversation-1';
  let id = 0;
  const deps = {
    state,
    plugin: { app: {}, settings: { permissionMode: 'normal' } },
    renderer: { renderContent: async (el: HTMLElement, content: string) => { el.textContent = content; } },
    streamController: { hideThinkingIndicator: () => undefined },
    getInputContainerEl: () => composer,
    getInputEl: () => document.createElement('textarea'),
    getExecutionCoordinator: () => null,
    getTabProviderId: () => 'claude',
    generateId: () => `id-${++id}`,
  } as unknown as InputControllerDeps;
  const controller = new InputController(deps);
  return { controller, state, parent, composer, replaceController: () => new InputController(deps), cleanup: () => {
    controller.dismissPendingApproval(); controller.detachInteractionPresentation(); parent.remove();
  } };
}

const approval: ProviderApprovalInteractionRequest = {
  kind: 'approval', interactionId: 'approval-1', sessionInstanceId: 'session-1', turnId: 'turn-1',
  toolName: 'Bash', input: { command: 'ls' }, description: 'List notes',
};

async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

it.each([['拒绝', 'deny'], ['允许一次', 'allow'], ['始终允许', 'allow-always']])(
  'localizes the default approval %s without changing its decision', async (label, decision) => {
    setLocale('zh-CN');
    const f = fixture();
    try {
      const result = f.state.interactions.requestApproval(approval, new AbortController().signal);
      expect(f.parent.textContent).toContain('需要权限');
      expect(f.parent.textContent).toContain('List notes');
      const button = [...f.parent.querySelectorAll<HTMLElement>('.claudian-ask-item')]
        .find(el => el.textContent?.includes(label));
      expect(button).toBeDefined();
      button!.click();
      await expect(result).resolves.toEqual({ interactionId: 'approval-1', decision });
    } finally { f.cleanup(); setLocale('en'); }
  },
);

it('keeps async user-message questions pending without a mounted composer', async () => {
  const f = fixture(false);
  const tool: ToolCallInfo = { id: 'ask-1', name: 'AskUserQuestion', status: 'completed', input: {
    replyMode: 'user-message', questions: [{ question: 'Which note?', options: [{ label: 'Daily', description: 'Use daily note' }] }],
  } };
  f.state.addMessage({ id: 'message-1', role: 'assistant', content: '', timestamp: 1, toolCalls: [tool] });
  try {
    f.controller.updateAsyncQuestion(tool);
    await tick();
    expect(tool.questionStatus).toBe('pending');
    expect(f.state.requiresAction).toBe(true);
    f.parent.appendChild(f.composer);
    f.controller.attachInteractionPresentation();
    expect(f.parent.querySelector('.claudian-ask-question-inline')?.textContent).toContain('Which note?');
  } finally { f.cleanup(); }
});

it('remounts an approval and ignores clicks on the removed prompt', async () => {
  const f = fixture();
  try {
    const result = f.state.interactions.requestApproval(approval, new AbortController().signal);
    const oldButton = f.parent.querySelector<HTMLElement>('.claudian-ask-item')!;
    expect(oldButton).not.toBeNull();
    f.controller.detachInteractionPresentation();
    expect(f.parent.querySelector('.claudian-ask-question-inline')).toBeNull();
    expect(f.state.requiresAction).toBe(true);
    oldButton.click();
    await tick();
    expect(f.state.interactions.pending).toHaveLength(1);
    f.controller.attachInteractionPresentation();
    [...f.parent.querySelectorAll<HTMLElement>('.claudian-ask-item')].find(el => el.textContent?.includes('Allow once'))!.click();
    await expect(result).resolves.toEqual({ interactionId: 'approval-1', decision: 'allow' });
    expect(f.composer.style.display).toBe('');
    expect(f.state.requiresAction).toBe(false);
  } finally { f.cleanup(); }
});

it('shows one prompt at a time and restores provider plan presentation after detach', async () => {
  const f = fixture();
  try {
    const permission = f.state.interactions.requestApproval(approval, new AbortController().signal);
    const plan = f.state.interactions.requestPlanDecision({ kind: 'plan-decision', interactionId: 'plan-1', sessionInstanceId: 'session-1', turnId: 'turn-1', input: { plan: 'Use a narrow refactor' }, presentation: { allowNewSession: false, approveLabel: 'Apply plan' } }, new AbortController().signal);
    expect(f.parent.querySelectorAll('.claudian-ask-question-inline')).toHaveLength(1);
    expect(f.parent.querySelector('.claudian-plan-approval-inline')).toBeNull();
    f.parent.querySelector<HTMLElement>('.claudian-ask-item')!.click();
    await permission; await tick();
    f.controller.detachInteractionPresentation();
    f.controller.attachInteractionPresentation();
    expect(f.parent.textContent).toContain('Apply plan');
    expect(f.parent.textContent).not.toContain('Approve (new session)');
    f.parent.querySelector<HTMLElement>('.claudian-plan-approval-inline .claudian-ask-item')!.click();
    await expect(plan).resolves.toEqual({ interactionId: 'plan-1', decision: { type: 'approve' } });
    expect(f.composer.style.display).toBe('');
  } finally { f.cleanup(); }
});

it('keeps one async question owner when the presentation controller is replaced', async () => {
  const f = fixture(false);
  const tool: ToolCallInfo = { id: 'ask-replace', name: 'AskUserQuestion', status: 'completed', input: {
    replyMode: 'user-message', questions: [{ question: 'Which note?', options: [{ label: 'Daily', description: '' }] }],
  } };
  f.state.addMessage({ id: 'message-1', role: 'assistant', content: '', timestamp: 1, toolCalls: [tool] });
  try {
    f.controller.updateAsyncQuestion(tool);
    f.parent.appendChild(f.composer);
    const replacement = f.replaceController();
    replacement.updateAsyncQuestion(tool);
    await tick();
    expect(tool.questionStatus).toBe('pending');
    expect(f.state.interactions.pending).toHaveLength(1);
    expect(f.parent.querySelectorAll('.claudian-ask-question-inline')).toHaveLength(1);
    replacement.dismissPendingApproval();
    replacement.detachInteractionPresentation();
  } finally { f.cleanup(); }
});

it('restores local plan confirmation without invalidating it when presentation detaches', async () => {
  const f = fixture(false);
  try {
    const result = f.state.interactions.requestLocalPlanApproval({ kind: 'local-plan', interactionId: 'local-plan-1' }, new AbortController().signal);
    f.parent.appendChild(f.composer);
    f.controller.attachInteractionPresentation();
    const oldPrompt = f.parent.querySelector<HTMLElement>('.claudian-plan-approval-inline')!;
    f.controller.detachInteractionPresentation();
    oldPrompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    expect(f.state.interactions.pending).toHaveLength(1);
    f.controller.attachInteractionPresentation();
    f.parent.querySelector<HTMLElement>('.claudian-plan-approval-inline')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await expect(result).resolves.toEqual({ interactionId: 'local-plan-1', decision: { type: 'implement' }, invalidated: false });
    expect(f.state.requiresAction).toBe(false);
    expect(f.composer.style.display).toBe('');
  } finally { f.cleanup(); }
});
