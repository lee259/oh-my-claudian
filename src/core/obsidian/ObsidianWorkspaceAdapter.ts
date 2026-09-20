/**
 * Provider-neutral access to the currently open Obsidian vault.
 *
 * Providers must use this contract instead of reaching into Obsidian's App
 * object or constructing shell commands themselves.
 */

export type ObsidianWorkspaceOperation =
  | 'set-property'
  | 'move'
  | 'trash'
  | 'backlinks';

export type ObsidianPropertyValue = string | number | boolean | string[] | null;

export interface ObsidianWorkspaceAdapter {
  setProperty(path: string, name: string, value: ObsidianPropertyValue): Promise<void>;
  move(path: string, destination: string): Promise<void>;
  trash(path: string): Promise<void>;
  backlinks(path: string): Promise<string[]>;
}
