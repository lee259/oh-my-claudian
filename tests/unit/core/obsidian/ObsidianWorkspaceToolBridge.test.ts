import {
  OBSIDIAN_WORKSPACE_OPERATIONS,
  resolveObsidianWorkspaceToolOperations,
} from '@/core/obsidian/ObsidianWorkspaceToolBridge';

describe('resolveObsidianWorkspaceToolOperations', () => {
  it.each([
    { kind: 'provider-default' as const },
    { kind: 'unrestricted' as const },
  ])('allows supported operations for $kind policy', policy => {
    expect(resolveObsidianWorkspaceToolOperations(policy)).toEqual(OBSIDIAN_WORKSPACE_OPERATIONS);
  });

  it('denies all Obsidian operations for a passive policy', () => {
    expect(resolveObsidianWorkspaceToolOperations({ kind: 'passive' })).toEqual([]);
  });

  it('allows backlinks but denies mutations for a read-only policy', () => {
    expect(resolveObsidianWorkspaceToolOperations({ kind: 'read-only' })).toEqual(['backlinks']);
  });

  it('allows the tool only when an allow-list includes a recognized provider tool name', () => {
    expect(resolveObsidianWorkspaceToolOperations({
      kind: 'allow-list',
      names: ['read', 'claudian_obsidian_vault'],
    })).toEqual(OBSIDIAN_WORKSPACE_OPERATIONS);
    expect(resolveObsidianWorkspaceToolOperations({
      kind: 'allow-list',
      names: ['read', 'unrelated_tool'],
    })).toEqual([]);
  });
});
