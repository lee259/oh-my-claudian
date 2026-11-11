import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolvePiSessionFileHint } from '@/providers/pi/history/PiHistoryPathResolver';

it('finds local history under the package-selected config directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-history-config-'));
  try {
    const home = path.join(root, 'home');
    const packageDir = path.join(root, 'package');
    const sessionDir = path.join(home, '.pi-custom', 'agent', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ piConfig: { configDir: '.pi-custom' } }));
    const sessionFile = path.join(sessionDir, 'session-1.jsonl');
    fs.writeFileSync(sessionFile, '{}\n');

    const resolved = resolvePiSessionFileHint(null, 'session-1', null, {
      environment: { HOME: home, PI_PACKAGE_DIR: packageDir },
      vaultPath: root,
    });

    expect(resolved).toBe(sessionFile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
