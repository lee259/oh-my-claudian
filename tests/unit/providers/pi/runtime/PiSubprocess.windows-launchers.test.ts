jest.mock('cross-spawn', () => jest.fn());

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createMockChildProcess } from '@test/helpers/MockChildProcess';
import spawn from 'cross-spawn';

import { PiSubprocess } from '@/providers/pi/runtime/PiSubprocess';
import * as env from '@/utils/env';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const originalPlatform = process.platform;
let root: string;
let nodeSpy: jest.SpiedFunction<typeof env.findNodeExecutable>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-managed-launchers-'));
  Object.defineProperty(process, 'platform', { value: 'win32' });
  nodeSpy = jest.spyOn(env, 'findNodeExecutable').mockReturnValue('/runtime/node.exe');
  mockSpawn.mockReturnValue(createMockChildProcess());
});

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  nodeSpy.mockRestore();
  jest.clearAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function writeManagedInstall(): Promise<string> {
  const bin = path.join(root, 'bin');
  const install = path.join(root, 'install');
  const pkg = path.join(install, 'releases', '1.1.0', 'node_modules', '@earendil-works', 'pi-coding-agent');
  const cli = path.join(pkg, 'dist', 'bundle', 'cli.js');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(cli, 'process.stdin.resume();');
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: 'dist/bundle/cli.js' } }));
  await fs.writeFile(path.join(install, 'managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', layout: 'releases-v1', schemaVersion: 1 }));
  await fs.writeFile(path.join(install, 'current-version'), '1.1.0\n');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, 'pi-launcher.js'), '// installation locator');
  await fs.writeFile(path.join(bin, 'pi.cmd'), '@ECHO off\r\nnode "%~dp0pi-launcher.js" %*\r\n');
  await fs.writeFile(path.join(bin, 'pi.ps1'), '$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent\n$launcher = Join-Path $basedir "pi-launcher.js"\n& node $launcher $args\n');
  return cli;
}

it.each(['cmd', 'ps1'])('launches the active managed release through Node for pi.%s', async extension => {
  const cli = await writeManagedInstall();
  const args = ['--mode', 'rpc', '--system-prompt', 'First line\nSecond line %PATH% !^', '--session', 'D:\\Pi Sessions\\session.jsonl'];
  const subprocess = new PiSubprocess({ command: path.join(root, 'bin', `pi.${extension}`), args, cwd: root, env: {} });
  subprocess.start();
  expect(mockSpawn).toHaveBeenCalledWith('/runtime/node.exe', [cli, ...args], expect.objectContaining({ windowsHide: true, stdio: 'pipe' }));
});

it.each([
  ['invalid marker', async () => fs.writeFile(path.join(root, 'install', 'managed-install.json'), '{}')],
  ['unsafe version', async () => fs.writeFile(path.join(root, 'install', 'current-version'), '../1.1.0')],
  ['missing release', async () => fs.writeFile(path.join(root, 'install', 'current-version'), '9.9.9')],
  ['wrong package', async () => fs.writeFile(path.join(root, 'install', 'releases', '1.1.0', 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'), JSON.stringify({ name: 'other', bin: { pi: 'dist/bundle/cli.js' } }))],
] as const)('rejects a managed install with an %s without invoking a shell', async (_label, corrupt) => {
  await writeManagedInstall();
  await corrupt();
  for (const extension of ['cmd', 'ps1']) {
    expect(() => new PiSubprocess({ command: path.join(root, 'bin', `pi.${extension}`), args: ['--mode', 'rpc'], cwd: root, env: {} }))
      .toThrow('could not be resolved to its Node.js entry point');
  }
  expect(mockSpawn).not.toHaveBeenCalled();
});

it('rejects an unproved PowerShell launcher', async () => {
  const launcher = path.join(root, 'pi.ps1');
  await fs.writeFile(launcher, '& unknown-wrapper $args');
  expect(() => new PiSubprocess({ command: launcher, args: ['--mode', 'rpc'], cwd: root, env: {} }))
    .toThrow('could not be resolved to its Node.js entry point');
  expect(mockSpawn).not.toHaveBeenCalled();
});
