import { isImeKeyEvent } from '@/utils/keyboard';

describe('isImeKeyEvent', () => {
  it.each([
    { isComposing: true, key: 'Enter' },
    { isComposing: false, key: 'Process' },
    { isComposing: false, key: 'Enter', keyCode: 229 },
  ])('recognizes an input-method event: %o', event => {
    expect(isImeKeyEvent(event)).toBe(true);
  });

  it.each(['Enter', 'Tab', 'Escape', 'ArrowDown'])('leaves ordinary %s keys available', key => {
    expect(isImeKeyEvent({ isComposing: false, key })).toBe(false);
  });
});
