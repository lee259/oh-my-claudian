import { type App,TFile } from 'obsidian';

import type {
  ObsidianCapabilitySnapshot,
  ObsidianCliStatus,
  ObsidianPropertyValue,
  ObsidianSearchResult,
  ObsidianWorkspaceAdapter,
} from '../../core/obsidian/ObsidianWorkspaceAdapter';
import type { ManagedCommandResult } from '../../core/process/ManagedCommandRunner';
import { ManagedCommandRunner } from '../../core/process/ManagedCommandRunner';
import { findCliBinaryPath } from '../../utils/cliBinaryLocator';
import { getVaultPath } from '../../utils/path';
import { buildShellCommand, shellQuote } from '../../utils/shell';

const OBSIDIAN_CLI_BINARY = 'obsidian';
const CLI_TIMEOUT_MS = 15_000;
const CLI_OUTPUT_LIMIT_BYTES = 16_384;

const API_OPERATIONS = {
  read: true,
  search: true,
  'set-property': true,
  move: true,
  trash: true,
  backlinks: true,
} as const;

function assertVaultPath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Obsidian path must be vault-relative.');
  }
  return normalized;
}

/**
 * Application-owned adapter. The first implementation deliberately uses the
 * live Obsidian API for vault mutations; the CLI is treated as an optional
 * capability probe until a provider asks for a CLI-only operation.
 */
export class ObsidianCapabilityAdapter implements ObsidianWorkspaceAdapter {
  private readonly runner: ManagedCommandRunner;

  constructor(
    private readonly app: App,
    runner?: ManagedCommandRunner,
  ) {
    this.runner = runner ?? new ManagedCommandRunner();
  }

  async probe(): Promise<ObsidianCapabilitySnapshot> {
    const cli = await this.probeCli();
    const apiAvailable = Boolean(this.app.vault && this.app.fileManager);
    return {
      apiAvailable,
      cli,
      operations: apiAvailable
        ? API_OPERATIONS
        : {
          read: false,
          search: false,
          'set-property': false,
          move: false,
          trash: false,
          backlinks: false,
        },
    };
  }

  async read(path: string): Promise<string> {
    const file = this.getFile(path);
    return this.app.vault.read(file);
  }

  async search(query: string, options: { path?: string; limit?: number } = {}): Promise<ObsidianSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const folder = options.path ? assertVaultPath(options.path).replace(/\/$/, '') : null;
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const results: ObsidianSearchResult[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (folder && file.path !== folder && !file.path.startsWith(`${folder}/`)) continue;
      const content = await this.app.vault.read(file);
      const matches = content
        .split(/\r?\n/)
        .map((text, index) => ({ line: index + 1, text }))
        .filter(match => match.text.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()));
      if (matches.length > 0) {
        results.push({ path: file.path, matches });
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  async setProperty(path: string, name: string, value: ObsidianPropertyValue): Promise<void> {
    const file = this.getFile(path);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (value === null) {
        delete frontmatter[name];
      } else {
        frontmatter[name] = value;
      }
    });
  }

  async move(path: string, destination: string): Promise<void> {
    await this.app.fileManager.renameFile(this.getFile(path), assertVaultPath(destination));
  }

  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.getFile(path));
  }

  async backlinks(path: string): Promise<string[]> {
    const target = assertVaultPath(path);
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    return Object.entries(resolvedLinks)
      .filter(([, links]) => Object.prototype.hasOwnProperty.call(links, target))
      .map(([source]) => source)
      .sort();
  }

  private getFile(path: string): TFile {
    const normalized = assertVaultPath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      throw new Error(`Obsidian file not found: ${normalized}`);
    }
    return file;
  }

  private async probeCli(): Promise<ObsidianCliStatus> {
    const env = { ...process.env } as Record<string, string>;
    const resolvedPath = findCliBinaryPath(OBSIDIAN_CLI_BINARY, env.PATH);
    const attempts: Array<{ command: string; args: string[] }> = [];
    if (resolvedPath) attempts.push({ command: resolvedPath, args: ['version'] });
    attempts.push({ command: OBSIDIAN_CLI_BINARY, args: ['version'] });

    for (const attempt of attempts) {
      const result = await this.runCli(attempt.command, attempt.args, env);
      if (result?.exitCode === 0) {
        return {
          available: true,
          path: resolvedPath ?? OBSIDIAN_CLI_BINARY,
          version: result.stdout.trim() || result.stderr?.trim() || null,
          error: null,
        };
      }
    }

    return {
      available: false,
      path: resolvedPath,
      version: null,
      error: resolvedPath ? 'Obsidian CLI is installed but unavailable.' : 'Obsidian CLI is not registered on PATH.',
    };
  }

  private async runCli(
    command: string,
    args: string[],
    env: Record<string, string>,
  ): Promise<ManagedCommandResult | null> {
    const result = await this.runner.run({
      command,
      args,
      cwd: getVaultPath(this.app) ?? process.cwd(),
      env,
      timeoutMs: CLI_TIMEOUT_MS,
      stdoutLimitBytes: CLI_OUTPUT_LIMIT_BYTES,
      captureStderr: true,
    });
    if (result.termination !== 'error') return result;

    const shellCommand = buildShellCommand(
      `${shellQuote(OBSIDIAN_CLI_BINARY)} ${args.map(shellQuote).join(' ')}`,
    );
    if (!shellCommand) return null;

    const shellResult = await this.runner.run({
      command: shellCommand.command,
      args: shellCommand.args,
      cwd: getVaultPath(this.app) ?? process.cwd(),
      env,
      timeoutMs: CLI_TIMEOUT_MS,
      stdoutLimitBytes: CLI_OUTPUT_LIMIT_BYTES,
      captureStderr: true,
    });
    return shellResult.termination === 'error' ? null : shellResult;
  }
}
