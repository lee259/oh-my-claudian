/** A consumed native task notification keeps its task identity across live and replay paths. */
export function parseClaudeTaskNotification(content: unknown): { taskId: string; content: string } | null {
  const textBlocks = (blocks: unknown[]): string => blocks
    .filter(isNonemptyTextBlock)
    .map(block => block.text)
    .join('\n');
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? textBlocks(content as unknown[])
      : '';
  if (!text.trimStart().startsWith('<task-notification>')) return null;

  const taskId = extractXmlTag(text, 'task-id');
  const status = extractXmlTag(text, 'status');
  if (!taskId || !status) return null;
  return {
    taskId,
    content: extractXmlTag(text, 'result') ?? extractXmlTag(text, 'summary') ?? `Background task ${status}.`,
  };
}

function isNonemptyTextBlock(block: unknown): block is { type: 'text'; text: string } {
  if (typeof block !== 'object' || block === null) return false;
  if (!('type' in block) || block.type !== 'text') return false;
  if (!('text' in block) || typeof block.text !== 'string') return false;
  return block.text.trim() !== '(no content)';
}

function extractXmlTag(content: string, tagName: string): string | null {
  const match = content.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i'));
  const value = match?.[1]?.trim();
  return value || null;
}
