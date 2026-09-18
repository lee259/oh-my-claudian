import type { ObsidianWorkspaceAdapter } from '@/core/obsidian/ObsidianWorkspaceAdapter';
import { executeObsidianWorkspaceTool } from '@/core/obsidian/ObsidianWorkspaceTool';

function createAdapter(): jest.Mocked<ObsidianWorkspaceAdapter> {
  return {
    setProperty: jest.fn(),
    move: jest.fn(),
    trash: jest.fn(),
    backlinks: jest.fn().mockResolvedValue(['Notes/Source.md']),
  };
}

describe('executeObsidianWorkspaceTool', () => {
  it('supports property deletion and destructive operations', async () => {
    const adapter = createAdapter();

    await expect(executeObsidianWorkspaceTool(adapter, {
      operation: 'set-property',
      path: 'Notes/Plan.md',
      name: 'status',
      value: null,
    })).resolves.toEqual({ success: true, text: 'Updated property status in Notes/Plan.md.' });
    await expect(executeObsidianWorkspaceTool(adapter, {
      operation: 'move',
      path: 'Notes/Plan.md',
      destination: 'Archive/Plan.md',
    })).resolves.toMatchObject({ success: true });
    await expect(executeObsidianWorkspaceTool(adapter, {
      operation: 'trash',
      path: 'Notes/Plan.md',
    })).resolves.toMatchObject({ success: true });

    expect(adapter.setProperty).toHaveBeenCalledWith('Notes/Plan.md', 'status', null);
    expect(adapter.move).toHaveBeenCalledWith('Notes/Plan.md', 'Archive/Plan.md');
    expect(adapter.trash).toHaveBeenCalledWith('Notes/Plan.md');
  });

  it('returns validation failures without calling the adapter', async () => {
    const adapter = createAdapter();

    await expect(executeObsidianWorkspaceTool(adapter, {
      operation: 'move',
      path: 'Notes/Plan.md',
    })).resolves.toEqual({
      success: false,
      text: 'Obsidian vault tool requires a non-empty destination.',
    });
    await expect(executeObsidianWorkspaceTool(adapter, {
      operation: 'set-property',
      path: 'Notes/Plan.md',
      name: 'status',
    })).resolves.toMatchObject({ success: false });

    expect(adapter.move).not.toHaveBeenCalled();
    expect(adapter.setProperty).not.toHaveBeenCalled();
  });
});
