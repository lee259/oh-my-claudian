import { readFileSync } from 'node:fs';
import path from 'node:path';

it('keeps light-theme provider icons legible', () => {
  const variables = readFileSync(path.resolve('src/style/base/variables.css'), 'utf8');
  const icons = readFileSync(path.resolve('src/shared/icons.ts'), 'utf8');
  expect(variables).toContain('--claudian-brand-opencode: #4B4646;');
  expect(variables).toContain('--claudian-brand-pi: #1F1F1F;');
  expect(icons).toContain("fill: '#D2D2D2'");
  expect(icons).toContain("fill: '#1F1F1F'");
});
