import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { h } from 'preact';

import type { ManagedCommandResult } from '../../core/process/ManagedCommandRunner';
import { ManagedCommandRunner } from '../../core/process/ManagedCommandRunner';
import type { CliCommand, CliProviderMetadata } from '../../core/providers/cli/CliProviderMetadata';
import type { CliVersionInfo } from '../../core/providers/cli/CliProviderMetadata';
import {
  resolveCliInstallCommand,
  resolveCliUpdateCommand,
} from '../../core/providers/cli/CliProviderMetadata';
import { isUpdateAvailable } from '../../core/providers/cli/CliVersionUtils';
import { resolveCliVersionInfo } from '../../core/providers/cli/CliVersionUtils';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';
import { findCliBinaryPath } from '../../utils/cliBinaryLocator';
import { parseEnvironmentVariables } from '../../utils/env';
import { buildShellCommand, shellQuote } from '../../utils/shell';
import { createPreactRoot } from '../ui/PreactRoot';
import { type CliLifecycleAction,CliLifecycleView } from './CliLifecycleView';

/** Map stable probe error strings from CliVersionUtils to i18n keys. */
const PROBE_ERROR_KEYS: Readonly<Record<string, TranslationKey>> = {
  'Version probe timed out': 'settings.cliLifecycle.probe.timedOut',
  'Failed to start the CLI process': 'settings.cliLifecycle.probe.failedToStart',
  'Version probe output too large': 'settings.cliLifecycle.probe.outputTooLarge',
  'CLI not installed or not on PATH': 'settings.cliLifecycle.probe.notFound',
};

function localizeProbeError(error: string): string {
  const key = PROBE_ERROR_KEYS[error];
  return key ? t(key) : error;
}

export interface CliLifecycleSectionOptions {
  container: HTMLElement;
  metadata: CliProviderMetadata;
  /** Resolve the CLI path for this provider. */
  resolveCliPath: () => Promise<string | null>;
  /** Get runtime environment text for the provider. */
  getRuntimeEnvText: () => string;
  /** App reference for confirmation modals. */
  app: App;
  /** Called after install/update completes (refresh CLI resolvers, etc.). */
  onCliChanged?: () => Promise<void>;
  /** Re-run the provider readiness check, rendered as a "Check again" button
   *  in the same action area as install/update. */
  onCheckAgain?: () => Promise<void>;
}

const lifecycleDestructors = new WeakMap<HTMLElement, () => void>();

/** Unmount lifecycle views before their provider settings container is cleared. */
export function destroyCliLifecycleSections(container: HTMLElement): void {
  const mounts = Array.from(
    container.querySelectorAll<HTMLElement>('.claudian-cli-lifecycle-mount'),
  );
  if (container.classList.contains('claudian-cli-lifecycle-mount')) {
    mounts.unshift(container);
  }
  mounts.forEach(mount => lifecycleDestructors.get(mount)?.());
}

/**
 * Renders a CLI lifecycle section (version display + install/update buttons)
 * inside the readiness panel's CLI detail container.
 *
 * The section no longer carries its own heading — it renders as a compact
 * block inside the provider readiness panel, keeping version management
 * visually merged with the readiness status.
 *
 * Usage in a provider settings tab:
 * ```
 * renderCliLifecycleSection({
 *   container: readinessPanel.cliDetail,
 *   metadata: myCliMetadata,
 *   resolveCliPath: () => context.plugin.getResolvedProviderCliPath(providerId),
 *   getRuntimeEnvText: () => context.plugin.getActiveEnvironmentVariables(providerId),
 *   app: context.plugin.app,
 *   onCliChanged: async () => { await readinessPanel.refresh(); },
 *   onCheckAgain: () => readinessPanel.refresh(true),
 * });
 * ```
 */
export function renderCliLifecycleSection(options: CliLifecycleSectionOptions): void {
  const { container, metadata, resolveCliPath, getRuntimeEnvText, app } = options;

  const mount = container.createDiv({ cls: 'claudian-cli-lifecycle-mount' });
  const root = createPreactRoot(mount);

  let destroyed = false;
  let loading = false;
  let currentEnv: Record<string, string> = {};
  let info: CliVersionInfo | null = null;
  let statusText = t('settings.cliLifecycle.checking');
  let pendingAction: CliLifecycleAction = null;

  const render = (): void => {
    if (destroyed) return;
    const updateAvailable = Boolean(
      info?.version
      && info.latestVersion
      && isUpdateAvailable(info.version, info.latestVersion),
    );
    root.render(h(CliLifecycleView, {
      statusText,
      info,
      errorText: info?.error ? localizeProbeError(info.error) : undefined,
      canInstall: Boolean(info && !info.installedButBroken && !info.version
        && resolveCliInstallCommand(metadata)),
      canUpdate: Boolean(info && !info.installedButBroken && info.version
        && updateAvailable && resolveCliUpdateCommand(metadata)),
      isUpdateAvailable: updateAvailable,
      pendingAction,
      onInstall: () => { void runAction('install'); },
      onUpdate: () => { void runAction('update'); },
      onCheckAgain: options.onCheckAgain ? () => { void handleCheckAgain(); } : undefined,
    }));
  };

  const refresh = async (): Promise<void> => {
    if (destroyed || loading) return;
    loading = true;
    info = null;
    statusText = t('settings.cliLifecycle.checking');
    render();

    try {
      const cliPath = await resolveCliPath();
      const envText = getRuntimeEnvText();
      currentEnv = { ...process.env, ...parseEnvironmentVariables(envText) } as Record<string, string>;

      const cliVersionInfo = await resolveCliVersionInfo(cliPath, {
        binaryName: metadata.binaryName,
        npmPackage: metadata.npmPackage,
      }, undefined, currentEnv);

      info = cliVersionInfo;
      statusText = '';
    } catch {
      info = null;
      statusText = t('common.error');
    } finally {
      loading = false;
      render();
    }
  };

  const runAction = async (action: 'install' | 'update'): Promise<void> => {
    if (!info || pendingAction !== null) return;
    const command = action === 'install'
      ? resolveCliInstallCommand(metadata)
      : resolveCliUpdateCommand(metadata);
    if (!command) return;

    pendingAction = action;
    render();
    try {
      await runLifecycleAction(
        app,
        command,
        action,
        metadata.displayName,
        currentEnv,
        refresh,
        options.onCliChanged,
        reprobeVersion,
      );
    } finally {
      pendingAction = null;
      render();
    }
  };

  /** "Check again" refreshes both the CLI version block and the provider
   *  readiness panel so the two stay consistent. */
  const handleCheckAgain = async (): Promise<void> => {
    if (pendingAction !== null) return;
    pendingAction = 'check';
    render();
    try {
      await Promise.all([options.onCheckAgain?.(), refresh()]);
    } catch {
      // Readiness refresh errors are surfaced by the panel.
    } finally {
      pendingAction = null;
      render();
    }
  };

  /** Re-probe the CLI version after a lifecycle action to verify the result. */
  const reprobeVersion = async (): Promise<CliVersionInfo> => {
    const cliPath = await resolveCliPath();
    return resolveCliVersionInfo(cliPath, {
      binaryName: metadata.binaryName,
      npmPackage: metadata.npmPackage,
    }, undefined, currentEnv);
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    lifecycleDestructors.delete(mount);
    root.unmount();
    mount.remove();
  };

  lifecycleDestructors.set(mount, destroy);
  render();
  void refresh();
}

/** Resolve a bare binary name to an absolute path so the update command
 * can find it even when the Electron renderer PATH differs from the shell. */
function resolveLifecycleCommand(cmd: CliCommand, env: Record<string, string>): CliCommand {
  const looksLikePath = cmd.command.includes('/') || cmd.command.includes('\\');
  if (looksLikePath) return cmd;
  const resolved = findCliBinaryPath(cmd.command, env.PATH);
  return resolved ? { command: resolved, args: cmd.args } : cmd;
}

async function runLifecycleAction(
  app: App,
  cmd: CliCommand,
  action: 'install' | 'update',
  displayName: string,
  env: Record<string, string>,
  refresh: () => Promise<void>,
  onCliChanged?: () => Promise<void>,
  reprobeVersion?: () => Promise<CliVersionInfo>,
): Promise<void> {
  const actionLabel = action === 'install'
    ? t('settings.cliLifecycle.install')
    : t('settings.cliLifecycle.update');
  const confirmMsg = action === 'install'
    ? t('settings.cliLifecycle.installConfirm', { cli: displayName, command: `${cmd.command} ${cmd.args.join(' ')}` })
    : t('settings.cliLifecycle.updateConfirm', { cli: displayName, command: `${cmd.command} ${cmd.args.join(' ')}` });

  let confirmed: boolean;
  try {
    confirmed = await (await import('../modals/ConfirmModal')).confirm(
      app,
      confirmMsg,
      actionLabel,
    );
  } catch {
    new Notice(`${actionLabel} failed to open confirmation dialog.`);
    return;
  }
  if (!confirmed) return;

  try {
    const runner = new ManagedCommandRunner();
    const resolvedCommand = resolveLifecycleCommand(cmd, env);

    /** Run a lifecycle command; returns null when the spawn itself failed
     *  (ENOENT) so the caller can retry via shell. */
    const tryRun = async (command: string, args: string[]): Promise<ManagedCommandResult | null> => {
      const result = await runner.run({
        command,
        args,
        cwd: process.cwd(),
        env,
        timeoutMs: 120_000,
        stdoutLimitBytes: 16_384,
        captureStderr: true,
      });
      return result.termination === 'error' ? null : result;
    };

    let result = await tryRun(resolvedCommand.command, resolvedCommand.args);
    if (result === null) {
      // Fallback: run through user shell so that the login profile PATH
      // (nvm, homebrew, etc.) is loaded — same approach as cc-switch.
      const commandLine = `${shellQuote(resolvedCommand.command)} ${resolvedCommand.args.map(shellQuote).join(' ')}`;
      const shellCmd = buildShellCommand(commandLine);
      if (shellCmd) {
        result = await tryRun(shellCmd.command, shellCmd.args);
      }
    }

    if (result === null) {
      new Notice(
        action === 'install'
          ? `${t('settings.cliLifecycle.installFailed', { cli: displayName })} (error)`
          : `${t('settings.cliLifecycle.updateFailed', { cli: displayName })} (error)`,
      );
    } else if (result.exitCode !== 0) {
      const detail = result.termination
        ? result.termination
        : (result.stderr?.trim() || result.stdout.trim()).slice(0, 200) || 'unknown error';
      new Notice(
        action === 'install'
          ? `${t('settings.cliLifecycle.installFailed', { cli: displayName })} (${detail})`
          : `${t('settings.cliLifecycle.updateFailed', { cli: displayName })} (${detail})`,
      );
    } else {
      // Command exited 0 — re-probe to verify the version actually changed.
      // This mirrors cc-switch's executeRun which re-probes after every action
      // and reports a soft failure when the version did not move.
      const after = reprobeVersion ? await reprobeVersion() : null;
      const updateUnchanged = after
        && action === 'update'
        && after.version
        && after.latestVersion
        && isUpdateAvailable(after.version, after.latestVersion);
      const installStillMissing = after
        && action === 'install'
        && !after.version;

      if (updateUnchanged) {
        new Notice(
          t('settings.cliLifecycle.versionUnchanged', {
            cli: displayName,
            version: after?.version ?? '',
          }),
        );
      } else if (installStillMissing) {
        new Notice(t('settings.cliLifecycle.installFailed', { cli: displayName }));
      } else {
        new Notice(
          action === 'install'
            ? t('settings.cliLifecycle.installDone', { cli: displayName })
            : t('settings.cliLifecycle.updateDone', { cli: displayName }),
        );
      }
      await onCliChanged?.();
    }
  } catch (error) {
    new Notice(
      `${actionLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    void refresh();
  }
}
