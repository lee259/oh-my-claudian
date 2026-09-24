import { appendFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.GROK_FIXTURE_MODE ?? 'native';

if (process.env.GROK_FIXTURE_PID_FILE) {
  writeFileSync(process.env.GROK_FIXTURE_PID_FILE, String(process.pid));
}

if (args[0] === '--version') {
  process.stdout.write('grok 0.2.106\n');
  process.exit(0);
}

if (args[0] === 'models') {
  process.stdout.write('Default model: legacy-model\nAvailable models:\n  legacy-model\n');
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  let newline = input.indexOf('\n');
  while (newline >= 0) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    handleMessage(JSON.parse(line));
    newline = input.indexOf('\n');
  }
});

function handleMessage(message) {
  if (message.method === '_x.ai/models/list') {
    if (process.env.GROK_FIXTURE_REQUEST_FILE) {
      appendFileSync(process.env.GROK_FIXTURE_REQUEST_FILE, 'requested\n');
    }
    if (mode === 'hang') return;
    if (mode === 'unsupported') {
      respond({
        error: { code: -32601, message: 'Method not found' },
        id: message.id,
        jsonrpc: '2.0',
      });
      return;
    }
    respond({
      id: message.id,
      jsonrpc: '2.0',
      result: {
        currentModelId: 'grok-4.6',
        availableModels: [{
          _meta: {
            defaultReasoningEffort: 'high',
            reasoningEfforts: [
              { label: 'Low Effort', value: 'low' },
              { label: 'High Effort', value: 'high' },
              { label: 'Extra High Effort', value: 'xhigh' },
            ],
          },
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
        }],
      },
    });
    return;
  }

  if (message.method === 'initialize') {
    respond({ id: message.id, jsonrpc: '2.0', result: {} });
  }
}

function respond(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
