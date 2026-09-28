/** A consumed native task notification keeps its task identity across live and replay paths. */
export function parseClaudeTaskNotification(content: unknown): { taskId: string; content: string } | null {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block): block is { type: 'text'; text: string } => (
        typeof block === 'object' && block !== null
        && 'type' in block && block.type === 'text'
        && 'text' in block && typeof block.text === 'string'
        && block.text.trim() !== '(no content)'
      )).map(block => block.text).join('\n')
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

function extractXmlTag(content: string, tagName: string): string | null {
  const match = content.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i'));
  const value = match?.[1]?.trim();
  return value || null;
}
