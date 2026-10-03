import { TEST_CODEX_MODEL } from '@test/helpers/codexModels';
import { createMockEl } from '@test/helpers/MockElement';

import type { UsageInfo } from '@/core/types';
import {
  ContextUsageMeter,
  InputToolbarLayoutController,
  McpServerSelector,
  ModeSelector,
} from '@/features/chat/ui/InputToolbar';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn(),
}));

function makeUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 200000,
    contextTokens: 0,
    percentage: 0,
    ...overrides,
  };
}

const DEFAULT_MODELS = [
  { value: 'haiku', label: 'Haiku', description: 'Fast and efficient' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced performance' },
  { value: 'sonnet[1m]', label: 'Sonnet 1M', description: 'Balanced performance (1M context window)' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'opus[1m]', label: 'Opus 1M', description: 'Most capable (1M context window)' },
];

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const BUDGET_OPTIONS = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'medium', label: 'Med', tokens: 8000 },
  { value: 'high', label: 'High', tokens: 16000 },
  { value: 'xhigh', label: 'Ultra', tokens: 32000 },
];

const DEFAULT_MODEL_VALUES = new Set(DEFAULT_MODELS.map(m => m.value));

function filterVisibleModels(
  models: typeof DEFAULT_MODELS,
  enableOpus1M: boolean,
  enableSonnet1M: boolean,
) {
  return models.filter((model) => {
    if (model.value === 'opus' || model.value === 'opus[1m]') {
      return enableOpus1M ? model.value === 'opus[1m]' : model.value === 'opus';
    }
    if (model.value === 'sonnet' || model.value === 'sonnet[1m]') {
      return enableSonnet1M ? model.value === 'sonnet[1m]' : model.value === 'sonnet';
    }
    return true;
  });
}

function createMockUIConfig() {
  return {
    getProviderIcon: jest.fn().mockReturnValue(null),
    getModelOptions: jest.fn().mockImplementation((settings: {
      enableOpus1M?: boolean;
      enableSonnet1M?: boolean;
      environmentVariables?: string;
    }) => {
      // Mimic real behavior: env-based custom models bypass 1M filtering
      if (settings.environmentVariables) {
        const match = settings.environmentVariables.match(/ANTHROPIC_MODEL=(\S+)/);
        if (match) {
          const value = match[1];
          const label = value.includes('/')
            ? value.split('/').pop() || value
            : value.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
          return [{ value, label }];
        }
      }
      return filterVisibleModels(
        DEFAULT_MODELS,
        settings.enableOpus1M ?? false,
        settings.enableSonnet1M ?? false,
      );
    }),
    isAdaptiveReasoningModel: jest.fn().mockImplementation((model: string) => {
      if (DEFAULT_MODEL_VALUES.has(model)) return true;
      return /claude-(haiku|sonnet|opus)-/.test(model);
    }),
    getReasoningOptions: jest.fn().mockImplementation((model: string) => {
      if (DEFAULT_MODEL_VALUES.has(model) || /claude-(haiku|sonnet|opus)-/.test(model)) {
        return EFFORT_OPTIONS;
      }
      return BUDGET_OPTIONS;
    }),
    getDefaultReasoningValue: jest.fn().mockReturnValue('high'),
    getContextWindowSize: jest.fn().mockReturnValue(200000),
    isDefaultModel: jest.fn().mockImplementation((model: string) =>
      DEFAULT_MODELS.some(m => m.value === model)
    ),
    applyModelDefaults: jest.fn(),
    normalizeModelVariant: jest.fn((model: string) => model),
    getPermissionModeToggle: jest.fn().mockReturnValue({
      inactiveValue: 'normal',
      inactiveLabel: 'Safe',
      activeValue: 'yolo',
      activeLabel: 'YOLO',
      planValue: 'plan',
      planLabel: 'PLAN',
    }),
    getPermissionModeOptions: jest.fn().mockReturnValue([
      { value: 'normal', label: 'Safe', icon: 'shield-check' },
      { value: 'yolo', label: 'YOLO', icon: 'zap', isDangerous: true },
      { value: 'plan', label: 'PLAN', icon: 'clipboard-list', isPlanMode: true },
    ]),
    getServiceTierToggle: jest.fn().mockImplementation((settings: Record<string, unknown>) =>
      settings.model === TEST_CODEX_MODEL
        ? {
          inactiveValue: 'default',
          inactiveLabel: 'Standard',
          activeValue: 'fast',
          activeLabel: 'Fast',
          description: '1.5x speed, 2x credits',
        }
        : null
    ),
    getModeSelector: jest.fn().mockImplementation((settings: Record<string, unknown>) => ({
      activeValue: 'build',
      label: 'Mode',
      options: [
        { value: 'build', label: 'Build', description: 'Default editing agent' },
        { value: 'plan', label: 'Plan', description: 'Planning-first agent' },
      ],
      value: typeof settings.selectedMode === 'string' && settings.selectedMode
        ? settings.selectedMode
        : 'build',
    })),
  };
}

function createMockCallbacks(overrides: Record<string, any> = {}) {
  return {
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    getSettings: jest.fn().mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'build',
      enableOpus1M: false,
      enableSonnet1M: false,
    }),
    getEnvironmentVariables: jest.fn().mockReturnValue(''),
    getRuntimeModel: jest.fn().mockReturnValue(null),
    getUIConfig: jest.fn().mockReturnValue(createMockUIConfig()),
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsNativeHistory: true,
      supportsPlanMode: true,
      supportsRewind: true,
      supportsFork: true,
      supportsProviderCommands: true,
      reasoningControl: 'effort',
    }),
    ...overrides,
  };
}

describe('ModeSelector', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let selector: ModeSelector;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
    selector = new ModeSelector(parentEl, callbacks);
  });

  it('should create a container with mode-selector class', () => {
    const container = parentEl.querySelector('.claudian-mode-selector');
    expect(container).not.toBeNull();
  });

  it('should display the current mode label', () => {
    const label = parentEl.querySelector('.claudian-mode-label');
    expect(label?.textContent).toBe('Build');
  });

  it('should call onModeChange when the toggle is clicked', async () => {
    const toggle = parentEl.querySelector('.claudian-toggle-switch');
    await toggle?.dispatchEvent('click');

    expect(callbacks.onModeChange).toHaveBeenCalledWith('plan');
  });

  it('should show the active style when the configured active mode is selected', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'build',
      enableOpus1M: false,
      enableSonnet1M: false,
    });

    const parentEl2 = createMockEl();
    new ModeSelector(parentEl2, callbacks);

    const label = parentEl2.querySelector('.claudian-mode-label');
    const toggle = parentEl2.querySelector('.claudian-toggle-switch');
    expect(label?.textContent).toBe('Build');
    expect(label?.hasClass('active')).toBe(true);
    expect(toggle?.hasClass('active')).toBe(true);
  });

  it('should show the inactive style when the configured inactive mode is selected', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'plan',
      enableOpus1M: false,
      enableSonnet1M: false,
    });

    const parentEl2 = createMockEl();
    new ModeSelector(parentEl2, callbacks);

    const label = parentEl2.querySelector('.claudian-mode-label');
    const toggle = parentEl2.querySelector('.claudian-toggle-switch');
    expect(label?.textContent).toBe('Plan');
    expect(label?.hasClass('active')).toBe(false);
    expect(toggle?.hasClass('active')).toBe(false);
  });

  it('should hide when the provider exposes no mode selector', () => {
    const uiConfig = createMockUIConfig();
    uiConfig.getModeSelector.mockReturnValue(null);
    callbacks.getUIConfig.mockReturnValue(uiConfig);

    selector.updateDisplay();

    const container = parentEl.querySelector('.claudian-mode-selector');
    expect(container?.style?.display).toBe('none');
  });
});

describe('McpServerSelector', () => {
  let parentEl: any;
  let selector: McpServerSelector;

  function createMockMcpManager(servers: { name: string; enabled: boolean; contextSaving?: boolean }[] = []) {
    return {
      getServers: jest.fn().mockReturnValue(
        servers.map(s => ({
          name: s.name,
          enabled: s.enabled,
          contextSaving: s.contextSaving ?? false,
        }))
      ),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    selector = new McpServerSelector(parentEl);
  });

  it('should create container with mcp-selector class', () => {
    const container = parentEl.querySelector('.claudian-mcp-selector');
    expect(container).not.toBeNull();
  });

  it('should return empty set of enabled servers initially', () => {
    expect(selector.getEnabledServers().size).toBe(0);
  });

  it('should hide container when no servers configured', () => {
    selector.setMcpManager(createMockMcpManager([]));
    const container = parentEl.querySelector('.claudian-mcp-selector');
    expect(container?.style.display).toBe('none');
  });

  it('should show container when servers are configured', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'test', enabled: true }]));
    const container = parentEl.querySelector('.claudian-mcp-selector');
    expect(container?.hasClass('claudian-hidden')).toBe(false);
  });

  it('keeps a lazy selector hidden until configured servers finish loading', async () => {
    let loaded = false;
    const manager = {
      ensureLoaded: jest.fn(async () => {
        loaded = true;
      }),
      getServers: jest.fn(() => loaded
        ? [{ name: 'lazy-server', enabled: true, contextSaving: false }]
        : []),
      isLoaded: jest.fn(() => loaded),
    } as any;

    selector.setMcpManager(manager);
    const container = parentEl.querySelector('.claudian-mcp-selector');

    expect(container?.hasClass('claudian-hidden')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(container?.hasClass('claudian-hidden')).toBe(false);
    expect(parentEl.querySelector('.claudian-mcp-selector-item')).not.toBeNull();
  });

  it('stays hidden when lazy loading finds no configured servers', async () => {
    let loaded = false;
    const manager = {
      ensureLoaded: jest.fn(async () => {
        loaded = true;
      }),
      getServers: jest.fn().mockReturnValue([]),
      isLoaded: jest.fn(() => loaded),
    } as any;

    selector.setMcpManager(manager);
    const container = parentEl.querySelector('.claudian-mcp-selector');

    expect(container?.hasClass('claudian-hidden')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(container?.hasClass('claudian-hidden')).toBe(true);
  });

  it('should show empty message when all servers are disabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'test', enabled: false }]));
    const empty = parentEl.querySelector('.claudian-mcp-selector-empty');
    expect(empty?.textContent).toBe('All MCP servers disabled');
  });

  it('should show no servers message when no servers configured', () => {
    selector.setMcpManager(createMockMcpManager([]));
    const empty = parentEl.querySelector('.claudian-mcp-selector-empty');
    expect(empty?.textContent).toBe('No MCP servers configured');
  });

  it('should add mentioned servers', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.addMentionedServers(new Set(['server1']));
    expect(selector.getEnabledServers().has('server1')).toBe(true);
  });

  it('should not re-render when adding already enabled servers', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.addMentionedServers(new Set(['server1']));
    const enabledBefore = selector.getEnabledServers();

    selector.addMentionedServers(new Set(['server1']));
    expect(selector.getEnabledServers()).toEqual(enabledBefore);
  });

  it('should clear all enabled servers', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.addMentionedServers(new Set(['server1', 'server2']));
    expect(selector.getEnabledServers().size).toBe(2);

    selector.clearEnabled();
    expect(selector.getEnabledServers().size).toBe(0);
  });

  it('should set enabled servers from array', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    expect(selector.getEnabledServers().size).toBe(2);
  });

  it('preserves persisted selections until a lazy manager finishes loading', () => {
    const manager = {
      getServers: jest.fn().mockReturnValue([]),
      isLoaded: jest.fn().mockReturnValue(false),
    } as any;

    selector.setMcpManager(manager);
    selector.setEnabledServers(['server1']);

    expect(selector.getEnabledServers()).toEqual(new Set(['server1']));
  });

  it('should prune enabled servers that no longer exist in manager', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);

    // Now update manager to only have server1
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    expect(selector.getEnabledServers().has('server1')).toBe(true);
    expect(selector.getEnabledServers().has('server2')).toBe(false);
  });

  it('should invoke onChange callback when pruning removes servers', () => {
    const onChange = jest.fn();
    selector.setOnChange(onChange);

    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    onChange.mockClear();

    // Prune by removing server2
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    expect(onChange).toHaveBeenCalled();
  });

  it('should show badge when more than 1 server enabled', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    selector.updateDisplay();

    const badge = parentEl.querySelector('.claudian-mcp-selector-badge');
    expect(badge?.hasClass('visible')).toBe(true);
    expect(badge?.textContent).toBe('2');
  });

  it('should not show badge when only 1 server enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.setEnabledServers(['server1']);
    selector.updateDisplay();

    const badge = parentEl.querySelector('.claudian-mcp-selector-badge');
    expect(badge?.hasClass('visible')).toBe(false);
  });

  it('should add active class to icon when servers are enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.setEnabledServers(['server1']);
    selector.updateDisplay();

    const icon = parentEl.querySelector('.claudian-mcp-selector-icon');
    expect(icon?.hasClass('active')).toBe(true);
  });

  it('should remove active class from icon when no servers enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.clearEnabled();
    selector.updateDisplay();

    const icon = parentEl.querySelector('.claudian-mcp-selector-icon');
    expect(icon?.hasClass('active')).toBe(false);
  });

  it('should handle null mcpManager', () => {
    selector.setMcpManager(null);
    expect(selector.getEnabledServers().size).toBe(0);
  });
});

describe('ContextUsageMeter', () => {
  let parentEl: any;
  let meter: ContextUsageMeter;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    meter = new ContextUsageMeter(parentEl);
  });

  it('should create a container with context-meter class', () => {
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container).not.toBeNull();
  });

  it('should be hidden initially', () => {
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.style.display).toBe('none');
  });

  it('should remain hidden when update called with null', () => {
    meter.update(null);
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.style.display).toBe('none');
  });

  it('should show a known context window even when contextTokens is 0', () => {
    meter.update(makeUsage({ contextTokens: 0, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.style.display).toBe('flex');
  });

  it('should become visible when contextTokens > 0', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.style.display).toBe('flex');
  });

  it('should render percentage text for responsive styling', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const percent = parentEl.querySelector('.claudian-context-meter-percent');
    expect(percent?.textContent).toBe('25%');
  });

  it('should expose usage details to assistive technology', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('role')).toBe('progressbar');
    expect(container?.getAttribute('aria-label')).toBe('Context usage');
    expect(container?.getAttribute('aria-valuemin')).toBe('0');
    expect(container?.getAttribute('aria-valuemax')).toBe('100');
    expect(container?.getAttribute('aria-valuenow')).toBe('25');
    expect(container?.getAttribute('aria-valuetext')).toBe('50k / 200k');
  });

  it('should add warning class when usage > 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.hasClass('warning')).toBe(true);
  });

  it('should remove warning class when usage drops below 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.hasClass('warning')).toBe(false);
  });

  it('should set tooltip with formatted token counts', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('50k / 200k');
  });

  it('should format small token counts without k suffix', () => {
    meter.update(makeUsage({ contextTokens: 500, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('500 / 200k');
  });

  it('should add compact reminder to tooltip when usage > 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('170k / 200k (Approaching limit, run `/compact` to continue)');
  });

  it('should not add compact reminder to tooltip when usage ≤ 80%', () => {
    meter.update(makeUsage({ contextTokens: 160000, contextWindow: 200000, percentage: 80 }));
    const container = parentEl.querySelector('.claudian-context-meter');
    expect(container?.getAttribute('data-tooltip')).toBe('160k / 200k');
  });
});

describe('InputToolbarLayoutController', () => {
  function setRect(element: any, top: number, width = 40, height = 24): void {
    element.getBoundingClientRect = jest.fn().mockReturnValue({
      top,
      bottom: top + height,
      left: 0,
      right: width,
      width,
      height,
      x: 0,
      y: top,
      toJSON: jest.fn(),
    });
  }

  it('should compact optional labels when toolbar items wrap', () => {
    const toolbarEl = createMockEl();
    const firstItem = toolbarEl.createDiv();
    const wrappedItem = toolbarEl.createDiv();
    setRect(firstItem, 0);
    setRect(wrappedItem, 36);

    const controller = new InputToolbarLayoutController(toolbarEl);
    controller.refreshLayout();

    expect(toolbarEl.hasClass('claudian-input-toolbar--compact')).toBe(true);
    controller.destroy();
  });

  it('should show optional labels when all toolbar items fit on one line', () => {
    const toolbarEl = createMockEl();
    const firstItem = toolbarEl.createDiv();
    const secondItem = toolbarEl.createDiv();
    setRect(firstItem, 0, 40, 24);
    setRect(secondItem, 3, 40, 18);
    toolbarEl.addClass('claudian-input-toolbar--compact');

    const controller = new InputToolbarLayoutController(toolbarEl);
    controller.refreshLayout();

    expect(toolbarEl.hasClass('claudian-input-toolbar--compact')).toBe(false);
    controller.destroy();
  });

  it('should remeasure after resize and disconnect its observer on destroy', () => {
    const toolbarEl = createMockEl();
    const firstItem = toolbarEl.createDiv();
    const secondItem = toolbarEl.createDiv();
    setRect(firstItem, 0);
    setRect(secondItem, 0);

    const observerCallbacks: {
      resize?: ResizeObserverCallback;
      frame?: FrameRequestCallback;
    } = {};
    const observe = jest.fn();
    const disconnect = jest.fn();
    toolbarEl.ownerDocument.defaultView.requestAnimationFrame = jest.fn((callback) => {
      observerCallbacks.frame = callback;
      return 1;
    });
    toolbarEl.ownerDocument.defaultView.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.resize = callback;
      }
      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;
    };

    const controller = new InputToolbarLayoutController(toolbarEl);
    expect(observe).toHaveBeenCalledWith(toolbarEl);
    observerCallbacks.frame?.(0);
    expect(toolbarEl.hasClass('claudian-input-toolbar--compact')).toBe(false);

    setRect(secondItem, 36);
    observerCallbacks.resize?.([], {} as ResizeObserver);
    observerCallbacks.frame?.(0);
    expect(toolbarEl.hasClass('claudian-input-toolbar--compact')).toBe(true);

    controller.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('McpServerSelector - toggle and badges', () => {
  let parentEl: any;
  let selector: McpServerSelector;

  function createMockMcpManager(servers: { name: string; enabled: boolean; contextSaving?: boolean }[] = []) {
    return {
      getServers: jest.fn().mockReturnValue(
        servers.map(s => ({
          name: s.name,
          enabled: s.enabled,
          contextSaving: s.contextSaving ?? false,
        }))
      ),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    selector = new McpServerSelector(parentEl);
  });

  it('should render context-saving badge for servers with contextSaving', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true, contextSaving: true },
    ]));

    const csBadge = parentEl.querySelector('.claudian-mcp-selector-cs-badge');
    expect(csBadge).not.toBeNull();
    expect(csBadge?.textContent).toBe('@');
  });

  it('should not render context-saving badge for servers without contextSaving', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true, contextSaving: false },
    ]));

    const csBadge = parentEl.querySelector('.claudian-mcp-selector-cs-badge');
    expect(csBadge).toBeNull();
  });

  it('should toggle server on mousedown and update display', () => {
    const onChange = jest.fn();
    selector.setOnChange(onChange);

    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
    ]));

    // Find the server item and trigger mousedown
    const item = parentEl.querySelector('.claudian-mcp-selector-item');
    expect(item).not.toBeNull();

    // Simulate mousedown to enable
    const mousedownHandlers = item._eventListeners?.get('mousedown');
    expect(mousedownHandlers).toBeDefined();
    mousedownHandlers![0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

    expect(selector.getEnabledServers().has('server1')).toBe(true);
    expect(onChange).toHaveBeenCalled();

    // Toggle again to disable
    onChange.mockClear();
    mousedownHandlers![0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

    expect(selector.getEnabledServers().has('server1')).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it('should re-render dropdown on mouseenter', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
    ]));

    // Get container and trigger mouseenter
    const container = parentEl.querySelector('.claudian-mcp-selector');
    const mouseenterHandlers = container?._eventListeners?.get('mouseenter');
    expect(mouseenterHandlers).toBeDefined();

    // Should not throw
    expect(() => mouseenterHandlers![0]()).not.toThrow();
  });
});
