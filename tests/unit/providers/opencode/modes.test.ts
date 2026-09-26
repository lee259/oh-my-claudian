import {
  getEffectiveOpencodeModes,
  normalizeOpencodeAvailableModes,
  normalizeOpencodeSelectedMode,
  normalizeSelectedOpencodeMode,
  OPENCODE_BUILD_MODE_ID,
  resolveOpencodeModeForPermissionMode,
  resolveOpencodePermissionMode,
} from '../../../../src/providers/opencode/modes';
import { opencodeChatUIConfig } from '../../../../src/providers/opencode/ui/OpencodeChatUIConfig';

describe('OpenCode mode settings', () => {
  it('normalizes duplicate/invalid mode entries', () => {
    expect(normalizeOpencodeAvailableModes([
      { id: 'build', name: 'Build' },
      { id: 'build', name: 'Duplicate build' },
      { id: 'plan', name: 'Plan', description: 'Planning-first agent' },
      null,
    ])).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
  });

  it('preserves a saved mode string until fresh discovery decides whether it is valid', () => {
    expect(normalizeOpencodeSelectedMode('plan')).toBe('plan');
  });

  it('does not invent selectable modes before ACP discovery finishes', () => {
    expect(getEffectiveOpencodeModes([])).toEqual([]);
  });

  it('uses the modes actually advertised by ACP, including custom agents', () => {
    expect(getEffectiveOpencodeModes([
      { id: 'compaction', name: 'compaction' },
      { id: 'summary', name: 'summary' },
    ])).toEqual([
      { id: 'compaction', name: 'compaction' },
      { id: 'summary', name: 'summary' },
    ]);
  });

  it('normalizes unsupported saved selections to the first advertised native mode', () => {
    const modes = [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }];
    expect(normalizeSelectedOpencodeMode('custom', modes)).toBe(OPENCODE_BUILD_MODE_ID);
    expect(normalizeSelectedOpencodeMode(123, modes)).toBe(OPENCODE_BUILD_MODE_ID);
    expect(normalizeSelectedOpencodeMode(null, modes)).toBe(OPENCODE_BUILD_MODE_ID);
  });

  it('preserves absent and blank saved mode selections as unset', () => {
    expect(normalizeSelectedOpencodeMode(undefined)).toBe('');
    expect(normalizeSelectedOpencodeMode('   ')).toBe('');
  });

  it('keeps native Build selected instead of translating it to a synthetic permission mode', () => {
    expect(normalizeSelectedOpencodeMode(OPENCODE_BUILD_MODE_ID, [
      { id: 'build', name: 'Build' },
    ])).toBe(OPENCODE_BUILD_MODE_ID);
  });

  it('maps shared modes to native OpenCode modes when those modes are advertised', () => {
    const modes = [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }];
    expect(resolveOpencodeModeForPermissionMode('yolo', modes)).toBe('build');
    expect(resolveOpencodeModeForPermissionMode('normal', modes)).toBe('build');
    expect(resolveOpencodeModeForPermissionMode('plan', modes)).toBe('plan');
    expect(resolveOpencodeModeForPermissionMode('plan', [{ id: 'build', name: 'Build' }])).toBe('build');
    expect(resolveOpencodeModeForPermissionMode('normal')).toBe('');
  });

  it('projects native OpenCode modes into shared execution policy without relabeling the UI', () => {
    expect(resolveOpencodePermissionMode(OPENCODE_BUILD_MODE_ID)).toBe('normal');
    expect(resolveOpencodePermissionMode('plan')).toBe('plan');
    expect(resolveOpencodePermissionMode('summary')).toBe('normal');
    expect(resolveOpencodePermissionMode('')).toBeNull();
  });
});

describe('opencodeChatUIConfig permission mode wiring', () => {
  it('shows each native ACP mode with its native id, name, and description', () => {
    const options = opencodeChatUIConfig.getPermissionModeOptions?.({
      providerConfigs: {
        opencode: {
          availableModes: [
            { id: 'build', name: 'Build mode', description: 'Execute configured tools.' },
            { id: 'ask', name: 'Ask mode', description: 'Ask before writes.' },
            { id: 'plan', name: 'Plan mode', description: 'Do not edit files.' },
            { id: 'custom-agent', name: 'Custom agent', description: 'Not a permission mode.' },
          ],
        },
      },
    });

    expect(options?.map(({ value, label, description, isPlanMode }) => ({
      value,
      label,
      description,
      isPlanMode: isPlanMode ?? false,
    }))).toEqual([
      {
        value: 'build',
        label: 'Build mode',
        description: 'Execute configured tools.',
        isPlanMode: false,
      },
      {
        value: 'ask',
        label: 'Ask mode',
        description: 'Ask before writes.',
        isPlanMode: false,
      },
      {
        value: 'plan',
        label: 'Plan mode',
        description: 'Do not edit files.',
        isPlanMode: true,
      },
      {
        value: 'custom-agent',
        label: 'Custom agent',
        description: 'Not a permission mode.',
        isPlanMode: false,
      },
    ]);
  });

  it('exposes the shared Safe/YOLO/Plan toggle instead of a provider-owned mode selector', () => {
    expect(opencodeChatUIConfig.getModeSelector?.({
      providerConfigs: {
        opencode: {
          availableModes: [
            { id: 'build', name: 'Build' },
            { id: 'plan', name: 'Plan' },
          ],
          selectedMode: 'build',
        },
      },
    }) ?? null).toBeNull();

    expect(opencodeChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeDescription: "Use tools according to OpenCode's configured permissions.",
      activeIcon: 'zap',
      activeLabel: 'YOLO',
      activeIsDangerous: false,
      activeValue: 'yolo',
      inactiveDescription: 'Ask before running commands or making file changes.',
      inactiveIcon: 'hand',
      inactiveLabel: 'Safe',
      inactiveValue: 'normal',
      planDescription: 'Explore the workspace and prepare a plan before editing.',
      planIcon: 'clipboard-list',
      planLabel: 'Plan',
      planValue: 'plan',
    });
  });

  it('derives execution policy from the saved native OpenCode mode', () => {
    expect(opencodeChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        opencode: {
          availableModes: [{ id: 'build', name: 'Build' }],
          selectedMode: 'build',
        },
      },
    })).toBe('normal');

    expect(opencodeChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        opencode: {
          selectedMode: 'plan',
          availableModes: [{ id: 'plan', name: 'Plan' }],
        },
      },
    })).toBe('plan');
  });

  it('persists the selected native mode and projects only the generic execution policy', () => {
    const settings: Record<string, unknown> = {
      permissionMode: 'normal',
      providerConfigs: {
        opencode: {
          availableModes: [
            { id: 'build', name: 'Build' },
            { id: 'ask', name: 'Ask' },
            { id: 'plan', name: 'Plan' },
          ],
          selectedMode: 'build',
        },
      },
    };

    opencodeChatUIConfig.applyPermissionMode?.('ask', settings);
    expect(settings.permissionMode).toBe('normal');
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).opencode.selectedMode).toBe('ask');

    opencodeChatUIConfig.applyPermissionMode?.('plan', settings);
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).opencode.selectedMode).toBe('plan');

    opencodeChatUIConfig.applyPermissionMode?.('build', settings);
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).opencode.selectedMode).toBe('build');
  });
});
