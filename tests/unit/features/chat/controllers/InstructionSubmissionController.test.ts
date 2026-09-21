import { InstructionSubmissionController } from '@/features/chat/controllers/InstructionSubmissionController';

const modalCallbacks: {
  onAccept: (instruction: string) => void;
  onReject: () => void;
  onClarificationSubmit: (response: string) => Promise<void>;
} = {} as never;

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
}));

jest.mock('@/shared/modals/InstructionConfirmModal', () => ({
  InstructionModal: jest.fn().mockImplementation((_app, _instruction, callbacks) => {
    Object.assign(modalCallbacks, callbacks);
    return {
      open: jest.fn(),
      showClarification: jest.fn(),
      showConfirmation: jest.fn(),
      showError: jest.fn(),
    };
  }),
}));

describe('InstructionSubmissionController', () => {
  it('cancels the refinement session before accepting the final instruction', async () => {
    const settings = { systemPrompt: 'Existing prompt' };
    const instructionRefineService = {
      cancel: jest.fn(),
      continueConversation: jest.fn(),
      refineInstruction: jest.fn().mockResolvedValue({
        success: true,
        refinedInstruction: 'Refined instruction',
      }),
      resetConversation: jest.fn(),
      setModelOverride: jest.fn(),
    };
    const plugin = {
      app: {},
      settings,
      mutateSettings: jest.fn(async (update: (next: typeof settings) => void) => {
        update(settings);
      }),
    } as never;
    const controller = new InstructionSubmissionController({
      plugin,
      getInstructionRefineService: () => instructionRefineService,
      getInstructionModeManager: () => null,
      getModelOverride: () => null,
    });

    await controller.submit('Make it concise');
    modalCallbacks.onAccept('Final instruction');
    await Promise.resolve();

    expect(instructionRefineService.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the refinement session when refinement fails', async () => {
    const instructionRefineService = {
      cancel: jest.fn(),
      continueConversation: jest.fn(),
      refineInstruction: jest.fn().mockResolvedValue({
        success: false,
        error: 'Failed to refine',
      }),
      resetConversation: jest.fn(),
      setModelOverride: jest.fn(),
    };
    const controller = new InstructionSubmissionController({
      plugin: { app: {}, settings: { systemPrompt: '' } } as never,
      getInstructionRefineService: () => instructionRefineService,
      getInstructionModeManager: () => null,
      getModelOverride: () => null,
    });

    await controller.submit('Make it concise');

    expect(instructionRefineService.cancel).toHaveBeenCalledTimes(1);
  });
});
