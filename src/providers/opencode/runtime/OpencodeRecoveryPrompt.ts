import { createHash } from 'node:crypto';

const FOOTER = '\n</claudian_opencode_recovery>';
const HEADER = /^<claudian_opencode_recovery version="1" historyLength="(\d+)" promptLength="(\d+)" digest="([a-f0-9]{64})">\n/;

/** Lengths and a digest distinguish emitted recovery context from ordinary transcript text. */
export function buildOpencodeRecoveryPrompt(history: string, prompt: string): {
  text: string;
  promptStart: number;
} {
  const body = `${history}\n\nUser: ${prompt}`;
  const header = `<claudian_opencode_recovery version="1" historyLength="${history.length}" promptLength="${prompt.length}" digest="${digest(body)}">\n`;
  return { text: header + body + FOOTER, promptStart: header.length + history.length + '\n\nUser: '.length };
}

/** Returns the original composed input only for the exact protocol emitted above. */
export function unwrapOpencodeRecoveryPrompt(text: string): string {
  const match = HEADER.exec(text);
  if (!match || !text.endsWith(FOOTER)) return text;
  const historyLength = Number(match[1]);
  const promptLength = Number(match[2]);
  if (!Number.isSafeInteger(historyLength) || !Number.isSafeInteger(promptLength)) return text;
  const body = text.slice(match[0].length, -FOOTER.length);
  if (body.length !== historyLength + '\n\nUser: '.length + promptLength
    || body.slice(historyLength, historyLength + '\n\nUser: '.length) !== '\n\nUser: '
    || digest(body) !== match[3]) return text;
  return body.slice(historyLength + '\n\nUser: '.length);
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
