/** Keeps incomplete lines in fragments to avoid rescanning their full prefix on every chunk. */
export class LineBuffer {
  private fragments: string[] = [];
  private length = 0;

  constructor(private readonly maxLength = Number.POSITIVE_INFINITY) {}

  get bufferedLength(): number {
    return this.length;
  }

  push(text: string, onLine: (line: string) => void): void {
    let start = 0;
    for (;;) {
      const end = text.indexOf('\n', start);
      const fragment = text.slice(start, end < 0 ? undefined : end);
      this.length += fragment.length;
      if (this.length > this.maxLength) {
        throw new Error('Line exceeded the size limit.');
      }
      if (fragment) this.fragments.push(fragment);
      if (end < 0) return;

      onLine(this.take());
      start = end + 1;
    }
  }

  take(): string {
    const line = this.fragments.join('');
    this.fragments = [];
    this.length = 0;
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }
}
