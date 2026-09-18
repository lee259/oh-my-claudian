import type {
  ObsidianPropertyValue,
  ObsidianWorkspaceAdapter,
  ObsidianWorkspaceOperation,
} from './ObsidianWorkspaceAdapter';

export const OBSIDIAN_VAULT_TOOL_NAMESPACE = 'obsidian';
export const OBSIDIAN_VAULT_TOOL_NAME = 'vault';

const MAX_OUTPUT_CHARS = 16_000;

export interface ObsidianWorkspaceToolResult {
  readonly success: boolean;
  readonly text: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperation(value: unknown): value is ObsidianWorkspaceOperation {
  return value === 'set-property'
    || value === 'move'
    || value === 'trash'
    || value === 'backlinks';
}

function isPropertyValue(value: unknown): value is ObsidianPropertyValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Obsidian vault tool requires a non-empty ${name}.`);
  }
  return value.trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Output truncated at ${maxChars} characters.]`;
}

function formatJson(value: unknown): string {
  return truncate(JSON.stringify(value, null, 2), MAX_OUTPUT_CHARS);
}

async function execute(
  adapter: ObsidianWorkspaceAdapter,
  input: Record<string, unknown>,
): Promise<string> {
  const operation = input.operation;
  if (!isOperation(operation)) {
    throw new Error('Obsidian vault tool operation is invalid.');
  }

  switch (operation) {
    case 'set-property': {
      const path = requiredString(input, 'path');
      const name = requiredString(input, 'name');
      if (!Object.prototype.hasOwnProperty.call(input, 'value') || !isPropertyValue(input.value)) {
        throw new Error('Obsidian vault tool set-property requires a supported value, including null to delete a property.');
      }
      await adapter.setProperty(path, name, input.value);
      return `Updated property ${name} in ${path}.`;
    }
    case 'move': {
      const path = requiredString(input, 'path');
      const destination = requiredString(input, 'destination');
      await adapter.move(path, destination);
      return `Moved ${path} to ${destination}.`;
    }
    case 'trash': {
      const path = requiredString(input, 'path');
      await adapter.trash(path);
      return `Moved ${path} to the Obsidian trash.`;
    }
    case 'backlinks': {
      const path = requiredString(input, 'path');
      return formatJson(await adapter.backlinks(path));
    }
  }
}

export async function executeObsidianWorkspaceTool(
  adapter: ObsidianWorkspaceAdapter,
  rawInput: unknown,
): Promise<ObsidianWorkspaceToolResult> {
  try {
    if (!isRecord(rawInput)) {
      throw new Error('Obsidian vault tool arguments must be an object.');
    }
    return {
      success: true,
      text: await execute(adapter, rawInput),
    };
  } catch (error) {
    return {
      success: false,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}
