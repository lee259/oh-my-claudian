import { OpencodeHttpError } from '@/providers/opencode/http/OpencodeHttpClient';
import { type OpencodeV2MetadataClient, OpencodeV2MetadataProbe } from '@/providers/opencode/metadata/OpencodeV2MetadataProbe';

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
      if (route === '/api/skill') return { data: [
        { id: 'review', description: 'Shadowed by a command' },
        { id: 'project.review', description: 'Review the current project' },
      ] };
      if (route === '/api/agent') return { data: [
        { description: 'Plan changes', mode: 'primary', name: 'Plan' },
        { description: 'Reviews code', mode: 'subagent', name: 'review' },
        { description: 'Writes docs', mode: 'all', name: 'writer' },
        { hidden: true, mode: 'primary', name: 'hidden' },
      ] };
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
      commands: [
        { id: 'acp:review', name: 'review', content: '', description: 'Review changes', source: 'sdk', kind: 'command' },
        {
          id: 'opencode-skill:project.review',
          name: 'project.review',
          content: '',
          description: 'Review the current project',
          source: 'sdk',
          kind: 'skill',
        },
      ],
      models: {
        availableModels: [{ modelId: 'anthropic/claude-3-7-sonnet', name: 'anthropic/Claude 3.7 Sonnet' }],
        currentModelId: '',
      },
      modes: {
        availableModes: [
          { description: 'Plan changes', id: 'plan', name: 'Plan' },
          { description: 'Writes docs', id: 'writer', name: 'writer' },
        ],
        currentModeId: 'plan',
      },
    });
    expect(client.request).toHaveBeenCalledWith('/api/model', expect.anything());
    expect(client.request).toHaveBeenCalledWith('/api/command', expect.anything());
    expect(client.request).toHaveBeenCalledWith('/api/skill', expect.anything());
    expect(client.request).toHaveBeenCalledWith('/api/agent', expect.anything());
    expect(client.request).not.toHaveBeenCalledWith(expect.stringContaining('/session'), expect.anything());
  });

  it('waits for the v2 command catalog to load and tolerates older servers without skills', async () => {
    const client = createClient();
    let commandReads = 0;
    const defaultRequest = jest.mocked(client.request).getMockImplementation()!;
    jest.mocked(client.request).mockImplementation(async (route: string) => {
      if (route === '/api/command' && commandReads++ === 0) return { data: [] };
      if (route === '/api/skill') throw new OpencodeHttpError(404, 'not found');
      return defaultRequest(route);
    });
    const probe = new OpencodeV2MetadataProbe(client);

    await expect(probe.loadCatalog()).resolves.toMatchObject({
      commands: [{ kind: 'command', name: 'review' }],
    });
    expect(commandReads).toBeGreaterThan(1);
  });

  it('excludes subagents and hidden agents from selectable modes', async () => {
    const probe = new OpencodeV2MetadataProbe(createClient());

    await expect(probe.loadCatalog()).resolves.toMatchObject({
      modes: {
        availableModes: [
          { id: 'plan', name: 'Plan' },
          { id: 'writer', name: 'writer' },
        ],
        currentModeId: 'plan',
      },
    });
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
