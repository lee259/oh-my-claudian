import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { App, Workspace, WorkspaceLeaf } from 'obsidian';
import { Notice, TFile } from 'obsidian';
import * as Obsidian from 'obsidian';

import { type FileReference,parseFileReference } from './FileReference';
import { getVaultPath, normalizePathForVault } from './path';

const EXTERNAL_TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml',
  'csv', 'tsv', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro', 'html',
  'css', 'scss', 'less', 'py', 'pyi', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h',
  'cc', 'cpp', 'hpp', 'cs', 'fs', 'fsx', 'php', 'rb', 'rake', 'ex', 'exs', 'erl', 'hrl',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'gql', 'proto', 'env', 'conf', 'ini',
  'properties', 'diff', 'patch',
]);

/** Reads Obsidian's language when supported, with a safe fallback for older hosts. */
export function getObsidianLanguage(fallbackLanguage = 'en'): string {
  const getLanguage = (Obsidian as unknown as Record<string, unknown>)['getLanguage'];
  return typeof getLanguage === 'function'
    ? (getLanguage as () => string)()
    : fallbackLanguage;
}

export function getVaultFileByPath(app: App, filePath: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (isVaultFile(file)) {
    return file;
  }
  return null;
}

export async function revealWorkspaceLeaf(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
  await workspace.revealLeaf(leaf);
}

/** Opens a provider-reported vault file or an external text file with the OS default app. */
export async function openVaultFile(
  app: App,
  value: string | FileReference,
  openExternalFile: (path: string) => Promise<string> = openExternalFileWithDefaultApp,
): Promise<boolean> {
  const parsedReference = typeof value === 'string' ? parseFileReference(value) : value;
  // Obsidian can serialize a vault-root link with a leading slash. Keep this
  // hidden skill directory vault-relative instead of treating it as OS-rooted.
  const reference = parsedReference.path.startsWith('/.agents/skills/')
    ? { ...parsedReference, path: parsedReference.path.slice(1) }
    : parsedReference;
  try {
    if (isAbsolutePath(reference.path)) {
      if (!isExternalTextFilePath(reference.path)) {
        new Notice(`Could not open external file: ${reference.path}`);
        return false;
      }

      const error = await openExternalFile(reference.path);
      if (error) throw new Error(error);
      return true;
    }

    const relativePath = normalizePathForVault(reference.path, getVaultPath(app));
    if (!relativePath || relativePath.startsWith('/')) {
      new Notice(`Could not open vault file: ${reference.path}`);
      return false;
    }

    const file = resolveVaultFile(app, relativePath, reference.path);
    if (!(file instanceof TFile)) {
      if (isManagedSkillPath(relativePath)) {
        const vaultPath = getVaultPath(app);
        if (vaultPath) {
          const absolutePath = await resolveExistingVaultFile(vaultPath, relativePath);
          if (absolutePath) {
            const error = await openExternalFile(absolutePath);
            if (error) throw new Error(error);
            return true;
          }
        }
      }
      new Notice(`File not found in vault: ${relativePath}`);
      return false;
    }

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file);

    if (reference.lineStart !== undefined) {
      const editor = (leaf.view as { editor?: {
        focus?: () => void;
        getLine?: (line: number) => string;
        setSelection?: (anchor: { line: number; ch: number }, head?: { line: number; ch: number }) => void;
      } }).editor;
      if (editor?.setSelection) {
        const startLine = Math.max(0, reference.lineStart - 1);
        const endLine = Math.max(startLine, (reference.lineEnd ?? reference.lineStart) - 1);
        const endCh = editor.getLine ? editor.getLine(endLine).length : 0;
        editor.setSelection({ line: startLine, ch: 0 }, { line: endLine, ch: endCh });
        editor.focus?.();
      }
    }
    return true;
  } catch {
    const location = isAbsolutePath(reference.path) ? 'external file' : 'vault file';
    new Notice(`Could not open ${location}: ${reference.path}`);
    return false;
  }
}

/** True for absolute paths to common text and source files that can be safely handed to a file viewer. */
export function isExternalTextFilePath(filePath: string): boolean {
  if (!isAbsolutePath(filePath)) return false;
  const extension = filePath.split(/[\\/]/u).at(-1)?.split('.').at(-1)?.toLocaleLowerCase();
  return extension !== undefined && EXTERNAL_TEXT_EXTENSIONS.has(extension);
}

/** Opens a named local skill from the vault or common agent skill directories. */
export async function openAgentSkillByName(app: App, name: string): Promise<boolean> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) return false;

  const vaultPath = getVaultPath(app);
  if (vaultPath) {
    for (const skillsRoot of ['.agents/skills', '.claude/skills']) {
      const relativePath = `${skillsRoot}/${name}/SKILL.md`;
      if (await resolveExistingVaultFile(vaultPath, relativePath)) {
        return await openVaultFile(app, relativePath);
      }
    }
  }

  for (const skillsRoot of ['.agents/skills', '.codex/skills', '.claude/skills']) {
    const candidatePath = path.join(os.homedir(), skillsRoot, name, 'SKILL.md');
    try {
      const realPath = await fs.realpath(candidatePath);
      if ((await fs.stat(realPath)).isFile()) return await openVaultFile(app, realPath);
    } catch {
      // Try the next conventional skill directory.
    }
  }

  new Notice(`Skill file not found: ${name}/SKILL.md`);
  return false;
}

function isManagedSkillPath(filePath: string): boolean {
  return /^\.(?:agents|claude)\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(filePath);
}

async function resolveExistingVaultFile(vaultPath: string, relativePath: string): Promise<string | null> {
  try {
    const realVaultPath = await fs.realpath(vaultPath);
    const candidatePath = path.resolve(realVaultPath, ...relativePath.split('/'));
    const realFilePath = await fs.realpath(candidatePath);
    const relativeFilePath = path.relative(realVaultPath, realFilePath);
    if (
      relativeFilePath === '..'
      || relativeFilePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeFilePath)
      || !(await fs.stat(realFilePath)).isFile()
    ) {
      return null;
    }
    return realFilePath;
  } catch {
    return null;
  }
}

function openExternalFileWithDefaultApp(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is only available in Obsidian's renderer runtime.
  const electron = require('electron') as {
    shell: { openPath(path: string): Promise<string> };
  };
  return electron.shell.openPath(filePath);
}

/**
 * Resolves both vault-relative paths and paths relative to a provider's working directory.
 * Provider tools are allowed to return either form, while Obsidian only indexes vault-relative
 * paths. A suffix match is used only when it is unique, so similarly named files are never
 * opened by guesswork.
 */
function resolveVaultFile(app: App, normalizedPath: string, rawPath: string): TFile | null {
  const exact = app.vault.getAbstractFileByPath(normalizedPath);
  if (exact instanceof TFile) {
    return exact;
  }

  if (isAbsolutePath(rawPath)) {
    return null;
  }

  const suffix = `/${normalizedPath}`;
  const matches = app.vault.getFiles().filter((file) => (
    file.path === normalizedPath || file.path.endsWith(suffix)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\');
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFile>;
  return typeof candidate.path === 'string'
    && typeof candidate.basename === 'string';
}
