/** @jest-environment jsdom */

import { highlightRenderedTextChanges } from '@/features/inline-edit/ui/renderedTextDiff';

function root(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

function marks(element: HTMLElement, cls: string): Array<string | null> {
  return Array.from(element.querySelectorAll(`.${cls}`), mark => mark.textContent);
}

describe('highlightRenderedTextChanges', () => {
  it('marks only the changed characters inside compared blocks', () => {
    const before = root('<p>配套：协作、权限、自动化</p><p>Keep this as is</p>');
    const after = root('<p>配套：协作、授权、自动化</p><p>Keep this as is</p>');

    highlightRenderedTextChanges(before, after);

    expect(marks(before, 'claudian-diff-inline-delete')).toEqual(['限']);
    expect(marks(after, 'claudian-diff-inline-insert')).toEqual(['授']);
    expect(before.querySelectorAll('p')[0].textContent).toBe('配套：协作、权限、自动化');
    expect(after.querySelectorAll('p')[0].textContent).toBe('配套：协作、授权、自动化');
    expect(marks(before, 'claudian-diff-inline-delete')).not.toContain('Keep this as is');
  });

  it('leaves a formatting-only change unmarked', () => {
    const before = root('<p>Keep <strong>this</strong> paragraph</p>');
    const after = root('<p>Keep this <em>paragraph</em></p>');

    highlightRenderedTextChanges(before, after);

    expect(marks(before, 'claudian-diff-inline-delete')).toEqual([]);
    expect(marks(after, 'claudian-diff-inline-insert')).toEqual([]);
  });

  it('marks a change across formatting inside each text node it covers', () => {
    const before = root('<p>今天天气很好<strong>我们</strong>去公园</p>');
    const after = root('<p>今天天气很坏他们去公园</p>');

    highlightRenderedTextChanges(before, after);

    expect(marks(before, 'claudian-diff-inline-delete')).toEqual(['好', '我']);
    expect(marks(after, 'claudian-diff-inline-insert')).toEqual(['坏他']);
    expect(before.querySelector('strong')?.textContent).toBe('我们');
  });

  it('marks an unpaired block whole and skips math', () => {
    const before = root('<p>Draft</p><p>Plan <span class="math">a</span> builds</p>');
    const after = root('<p>Final</p><p>Plan <span class="math">b</span> builds up</p>');

    highlightRenderedTextChanges(before, after);

    expect(marks(before, 'claudian-diff-inline-delete')).toEqual(['Draft']);
    expect(marks(after, 'claudian-diff-inline-insert')).toEqual(['Final', ' up']);
    expect(marks(before, 'claudian-diff-inline-delete')).not.toContain('a');
    expect(marks(after, 'claudian-diff-inline-insert')).not.toContain('b');
  });
});
