import type { ChatTurnRequest, QueuedMessage } from '../state/types';

export interface QueuedChatTurn {
  displayContent: string;
  request: ChatTurnRequest;
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

export function cloneChatTurnRequest(request: ChatTurnRequest): ChatTurnRequest {
  return {
    ...request,
    editorSelection: request.editorSelection ? {
      ...request.editorSelection,
      cursorContext: request.editorSelection.cursorContext
        ? { ...request.editorSelection.cursorContext } : undefined,
    } : request.editorSelection,
    browserSelection: request.browserSelection ? { ...request.browserSelection } : request.browserSelection,
    canvasSelection: request.canvasSelection ? {
      ...request.canvasSelection, nodeIds: [...request.canvasSelection.nodeIds],
    } : request.canvasSelection,
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
