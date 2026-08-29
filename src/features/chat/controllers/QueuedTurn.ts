import type { ChatTurnRequest, QueuedMessage } from '../state/types';

export interface QueuedChatTurn {
  displayContent: string;
  request: ChatTurnRequest;
}

export function getQueuedMessageDisplay(message: QueuedMessage | null): string {
  if (!message) {
    return '';
  }

  const rawContent = message.content.trim();
  const preview = rawContent.length > 40
    ? `${rawContent.slice(0, 40)}...`
    : rawContent;

  if ((message.images?.length ?? 0) > 0) {
    return preview ? `${preview} [images]` : '[images]';
  }

  return preview;
}

export function cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
  return {
    ...message,
    images: message.images ? [...message.images] : undefined,
    turnRequest: message.turnRequest
      ? cloneChatTurnRequest(message.turnRequest)
      : undefined,
  };
}

export function createQueuedMessage(
  displayContent: string,
  turnRequest: ChatTurnRequest,
): QueuedMessage {
  const request = cloneChatTurnRequest(turnRequest);
  return {
    browserContext: request.browserSelection ?? null,
    canvasContext: request.canvasSelection ?? null,
    content: displayContent,
    editorContext: request.editorSelection ?? null,
    images: request.images,
    turnRequest: request,
  };
}

export function toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
  if (message.turnRequest) {
    return {
      displayContent: message.content,
      request: cloneChatTurnRequest(message.turnRequest),
    };
  }

  return {
    displayContent: message.content,
    request: {
      browserSelection: message.browserContext ?? null,
      canvasSelection: message.canvasContext,
      editorSelection: message.editorContext,
      images: message.images ? [...message.images] : undefined,
      text: message.content,
    },
  };
}

export function mergeQueuedMessages(
  existing: QueuedMessage | null,
  incoming: QueuedMessage,
): QueuedMessage {
  if (!existing) {
    return cloneQueuedMessage(incoming);
  }

  const mergedTurn = mergeQueuedChatTurns(
    toQueuedChatTurn(existing),
    toQueuedChatTurn(incoming),
  );
  return createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
}

export function cloneChatTurnRequest(request: ChatTurnRequest): ChatTurnRequest {
  return {
    ...request,
    contextFiles: request.contextFiles ? [...request.contextFiles] : undefined,
    enabledMcpServers: request.enabledMcpServers
      ? new Set(request.enabledMcpServers)
      : undefined,
    externalContextPaths: request.externalContextPaths
      ? [...request.externalContextPaths]
      : undefined,
    images: request.images ? [...request.images] : undefined,
  };
}

function mergeQueuedChatTurns(
  existing: QueuedChatTurn,
  incoming: QueuedChatTurn,
): QueuedChatTurn {
  const mergeText = (first: string, second: string) => (
    [first, second].map(value => value.trim()).filter(Boolean).join('\n\n')
  );
  const externalContextPaths = Array.from(new Set([
    ...(existing.request.externalContextPaths ?? []),
    ...(incoming.request.externalContextPaths ?? []),
  ]));
  const contextFiles = Array.from(new Set([
    ...(existing.request.contextFiles ?? []),
    ...(incoming.request.contextFiles ?? []),
  ]));
  const enabledMcpServers = new Set([
    ...(existing.request.enabledMcpServers ?? []),
    ...(incoming.request.enabledMcpServers ?? []),
  ]);
  const images = [
    ...(existing.request.images ?? []),
    ...(incoming.request.images ?? []),
  ];

  return {
    displayContent: mergeText(existing.displayContent, incoming.displayContent),
    request: {
      ...cloneChatTurnRequest(incoming.request),
      contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
      currentNotePath:
        incoming.request.currentNotePath ?? existing.request.currentNotePath,
      enabledMcpServers:
        enabledMcpServers.size > 0 ? enabledMcpServers : undefined,
      externalContextPaths:
        externalContextPaths.length > 0 ? externalContextPaths : undefined,
      images: images.length > 0 ? images : undefined,
      text: mergeText(existing.request.text, incoming.request.text),
    },
  };
}
