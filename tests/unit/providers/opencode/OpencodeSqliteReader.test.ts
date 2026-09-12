import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createMockChildProcess } from '@test/helpers/MockChildProcess';

import {
  loadOpencodeSessionRows,
  OPENCODE_MESSAGE_ROW_SQL,
  type OpencodeSqliteReaderDependencies,
} from '../../../../src/providers/opencode/history/OpencodeSqliteReader';

type Spawn = NonNullable<OpencodeSqliteReaderDependencies['spawn']>;

describe('loadOpencodeSessionRows', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'claudian-opencode-sqlite-reader-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { force: true, recursive: true });
    jest.restoreAllMocks();
  });

  it('never creates a missing history database through in-process SQLite', async () => {
    const dbPath = path.join(tmpRoot, 'missing.db');
    await loadOpencodeSessionRows(dbPath, 'ses-missing', {
      requireSqliteModule: () => ({ DatabaseSync } as any),
      findNodeExecutables: () => [],
      spawn: createSpawnMock([]),
    }).catch(() => undefined);
    expect(existsSync(dbPath)).toBe(false);
  });

  it('tries a compatible Node after an installed Node fails', async () => {
    const dbPath = createFixtureDatabase(tmpRoot);
    const nodeWithoutSqlite = path.join(tmpRoot, 'old-node');
    const spawn: Spawn = (command, args, options) => nodeSpawn(
      process.execPath,
      command === process.execPath ? args : ['--no-experimental-sqlite', ...args],
      options,
    );
    await expect(loadOpencodeSessionRows(dbPath, 'ses-child', {
      requireSqliteModule: () => null,
      findNodeExecutables: () => [nodeWithoutSqlite, process.execPath],
      spawn,
    })).resolves.toMatchObject({ partRows: [{ id: 'part-user' }] });
  });

  it('reports backend errors when SQLite cannot read the database', async () => {
    const dbPath = path.join(tmpRoot, 'empty.db');
    new DatabaseSync(dbPath).close();
    const spawn: Spawn = (command, args, options) => nodeSpawn(
      command === 'sqlite3' ? path.join(tmpRoot, 'missing-sqlite3') : command,
      args,
      options,
    );
    await expect(loadOpencodeSessionRows(dbPath, 'ses-missing', {
      requireSqliteModule: () => null,
      findNodeExecutables: () => [process.execPath],
      spawn,
    })).rejects.toThrow('no such table: message');
  });

  it('uses the supplied environment for external SQLite readers', async () => {
    const dbPath = createFixtureDatabase(tmpRoot);
    const spawn: Spawn = (command, args, options) => nodeSpawn(
      command === 'sqlite3' ? path.join(tmpRoot, 'missing-sqlite3') : command,
      args,
      options,
    );
    await expect(loadOpencodeSessionRows(dbPath, 'ses-child', {
      environment: { ...process.env, NODE_OPTIONS: '--no-experimental-sqlite' },
      requireSqliteModule: () => null,
      findNodeExecutables: () => [process.execPath],
      spawn,
    })).rejects.toThrow('No such built-in module: node:sqlite');
  });

  it('loads rows through a Node child process when in-process SQLite is unavailable', async () => {
    const dbPath = createFixtureDatabase(tmpRoot);

    await expect(loadOpencodeSessionRows(dbPath, 'ses-child', {
      findNodeExecutables: () => [process.execPath],
      requireSqliteModule: () => null,
    })).resolves.toEqual({
      messageRows: [{
        data_time_completed: null,
        data_time_created: 1_000,
        data_valid: 1,
        id: 'msg-user',
        model_id: null,
        provider_id: null,
        role: 'user',
        time_created: 1_000,
      }],
      partRows: [{
        data: JSON.stringify({ text: 'Hello from child process.', type: 'text' }),
        id: 'part-user',
        message_id: 'msg-user',
      }],
    });
  });

  it('opens an in-process SQLite database in read-only mode', async () => {
    const database = {
      close: jest.fn(),
      prepare: jest.fn(() => ({ all: jest.fn(() => []) })),
    };
    const DatabaseSync = jest.fn(() => database);

    await expect(loadOpencodeSessionRows('/tmp/opencode.db', 'ses-read-only', {
      requireSqliteModule: () => ({ DatabaseSync } as any),
    })).resolves.toEqual({ messageRows: [], partRows: [] });

    expect(DatabaseSync).toHaveBeenCalledWith('/tmp/opencode.db', { readOnly: true });
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it('tries each discovered Node executable with the configured environment', async () => {
    const spawn = createSpawnMock([
      { status: 1, stdout: '' },
      {
        status: 0,
        stdout: JSON.stringify({
          messageRows: [{ id: 'msg-user' }],
          partRows: [{ id: 'part-user' }],
        }),
      },
    ]);
    const environment = { PATH: 'C:\\custom\\node;C:\\Windows\\System32' };

    await expect(loadOpencodeSessionRows('/tmp/opencode.db', 'ses-node-fallback', {
      environment,
      findNodeExecutables: () => ['C:\\broken\\node.exe', 'C:\\working\\node.exe'],
      requireSqliteModule: () => null,
      spawn,
    })).resolves.toEqual({
      messageRows: [{ id: 'msg-user' }],
      partRows: [{ id: 'part-user' }],
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'C:\\broken\\node.exe',
      expect.any(Array),
      expect.objectContaining({ env: environment }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'C:\\working\\node.exe',
      expect.any(Array),
      expect.objectContaining({ env: environment }),
    );
  });

  it('uses a discovered Node executable before the system sqlite3 fallback', async () => {
    const spawn = createSpawnMock([{
      status: 0,
      stdout: JSON.stringify({
        messageRows: [{ id: 'msg-user' }],
        partRows: [{ id: 'part-user' }],
      }),
    }]);

    await expect(loadOpencodeSessionRows('/tmp/opencode.db', 'ses-node', {
      findNodeExecutables: () => ['/usr/local/bin/node'],
      requireSqliteModule: () => null,
      spawn,
    })).resolves.toEqual({
      messageRows: [{ id: 'msg-user' }],
      partRows: [{ id: 'part-user' }],
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      [
        '-e',
        expect.stringContaining("require('node:sqlite')"),
        '/tmp/opencode.db',
        'ses-node',
        OPENCODE_MESSAGE_ROW_SQL,
        expect.stringContaining('from part'),
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
  });

  it('keeps sqlite3 as a buffered compatibility fallback', async () => {
    const spawn = createSpawnMock([
      {
        status: 0,
        stdout: JSON.stringify([{ id: 'msg-user' }]),
      },
      {
        status: 0,
        stdout: JSON.stringify([{ id: 'part-user' }]),
      },
    ]);

    await expect(loadOpencodeSessionRows('/tmp/opencode.db', 'ses-with-quote\'s', {
      findNodeExecutables: () => [],
      requireSqliteModule: () => null,
      spawn,
    })).resolves.toEqual({
      messageRows: [{ id: 'msg-user' }],
      partRows: [{ id: 'part-user' }],
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'sqlite3',
      [
        '-readonly',
        '-json',
        '/tmp/opencode.db',
        expect.stringContaining("where session_id = 'ses-with-quote''s'"),
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'sqlite3',
      [
        '-readonly',
        '-json',
        '/tmp/opencode.db',
        expect.stringContaining("where session_id = 'ses-with-quote''s'"),
      ],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
  });
});

function createSpawnMock(
  outputs: Array<{ status: number; stdout: string }>,
): Spawn {
  const mock = jest.fn(() => {
    const output = outputs.shift() ?? { status: 1, stdout: '' };
    const child = createMockChildProcess();
    child.kill = jest.fn();
    setImmediate(() => {
      child.stdout.end(output.stdout);
      child.emit('close', output.status);
    });
    return child;
  });
  return mock as unknown as Spawn;
}

function createFixtureDatabase(tmpRoot: string): string {
  const dbPath = path.join(tmpRoot, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table message (
        id text primary key,
        session_id text not null,
        time_created integer not null,
        data text not null
      );
      create table part (
        id text primary key,
        session_id text not null,
        message_id text not null,
        data text not null
      );
    `);

    db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)').run(
      'msg-user',
      'ses-child',
      1_000,
      JSON.stringify({
        role: 'user',
        time: { created: 1_000 },
      }),
    );
    db.prepare('insert into part (id, session_id, message_id, data) values (?, ?, ?, ?)').run(
      'part-user',
      'ses-child',
      'msg-user',
      JSON.stringify({ text: 'Hello from child process.', type: 'text' }),
    );
  } finally {
    db.close();
  }

  return dbPath;
}
