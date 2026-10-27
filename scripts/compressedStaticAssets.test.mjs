import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';
import compressedStaticAssets from './compressedStaticAssets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDirectory = path.join(root, 'src/i18n/locales');

test('production locales preserve every translation while sharing their keys', async () => {
  const files = readdirSync(localeDirectory).filter(name => name.endsWith('.json')).sort();
  const source = files.map((name, index) => `import locale${index} from ${JSON.stringify(path.join(localeDirectory, name))};`).join('\n')
    + `\nmodule.exports = [${files.map((_, index) => `locale${index}`).join(',')}];`;
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    minify: true,
    write: false,
    plugins: [compressedStaticAssets.createCompressedStaticAssetsPlugin({ root })],
  });
  const output = result.outputFiles[0].text;
  const compiled = new Module(path.join(root, 'locale-fixture.cjs'));
  compiled.filename = path.join(root, 'locale-fixture.cjs');
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(output, compiled.filename);
  assert.deepEqual(compiled.exports, files.map(name => JSON.parse(readFileSync(path.join(localeDirectory, name), 'utf8'))));
  assert.ok(Buffer.byteLength(output) < 235_000, `locale bundle is ${Buffer.byteLength(output)} bytes`);
});

test('production locales decompress translations only when requested', async () => {
  const result = await esbuild.build({
    stdin: {
      contents: `import en from './src/i18n/locales/en.json';
        module.exports = { en, loadChinese: () => require('./src/i18n/locales/zh-CN.json').default };`,
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    plugins: [compressedStaticAssets.createCompressedStaticAssetsPlugin({ root })],
  });
  const compiled = new Module(path.join(root, 'locale-fixture.cjs'));
  compiled.filename = path.join(root, 'locale-fixture.cjs');
  compiled.paths = Module._nodeModulePaths(root);
  const originalRequire = compiled.require.bind(compiled);
  let decompressions = 0;
  compiled.require = name => {
    const dependency = originalRequire(name);
    if (name !== 'node:zlib') return dependency;
    return { ...dependency, brotliDecompressSync: (...args) => {
      decompressions += 1;
      return dependency.brotliDecompressSync(...args);
    } };
  };
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  assert.equal(decompressions, 2);
  assert.deepEqual(compiled.exports.loadChinese(), JSON.parse(readFileSync(path.join(localeDirectory, 'zh-CN.json'), 'utf8')));
  assert.equal(decompressions, 3);
});
