import { InputContainerVisibility } from '@/features/chat/controllers/InputContainerVisibility';

function createInputContainer(): HTMLElement {
  return {
    addClass: jest.fn(),
    removeClass: jest.fn(),
  } as unknown as HTMLElement;
}

describe('InputContainerVisibility', () => {
  it('keeps the composer hidden until every overlapping interaction restores it', () => {
    const visibility = new InputContainerVisibility();
    const inputContainer = createInputContainer();

    visibility.hide(inputContainer);
    visibility.hide(inputContainer);
    visibility.restore(inputContainer);

    expect(inputContainer.addClass).toHaveBeenCalledTimes(2);
    expect(inputContainer.removeClass).not.toHaveBeenCalled();

    visibility.restore(inputContainer);

    expect(inputContainer.removeClass).toHaveBeenCalledWith('claudian-hidden');
  });

  it('resets an unfinished interaction and ignores later restores', () => {
    const visibility = new InputContainerVisibility();
    const inputContainer = createInputContainer();

    visibility.hide(inputContainer);
    visibility.reset(inputContainer);
    visibility.restore(inputContainer);

    expect(inputContainer.removeClass).toHaveBeenCalledTimes(1);
  });
});
