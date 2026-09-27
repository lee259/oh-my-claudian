import { TurnSubmissionBuilder } from '@/features/chat/controllers/TurnSubmissionBuilder';

describe('TurnSubmissionBuilder', () => {
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
