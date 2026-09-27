import { buildOpencodeBaseModels, decodeOpencodeModelId, resolveOpencodeBaseModelRawId } from '../models';
import { getOpencodeProviderSettings } from '../settings';

export function assertOpencodeModelAvailable(
  settings: Record<string, unknown>,
  requestedModel: string | undefined,
): void {
  const model = requestedModel
    ?? (typeof settings.model === 'string' ? settings.model : '');
  const config = getOpencodeProviderSettings(settings);
  const rawId = decodeOpencodeModelId(model);
  const id = rawId
    ? resolveOpencodeBaseModelRawId(rawId, config.discoveredModels)
    : '';
  if (!(config.enabled
    && config.visibleModels.includes(id)
    && buildOpencodeBaseModels(config.discoveredModels)
      .some(candidate => candidate.rawId === id))) {
    throw new Error(
      'The selected OpenCode model is unavailable. Open OpenCode settings, refresh the model catalog, and choose an enabled model.',
    );
  }
}

export function ensureOpencodeModelAvailable(
  settings: Record<string, unknown>,
  requestedModel: string | undefined,
  refreshCatalog?: () => Promise<boolean>,
): void | Promise<void> {
  try {
    assertOpencodeModelAvailable(settings, requestedModel);
    return undefined;
  } catch (error) {
    if (!refreshCatalog) throw error;
    return refreshCatalog().then((refreshed) => {
      if (!refreshed) throw error;
      assertOpencodeModelAvailable(settings, requestedModel);
    });
  }
}
