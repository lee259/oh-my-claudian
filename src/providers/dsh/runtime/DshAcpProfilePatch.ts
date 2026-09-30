import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseDshModelRoute } from '../models';

/** Create a session-local ACP default matching the model selected in Claudian. */
export async function ensureDshAcpProfilePatch(rawModelId: string): Promise<string | null> {
  const content = getDshAcpProfilePatchContent(rawModelId);
  if (!content) return null;
  const directory = path.join(os.tmpdir(), 'claudian', 'dsh');
  const filePath = path.join(directory, `acp-profile-${randomUUID()}.patch.yml`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function removeDshAcpProfilePatch(filePath: string | null): Promise<void> {
  if (filePath) await fs.rm(filePath, { force: true });
}

export function getDshAcpProfilePatchContent(rawModelId: string): string {
  const route = parseDshModelRoute(rawModelId);
  if (!route) return '';
  return [
    '- id: acp',
    '  config:',
    `    provider: ${JSON.stringify(route.providerId)}`,
    `    model: ${JSON.stringify(route.modelId)}`,
    '',
  ].join('\n');
}
