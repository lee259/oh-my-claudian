import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEEPSEEK_PROVIDER_ICON } from '@/shared/icons';

describe('DeepSeek brand color', () => {
  const variablesCss = fs.readFileSync(path.join(process.cwd(), 'src/style/base/variables.css'), 'utf8');
  const tabsCss = fs.readFileSync(path.join(process.cwd(), 'src/style/components/tabs.css'), 'utf8');

  it('defines blue tokens and routes both active-provider aliases through them', () => {
    for (const prefix of ['claudian', 'oh-my-claudian']) {
      expect(variablesCss).toContain(`--${prefix}-brand-deepseek: #4D6BFE;`);
      expect(variablesCss).toContain(`--${prefix}-brand-deepseek-rgb: 77, 107, 254;`);
      const rule = variablesCss.match(/\[data-provider="deepseek"\] \{([^}]+)\}/)?.[1];
      expect(rule).toContain(`--${prefix}-brand: var(--${prefix}-brand-deepseek);`);
      expect(rule).toContain(`--${prefix}-brand-rgb: var(--${prefix}-brand-deepseek-rgb);`);
    }
  });

  it('uses DeepSeek blue for streaming tabs and provider icons', () => {
    expect(tabsCss).toMatch(/\.claudian-tab-badge-streaming\[data-provider="deepseek"\] \{\s*border-color: var\(--claudian-brand-deepseek\);/);
    expect('fill' in DEEPSEEK_PROVIDER_ICON ? DEEPSEEK_PROVIDER_ICON.fill : undefined).toBe('var(--claudian-brand-deepseek, #4D6BFE)');
  });
});
