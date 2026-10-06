import type { ObsidianWorkspaceToolBridge } from '@/core/obsidian/ObsidianWorkspaceToolBridge';
import { ObsidianWorkspaceToolSession } from '@/core/obsidian/ObsidianWorkspaceToolSession';

describe('ObsidianWorkspaceToolSession', () => {
  it('reuses one credential, scopes authorization to a turn, and releases it on disposal', async () => {
    const bridge: ObsidianWorkspaceToolBridge = {
      createConnection: jest.fn(async () => ({
        endpoint: 'http://127.0.0.1:1234/mcp',
        token: 'session-token',
      })),
      releaseConnection: jest.fn(),
      setAllowedOperations: jest.fn(),
    };
    const session = new ObsidianWorkspaceToolSession(bridge);

    const firstConnection = await session.activateForTurn({ kind: 'provider-default' });
    session.deactivateTurn();
    const secondConnection = await session.activateForTurn({ kind: 'unrestricted' });

    expect(firstConnection).toEqual(secondConnection);
    expect(bridge.createConnection).toHaveBeenCalledTimes(1);
    expect(bridge.setAllowedOperations).toHaveBeenNthCalledWith(
      1,
      'session-token',
      ['backlinks', 'move', 'set-property', 'trash'],
    );
    expect(bridge.setAllowedOperations).toHaveBeenNthCalledWith(2, 'session-token', []);
    expect(bridge.setAllowedOperations).toHaveBeenNthCalledWith(
      3,
      'session-token',
      ['backlinks', 'move', 'set-property', 'trash'],
    );

    session.dispose();
    expect(bridge.setAllowedOperations).toHaveBeenLastCalledWith('session-token', []);
    expect(bridge.releaseConnection).toHaveBeenCalledWith('session-token');
  });

  it('allows only backlinks for read-only access', async () => {
    const bridge: ObsidianWorkspaceToolBridge = {
      createConnection: jest.fn(async () => ({
        endpoint: 'http://127.0.0.1:1234/mcp',
        token: 'session-token',
      })),
      releaseConnection: jest.fn(),
      setAllowedOperations: jest.fn(),
    };
    const session = new ObsidianWorkspaceToolSession(bridge);

    await session.activateForTurn({ kind: 'read-only' });
    expect(bridge.setAllowedOperations).toHaveBeenCalledWith('session-token', ['backlinks']);
  });
});
