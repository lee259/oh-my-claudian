import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import { RuntimeCommandCatalog } from '@/core/providers/commands/RuntimeCommandCatalog';
import type { SlashCommand } from '@/core/types';

/**
 * OMP advertises every text-mode builtin over ACP. These are hidden from the
 * dropdown because they cannot work correctly inside Claudian; users can still
 * type them, and can hide more through the provider settings.
 */
export const OMP_HIDDEN_RUNTIME_COMMANDS: ReadonlySet<string> = new Set([
  // Claudian re-applies the toolbar model and reasoning on every turn.
  'model', 'switch', 'effort', 'fast', 'slow', 'modelpreset',
  // Change the native session identity or location Claudian resumes from.
  'session', 'move', 'wt', 'rename', 'pin', 'fresh',
  // Terminal, dashboard, export, or CLI-management surfaces.
  'stats', 'trace', 'browser', 'ssh', 'marketplace', 'plugins', 'reload-plugins',
  'share', 'export', 'dump', 'changelog',
  // Shadowed by Claudian's workspace directory commands.
  'add-dir', 'remove-dir', 'dirs',
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
    providerId: 'omp',
    scope: 'runtime',
    source: command.source ?? 'sdk',
    userInvocable: command.userInvocable,
  };
}

export class OmpCommandCatalog extends RuntimeCommandCatalog {
  constructor() {
    super({
      dropdownConfig: {
        builtInPrefix: '/',
        commandPrefix: '/',
        providerId: 'omp',
        skillPrefix: '/',
        triggerChars: ['/'],
      },
      isHidden: command => command.kind !== 'skill'
        && OMP_HIDDEN_RUNTIME_COMMANDS.has(command.name.toLowerCase()),
      projectEntry: slashCommandToEntry,
    });
  }
}
