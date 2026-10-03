import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import { RuntimeCommandCatalog } from '@/core/providers/commands/RuntimeCommandCatalog';
import type { SlashCommand } from '@/core/types';

function slashCommandToEntry(command: SlashCommand): ProviderCommandEntry {
  return {
    agent: command.agent,
    allowedTools: command.allowedTools,
    argumentHint: command.argumentHint,
    content: command.content,
    context: command.context,
    description: command.description,
    disableModelInvocation: command.disableModelInvocation,
    displayPrefix: '/',
    hooks: command.hooks,
    id: command.id,
    insertPrefix: '/',
    isDeletable: false,
    isEditable: false,
    kind: command.kind ?? 'command',
    model: command.model,
    name: command.name,
    providerId: 'cursor',
    scope: 'runtime',
    source: command.source ?? 'sdk',
    userInvocable: command.userInvocable,
  };
}

export class CursorCommandCatalog extends RuntimeCommandCatalog {
  constructor() {
    super({
      dropdownConfig: {
        builtInPrefix: '/',
        commandPrefix: '/',
        // Cursor takes ~12s to start and advertise; the probe owns its deadline.
        discoveryTimeoutMs: 'provider-owned',
        providerId: 'cursor',
        skillPrefix: '/',
        triggerChars: ['/'],
      },
      projectEntry: slashCommandToEntry,
    });
  }
}
