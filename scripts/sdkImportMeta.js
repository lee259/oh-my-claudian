// Bundled SDK ESM entries read `import.meta.url`, which is undefined in the
// CommonJS plugin bundle. The Claude SDK `/core` entry and its hashed shared
// chunks need the same rewrite as `sdk.mjs`; otherwise lazy SDK loading calls
// `createRequire(undefined)` and throws.
const SDK_IMPORT_META_FILTER =
  /[\\/]node_modules[\\/](?:@openai[\\/]codex-sdk[\\/]dist[\\/]index\.js|@anthropic-ai[\\/]claude-agent-sdk[\\/](?:sdk|core(?:-[A-Za-z0-9]+)?)\.mjs)$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNamedImportAliases(contents, exportName, moduleNames) {
  const aliases = new Set([exportName]);
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let match;

  while ((match = importPattern.exec(contents)) !== null) {
    const [, specifiers, moduleName] = match;
    if (!moduleNames.includes(moduleName)) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      if (parts[0] === exportName) {
        aliases.add(parts[1] ?? exportName);
      }
    }
  }

  return [...aliases];
}

function patchSdkImportMetaUrl(contents) {
  let patched = contents.replace(
    'createRequire(import.meta.url)',
    'createRequire(__filename)',
  );

  for (const alias of getNamedImportAliases(patched, 'createRequire', ['module', 'node:module'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      `${alias}(__filename)`,
    );
  }

  for (const alias of getNamedImportAliases(patched, 'fileURLToPath', ['url', 'node:url'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      '__filename',
    );
  }

  return patched;
}

module.exports = {
  SDK_IMPORT_META_FILTER,
  patchSdkImportMetaUrl,
};
