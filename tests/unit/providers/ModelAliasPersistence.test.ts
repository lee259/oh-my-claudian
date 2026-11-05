import { getCursorProviderSettings, updateCursorProviderSettings } from '@/providers/cursor/settings';
import { cursorChatUIConfig } from '@/providers/cursor/ui/CursorChatUIConfig';
import { getOmpProviderSettings, updateOmpProviderSettings } from '@/providers/omp/settings';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';

it.each([
  { id: 'cursor', read: getCursorProviderSettings, update: updateCursorProviderSettings, ui: cursorChatUIConfig },
  { id: 'omp', read: getOmpProviderSettings, update: updateOmpProviderSettings, ui: ompChatUIConfig },
])('round-trips $id aliases without changing runtime IDs or replacing provider fields', ({ id, read, update, ui }) => {
  const settings: Record<string, unknown> = { providerConfigs: { [id]: { extensionField: 'keep' } } };
  update(settings, {
    discoveredModels: [{ rawId: 'vendor/model-a', label: 'Model A' }],
    visibleModels: ['vendor/model-a'],
    modelAliases: { 'vendor/model-a': ' Daily model ' },
  });
  const restored = JSON.parse(JSON.stringify(settings));
  expect(read(restored).modelAliases).toEqual({ 'vendor/model-a': 'Daily model' });
  expect(ui.getModelOptions(restored)).toEqual([expect.objectContaining({
    value: `${id}:vendor/model-a`, label: 'Daily model',
  })]);
  update(restored, { discoveredModels: [{ rawId: 'vendor/model-a', label: 'New native label' }] });
  expect(ui.getModelOptions(restored)[0].label).toBe('Daily model');
  expect(restored.providerConfigs[id].extensionField).toBe('keep');
  update(restored, { modelAliases: {} });
  expect(ui.getModelOptions(restored)[0].label).toBe('New native label');
  expect(ui.getModelOptions(restored)[0].value).toBe(`${id}:vendor/model-a`);
});
