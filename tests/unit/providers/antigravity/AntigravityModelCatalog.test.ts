jest.mock('@/core/process/ProcessProbe', () => ({ runProcessProbe: jest.fn() }));
jest.mock('@/providers/antigravity/runtime/AntigravityExecutionContext', () => ({
  resolveAntigravityLaunchSpec: jest.fn(async () => ({
    args: ['models'],
    command: 'agy',
    cwd: '/tmp',
    env: {},
  })),
}));

import { runProcessProbe } from '@/core/process/ProcessProbe';
import { decodeAntigravityConfig } from '@/providers/antigravity/config';
import { AntigravityModelCatalog } from '@/providers/antigravity/runtime/AntigravityModelCatalog';

function createHost() {
  const config: Record<string, unknown> = { enabled: true };
  const selection = { referencedModelIds: [] };
  return {
    config,
    selection,
    environmentText: '',
    workingDirectory: '/vault',
    notifyChatOptionsChanged: jest.fn(),
    resolveCliPath: jest.fn(async () => null),
    updateConfig: jest.fn(async (mutation: (
      config: Record<string, unknown>,
      selection: { referencedModelIds: string[] },
    ) => unknown) => {
      await mutation(config, selection);
      return true;
    }),
  };
}

describe('AntigravityModelCatalog', () => {
  it('discovers models from the standalone CLI list', async () => {
    jest.mocked(runProcessProbe).mockResolvedValueOnce([
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
      'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
    ].join('\n'));
    const host = createHost();
    const catalog = new AntigravityModelCatalog(host as never);

    await expect(catalog.refresh(new AbortController().signal)).resolves.toMatchObject({ changed: true });
    expect(runProcessProbe).toHaveBeenCalledTimes(1);
    expect(decodeAntigravityConfig(host.config, host.selection).currentCatalog?.models.map(model => model.rawId))
      .toEqual(['gemini-3.8-flash', 'gpt-oss-120b-medium']);
  });

  it('keeps a live catalog authoritative while standalone discovery runs', async () => {
    let finishProbe!: (value: string | null) => void;
    jest.mocked(runProcessProbe).mockReturnValueOnce(new Promise(resolve => { finishProbe = resolve; }));
    const host = createHost();
    const catalog = new AntigravityModelCatalog(host as never);
    const refresh = catalog.refresh(new AbortController().signal);
    await catalog.mergeLiveModels([{
      displayName: 'Live model',
      rawId: 'live-model',
      reasoningEfforts: [],
    }], 'live-model');
    finishProbe(null);

    await refresh;
    expect(decodeAntigravityConfig(host.config, host.selection).currentCatalog?.models.map(model => model.rawId))
      .toEqual(['live-model']);
  });
});
