import { buildGrokLaunchArguments } from '@/providers/grok/execution/GrokExecutionNativeConnection';

describe('Grok Build ACP launch arguments', () => {
  it('appends configured literal arguments after the ACP command', () => {
    expect(buildGrokLaunchArguments(['--profile', 'custom profile'])).toEqual([
      'agent', '--no-leader', 'stdio', '--profile', 'custom profile',
    ]);
  });
});
