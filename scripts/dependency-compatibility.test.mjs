import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const obsidianRequire = createRequire(require.resolve('eslint-plugin-obsidianmd'));
const sdlRequire = createRequire(obsidianRequire.resolve('@microsoft/eslint-plugin-sdl'));

for (const [name, resolveFrom] of [
  ['eslint-plugin-import', obsidianRequire],
  ['eslint-plugin-json-schema-validator', obsidianRequire],
  ['eslint-plugin-react', sdlRequire],
]) {
  test(`${name} can use the legacy callable minimatch interface`, () => {
    const consumerRequire = createRequire(resolveFrom.resolve(name));
    const minimatch = consumerRequire('minimatch');
    assert.equal(typeof minimatch, 'function');
    assert.equal(minimatch('src/file.ts', 'src/*.ts'), true);
    assert.equal(minimatch('src/file.js', 'src/*.ts'), false);
    assert.equal(minimatch.minimatch('src/file.ts', 'src/*.ts'), true);
    assert.equal(new minimatch.Minimatch('src/*.ts').match('src/file.ts'), true);
  });
}

test('ESLint import and React rules can evaluate configured glob patterns', () => {
  const { Linter } = require('eslint');
  const react = sdlRequire('eslint-plugin-react');
  const imports = obsidianRequire('eslint-plugin-import');
  const linter = new Linter();
  const messages = linter.verify(
    'import value from "@app/value";\nconst element = <my_component />;\n',
    {
      languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { react, import: imports },
      rules: {
        'react/jsx-pascal-case': ['error', { ignore: ['my_*'] }],
        'import/order': ['error', { pathGroups: [{ pattern: '@app/**', group: 'internal' }] }],
      },
    },
    'fixture.js',
  );
  assert.deepEqual(messages, []);
});

const jestRequire = createRequire(require.resolve('jest'));
const jestCliRequire = createRequire(jestRequire.resolve('jest-cli'));
const jestCoreRequire = createRequire(jestCliRequire.resolve('@jest/core'));
const hasteMapRequire = createRequire(jestCoreRequire.resolve('jest-haste-map'));
const anymatchRequire = createRequire(hasteMapRequire.resolve('anymatch'));

for (const [consumer, resolveFrom] of [['jest-haste-map', hasteMapRequire], ['anymatch', anymatchRequire]]) {
  test(`${consumer} uses picomatch with repeated extglobs disabled`, () => {
    const picomatch = resolveFrom('picomatch');
    const testFile = picomatch('tests/**/*.test.ts');
    assert.equal(testFile('tests/unit/file.test.ts'), true);
    assert.equal(testFile('tests/unit/file.ts'), false);
    assert.equal(picomatch.isMatch('file.ts', 'file.@(ts|tsx)'), true);
    for (const operator of ['+', '*']) {
      assert.throws(() => picomatch(`${operator}(logs)`), /Repeated extglobs are disabled/);
    }
  });
}
