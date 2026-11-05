/** @jest-environment jsdom */

import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ModelSelectorView, type ModelSelectorViewProps } from '@/features/chat/ui/ModelSelectorView';
import { deepseekModelPolicy } from '@/providers/deepseek/DeepSeekModelPolicy';
import { updateDeepSeekProviderSettings } from '@/providers/deepseek/settings';

it('preserves the enabled DeepSeek order in the actual chat selector', async () => {
  const settings: Record<string, unknown> = {};
  const models = ['first', 'second'].map(id => ({
    id, provider: 'native', label: id, encodedId: `deepseek:native/${id}`,
  }));
  const order = models.map(model => model.encodedId);
  updateDeepSeekProviderSettings(settings, { discoveredModels: models, visibleModels: order });
  const container = document.body.appendChild(document.createElement('div'));
  const props: ModelSelectorViewProps = {
    id: 'model-order',
    models: deepseekModelPolicy.getModelOptions(settings),
    currentProviderId: 'deepseek',
    currentModel: order[0],
    displayModelLabel: 'first',
    modelTitle: '',
    reasoningOptions: [],
    reasoningValue: '',
    reasoningDefaultValue: '',
    reasoningLabel: 'Effort',
    serviceTier: null,
    serviceTierActive: false,
    onModelChange: jest.fn(),
    onReasoningChange: jest.fn(),
    onServiceTierToggle: jest.fn(),
  };
  try {
    await act(() => render(h(ModelSelectorView, props), container));
    await act(() => container.querySelector<HTMLButtonElement>('.claudian-model-btn')!.click());
    expect([...container.querySelectorAll('[data-model-value]')]
      .map(element => element.getAttribute('data-model-value'))).toEqual(order);
  } finally {
    render(null, container);
    container.remove();
  }
});
