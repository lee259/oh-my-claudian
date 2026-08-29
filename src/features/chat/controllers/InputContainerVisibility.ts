/** Balances temporary composer hiding across overlapping inline interactions. */
export class InputContainerVisibility {
  private hideDepth = 0;

  hide(inputContainerEl: HTMLElement): void {
    this.hideDepth++;
    inputContainerEl.addClass('claudian-hidden');
  }

  restore(inputContainerEl: HTMLElement): void {
    if (this.hideDepth <= 0) return;
    this.hideDepth--;
    if (this.hideDepth === 0) {
      inputContainerEl.removeClass('claudian-hidden');
    }
  }

  reset(inputContainerEl: HTMLElement): void {
    if (this.hideDepth <= 0) return;
    this.hideDepth = 0;
    inputContainerEl.removeClass('claudian-hidden');
  }
}
