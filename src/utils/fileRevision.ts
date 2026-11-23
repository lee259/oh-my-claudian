import * as fs from 'node:fs/promises';

/** Stable revision for a file without reading its contents; Antigravity reads its size back from the second field. */
export async function readFileRevision(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? `${stat.mtimeMs}:${stat.size}` : null;
  } catch {
    return null;
  }
}
