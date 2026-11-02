import type { SlashCommand } from '../../types';
import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
  ProviderCommandListContext,
} from './ProviderCommandCatalog';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

export interface RuntimeCommandCatalogOptions {
  readonly dropdownConfig: ProviderCommandDropdownConfig;
  /** Provider-owned policy for runtime commands that do not work inside Claudian. */
  readonly isHidden?: (command: SlashCommand) => boolean;
  readonly projectEntry: (command: SlashCommand) => ProviderCommandEntry;
}

export class RuntimeCommandCatalog implements ProviderCommandCatalog {
  private readonly dropdownConfig: ProviderCommandDropdownConfig;
  private commandSnapshot: SlashCommand[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: RuntimeCommandCatalogOptions) {
    this.dropdownConfig = cloneDropdownConfig(options.dropdownConfig);
  }

  setCommandSnapshot(commands: SlashCommand[]): void {
    if (JSON.stringify(commands) === JSON.stringify(this.commandSnapshot)) return;
    this.commandSnapshot = commands.map(cloneSlashCommand);
    for (const listener of this.listeners) {
      try { listener(); } catch { /* One observer must not block publication. */ }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async listDropdownEntries(
    context: ProviderCommandListContext,
  ): Promise<ProviderCommandEntry[]> {
    const commands = context.commandSnapshot
      ?? (context.allowCachedCommandSnapshot === false ? [] : this.commandSnapshot);
    const isHidden = this.options.isHidden;
    return commands
      .filter(command => !isHidden?.(command))
      .map((command) => cloneProviderCommandEntry(
        this.options.projectEntry(cloneSlashCommand(command)),
      ));
  }

  getDropdownConfig(): ProviderCommandDropdownConfig {
    return cloneDropdownConfig(this.dropdownConfig);
  }

  async refresh(): Promise<void> {}
}

function cloneDropdownConfig(
  config: ProviderCommandDropdownConfig,
): ProviderCommandDropdownConfig {
  return {
    ...config,
    triggerChars: [...config.triggerChars],
    ...(config.builtInCommands
      ? { builtInCommands: config.builtInCommands.map(cloneProviderCommandEntry) }
      : {}),
  };
}

function cloneSlashCommand(command: SlashCommand): SlashCommand {
  return {
    ...command,
    ...(command.allowedTools ? { allowedTools: [...command.allowedTools] } : {}),
    ...(command.hooks ? { hooks: cloneRecord(command.hooks) } : {}),
  };
}

function cloneProviderCommandEntry(entry: ProviderCommandEntry): ProviderCommandEntry {
  return {
    ...entry,
    ...(entry.allowedTools ? { allowedTools: [...entry.allowedTools] } : {}),
    ...(entry.hooks ? { hooks: cloneRecord(entry.hooks) } : {}),
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cloneValue(value)]),
  );
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return cloneRecord(value as Record<string, unknown>);
}
