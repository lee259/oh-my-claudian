import { buildDshLaunchSpec } from '@/providers/dsh/runtime/DshLaunchSpec';

describe('buildDshLaunchSpec', () => {
  it('uses the configured command and arguments without inventing a CLI protocol', () => {
    expect(buildDshLaunchSpec({
      args: ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts'],
      command: 'node',
      cwd: '/vault',
      env: { DEEPSEEK_API_KEY: 'secret' },
    })).toEqual({
      args: ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts'],
      command: 'node',
      cwd: '/vault',
      env: { DEEPSEEK_API_KEY: 'secret' },
    });
  });
});
