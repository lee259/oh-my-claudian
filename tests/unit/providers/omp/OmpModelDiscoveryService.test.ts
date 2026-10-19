import {
  OmpModelDiscoveryService,
  parseOmpModelRolesOutput,
  parseOmpModelsOutput,
} from '@/providers/omp/metadata/OmpModelDiscoveryService';

function createCatalogRunner() {
  return {
    run: jest.fn().mockResolvedValue({ exitCode: 1, stdout: '' }),
  };
}

describe('parseOmpModelsOutput', () => {
  it('parses the complete OMP catalog without using Pi model ids', () => {
    expect(parseOmpModelsOutput(JSON.stringify({
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash · Bailian',
        provider: 'bailian',
        selector: 'bailian/deepseek-v4-flash',
      }, {
        id: 'gpt-5',
        name: 'GPT-5 · OpenRouter',
        provider: 'openrouter',
      }],
    }))).toEqual([
      {
        description: 'bailian/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash · Bailian',
        rawId: 'bailian/deepseek-v4-flash',
      },
      {
        description: 'openrouter/gpt-5',
        label: 'GPT-5 · OpenRouter',
        rawId: 'openrouter/gpt-5',
      },
    ]);
  });
});

describe('OmpModelDiscoveryService', () => {
  it('discovers OMP thinking choices alongside models', async () => {
    const kernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({
        configOptions: [{
          category: 'mode', currentValue: 'default', id: 'mode', name: 'Mode', options: [
            { name: 'Default', value: 'default' },
            { name: 'Plan', value: 'plan' },
          ], type: 'select',
        }, {
          category: 'thought_level', currentValue: 'auto', id: 'thinking', name: 'Thinking', options: [
            { name: 'Off', value: 'off' },
            { name: 'Auto', value: 'auto' },
          ], type: 'select',
        }, {
          category: 'model', currentValue: 'openai/gpt-5-mini', id: 'model', name: 'Model', options: [
            { name: 'GPT-5 mini', value: 'openai/gpt-5-mini' },
          ], type: 'select',
        }],
        sessionId: 'metadata-session',
      }),
      prompt: jest.fn(),
      setModel: jest.fn(),
      setConfigOption: jest.fn(),
    };
    const plugin = { app: { vault: { adapter: { basePath: '/vault' } } } } as never;
    const kernelOptions: any[] = [];
    const service = new OmpModelDiscoveryService(plugin, {
      createKernel: (options) => {
        kernelOptions.push(options);
        return kernel;
      },
      runner: createCatalogRunner(),
    });

    await expect(service.discoverCatalog()).resolves.toEqual({
      models: [{ label: 'GPT-5 mini', rawId: 'openai/gpt-5-mini' }],
      thinking: {
        configId: 'thinking',
        currentValue: 'auto',
        options: [
          { id: 'off', name: 'Off' },
          { id: 'auto', name: 'Auto' },
        ],
      },
    });
    expect(kernelOptions[0]?.isolateNativeSessions).toBe(true);
  });

  it('returns models advertised through OMP ACP config options', async () => {
    const kernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({
        configOptions: [{
          category: 'model',
          currentValue: 'openai/gpt-5-mini',
          id: 'model',
          name: 'Model',
          options: [{
            description: 'OpenAI/gpt-5-mini',
            name: 'GPT-5 mini',
            value: 'openai/gpt-5-mini',
          }, {
            description: 'Anthropic/claude-sonnet',
            name: 'Claude Sonnet',
            value: 'anthropic/claude-sonnet',
          }],
          type: 'select',
        }],
        sessionId: 'metadata-session',
      }),
      prompt: jest.fn(),
      setModel: jest.fn(),
      setConfigOption: jest.fn(),
    };
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
    } as never;

    const service = new OmpModelDiscoveryService(plugin, {
      createKernel: () => kernel,
      runner: createCatalogRunner(),
    });

    await expect(service.discover()).resolves.toEqual([
      {
        description: 'OpenAI/gpt-5-mini',
        label: 'GPT-5 mini',
        rawId: 'openai/gpt-5-mini',
      },
      {
        description: 'Anthropic/claude-sonnet',
        label: 'Claude Sonnet',
        rawId: 'anthropic/claude-sonnet',
      },
    ]);
    expect(kernel.dispose).toHaveBeenCalledTimes(1);
  });

  it('returns every model that OMP ACP marks available', async () => {
    const kernel = {
      cancel: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      openSession: jest.fn().mockResolvedValue({
        configOptions: [{
          currentValue: 'openai/gpt-5-mini', id: 'model', name: 'Model', options: [
            { name: 'GPT-5 mini', value: 'openai/gpt-5-mini' },
            { name: 'Claude Sonnet', value: 'anthropic/claude-sonnet' },
          ], type: 'select',
        }], sessionId: 'metadata-session',
      }),
      prompt: jest.fn(),
      setModel: jest.fn(),
      setConfigOption: jest.fn(),
    };
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
    } as never;

    const service = new OmpModelDiscoveryService(plugin, {
      createKernel: () => kernel,
      runner: createCatalogRunner(),
    });

    await expect(service.discover()).resolves.toEqual([
      { label: 'GPT-5 mini', rawId: 'openai/gpt-5-mini' },
      { label: 'Claude Sonnet', rawId: 'anthropic/claude-sonnet' },
    ]);
  });
});


describe('parseOmpModelRolesOutput', () => {
  it('discovers configured chat roles without copying non-chat roles into the chat catalog', () => {
    expect(parseOmpModelRolesOutput(JSON.stringify({
      key: 'modelRoles',
      value: {
        default: 'openai/gpt-5:auto',
        smol: 'local/tiny,openai/gpt-5-mini:off',
        CODE: 'anthropic/claude-sonnet:high',
        '快速': 'openai/gpt-5-mini',
        speech: 'local/kokoro:auto',
        dictation: 'local/whisper-base:auto',
        web: 'web/public',
        empty: '',
        invalid: 42,
      },
    }))).toEqual([
      { rawId: '@default', label: '@default', description: 'openai/gpt-5:auto' },
      { rawId: '@smol', label: '@smol', description: 'local/tiny,openai/gpt-5-mini:off' },
      { rawId: '@CODE', label: '@CODE', description: 'anthropic/claude-sonnet:high' },
      { rawId: '@快速', label: '@快速', description: 'openai/gpt-5-mini' },
    ]);
    expect(parseOmpModelRolesOutput('{')).toEqual([]);
    expect(parseOmpModelRolesOutput('{"key":"other","value":{"default":"openai/gpt-5"}}')).toEqual([]);
  });
});


it('combines configured role selectors with the complete concrete model catalog', async () => {
  const kernel = {
    cancel: jest.fn(), connect: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined), prompt: jest.fn(),
    setConfigOption: jest.fn(), setModel: jest.fn(),
    openSession: jest.fn().mockResolvedValue({ sessionId: 'probe', configOptions: [] }),
  };
  const runner = { run: jest.fn(async ({ args }) => ({
    exitCode: 0,
    stdout: JSON.stringify(args[0] === 'config'
      ? { key: 'modelRoles', value: { smol: 'openai/gpt-5-mini:off' } }
      : { models: [{ provider: 'openai', id: 'gpt-5-mini' }] }),
  })) };
  const service = new OmpModelDiscoveryService({
    settings: {}, app: { vault: { adapter: { basePath: '/vault' } } },
    getResolvedProviderCliPath: async () => '/configured/omp',
  } as never, { createKernel: () => kernel, runner });
  const result = await service.discoverCatalog();
  expect(result.models).toEqual([
    { rawId: '@smol', label: '@smol', description: 'openai/gpt-5-mini:off' },
    { rawId: 'openai/gpt-5-mini', label: 'openai/gpt-5-mini', description: 'openai/gpt-5-mini' },
  ]);
  expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
    args: ['config', 'get', 'modelRoles', '--json'], command: '/configured/omp', cwd: '/vault',
  }));
});

it('resolves a role with native OMP selection and thinking without prompting or touching user history', async () => {
  const kernel = {
    cancel: jest.fn(), connect: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined), prompt: jest.fn(),
    setConfigOption: jest.fn(), setModel: jest.fn(),
    openSession: jest.fn().mockResolvedValue({ sessionId: 'probe', configOptions: [
      { id: 'model', type: 'select', currentValue: 'openai/gpt-5-mini', options: [] },
      { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'off', options: [] },
    ] }),
  };
  const createKernel = jest.fn(() => kernel);
  const service = new OmpModelDiscoveryService({
    settings: {}, app: { vault: { adapter: { basePath: '/vault' } } },
  } as never, { createKernel, runner: createCatalogRunner() });
  await expect(service.resolveRole('@smol', new AbortController().signal, '/vault/project')).resolves.toEqual({
    modelId: 'openai/gpt-5-mini', thinking: 'off',
  });
  expect(createKernel).toHaveBeenCalledWith(expect.objectContaining({
    modelSelector: '@smol', isolateNativeSessions: true, approvalMode: 'always-ask',
    config: expect.objectContaining({ vaultWorkingDirectory: '/vault/project' }),
  }));
  expect(kernel.openSession).toHaveBeenCalledWith();
  expect(kernel.prompt).not.toHaveBeenCalled();
  expect(kernel.dispose).toHaveBeenCalledTimes(1);
});

it('bounds role resolution even if the native metadata request never finishes', async () => {
  jest.useFakeTimers();
  const kernel = {
    cancel: jest.fn(), connect: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined), prompt: jest.fn(),
    setConfigOption: jest.fn(), setModel: jest.fn(),
    openSession: jest.fn(() => new Promise<never>(() => undefined)),
  };
  const service = new OmpModelDiscoveryService({
    settings: {}, app: { vault: { adapter: { basePath: '/vault' } } },
  } as never, { createKernel: () => kernel, runner: createCatalogRunner() });
  try {
    const pending = service.resolveRole('@smol', new AbortController().signal);
    let settled = false;
    const completed = pending.catch(error => { settled = true; return error; });
    await jest.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(true);
    await expect(completed).resolves.toMatchObject({ message: 'OMP model role resolution timed out' });
    expect(kernel.dispose).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
