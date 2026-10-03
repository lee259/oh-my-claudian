import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Permission mode popover styles', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/style/toolbar/permission-toggle.css'),
    'utf8',
  );

  it('uses a fixed preferred width that shrinks to the composer', () => {
    expect(css).toMatch(
      /\.claudian-permission-mode-popover\s*\{[\s\S]*?width:\s*min\(320px, calc\(100cqi - 16px\)\);[\s\S]*?max-width:\s*min\(320px, calc\(100cqi - 16px\)\);/,
    );
  });

  it('anchors the popover to the composer edge when the composer is narrow', () => {
    expect(css).toMatch(
      /@container \(max-width: 480px\)\s*\{[\s\S]*?\.claudian-permission-mode-menu\s*\{\s*position:\s*static;[\s\S]*?\.claudian-permission-mode-popover\s*\{[\s\S]*?inset-inline-end:\s*8px;[\s\S]*?width:\s*min\(320px, calc\(100cqi - 16px\)\);/,
    );
  });
});
