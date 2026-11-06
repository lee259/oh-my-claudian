import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { DEEPSEEK_COMPATIBILITY_SOURCE } from '@/providers/deepseek/runtime/DeepSeekCompatibility';

it('supports native tool presentation and prompt boundaries across supported DSH versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-'));
  try {
    const plugin = join(root, 'compat.mjs');
    await writeFile(plugin, DEEPSEEK_COMPATIBILITY_SOURCE);
    const host = pathToFileURL(join(__dirname, '../../../../helpers/deepseek/NativePluginHost.mjs')).href;
    const script = `
      const plugin = await import(process.argv[1]);
      const { createNativePluginHost } = await import(process.argv[2]);
      for (const version of ['0.2.1', '0.2.2']) {
        const native = createNativePluginHost(version);
        await native.apply(plugin, { promptDirectory: process.argv[3], codeModeFile: process.argv[3] + '/mode', listAgents: true });
        const agent = native.agent('root');
        native.setTurn('root', 1);
        native.sections[0].text({ agent });
        native.emit('agent/created', { agent });
        if (native.log[0] !== 'root present ' + native.presentation.direct) throw new Error('Incorrect presentation: ' + native.log);
        if (native.mounted.length !== (version === '0.2.1' ? 1 : 0)) throw new Error('Incorrect list_agents registration');
      }
    `;
    await expect(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(plugin).href, host, root])).resolves.toMatchObject({ stderr: '' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
