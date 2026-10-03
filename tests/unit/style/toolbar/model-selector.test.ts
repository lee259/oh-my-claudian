import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Model selector popover styles', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src/style/toolbar/model-selector.css'),
    'utf8',
  );

  it('uses a fixed preferred width that shrinks to the composer', () => {
    expect(css).toMatch(
      /\.claudian-model-dropdown\s*\{[\s\S]*?width:\s*min\(420px, calc\(100cqi - 16px\)\);[\s\S]*?max-width:\s*min\(420px, calc\(100cqi - 16px\)\);/,
    );
  });

  it('anchors the popover to the composer when the composer is narrow', () => {
    expect(css).toMatch(
      /@container \(max-width: 480px\)\s*\{[\s\S]*?\.claudian-model-selector\s*\{\s*position:\s*static;[\s\S]*?\.claudian-model-dropdown\s*\{[\s\S]*?inset-inline-start:\s*8px;[\s\S]*?width:\s*min\(420px, calc\(100cqi - 16px\)\);/,
    );
  });
});
