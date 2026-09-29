export interface ToolResultContentOptions {
  fallbackIndent?: number;
}

export function extractToolResultContent(
  content: unknown,
  options?: ToolResultContentOptions,
): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    const textParts = content.filter(isTextBlock).map((block) => block.text);
    if (textParts.length > 0) return textParts.join('\n');
    if (content.length > 0) {
      return JSON.stringify(content, omitToolResultImageData, options?.fallbackIndent);
    }
    return '';
  }

  return JSON.stringify(content, omitToolResultImageData, options?.fallbackIndent);
}

export function omitToolResultImageData(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type !== 'image' || !record.source || typeof record.source !== 'object') {
    return value;
  }

  const source = record.source as Record<string, unknown>;
  if (source.type !== 'base64' || typeof source.data !== 'string' || source.data.length === 0) {
    return value;
  }

  return { ...record, source: { ...source, data: '' } };
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  if (!block || typeof block !== 'object') return false;
  const record = block as Record<string, unknown>;
  return record.type === 'text' && typeof record.text === 'string';
}
