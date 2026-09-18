/**
 * Provider-neutral access to the currently open Obsidian vault.
 *
 * Providers must use this contract instead of reaching into Obsidian's App
 * object or constructing shell commands themselves.
 */

export type ObsidianWorkspaceOperation =
  | 'read'
  | 'search'
  | 'set-property'
  | 'move'
  | 'trash'
  | 'backlinks';

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
  read(path: string): Promise<string>;
  search(query: string, options?: { path?: string; limit?: number }): Promise<ObsidianSearchResult[]>;
  setProperty(path: string, name: string, value: ObsidianPropertyValue): Promise<void>;
  move(path: string, destination: string): Promise<void>;
  trash(path: string): Promise<void>;
  backlinks(path: string): Promise<string[]>;
}
