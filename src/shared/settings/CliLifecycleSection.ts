import type { App } from 'obsidian';
import { Notice } from 'obsidian';

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

  const root = container.createDiv({ cls: 'claudian-cli-lifecycle' });

  const labelDiv = root.createDiv({ cls: 'claudian-cli-lifecycle-label' });
  labelDiv.createSpan({ text: t('settings.cliLifecycle.label', { cli: metadata.displayName }) });

  const statusDiv = root.createDiv({ cls: 'claudian-cli-lifecycle-status' });
  const actionDiv = root.createDiv({ cls: 'claudian-cli-lifecycle-actions' });

  let loading = false;
  let currentEnv: Record<string, string> = {};

  const refresh = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    statusDiv.empty?.();
    actionDiv.empty?.();
    statusDiv.setText?.(t('settings.cliLifecycle.checking'));

    try {
      const cliPath = await resolveCliPath();
      const envText = getRuntimeEnvText();
      currentEnv = { ...process.env, ...parseEnvironmentVariables(envText) } as Record<string, string>;

      const cliVersionInfo = await resolveCliVersionInfo(cliPath, {
        binaryName: metadata.binaryName,
        npmPackage: metadata.npmPackage,
      }, undefined, currentEnv);

      renderVersionInfo(statusDiv, cliVersionInfo);
      renderActionButtons(actionDiv, cliVersionInfo, metadata, app, currentEnv, refresh, options.onCliChanged, reprobeVersion, options.onCheckAgain ? handleCheckAgain : undefined);
    } catch {
      statusDiv.setText?.(t('common.error'));
    } finally {
      loading = false;
    }
  };

  /** "Check again" refreshes both the CLI version block and the provider
   *  readiness panel so the two stay consistent. */
  const handleCheckAgain = async (): Promise<void> => {
    await Promise.all([options.onCheckAgain?.(), refresh()]);
  };

  /** Re-probe the CLI version after a lifecycle action to verify the result. */
  const reprobeVersion = async (): Promise<CliVersionInfo> => {
    const cliPath = await resolveCliPath();
    return resolveCliVersionInfo(cliPath, {
      binaryName: metadata.binaryName,
      npmPackage: metadata.npmPackage,
    }, undefined, currentEnv);
  };

  void refresh();
}

function renderVersionInfo(
  container: HTMLElement,
  info: CliVersionInfo,
): void {
  container.empty?.();

  const currentEl = container.createDiv({ cls: 'claudian-cli-lifecycle-version-item' });
  currentEl.createSpan({ text: t('settings.cliLifecycle.currentVersion') + ': ' });

  if (info.installedButBroken) {
    const val = currentEl.createSpan({ cls: 'claudian-cli-lifecycle-version-broken' });
    val.setText(t('settings.cliLifecycle.installedButBroken'));
    if (info.error) {
      val.title = info.error;
    }
  } else if (info.version) {
    currentEl.createSpan({ cls: 'claudian-cli-lifecycle-version-value' }).setText(info.version);
  } else {
    currentEl.createSpan({ cls: 'claudian-cli-lifecycle-version-not-installed' }).setText(
      t('settings.cliLifecycle.notInstalled'),
    );
  }

  if (info.latestVersion) {
    const latestEl = container.createDiv({ cls: 'claudian-cli-lifecycle-version-item' });
    latestEl.createSpan({ text: t('settings.cliLifecycle.latestVersion') + ': ' });
    latestEl.createSpan({ cls: 'claudian-cli-lifecycle-version-value' }).setText(info.latestVersion);

    if (info.version && isUpdateAvailable(info.version, info.latestVersion)) {
      const badge = container.createDiv({ cls: 'claudian-cli-lifecycle-update-badge' });
      badge.setText(t('settings.cliLifecycle.updateAvailable', {
        version: info.latestVersion,
      }));
    }
  }

  if (info.error && !info.version && !info.installedButBroken) {
    container.createDiv({
      cls: 'claudian-cli-lifecycle-error',
      text: localizeProbeError(info.error),
    });
  }
}

function renderActionButtons(
  container: HTMLElement,
  info: CliVersionInfo,
  metadata: CliProviderMetadata,
  app: App,
  env: Record<string, string>,
  refresh: () => Promise<void>,
  onCliChanged?: () => Promise<void>,
  reprobeVersion?: () => Promise<CliVersionInfo>,
  onCheckAgain?: () => Promise<void>,
): void {
  container.empty?.();

  if (info.installedButBroken) {
    container.createSpan({
      cls: 'claudian-cli-lifecycle-hint',
      text: t('settings.cliLifecycle.checkEnv'),
    });
  }

  // Action row: install/update (primary) + "Check again" (secondary) side by side.
  const row = container.createDiv({ cls: 'claudian-cli-lifecycle-action-row' });

  if (!info.installedButBroken && !info.version) {
    const installCmd = resolveCliInstallCommand(metadata);
    if (installCmd) {
      const btn = row.createEl('button', {
        cls: 'mod-cta',
        text: t('settings.cliLifecycle.install'),
      });
      btn.addEventListener?.('click', () => {
        btn.disabled = true;
        btn.setText?.(t('settings.cliLifecycle.installing'));
        void runLifecycleAction(
          app,
          installCmd,
          'install',
          metadata.displayName,
          env,
          refresh,
          onCliChanged,
          reprobeVersion,
        ).finally(() => {
          // refresh() re-renders the action row, so this element may already
          // be detached — resetting it is a no-op then.
          btn.disabled = false;
          btn.setText?.(t('settings.cliLifecycle.install'));
        });
      });
    }
  } else if (!info.installedButBroken && info.version) {
    if (info.latestVersion && isUpdateAvailable(info.version, info.latestVersion)) {
      const updateCmd = resolveCliUpdateCommand(metadata);
      if (updateCmd) {
        const btn = row.createEl('button', {
          cls: 'mod-cta',
          text: t('settings.cliLifecycle.update'),
        });
        btn.addEventListener?.('click', () => {
          btn.disabled = true;
          btn.setText?.(t('settings.cliLifecycle.updating'));
          void runLifecycleAction(
            app,
            updateCmd,
            'update',
            metadata.displayName,
            env,
            refresh,
            onCliChanged,
            reprobeVersion,
          ).finally(() => {
            // refresh() re-renders the action row, so this element may
            // already be detached — resetting it is a no-op then.
            btn.disabled = false;
            btn.setText?.(t('settings.cliLifecycle.update'));
          });
        });
      }
    } else {
      row.createSpan({
        cls: 'claudian-cli-lifecycle-ready',
        text: t('settings.cliLifecycle.ready'),
      });
    }
  }

  if (onCheckAgain) {
    const checkBtn = row.createEl('button', {
      cls: 'claudian-cli-lifecycle-check',
      text: t('settings.providerReadiness.refresh'),
    });
    checkBtn.addEventListener?.('click', () => {
      void (async () => {
        checkBtn.disabled = true;
        checkBtn.setText?.(t('settings.providerReadiness.checking'));
        try {
          await onCheckAgain();
        } catch {
          // Readiness refresh errors are already surfaced by the panel;
          // keep the button state consistent.
        } finally {
          // The action re-renders the action row via refresh(), so this
          // element may already be detached — resetting it is a no-op then.
          checkBtn.disabled = false;
          checkBtn.setText?.(t('settings.providerReadiness.refresh'));
        }
      })();
    });
  }
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