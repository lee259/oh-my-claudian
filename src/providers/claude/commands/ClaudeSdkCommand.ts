import type { SlashCommand as SDKSlashCommand } from '@anthropic-ai/claude-agent-sdk';

import type { SlashCommand } from '../../../core/types';

/** Maps an SDK slash entry; skill identity is resolved from its source files by the catalog. */
export function mapClaudeSdkCommand(command: SDKSlashCommand): SlashCommand {
  return {
    id: `sdk:${command.name}`,
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    content: '',
    source: 'sdk',
    // `builtin` identifies an explicit Claude Code command. Non-builtins may
    // be either commands or skills; the catalog resolves them from skill files.
    ...(command.builtin ? { kind: 'command' as const } : {}),
  };
}
