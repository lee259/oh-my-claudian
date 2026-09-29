import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  ProviderDiagnosticLogRecord,
  ProviderDiagnosticLogSink,
} from '@/core/providers/ProviderDiagnosticLog';
import { sanitizeProviderDiagnosticLogRecord } from '@/core/providers/ProviderDiagnosticLog';
import type { ClaudianSettings } from '@/core/types/settings';

const DEFAULT_LOG_DIRECTORY_NAME = '.claudian/diagnostics';

export type DiagnosticLogSettings = Pick<
  ClaudianSettings,
  'providerDiagnosticLogDirectory' | 'providerDiagnosticLogsEnabled'
>;

export class ProviderDiagnosticLogService implements ProviderDiagnosticLogSink {
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(
    private readonly getSettings: () => DiagnosticLogSettings,
    private readonly homeDirectory = os.homedir(),
  ) {}

  async write(record: ProviderDiagnosticLogRecord): Promise<void> {
    const settings = this.getSettings();
    if (settings.providerDiagnosticLogsEnabled !== true) return;

    const timestamp = record.timestamp ?? Date.now();
    const directory = resolveDiagnosticLogDirectory(
      settings.providerDiagnosticLogDirectory,
      this.homeDirectory,
    );
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const filePath = path.join(directory, `${record.source}-${date}.jsonl`);
    const safeRecord = sanitizeProviderDiagnosticLogRecord({ ...record, timestamp });
    const line = `${JSON.stringify({ ...safeRecord, timestamp: new Date(timestamp).toISOString() })}\n`;
    const previousWrite = this.pendingWrites.get(filePath) ?? Promise.resolve();
    const nextWrite = previousWrite
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(directory, { mode: 0o700, recursive: true });
        const file = await fs.open(filePath, 'a', 0o600);
        try {
          await file.chmod(0o600);
          await file.appendFile(line, 'utf8');
        } finally {
          await file.close();
        }
      });
    this.pendingWrites.set(filePath, nextWrite);

    try {
      await nextWrite;
    } finally {
      if (this.pendingWrites.get(filePath) === nextWrite) {
        this.pendingWrites.delete(filePath);
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites.values());
  }

  async ensureDirectory(): Promise<string> {
    const directory = resolveDiagnosticLogDirectory(
      this.getSettings().providerDiagnosticLogDirectory,
      this.homeDirectory,
    );
    await fs.mkdir(directory, { mode: 0o700, recursive: true });
    return directory;
  }
}

export function getDefaultDiagnosticLogDirectory(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, DEFAULT_LOG_DIRECTORY_NAME);
}

export function resolveDiagnosticLogDirectory(
  configuredDirectory: string,
  homeDirectory = os.homedir(),
): string {
  const configured = configuredDirectory.trim();
  if (!configured) return getDefaultDiagnosticLogDirectory(homeDirectory);
  const expanded = configured === '~'
    ? homeDirectory
    : configured.startsWith('~/') || configured.startsWith('~\\')
      ? path.join(homeDirectory, configured.slice(2))
      : configured;
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(homeDirectory, expanded);
}
