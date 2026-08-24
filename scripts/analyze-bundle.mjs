#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const metafilePath = path.join(root, '.context', 'esbuild-meta.json');

if (!fs.existsSync(metafilePath)) {
  console.error('Bundle metafile is missing. Run `pnpm run build` first.');
  process.exitCode = 1;
} else {
  const metafile = JSON.parse(fs.readFileSync(metafilePath, 'utf8'));
  const inputs = Object.entries(metafile.outputs ?? {})
    .flatMap(([, output]) => Object.entries(output.inputs ?? {}))
    .map(([file, info]) => ({
      file,
      bytes: info.bytesInOutput ?? 0,
    }))
    .sort((left, right) => right.bytes - left.bytes);
  const outputBytes = Object.values(metafile.outputs ?? {})
    .reduce((total, output) => total + (output.bytes ?? 0), 0);

  console.log(`main.js ${(outputBytes / 1024 / 1024).toFixed(2)} MiB`);
  console.log('Top bundle inputs:');
  for (const input of inputs.slice(0, 25)) {
    console.log(`${String(input.bytes).padStart(9)} ${input.file}`);
  }
}
