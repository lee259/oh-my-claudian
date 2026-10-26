/**
 * Extracts the final textual result from subagent JSONL output.
 * Prefers all visible text blocks in the latest assistant message and falls back to top-level result.
 */
export function extractFinalResultFromSubagentJsonl(content: string): string | null {
  const collector = createSubagentFinalResultCollector();
  for (const line of content.split('\n')) collector.addLine(line);
  return collector.result();
}

export function createSubagentFinalResultCollector(): { addLine(line: string): void; result(): string | null } {
  let lastAssistantText: string | null = null;
  let lastResultText: string | null = null;

  const addLine = (line: string): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }

    if (!raw || typeof raw !== 'object') {
      return;
    }

    const record = raw as {
      result?: unknown;
      message?: { role?: unknown; content?: unknown };
    };

    if (typeof record.result === 'string' && record.result.trim().length > 0) {
      lastResultText = record.result.trim();
    }

    if (record.message?.role !== 'assistant' || !Array.isArray(record.message.content)) {
      return;
    }

    const messageText: string[] = [];
    for (const blockRaw of record.message.content) {
      if (!blockRaw || typeof blockRaw !== 'object') {
        continue;
      }

      const block = blockRaw as { type?: unknown; text?: unknown };
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        messageText.push(block.text.trim());
      }
    }
    if (messageText.length > 0) lastAssistantText = messageText.join('\n');
  };

  return { addLine, result: () => lastAssistantText ?? lastResultText };
}
