import type { ProviderToolPolicy } from '../execution/ProviderExecutionRequest';
import type { ObsidianWorkspaceOperation } from './ObsidianWorkspaceAdapter';
import type { ObsidianWorkspaceToolBridge, ObsidianWorkspaceToolBridgeConnection } from './ObsidianWorkspaceToolBridge';
import { resolveObsidianWorkspaceToolOperations } from './ObsidianWorkspaceToolBridge';

/** Owns the session credential and per-turn authorization for a provider tool adapter. */
export class ObsidianWorkspaceToolSession {
  private connection: ObsidianWorkspaceToolBridgeConnection | null = null;
  private connectionFlight: Promise<ObsidianWorkspaceToolBridgeConnection | null> | null = null;
  private disposed = false;

  constructor(private readonly bridge?: ObsidianWorkspaceToolBridge) {}

  async activateForTurn(
    policy: ProviderToolPolicy,
    enabled = true,
    operationLimit?: readonly ObsidianWorkspaceOperation[],
  ): Promise<ObsidianWorkspaceToolBridgeConnection | null> {
    if (this.disposed) throw new Error('Obsidian workspace tool session is disposed.');
    const operations = enabled
      ? resolveObsidianWorkspaceToolOperations(policy).filter(
        operation => !operationLimit || operationLimit.includes(operation),
      )
      : [];
    if (!this.bridge || operations.length === 0) {
      this.deactivateTurn();
      return null;
    }

    const connection = await this.getConnection();
    if (!connection || this.disposed) return null;
    this.bridge.setAllowedOperations(connection.token, operations);
    return connection;
  }

  deactivateTurn(): void {
    if (this.connection) this.bridge?.setAllowedOperations(this.connection.token, []);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      this.bridge?.setAllowedOperations(connection.token, []);
      this.bridge?.releaseConnection(connection.token);
    }
  }

  private getConnection(): Promise<ObsidianWorkspaceToolBridgeConnection | null> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.connectionFlight) return this.connectionFlight;
    if (!this.bridge) return Promise.resolve(null);

    const flight = this.bridge.createConnection().then((connection) => {
      if (this.disposed) {
        this.bridge?.releaseConnection(connection.token);
        return null;
      }
      this.connection = connection;
      return connection;
    });
    this.connectionFlight = flight;
    void flight.finally(() => {
      if (this.connectionFlight === flight) this.connectionFlight = null;
    }).catch(() => undefined);
    return flight;
  }
}
