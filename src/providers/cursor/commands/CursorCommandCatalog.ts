import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import { RuntimeCommandCatalog } from '@/core/providers/commands/RuntimeCommandCatalog';
import type { SlashCommand } from '@/core/types';

/**
 * Cursor advertises CLI builtins and builtin skills over ACP. These are hidden
 * from the dropdown because they act on the CLI process, terminal, Cursor
 * account, or chat identity rather than the Claudian conversation; users can
 * still type them, and can hide more through the provider settings.
 */
export const CURSOR_HIDDEN_RUNTIME_COMMANDS: ReadonlySet<string> = new Set([
  // Act on the headless CLI process or terminal.
  'copy-request-id', 'statusline', 'update-cli-config', 'shell',
  // Change the native chat identity or schedule work outside the turn.
  'rename-chat', 'loop',
  // Create, move, or publish workspaces outside the vault conversation.
  'worktree', 'apply-worktree', 'delete-worktree', 'origin', 'new-repo', 'share',
]);

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
      isHidden: command => CURSOR_HIDDEN_RUNTIME_COMMANDS.has(command.name.toLowerCase()),
      projectEntry: slashCommandToEntry,
    });
  }
}
