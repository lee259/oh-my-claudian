/** Extracts the answer from Claude's complete model-facing subagent hand-back envelope. */
export function extractHandbackResult(payload: string): string | null {
  const header = payload.match(/^\[Subagent hand-back\] The text below is the final report of a subagent[^\r\n]* The report follows:\r?\n/);
  const trailer = payload.match(/\r?\nagentId: [a-zA-Z0-9_-]+ \([^\r\n]*\)\r?\n<usage>[^]*<\/usage>\s*$/);
  if (!header || !trailer || trailer.index === undefined) return null;
  const lines = payload.slice(header[0].length, trailer.index).split(/\r?\n/);
  if (!lines.every(line => line.startsWith('  '))) return null;
  return lines.map(line => line.slice(2)).join('\n');
}
