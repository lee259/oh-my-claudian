import { type OpencodeV2MetadataClient,OpencodeV2MetadataProbe } from '@/providers/opencode/metadata/OpencodeV2MetadataProbe';

function createClient(): OpencodeV2MetadataClient {
  const client = {
    dispose: jest.fn(async () => undefined),
    request: jest.fn(async (route: string) => {
      if (route === '/api/model') {
        return { data: [
          { enabled: true, id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', providerID: 'anthropic', variants: [{ id: 'high' }] },
          { enabled: false, id: 'disabled', name: 'Disabled', providerID: 'anthropic' },
          { enabled: true, id: 'broken', providerID: 'anthropic' },
        ] };
      }
      if (route === '/api/command') return { data: [{ name: 'review', description: 'Review changes' }] };
      if (route === '/api/integration') return { data: [] };
      throw new Error(`Unexpected route: ${route}`);
    }),
    signal: (signal?: AbortSignal) => signal ?? new AbortController().signal,
    waitForActivation: jest.fn(async () => undefined),
  };
  return client as unknown as OpencodeV2MetadataClient;
}

describe('OpencodeV2MetadataProbe', () => {
  it('reads enabled models and commands from the native catalog without opening a chat session', async () => {
    const client = createClient();
    const probe = new OpencodeV2MetadataProbe(client);

    await expect(probe.loadCatalog()).resolves.toEqual({
      commands: [{ id: 'acp:review', name: 'review', content: '', description: 'Review changes', source: 'sdk' }],
      models: {
        availableModels: [{ modelId: 'anthropic/claude-3-7-sonnet', name: 'anthropic/Claude 3.7 Sonnet' }],
        currentModelId: '',
      },
    });
    expect(client.request).toHaveBeenCalledWith('/api/model', expect.anything());
    expect(client.request).toHaveBeenCalledWith('/api/command', expect.anything());
    expect(client.request).not.toHaveBeenCalledWith(expect.stringContaining('/session'), expect.anything());
  });

  it('exposes native model variants as the reasoning selector options', async () => {
    const client = createClient();
    const probe = new OpencodeV2MetadataProbe(client);
    await probe.loadCatalog();

    await expect(probe.warmModel('anthropic/claude-3-7-sonnet')).resolves.toMatchObject({
      rawModelId: 'anthropic/claude-3-7-sonnet',
      configOptions: [{
        category: 'thought_level',
        id: 'effort',
        options: [
          { name: 'High', value: 'high' },
          { name: 'Default', value: 'default' },
        ],
      }],
    });
  });
});
