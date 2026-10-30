import { TurnSubmissionBuilder } from '@/features/chat/controllers/TurnSubmissionBuilder';
import { McpServerSelector } from '@/features/chat/ui/InputToolbar';

describe('TurnSubmissionBuilder', () => {
  it('passes mentioned MCP servers through the turn request without a picker', () => {
    const selection = new McpServerSelector();
    selection.setMcpManager({ isLoaded: () => true, getServers: () => [{ name: 'docs', enabled: true }] } as never);
    selection.addMentionedServers(new Set(['docs']));
    const builder = new TurnSubmissionBuilder({
      getFileContextManager: () => null,
      getExternalContextSelector: () => null,
      getMcpServerSelector: () => selection,
      selectionController: { getContext: () => null },
      canvasSelectionController: { getContext: () => null },
    } as never);
    expect(builder.buildRequest({ content: 'hello' }).turnRequest.enabledMcpServers).toEqual(new Set(['docs']));
  });

  it('uses the active tab provider settings for execution reasoning', () => {
    const builder = new TurnSubmissionBuilder({
      plugin: {
        settings: { systemPrompt: '', useClaudianSystemPrompt: false },
      },
      state: { messages: [] },
      getProviderId: () => 'claude',
      getProviderSettings: () => ({
        permissionMode: 'normal',
        effortLevel: 'low',
        thinkingBudget: 'medium',
      }),
      getProviderCapabilities: () => ({ supportsPlanMode: false }),
      getAuxiliaryModel: () => null,
      generateId: () => 'input-record',
    } as never);

    const submission = builder.buildExecutionSubmission('prompt', {} as never);

    expect(submission.configuration.reasoning).toBe('low');
  });
});
