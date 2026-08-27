import type { ProviderInteractionPort } from '@/core/execution';
import {
  PiExtensionUiInteractionAdapter,
  type PiExtensionUiRenderer,
} from '@/providers/pi/runtime/PiExtensionUiInteractionAdapter';

function createInteractionPort(): jest.Mocked<ProviderInteractionPort> {
  return {
    askUserQuestion: jest.fn(),
    dismissInteraction: jest.fn(),
    requestApproval: jest.fn(),
    requestPlanDecision: jest.fn(),
  };
}

function createFallback(): jest.Mocked<PiExtensionUiRenderer> {
  return {
    confirm: jest.fn(),
    editor: jest.fn(),
    input: jest.fn(),
    notify: jest.fn(),
    select: jest.fn(),
    setEditorText: jest.fn(),
    setStatus: jest.fn(),
    setTitle: jest.fn(),
    setWidget: jest.fn(),
  };
}

describe('PiExtensionUiInteractionAdapter', () => {
  it('adapts a Pi select request to the shared question presentation', async () => {
    const interactionPort = createInteractionPort();
    interactionPort.askUserQuestion.mockResolvedValue({
      answers: { 'pi-extension-ui-42': 'choice-b' },
      interactionId: 'pi-extension:session-1:42',
    });
    const adapter = new PiExtensionUiInteractionAdapter(createFallback(), {
      interactionPort,
      sessionInstanceId: 'session-1',
      getTurnId: () => 'turn-1',
    });

    await expect(adapter.select({
      id: '42',
      message: 'Choose a deployment target.',
      options: [
        { label: 'Preview', value: 'preview' },
        { label: 'Production', value: 'choice-b' },
      ],
      title: 'Deploy',
      type: 'extension_ui_request',
    }, new AbortController().signal)).resolves.toEqual({ value: 'choice-b' });

    expect(interactionPort.askUserQuestion).toHaveBeenCalledWith({
      interactionId: 'pi-extension:session-1:42',
      input: {
        questions: [{
          header: 'Deploy',
          id: 'pi-extension-ui-42',
          isOther: false,
          multiSelect: false,
          options: [
            { description: '', label: 'Preview', value: 'preview' },
            { description: '', label: 'Production', value: 'choice-b' },
          ],
          question: 'Choose a deployment target.',
        }],
      },
      kind: 'question',
      nativeContext: { extensionRequestId: '42' },
      sessionInstanceId: 'session-1',
      turnId: 'turn-1',
    }, expect.any(AbortSignal));
  });

  it('preserves cancellation when the shared question is dismissed', async () => {
    const interactionPort = createInteractionPort();
    interactionPort.askUserQuestion.mockResolvedValue({
      answers: null,
      interactionId: 'pi-extension:session-1:42',
    });
    const adapter = new PiExtensionUiInteractionAdapter(createFallback(), {
      interactionPort,
      sessionInstanceId: 'session-1',
      getTurnId: () => 'turn-1',
    });

    await expect(adapter.select({
      id: '42',
      options: ['Preview'],
      type: 'extension_ui_request',
    }, new AbortController().signal)).resolves.toEqual({ cancelled: true });
  });

  it('keeps unsupported and out-of-turn requests on the native renderer', async () => {
    const interactionPort = createInteractionPort();
    const fallback = createFallback();
    fallback.select.mockResolvedValue({ value: 'native-choice' });
    fallback.confirm.mockResolvedValue({ confirmed: true });
    const adapter = new PiExtensionUiInteractionAdapter(fallback, {
      interactionPort,
      sessionInstanceId: 'session-1',
      getTurnId: () => null,
    });

    await expect(adapter.select({
      id: '42',
      options: ['Preview'],
      type: 'extension_ui_request',
    }, new AbortController().signal)).resolves.toEqual({ cancelled: true });
    await expect(adapter.confirm({
      id: '43',
      type: 'extension_ui_request',
    }, new AbortController().signal)).resolves.toEqual({ confirmed: true });

    expect(interactionPort.askUserQuestion).not.toHaveBeenCalled();
    expect(fallback.select).not.toHaveBeenCalled();
    expect(fallback.confirm).toHaveBeenCalled();
  });
});
