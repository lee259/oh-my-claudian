import '@/providers';

import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/core/bootstrap/ConversationPersistenceStore';
import type { SessionMetadata } from '@/core/types';
import type { Conversation } from '@/core/types';
import { opencodeSettingsReconciler } from '@/providers/opencode/env/OpencodeSettingsReconciler';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'claudian-opencode-recovery-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fixture(databasePath: string, sessionIds: string[], nativeVersion: 1 | 2): void {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  if (nativeVersion === 2) {
    db.exec('CREATE TABLE session_v2 (id text); CREATE TABLE session_message (id text, session_id text, type text, time_created integer, data text, seq integer);');
    for (const id of sessionIds) {
      db.prepare('INSERT INTO session_v2 VALUES (?)').run(id);
      db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run('user', id, 'user', 1000, JSON.stringify({ text: `Question ${id}` }), 1);
      db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run('answer', id, 'assistant', 2000, JSON.stringify({ providerID: 'anthropic', modelID: 'claude', content: [{ type: 'text', text: `Answer ${id}` }] }), 2);
    }
  } else {
    db.exec('CREATE TABLE session (id text); CREATE TABLE message (id text, session_id text, time_created integer, data text); CREATE TABLE part (id text, session_id text, message_id text, data text);');
    for (const id of sessionIds) {
      db.prepare('INSERT INTO session VALUES (?)').run(id);
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('user', id, 1000, JSON.stringify({ role: 'user' }));
      db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run('part-user', id, 'user', JSON.stringify({ type: 'text', text: `Question ${id}` }));
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('answer', id, 2000, JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude' }));
      db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run('part-answer', id, 'answer', JSON.stringify({ type: 'text', text: `Answer ${id}` }));
    }
  }
  db.close();
}

function harness(currentDatabase: string) {
  const saved = new Map<string, SessionMetadata>();
  const persistence: ConversationPersistence = {
    metadataReader: {
      load: async () => null,
      scan: async () => ({ records: [], complete: true, invalidMetadataCount: 0 }),
      loadMetadata: async () => null,
      scanMetadata: async () => ({ metadata: [], complete: true, invalidMetadataCount: 0 }),
      listMetadata: async () => [],
    },
    loadInputLedger: async () => ({ status: 'missing' }),
    saveInputLedger: async () => {},
    saveMetadata: async metadata => { saved.set(metadata.id, structuredClone(metadata)); },
    deleteCurrentMetadata: async () => {}, deleteLegacyMetadata: async () => {},
    deleteInputLedger: async () => {}, isDeleted: async () => false, markDeleted: async () => {},
  };
  const settings = { providerConfigs: { opencode: {
    enabled: true, visibleModels: ['anthropic/claude'],
    discoveredModels: [{ rawId: 'anthropic/claude', label: 'Claude' }],
    environmentVariables: `XDG_DATA_HOME=${root}\nOPENCODE_DB=${currentDatabase}`,
  } } };
  const createRepository = () => new ConversationRepository({
    getSettings: () => settings, getVaultPath: () => root, persistence,
    onConversationDeleted: async () => {},
  });
  return { saved, createRepository };
}

it.each([1, 2] as const)('reopens two retired v%i conversations with their original histories and models', async nativeVersion => {
  const oldPath = path.join(root, 'opencode', 'old.db');
  const currentPath = path.join(root, 'opencode', 'new.db');
  fixture(oldPath, ['one', 'two'], nativeVersion);
  fixture(currentPath, ['one', 'two'], nativeVersion);
  const { createRepository, saved } = harness(currentPath);
  const conversations: Conversation[] = ['one', 'two'].map(id => ({
    id, providerId: 'opencode', title: id, createdAt: 1, lastActivityAt: 1, messages: [], sessionId: id,
    providerState: { sessionId: id, databasePath: oldPath, nativeVersion, future: 'preserve' },
  }));
  const first = createRepository();
  first.replaceAll(conversations);
  const invalidated = opencodeSettingsReconciler.invalidateConversationSessions(conversations);
  await first.persistConversations(invalidated);
  const reopened = createRepository();
  reopened.replaceAll([...saved.values()].map(metadata => ({ ...metadata, providerId: metadata.providerId ?? 'opencode', sessionId: metadata.sessionId ?? null, messages: [] })));
  for (const id of ['one', 'two']) {
    const conversation = await reopened.ensureHydrated(id);
    expect(conversation?.messages.map(message => message.content)).toEqual([`Question ${id}`, `Answer ${id}`]);
    expect(conversation?.sessionId).toBeNull();
    expect(conversation?.providerState).toMatchObject({ future: 'preserve',
      historySources: [{ sessionId: id, databasePath: oldPath, nativeVersion }], nativeConversationContextEstablished: false });
    expect(conversation?.messages[1].assistantMessageId).toBeUndefined();
    expect(conversation?.selectedModel).toBe('opencode:anthropic/claude');
  }
});

it('retries a missing original database through Repository reopen without replacing the locator', async () => {
  const oldPath = path.join(root, 'opencode', 'old.db');
  const currentPath = path.join(root, 'opencode', 'new.db');
  fixture(oldPath, ['old'], 2);
  fixture(currentPath, ['old'], 2);
  renameSync(oldPath, oldPath + '.offline');
  const { createRepository } = harness(currentPath);
  const repository = createRepository();
  const conversation: Conversation = { id: 'retry', providerId: 'opencode', title: 'Retry', createdAt: 1,
    lastActivityAt: 1, sessionId: null, messages: [], selectedModel: 'opencode:anthropic/claude',
    providerState: { historySources: [{ sessionId: 'old', databasePath: oldPath, nativeVersion: 2 }] } };
  repository.replaceAll([conversation]);
  await repository.ensureHydrated(conversation.id);
  expect(conversation.messages[0].id).toContain('opencode-hydration-error');
  expect(conversation.providerState?.historySources).toEqual([{ sessionId: 'old', databasePath: oldPath, nativeVersion: 2 }]);
  renameSync(oldPath + '.offline', oldPath);
  await repository.ensureHydrated(conversation.id);
  expect(conversation.messages.map(message => message.content)).toEqual(['Question old', 'Answer old']);
});

it('retains turn labels across retirement without assigning an old label to a new segment', async () => {
  const oldPath = path.join(root, 'opencode', 'old.db');
  const currentPath = path.join(root, 'opencode', 'new.db');
  fixture(oldPath, ['old'], 2);
  fixture(currentPath, ['fresh'], 2);
  const { createRepository } = harness(currentPath);
  const repository = createRepository();
  const conversation: Conversation = { id: 'labels', providerId: 'opencode', title: 'Labels', createdAt: 1,
    lastActivityAt: 1, sessionId: 'old', messages: [], selectedModel: 'opencode:anthropic/claude',
    providerState: { sessionId: 'old', databasePath: oldPath, nativeVersion: 2 } };
  repository.replaceAll([conversation]);
  await repository.ensureHydrated(conversation.id);
  conversation.messages[1].modelName = 'Historical old model';
  await repository.update(conversation.id, { messages: conversation.messages });
  await repository.persistConversations(opencodeSettingsReconciler.invalidateConversationSessions([conversation]));
  await repository.update(conversation.id, { sessionId: 'fresh', providerState: {
    ...conversation.providerState, sessionId: 'fresh', databasePath: currentPath, nativeVersion: 2,
  } });
  await repository.ensureHydrated(conversation.id);
  expect(conversation.messages).toHaveLength(4);
  expect(conversation.messages[1].modelName).toBe('Historical old model');
  expect(conversation.messages[3].modelName).toBeUndefined();
});

it('keeps restored subagent display IDs aligned with their source-scoped parent tool', async () => {
  const oldPath = path.join(root, 'opencode', 'tools.db');
  fixture(oldPath, ['old', 'ses_child'], 2);
  const db = new DatabaseSync(oldPath);
  db.prepare('UPDATE session_message SET data=? WHERE session_id=? AND type=?').run(JSON.stringify({
    content: [{ type: 'tool', id: 'parent-task', name: 'task', state: { status: 'completed', input: { prompt: 'Child task' },
      content: [{ type: 'text', text: '<subagent sessionID="ses_child" state="completed">\nChild result\n</subagent>' }] } }],
  }), 'old', 'assistant');
  db.prepare('UPDATE session_message SET data=? WHERE session_id=? AND type=?').run(JSON.stringify({
    content: [{ type: 'tool', id: 'child-tool', name: 'bash', state: { status: 'completed', input: { command: 'echo fixture' } } }],
  }), 'ses_child', 'assistant');
  db.close();
  const { createRepository } = harness(oldPath);
  const repository = createRepository();
  repository.replaceAll([{ id: 'tools', providerId: 'opencode', title: 'Tools', createdAt: 1, lastActivityAt: 1,
    sessionId: null, selectedModel: 'opencode:anthropic/claude', messages: [], providerState: {
      historySources: [{ sessionId: 'old', databasePath: oldPath, nativeVersion: 2 }],
    } }]);
  const conversation = await repository.ensureHydrated('tools');
  const task = conversation!.messages[1].toolCalls![0];
  expect(task.id).toMatch(/^opencode-history-/);
  expect(task.subagent?.id).toBe(task.id);
  expect(task.subagent?.toolCalls[0].id).toMatch(/^opencode-history-/);
  expect(conversation!.messages[1].contentBlocks?.[0]).toEqual({ type: 'tool_use', toolId: task.id });
});
