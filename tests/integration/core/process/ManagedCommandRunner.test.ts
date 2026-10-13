import { ManagedCommandRunner } from '@/core/process/ManagedCommandRunner';

it('lets a verbose updater finish and retains its native failure reply', async () => {
  const result = await new ManagedCommandRunner().run({
    command: process.execPath,
    args: ['-e', "process.stdout.write('progress\\n'.repeat(400000),()=>{process.stderr.write('native updater: permission denied\\n',()=>{process.exit(7);});});"],
    cwd: process.cwd(), env: process.env, timeoutMs: 10_000,
    captureStderr: true, stdoutLimitBytes: 1024 * 1024, outputLimitBehavior: 'truncate',
  });
  expect(result).toMatchObject({ exitCode: 7, stderr: 'native updater: permission denied\n', outputTruncated: true });
  expect(result.termination).toBeUndefined();
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024 * 1024);
});
