import * as fs from 'node:fs';
import * as path from 'node:path';

import { ANTIGRAVITY_PROVIDER_ICON } from '@/shared/icons';

describe('Antigravity brand color', () => {
  const variablesCss = fs.readFileSync(path.join(process.cwd(), 'src/style/base/variables.css'), 'utf8');
  const tabsCss = fs.readFileSync(path.join(process.cwd(), 'src/style/components/tabs.css'), 'utf8');

  it('defines blue tokens and routes both active-provider aliases through them', () => {
    for (const prefix of ['claudian', 'oh-my-claudian']) {
      expect(variablesCss).toContain(`--${prefix}-brand-antigravity: #3186FF;`);
      expect(variablesCss).toContain(`--${prefix}-brand-antigravity-rgb: 49, 134, 255;`);
      const rule = variablesCss.match(/\[data-provider="antigravity"\] \{([^}]+)\}/)?.[1];
      expect(rule).toContain(`--${prefix}-brand: var(--${prefix}-brand-antigravity);`);
      expect(rule).toContain(`--${prefix}-brand-rgb: var(--${prefix}-brand-antigravity-rgb);`);
    }
  });

  it('uses Antigravity blue for streaming tabs and provider icons', () => {
    expect(tabsCss).toMatch(/\.claudian-tab-badge-streaming\[data-provider="antigravity"\] \{\s*border-color: var\(--claudian-brand-antigravity, #3186FF\);/);
    expect('fill' in ANTIGRAVITY_PROVIDER_ICON ? ANTIGRAVITY_PROVIDER_ICON.fill : undefined)
      .toBe('var(--claudian-brand-antigravity, #3186FF)');
  });
});
