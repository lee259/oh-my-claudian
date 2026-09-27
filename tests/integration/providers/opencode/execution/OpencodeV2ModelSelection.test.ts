import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { ProviderExecutionEvent, ProviderExecutionRequest } from '@/core/execution';
import { OpencodeExecutionBackend } from '@/providers/opencode/execution/OpencodeExecutionBackend';

const cliFixture = `#!/usr/bin/env node
const http = require('node:http');
if (process.argv.includes('--version')) { console.log('OpenCode 2.0.18'); return; }
let feed;
let selectedModel;
let activated = false;
const emit = (type, data) => feed.write('data: ' + JSON.stringify({ type, data: { sessionID: 'ses_test', ...data } }) + '\\n\\n');
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const route = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Type', 'application/json');
  if (route === '/api/event') { feed = res; res.setHeader('Content-Type', 'text/event-stream'); emit('server.connected', {}); return; }
  if (route === '/api/integration') { activated = true; res.end('{}'); return; }
  if (route === '/api/model') { res.end(JSON.stringify({ data: activated ? [{ id: 'mimo-v2.6-flash-free', providerID: 'opencode', name: 'MiMo-V2.6-Flash Free', enabled: true }] : [] })); return; }
  if (route === '/api/command') { res.end(JSON.stringify({ data: [] })); return; }
  if (route === '/api/session' && req.method === 'POST') { res.end(JSON.stringify({ data: { id: 'ses_test' } })); return; }
  if (route === '/api/session/ses_test/model' && req.method === 'POST') { selectedModel = body.model; res.writeHead(204).end(); return; }
  if (route === '/api/session/ses_test/prompt' && req.method === 'POST') {
    if (!activated || selectedModel?.providerID !== 'opencode' || selectedModel?.id !== 'mimo-v2.6-flash-free') { res.writeHead(400).end('selected model mismatch'); return; }
    res.end(JSON.stringify({ data: { id: 'msg_user' } }));
    setTimeout(() => {
      emit('session.execution.started', {});
      emit('session.step.started', { assistantMessageID: 'msg_assistant' });
      emit('session.text.delta', { assistantMessageID: 'msg_assistant', ordinal: 0, delta: 'ok' });
      emit('session.execution.succeeded', {});
    }, 10);
    return;
  }
  if (route === '/test/selected-model') { res.end(JSON.stringify(selectedModel)); return; }
  res.writeHead(404).end();
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port })));
process.stdin.resume(); process.stdin.on('end', () => server.close());
`;

function request(model: string): ProviderExecutionRequest {
  return {
    input: [{ type: 'text', text: 'hello' }],
    configuration: {
      model,
      permissionMode: 'normal',
      systemInstructions: { kind: 'none' },
    },
    toolPolicy: { kind: 'provider-default' },
    signal: new AbortController().signal,
  };
}

it('uses OpenCode v2 HTTP and applies the selected model before prompting', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'claudian-opencode-v2-model-'));
  const cliPath = path.join(root, 'opencode.cjs');
  writeFileSync(cliPath, cliFixture, { mode: 0o700 });
  const modelId = 'opencode:opencode/mimo-v2.6-flash-free';
  const plugin: any = {
    settings: {
      model: modelId,
      providerConfigs: {
        opencode: {
          enabled: true,
          visibleModels: ['opencode/mimo-v2.6-flash-free'],
          discoveredModels: [{ rawId: 'opencode/mimo-v2.6-flash-free', label: 'MiMo-V2.6-Flash Free' }],
        },
      },
    },
    getResolvedProviderCliPath: async () => cliPath,
    mutateSettings: async (mutate: (settings: unknown) => void) => mutate(plugin.settings),
    notifyProviderChatOptionsChanged() {},
  };
  const session = new OpencodeExecutionBackend(plugin).createSession({
    vaultWorkingDirectory: root,
    lifecycle: 'ephemeral',
    nativePersistence: 'disabled-if-supported',
    interactionPort: {
      dismissInteraction() {},
      requestPlanDecision: async () => ({ interactionId: '', decision: { type: 'abandon' } }),
      requestApproval: async () => ({ interactionId: '', decision: 'deny' }),
      askUserQuestion: async () => ({ interactionId: '', answers: {} }),
    },
  });

  try {
    const events: ProviderExecutionEvent[] = [];
    for await (const event of session.execute(request(modelId)).events) events.push(event);
    expect(events.map(event => event.type)).toContain('text_delta');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.text).join('')).toBe('ok');
    expect(session.getSnapshot()).toMatchObject({ providerSessionId: expect.any(String), providerState: { nativeVersion: 2 } });
  } finally {
    await session.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
