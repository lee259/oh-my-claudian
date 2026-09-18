/**
 * Provider-neutral access to the currently open Obsidian vault.
 *
 * Providers must use this contract instead of reaching into Obsidian's App
 * object or constructing shell commands themselves.
 */

export const OBSIDIAN_CLI_SETUP_URL = 'https://obsidian.md/help/cli';

export type ObsidianWorkspaceOperation =
  | 'read'
  | 'search'
  | 'set-property'
  | 'move'
  | 'trash'
  | 'backlinks';

export interface ObsidianCliStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface ObsidianCapabilitySnapshot {
  apiAvailable: boolean;
  cli: ObsidianCliStatus;
  operations: Readonly<Record<ObsidianWorkspaceOperation, boolean>>;
}

export interface ObsidianSearchMatch {
  line: number;
  text: string;
}

export interface ObsidianSearchResult {
  path: string;
  matches: ObsidianSearchMatch[];
}

export type ObsidianPropertyValue = string | number | boolean | string[] | null;

export interface ObsidianWorkspaceAdapter {
  probe(): Promise<ObsidianCapabilitySnapshot>;
  read(path: string): Promise<string>;
  search(query: string, options?: { path?: string; limit?: number }): Promise<ObsidianSearchResult[]>;
  setProperty(path: string, name: string, value: ObsidianPropertyValue): Promise<void>;
  move(path: string, destination: string): Promise<void>;
  trash(path: string): Promise<void>;
  backlinks(path: string): Promise<string[]>;
}
