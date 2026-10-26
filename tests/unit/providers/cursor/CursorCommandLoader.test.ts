import type { ProviderCommandLoaderContext } from '@/core/providers/types';
import { CursorCommandLoader } from '@/providers/cursor/app/CursorCommandLoader';

const context: ProviderCommandLoaderContext = {
  allowIsolatedMetadataCreation: true,
  conversation: null,
  externalContextPaths: [],
  plugin: {} as never,
};

describe('CursorCommandLoader', () => {
  it('delegates explicit invalidation to the workspace metadata owner', async () => {
    const probe = { invalidate: jest.fn(), load: jest.fn().mockResolvedValue([{ name: 'review' }]) };
    const loader = new CursorCommandLoader(probe);
    await expect(loader.loadCommands(context)).resolves.toMatchObject({ status: 'ready' });
    loader.invalidate();
    expect(probe.invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not start isolated metadata discovery when the context forbids it', async () => {
    const probe = { invalidate: jest.fn(), load: jest.fn() };
    const loader = new CursorCommandLoader(probe);
    await expect(loader.loadCommands({ ...context, allowIsolatedMetadataCreation: false }))
      .resolves.toMatchObject({ status: 'requires-session' });
    expect(probe.load).not.toHaveBeenCalled();
  });
});
