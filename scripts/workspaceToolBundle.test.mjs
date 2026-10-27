import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import sdkImportMeta from './sdkImportMeta.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bundled workspace tool validates and executes operations without unused schema exports', async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/core/obsidian/ObsidianWorkspaceTool.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    minify: true,
    write: false,
  });
  const output = result.outputFiles[0];
  const compiled = new Module(path.join(root, 'workspace-tool-fixture.cjs'));
  compiled.filename = path.join(root, 'workspace-tool-fixture.cjs');
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(output.text, compiled.filename);
  const tool = compiled.exports;
  assert.equal(tool.OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA.operation.safeParse('backlinks').success, true);
  assert.equal(tool.OBSIDIAN_WORKSPACE_TOOL_INPUT_SCHEMA.operation.safeParse('unknown').success, false);
  assert.deepEqual(await tool.executeObsidianWorkspaceTool({ backlinks: async () => ['source.md'] }, {
    operation: 'backlinks', path: 'target.md',
  }), { success: true, text: '[\n  "source.md"\n]' });
  assert.ok(output.contents.length < 150_000, `workspace tool bundle is ${output.contents.length} bytes`);
});

test('bundled Claude workspace server handles real MCP requests', async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/providers/claude/runtime/ClaudeObsidianWorkspaceMcpServer.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    minify: true,
    write: false,
    plugins: [{
      name: 'patch-sdk-import-meta',
      setup(build) {
        build.onLoad({ filter: sdkImportMeta.SDK_IMPORT_META_FILTER }, args => ({
          contents: sdkImportMeta.patchSdkImportMetaUrl(readFileSync(args.path, 'utf8')),
          loader: 'js',
        }));
      },
    }],
  });
  const compiled = new Module(path.join(root, 'claude-workspace-fixture.cjs'));
  compiled.filename = path.join(root, 'claude-workspace-fixture.cjs');
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  const paths = [];
  const server = compiled.exports.createClaudeObsidianWorkspaceMcpServer({
    backlinks: async value => { paths.push(value); return ['source.md']; },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await server.instance.connect(serverTransport);
    await client.connect(clientTransport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'vault'));
    const result = await client.callTool({ name: 'vault', arguments: { operation: 'backlinks', path: 'target.md' } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(paths, ['target.md']);
    const invalid = await client.callTool({ name: 'vault', arguments: { operation: 'invalid' } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.instance.close();
  }
});
