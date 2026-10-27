const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const {
  brotliCompressSync,
  constants: zlibConstants,
} = require('node:zlib');

const localeFilter = /[\\/]src[\\/]i18n[\\/]locales[\\/][^\\/]+\.json$/;
const localeCatalogSpecifier = 'claudian:compressed-locale-catalog';
const localeCatalogNamespace = 'compressed-locale-catalog';

function compress(contents, mode) {
  return brotliCompressSync(contents, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: mode,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
    },
  }).toString('base64');
}

function makeShape(value) {
  if (typeof value === 'string') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Locale dictionaries must contain only objects and strings');
  }
  return Object.entries(value).map(([key, child]) => [key, makeShape(child)]);
}

function packValues(shape, value, locale) {
  if (shape === null) {
    if (typeof value !== 'string') throw new Error(`Invalid translation in ${locale}`);
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== shape.length
    || shape.some(([key]) => !Object.hasOwn(value, key))) {
    throw new Error(`Locale keys do not match English in ${locale}`);
  }
  return shape.map(([key, child]) => packValues(child, value[key], locale));
}

function createCompressedStaticAssetsPlugin({ root = process.cwd() } = {}) {
  const localeDirectory = path.join(root, 'src', 'i18n', 'locales');

  return {
    name: 'compressed-static-assets',
    setup(build) {
      build.onResolve({ filter: /^claudian:compressed-locale-catalog$/ }, () => ({
        namespace: localeCatalogNamespace,
        path: 'all',
      }));

      build.onLoad({ filter: /.*/, namespace: localeCatalogNamespace }, () => {
        const english = JSON.parse(readFileSync(path.join(localeDirectory, 'en.json'), 'utf8'));
        const shape = makeShape(english);
        const compressedShape = compress(Buffer.from(JSON.stringify(shape)), zlibConstants.BROTLI_MODE_TEXT);
        const catalog = Object.fromEntries(
          readdirSync(localeDirectory)
            .filter(fileName => fileName.endsWith('.json'))
            .sort()
            .map(fileName => [
              path.basename(fileName, '.json'),
              compress(
                Buffer.from(JSON.stringify(packValues(shape, JSON.parse(readFileSync(path.join(localeDirectory, fileName), 'utf8')), fileName))),
                zlibConstants.BROTLI_MODE_TEXT,
              ),
            ]),
        );
        return {
          contents: [
            'import { brotliDecompressSync } from "node:zlib";',
            `const compressedShape = ${JSON.stringify(compressedShape)};`,
            `const compressedCatalog = ${JSON.stringify(catalog)};`,
            'const decode = value => JSON.parse(brotliDecompressSync(Buffer.from(value, "base64")).toString("utf8"));',
            'let shape;',
            'function unpack(shape, values) {',
            '  if (shape === null) return values;',
            '  return Object.fromEntries(shape.map(([key, child], index) => [key, unpack(child, values[index])]));',
            '}',
            'export function loadCompressedLocale(locale) {',
            '  const compressed = compressedCatalog[locale];',
            '  if (!compressed) throw new Error(`Unsupported compressed locale: ${locale}`);',
            '  shape ??= decode(compressedShape);',
            '  return unpack(shape, decode(compressed));',
            '}',
          ].join('\n'),
          loader: 'js',
        };
      });

      build.onLoad({ filter: localeFilter }, (args) => {
        const dictionary = JSON.parse(readFileSync(args.path, 'utf8'));
        const exportNames = Object.keys(dictionary);
        if (!exportNames.every(name => /^[$A-Z_a-z][$\w]*$/.test(name))) {
          throw new Error(`Locale ${args.path} has a top-level key that cannot be exported`);
        }
        const locale = path.basename(args.path, '.json');
        return {
          contents: [
            `import { loadCompressedLocale } from ${JSON.stringify(localeCatalogSpecifier)};`,
            `const dictionary = loadCompressedLocale(${JSON.stringify(locale)});`,
            ...exportNames.map(name => `const ${name} = dictionary.${name};`),
            `export { ${exportNames.join(', ')} };`,
            'export default dictionary;',
          ].join('\n'),
          loader: 'js',
        };
      });
    },
  };
}

module.exports = { createCompressedStaticAssetsPlugin };
