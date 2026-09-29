import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ProviderDiagnosticLogService } from '@/app/diagnostics/ProviderDiagnosticLogService';

describe('ProviderDiagnosticLogService', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-diagnostic-log-'));
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it('does not create files while logging is disabled', async () => {
    const service = new ProviderDiagnosticLogService(() => ({
      providerDiagnosticLogDirectory: root,
      providerDiagnosticLogsEnabled: false,
    }), root);

    await service.write({ event: 'execution-error', message: 'failure', source: 'pi' });

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('writes sanitized JSON lines into daily files split by source', async () => {
    const service = new ProviderDiagnosticLogService(() => ({
      providerDiagnosticLogDirectory: path.join(root, 'logs'),
      providerDiagnosticLogsEnabled: true,
    }), root);
    const timestamp = Date.UTC(2026, 8, 29, 12);

    await Promise.all([
      service.write({ event: 'process-started', source: 'pi', timestamp, args: ['--api-key', 'secret-value'] }),
      service.write({ event: 'process-stderr', source: 'pi', timestamp, message: 'bearer secret-value' }),
      service.write({ event: 'uncaught-exception', source: 'claudian', timestamp, message: 'error' }),
    ]);

    const logDirectory = path.join(root, 'logs');
    const files = (await fs.readdir(logDirectory)).sort();
    expect(files).toEqual(['claudian-2026-09-29.jsonl', 'pi-2026-09-29.jsonl']);
    const piLines = (await fs.readFile(path.join(logDirectory, 'pi-2026-09-29.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(piLines).toHaveLength(2);
    expect(JSON.stringify(piLines)).not.toContain('secret-value');
    expect(JSON.stringify(piLines)).toContain('[REDACTED]');
    if (process.platform !== 'win32') {
      const directoryMode = (await fs.stat(logDirectory)).mode & 0o777;
      const fileMode = (await fs.stat(path.join(logDirectory, 'pi-2026-09-29.jsonl'))).mode & 0o777;
      // eslint-disable-next-line jest/no-conditional-expect -- POSIX permission bits do not have a Windows equivalent.
      expect(directoryMode).toBe(0o700);
      // eslint-disable-next-line jest/no-conditional-expect -- POSIX permission bits do not have a Windows equivalent.
      expect(fileMode).toBe(0o600);
    }
  });

  it('uses the home directory for relative custom paths and an empty default', async () => {
    const service = new ProviderDiagnosticLogService(() => ({
      providerDiagnosticLogDirectory: 'local-diagnostics',
      providerDiagnosticLogsEnabled: false,
    }), root);

    await expect(service.ensureDirectory()).resolves.toBe(path.join(root, 'local-diagnostics'));
    await expect(fs.stat(path.join(root, 'local-diagnostics'))).resolves.toBeDefined();
  });
});
