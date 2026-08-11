#!/usr/bin/env node
/**
 * CSS Build Script
 * Concatenates modular CSS files from src/style/ into root styles.css
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STYLE_DIR = join(ROOT, 'src', 'style');
const OUTPUT = join(ROOT, 'styles.css');
const INDEX_FILE = join(STYLE_DIR, 'index.css');
const CSS_SCOPE = '.oh-my-claudian-root';
const ROOT_STATE_CLASSES = new Set([
  'claudian-container',
  'claudian-wide-session-layout',
  'claudian-session-sidebar-left',
  'claudian-resizing-session-sidebar',
]);
const SCOPED_MODULE_PREFIXES = ['components/', 'toolbar/'];
const SCOPED_FEATURE_MODULES = new Set([
  'features/ask-user-question.css',
  'features/diff.css',
  'features/file-context.css',
  'features/image-context.css',
  'features/image-embed.css',
  'features/plan-mode.css',
  'features/resume-session.css',
]);

const IMPORT_PATTERN = /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/gm;

function findClosingBrace(content, openIndex) {
  let depth = 1;
  let quote = null;
  let comment = false;

  for (let index = openIndex + 1; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unbalanced CSS braces');
}

function splitSelectorList(selector) {
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      selectors.push(selector.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(selector.slice(start));
  return selectors;
}

function scopeSelector(selector) {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.includes(CSS_SCOPE)) return selector;

  if (trimmed.startsWith('body.theme-')) {
    const bodyEnd = trimmed.indexOf(' ');
    if (bodyEnd === -1) return `${trimmed} ${CSS_SCOPE}`;
    return `${trimmed.slice(0, bodyEnd)} ${CSS_SCOPE} ${trimmed.slice(bodyEnd + 1)}`;
  }

  const rootStateMatch = trimmed.match(/^((?:\.[A-Za-z0-9_-]+)+)(?:\s+)(.+)$/);
  if (rootStateMatch) {
    const stateClasses = rootStateMatch[1]
      .split('.')
      .filter(Boolean);
    if (stateClasses.some(className => ROOT_STATE_CLASSES.has(className))) {
      return `${CSS_SCOPE}${rootStateMatch[1]} ${rootStateMatch[2]}`;
    }
  }

  return `${CSS_SCOPE} ${trimmed}`;
}

function scopeSelectorPrelude(prelude) {
  const commentEnd = prelude.lastIndexOf('*/');
  const prefix = commentEnd === -1 ? '' : prelude.slice(0, commentEnd + 2);
  const selector = commentEnd === -1 ? prelude : prelude.slice(commentEnd + 2);
  return `${prefix}${splitSelectorList(selector).map(scopeSelector).join(',')}`;
}

function scopeCss(content) {
  let output = '';
  let segmentStart = 0;
  let index = 0;
  let comment = false;
  let quote = null;

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === '\\') index += 2;
      else if (char === quote) {
        quote = null;
        index += 1;
      } else index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      comment = true;
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char !== '{') {
      index += 1;
      continue;
    }

    const prelude = content.slice(segmentStart, index);
    const closeIndex = findClosingBrace(content, index);
    const inner = content.slice(index + 1, closeIndex);
    const trimmedPrelude = prelude.trim();
    const isNestedAtRule = trimmedPrelude.startsWith('@media') ||
      trimmedPrelude.startsWith('@supports') ||
      trimmedPrelude.startsWith('@container') ||
      trimmedPrelude.startsWith('@layer');
    const isKeyframes = trimmedPrelude.startsWith('@keyframes') ||
      trimmedPrelude.startsWith('@-webkit-keyframes');

    output += isKeyframes
      ? `${prelude}{${inner}}`
      : isNestedAtRule
        ? `${prelude}{${scopeCss(inner)}}`
        : `${scopeSelectorPrelude(prelude)}{${inner}}`;

    segmentStart = closeIndex + 1;
    index = segmentStart;
  }

  return output + content.slice(segmentStart);
}

function shouldScopeModule(modulePath) {
  return SCOPED_MODULE_PREFIXES.some(prefix => modulePath.startsWith(prefix)) ||
    SCOPED_FEATURE_MODULES.has(modulePath);
}

function getModuleOrder() {
  if (!existsSync(INDEX_FILE)) {
    console.error('Missing src/style/index.css');
    process.exit(1);
  }

  const content = readFileSync(INDEX_FILE, 'utf-8');
  const matches = [...content.matchAll(IMPORT_PATTERN)];

  if (matches.length === 0) {
    console.error('No @import entries found in src/style/index.css');
    process.exit(1);
  }

  return matches.map((match) => match[1]);
}

function listCssFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listCssFiles(entryPath, baseDir));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.css')) {
      const relativePath = relative(baseDir, entryPath).split('\\').join('/');
      files.push(relativePath);
    }
  }

  return files;
}

function build() {
  const moduleOrder = getModuleOrder();
  const parts = ['/* Claudian Plugin Styles */\n/* Built from src/style/ modules */\n'];
  const missingFiles = [];
  const invalidImports = [];
  const normalizedImports = [];

  for (const modulePath of moduleOrder) {
    const resolvedPath = resolve(STYLE_DIR, modulePath);
    const relativePath = relative(STYLE_DIR, resolvedPath);

    if (relativePath.startsWith('..') || !relativePath.endsWith('.css')) {
      invalidImports.push(modulePath);
      continue;
    }

    const normalizedPath = relativePath.split('\\').join('/');
    normalizedImports.push(normalizedPath);

    if (!existsSync(resolvedPath)) {
      missingFiles.push(normalizedPath);
      continue;
    }

    const sourceContent = readFileSync(resolvedPath, 'utf-8');
    const content = shouldScopeModule(normalizedPath)
      ? scopeCss(sourceContent)
      : sourceContent;
    const header = `\n/* ============================================\n   ${normalizedPath}\n   ============================================ */\n`;
    parts.push(header + content);
  }

  let hasErrors = false;

  if (invalidImports.length > 0) {
    console.error('Invalid @import entries in src/style/index.css:');
    invalidImports.forEach((modulePath) => console.error(`  - ${modulePath}`));
    hasErrors = true;
  }

  if (missingFiles.length > 0) {
    console.error('Missing CSS files:');
    missingFiles.forEach((f) => console.error(`  - ${f}`));
    hasErrors = true;
  }

  const allCssFiles = listCssFiles(STYLE_DIR).filter((file) => file !== 'index.css');
  const importedSet = new Set(normalizedImports);
  const unlistedFiles = allCssFiles.filter((file) => !importedSet.has(file));

  if (unlistedFiles.length > 0) {
    console.error('Unlisted CSS files (not imported in src/style/index.css):');
    unlistedFiles.forEach((file) => console.error(`  - ${file}`));
    hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  const output = parts.join('\n');
  writeFileSync(OUTPUT, output);
}

build();
