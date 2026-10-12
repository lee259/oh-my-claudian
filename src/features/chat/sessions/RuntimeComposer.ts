/** Owns the unsent text independently of an optional composer input. */
export class RuntimeComposer {
  private text = '';
  private initialized = false;
  private binding: { input: HTMLTextAreaElement; onInput: () => void } | null = null;

  get value(): string {
    if (this.binding) this.text = this.binding.input.value;
    return this.text;
  }
  set value(value: string) {
    this.text = value;
    this.initialized = true;
    if (this.binding) {
      this.binding.input.value = value;
    }
  }

  get ownerDocument(): Document | undefined { return this.binding?.input.ownerDocument; }

  dispatchEvent(event: Event): boolean { return this.binding?.input.dispatchEvent(event) ?? true; }

  focus(): void { this.binding?.input.focus(); }

  attach(input: HTMLTextAreaElement): () => void {
    if (this.binding) this.detach(this.binding);
    if (!this.initialized) this.text = input.value;
    this.initialized = true;
    input.value = this.text;
    const binding = { input, onInput: () => { this.text = input.value; } };
    this.binding = binding;
    input.addEventListener('input', binding.onInput);
    return () => this.detach(binding);
  }

  private detach(binding: { input: HTMLTextAreaElement; onInput: () => void }): void {
    if (this.binding !== binding) return;
    this.text = binding.input.value;
    binding.input.removeEventListener('input', binding.onInput);
    this.binding = null;
  }
}
