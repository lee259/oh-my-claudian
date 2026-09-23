/** @jest-environment jsdom */

jest.mock('@/utils/cliBinaryLocator', () => ({
  findCliBinaryPath: jest.fn(() => null),
}));

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn(() => ({})),
}));

jest.mock('@/core/providers/cli/CliVersionUtils', () => ({
  isUpdateAvailable: (current: string, latest: string) => current !== latest,
  resolveCliVersionInfo: jest.fn(),
}));

import { resolveCliVersionInfo } from '@/core/providers/cli/CliVersionUtils';
import {
  destroyCliLifecycleSections,
  renderCliLifecycleSection,
} from '@/shared/settings/CliLifecycleSection';

describe('renderCliLifecycleSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows version status and offers update and readiness refresh actions', async () => {
    jest.mocked(resolveCliVersionInfo).mockResolvedValue({
      version: '1.2.0',
      latestVersion: '1.3.0',
      error: null,
      installedButBroken: false,
    });
    const onCheckAgain = jest.fn().mockResolvedValue(undefined);
    const container = document.createElement('div');

    renderCliLifecycleSection({
      container,
      metadata: {
        binaryName: 'test-cli',
        displayName: 'Test CLI',
        npmPackage: 'test-cli',
        update: { command: 'npm', args: ['update', '-g', 'test-cli'] },
      },
      resolveCliPath: async () => '/usr/local/bin/test-cli',
      getRuntimeEnvText: () => '',
      app: {} as never,
      onCheckAgain,
    });

    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('1.2.0');
    expect(container.textContent).toContain('1.3.0');
    expect(container.querySelector('.claudian-cli-lifecycle-update-badge')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.claudian-cli-lifecycle-action-row .mod-cta')?.textContent)
      .toBe('Update');

    const checkButton = container.querySelector<HTMLButtonElement>('.claudian-cli-lifecycle-check');
    expect(checkButton?.textContent).toBe('Check again');
    checkButton?.click();
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(onCheckAgain).toHaveBeenCalledTimes(1);

    destroyCliLifecycleSections(container);
    expect(container.childElementCount).toBe(0);
  });
});
