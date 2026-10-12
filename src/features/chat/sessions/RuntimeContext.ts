export interface ConversationMetadataContext {
  readonly currentNote?: string;
  readonly externalContextPaths: readonly string[];
  readonly enabledMcpServers: readonly string[];
}

/** Plugin-owned context survives release of the selectors that edited it. */
export class RuntimeContext {
  private metadata: ConversationMetadataContext = { externalContextPaths: [], enabledMcpServers: [] };

  capture(metadata: ConversationMetadataContext): void {
    this.metadata = {
      currentNote: metadata.currentNote,
      externalContextPaths: [...metadata.externalContextPaths],
      enabledMcpServers: [...metadata.enabledMcpServers],
    };
  }

  get snapshot(): ConversationMetadataContext {
    return {
      currentNote: this.metadata.currentNote,
      externalContextPaths: [...this.metadata.externalContextPaths],
      enabledMcpServers: [...this.metadata.enabledMcpServers],
    };
  }
}
