import { accessSync, constants, realpathSync, statSync } from 'node:fs';

import { findCliBinaryPath } from '@/utils/cliBinaryLocator';
import { findNodeExecutable, getEnhancedPath, parseEnvironmentVariables } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

import type { ProviderHost } from '../ProviderHost';
import type { ProviderId } from '../types';
import { type CliCommand, type CliProviderMetadata, resolveCliInstallCommand } from './CliProviderMetadata';
import type { ProviderCliLifecycleAdapter } from './ProviderCliLifecycle';

interface HostCliLifecycleOptions {
  identityPattern?: RegExp;
  environment?(host: ProviderHost, cliPath: string | null): Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv;
  command?(host: ProviderHost, cliPath: string, args: string[], environment: NodeJS.ProcessEnv): Promise<CliCommand> | CliCommand;
}

export function buildHostCliEnvironment(host: ProviderHost, id: ProviderId, cliPath?: string | null): NodeJS.ProcessEnv {
  const configured = parseEnvironmentVariables(host.getActiveEnvironmentVariables(id));
  return { ...process.env, ...configured, PATH: getEnhancedPath(configured.PATH, cliPath ?? undefined) };
}

/** Host-native mechanics; providers supply identity, launch environment and command policy. */
export function createHostCliLifecycleAdapter(
  id: ProviderId,
  metadata: CliProviderMetadata,
  options: HostCliLifecycleOptions = {},
): ProviderCliLifecycleAdapter {
  const environment = (host: ProviderHost, cliPath: string | null) => (
    options.environment?.(host, cliPath) ?? buildHostCliEnvironment(host, id, cliPath)
  );
  const command = async (host: ProviderHost, cliPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<CliCommand> => {
    if (options.command) return options.command(host, cliPath, args, env);
    if (/\.(?:[cm]?js)$/iu.test(cliPath)) {
      const node = findNodeExecutable(env.PATH);
      if (!node) throw new Error('Node.js is required for this CLI.');
      return { command: node, args: [cliPath, ...args] };
    }
    return { command: cliPath, args };
  };
  return {
    metadata,
    async resolveTarget(host, context) {
      const cliPath = await host.getResolvedProviderCliPath(id, context);
      if (!cliPath) return null;
      const stat = statSync(cliPath);
      if (!stat.isFile()) throw new Error('The configured CLI is not a file.');
      if (process.platform !== 'win32' && !/\.(?:[cm]?js)$/iu.test(cliPath)) {
        try { accessSync(cliPath, constants.X_OK); }
        catch { throw new Error('The configured CLI is not executable.'); }
      }
      const env = await environment(host, cliPath);
      const update = metadata.platform?.[process.platform]?.update ?? metadata.update;
      return {
        installationIdentity: JSON.stringify([realpathSync(cliPath), stat.dev, stat.ino, stat.size, stat.mtimeMs]),
        path: cliPath, environment: env, cwd: getVaultPath(host.app) ?? process.cwd(),
        versionCommand: await command(host, cliPath, ['--version'], env),
        updateCommand: update?.command === metadata.binaryName
          ? await command(host, cliPath, update.args, env) : null,
        ...(options.identityPattern ? {
          identityCommand: await command(host, cliPath, ['--help'], env),
          identityPattern: options.identityPattern,
        } : {}),
      };
    },
    async resolveInstallCommand(host) {
      const install = resolveCliInstallCommand(metadata);
      if (!install) return null;
      const env = await environment(host, null);
      return {
        command: { ...install, command: findCliBinaryPath(install.command, env.PATH) ?? install.command },
        environment: env, cwd: getVaultPath(host.app) ?? process.cwd(),
      };
    },
  };
}
