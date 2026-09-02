/**
 * Per-provider CLI metadata for version probing, install, and update.
 *
 * Each provider that exposes a CLI registers its metadata here. Core tools
 * use this information to check local version, query the latest release,
 * and run lifecycle actions (install/update).
 */

/** A structured command to execute (safe across platforms via cross-spawn). */
export interface CliCommand {
  command: string;
  args: string[];
}

/**
 * Per-provider CLI metadata for version probing, install, and update.
 *
 * Each provider that exposes a CLI registers its metadata here. Core tools
 * use this information to check local version, query the latest release,
 * and run lifecycle actions (install/update).
 */
export interface CliProviderMetadata {
  /** Binary name used for PATH lookup (e.g. "grok", "claude", "codex"). */
  binaryName: string;

  /** Human-readable display name for the CLI (e.g. "Grok CLI"). */
  displayName: string;

  /** npm package name for registry-based version checking and install. */
  npmPackage?: string;

  /** Optional URL to an official shell installer script (macOS/Linux). */
  installerUrl?: string;

  /** Structured install command. Defaults to `npm install -g <pkg>@latest`. */
  install?: CliCommand;

  /** Structured update command. Defaults to the CLI's native update or npm update. */
  update?: CliCommand;

  /** Platform-specific overrides (applied before the generic fields). */
  platform?: Partial<Record<NodeJS.Platform, CliPlatformOverrides>>;
}

/** Platform-specific overrides for a CLI lifecycle command. */
export interface CliPlatformOverrides {
  install?: CliCommand;
  update?: CliCommand;
  installerUrl?: string;
}

/** Result of a local version probe. */
export interface CliVersionProbeResult {
  /** Local version string, or null if the CLI is not installed. */
  version: string | null;
  /** Error message when the probe failed. */
  error: string | null;
  /** CLI exists but --version failed (installed but broken). */
  installedButBroken: boolean;
}

/** Complete version info combining local probe and remote latest. */
export interface CliVersionInfo {
  /** Local version string, null if not installed. */
  version: string | null;
  /** Latest version from the package registry, null if unavailable. */
  latestVersion: string | null;
  /** Error message from the local probe. */
  error: string | null;
  /** CLI exists but --version failed. */
  installedButBroken: boolean;
}

/** Resolve the effective install command for a metadata entry on the current platform. */
export function resolveCliInstallCommand(metadata: CliProviderMetadata): CliCommand | null {
  const platformOverride = metadata.platform?.[process.platform];
  if (platformOverride?.install) {
    return platformOverride.install;
  }
  if (metadata.install) {
    return metadata.install;
  }
  if (metadata.npmPackage) {
    return { command: 'npm', args: ['install', '-g', `${metadata.npmPackage}@latest`] };
  }
  return null;
}

/** Resolve the effective update command for a metadata entry on the current platform. */
export function resolveCliUpdateCommand(metadata: CliProviderMetadata): CliCommand | null {
  const platformOverride = metadata.platform?.[process.platform];
  if (platformOverride?.update) {
    return platformOverride.update;
  }
  if (metadata.update) {
    return metadata.update;
  }
  if (metadata.npmPackage) {
    // `npm update -g <pkg>` is a no-op when the current version already
    // satisfies the installed range, and exits 0 even though nothing changed.
    // `npm install -g <pkg>@latest` forces the latest release — same as
    // cc-switch's npm_install_command_for.
    return { command: 'npm', args: ['install', '-g', `${metadata.npmPackage}@latest`] };
  }
  return null;
}

/** Resolve the effective installer URL for the current platform. */
export function resolveCliInstallerUrl(metadata: CliProviderMetadata): string | null {
  const platformOverride = metadata.platform?.[process.platform];
  return platformOverride?.installerUrl ?? metadata.installerUrl ?? null;
}