import type { ToolCallPresentation } from '../../../core/types';

type RecordValue = Record<string, unknown>;

const READ_COMMANDS = new Set(['cat', 'bat', 'batcat', 'nl', 'less', 'more', 'tac', 'head', 'tail']);
const SEARCH_COMMANDS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ack', 'ag']);
const SHELL_NOISE_COMMANDS = new Set(['cd', 'echo', 'printf', 'pwd', 'true', 'false', 'clear', 'wc']);

/** Creates display-only labels for Codex shell commands when their intent is clear. */
export function presentCodexCommand(input: {
  command?: unknown;
  cwd?: unknown;
  commandActions?: unknown;
}): ToolCallPresentation | undefined {
  const command = stringValue(input.command);
  const actions: unknown[] = Array.isArray(input.commandActions) ? input.commandActions : [];

  for (const actionValue of [...actions].reverse()) {
    const action = asRecord(actionValue);
    if (!action) continue;
    const type = stringValue(action.type)?.toLowerCase();
    const path = displayPath(action.path, input.cwd);
    if (type === 'read' && path) return { name: 'Read', summary: path };
    if (type === 'search') {
      const query = stringValue(action.query) ?? stringValue(action.queries);
      if (query) return { name: 'Find', summary: path ? `${query} · ${path}` : query };
    }
    if (type === 'listfiles' && path) return { name: 'List', summary: path };
    if ((type === 'edit' || type === 'write') && path) {
      return { name: type === 'edit' ? 'Edit' : 'Write', summary: path };
    }
  }

  if (!command || command.length > 2000) return undefined;
  return inferShellPresentation(unwrapShell(command), input.cwd);
}

/** Labels Codex's native file-change event without changing its execution identity. */
export function presentCodexFileChange(changes: unknown, cwd?: unknown): ToolCallPresentation {
  const paths = Array.isArray(changes)
    ? [...new Set(changes.flatMap((value) => {
        const path = displayPath(asRecord(value)?.path, cwd);
        return path ? [path] : [];
      }))]
    : [];
  const first = paths[0];
  const summary = first
    ? paths.length > 1 ? `${first} +${paths.length - 1}` : first
    : undefined;
  return { name: 'Edit', ...(summary ? { summary } : {}) };
}

function parseSimpleCommand(source: string): { executable: string; args: string[] } | undefined {
  // Mixed shell expressions and expansions need a real shell parser; leave them as Bash.
  if (/[;&|<>`$()\n]/.test(source)) return undefined;
  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote === 'single') {
      if (char === "'") quote = undefined;
      else token += char;
      continue;
    }
    if (quote === 'double') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && index + 1 < source.length) token += source[++index] ?? '';
      else token += char;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = '';
    } else if (char === '\\' && index + 1 < source.length) token += source[++index] ?? '';
    else token += char;
  }
  if (quote) return undefined;
  if (token) tokens.push(token);
  const executable = tokens[0];
  return executable ? { executable, args: tokens.slice(1) } : undefined;
}

function unwrapShell(command: string): string {
  const match = command.trim().match(/^(?:\/[^\s]+\/)?(?:sh|bash|zsh)\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/i);
  return match?.[2] ?? command.trim();
}

type ClassifiedCommand = ToolCallPresentation | 'noise' | 'opaque';

function inferShellPresentation(command: string, cwd: unknown): ToolCallPresentation | undefined {
  const intents: ToolCallPresentation[] = [];
  const chains = splitShell(command, new Set(['&&', '||', ';', '\n']));
  if (chains.length === 0) return undefined;

  for (const chain of chains) {
    let pipelineIntent: ToolCallPresentation | undefined;
    const stages = splitShell(chain, new Set(['|']));
    if (stages.length === 0) return undefined;
    for (const stage of stages) {
      const classified = classifyCommand(stage, cwd);
      if (classified === 'opaque') return undefined;
      if (classified !== 'noise') pipelineIntent = classified;
    }
    if (pipelineIntent) intents.push(pipelineIntent);
  }

  const reversed = intents.reverse();
  return reversed.find(intent => intent.name === 'Edit' || intent.name === 'Write')
    ?? reversed.find(intent => intent.name === 'Read' || intent.name === 'Find')
    ?? reversed[0];
}

function classifyCommand(command: string, cwd: unknown): ClassifiedCommand {
  const parsed = parseSimpleCommand(command);
  if (!parsed) return 'opaque';
  const { executable, args } = parsed;
  const bin = executable.split(/[\\/]/).pop()?.toLowerCase() ?? executable.toLowerCase();
  if (SHELL_NOISE_COMMANDS.has(bin)) return 'noise';

  if (bin === 'rg' && args.includes('--files')) return { name: 'Find', summary: 'files' };
  if (bin === 'sed' && args.some(value => value === '-i' || value.startsWith('-i'))) {
    const path = lastPositional(args);
    return path ? { name: 'Edit', summary: displayPath(path, cwd) } : 'opaque';
  }
  if (READ_COMMANDS.has(bin)) {
    const path = lastPositional(args);
    return path ? { name: 'Read', summary: displayPath(path, cwd) } : 'noise';
  }
  if (bin === 'sed') {
    const path = lastPositional(args);
    return path ? { name: 'Read', summary: displayPath(path, cwd) } : 'noise';
  }
  if (SEARCH_COMMANDS.has(bin)) {
    const positional = searchPositionals(args);
    const query = positional[0];
    if (!query) return 'opaque';
    const path = positional[1] ? displayPath(positional[1], cwd) : undefined;
    return { name: 'Find', summary: path ? `${query} · ${path}` : query };
  }
  if (bin === 'find') {
    const path = args.find(value => !value.startsWith('-'));
    const markerIndex = args.findIndex(value => ['-name', '-iname', '-path', '-ipath'].includes(value));
    const query = markerIndex >= 0 ? args[markerIndex + 1] : undefined;
    return { name: 'Find', summary: [query, path && displayPath(path, cwd)].filter(Boolean).join(' · ') || 'files' };
  }
  if (bin === 'ls' || bin === 'tree') {
    const path = args.find(value => !value.startsWith('-'));
    return path ? { name: 'List', summary: displayPath(path, cwd) } : 'noise';
  }
  return 'opaque';
}

function splitShell(command: string, separators: Set<string>): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: 'single' | 'double' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? '';
    if (quote) {
      if (quote === 'double' && char === '\\') {
        index += 1;
      } else if ((quote === 'single' && char === "'") || (quote === 'double' && char === '"')) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'") {
      quote = 'single';
      continue;
    }
    if (char === '"') {
      quote = 'double';
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }

    const separator = [...separators]
      .sort((left, right) => right.length - left.length)
      .find(value => command.startsWith(value, index)
        && (value !== '|' || command[index + 1] !== '|'));
    if (!separator) continue;
    const part = command.slice(start, index).trim();
    if (part) parts.push(part);
    index += separator.length - 1;
    start = index + 1;
  }
  if (quote) return [];
  const tail = command.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function lastPositional(args: string[]): string | undefined {
  return [...args].reverse().find((value) => !value.startsWith('-') && !/^\d+(?:,\d+)?p$/.test(value));
}

function searchPositionals(args: string[]): string[] {
  const valueFlags = new Set(['-e', '--regexp', '-f', '--file', '-g', '--glob', '-t', '--type', '--type-add', '--type-clear', '-A', '-B', '-C', '--context', '--max-count']);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? '';
    if (valueFlags.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith('-')) continue;
    positional.push(value);
  }
  return positional;
}

function displayPath(value: unknown, cwd: unknown): string | undefined {
  const path = stringValue(value)?.replace(/\\/g, '/');
  if (!path) return undefined;
  const workingDirectory = stringValue(cwd)?.replace(/\\/g, '/').replace(/\/$/, '');
  if (workingDirectory && path.startsWith(`${workingDirectory}/`)) return path.slice(workingDirectory.length + 1);
  return path;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}
