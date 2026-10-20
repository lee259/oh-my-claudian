import { computeConversationInputDigest } from '../../core/bootstrap/ConversationInputLedgerStorage';
import { type ChatMessage, type Conversation, type ConversationTurnModel, isCanonicalUserMessage } from '../../core/types';
import { extractUserDisplayContent } from '../../utils/context';

interface TurnAnchor {
  userTurnOrdinal: number;
  inputDigest?: string;
  userMessageId?: string;
}

function forEachAssistant(
  messages: readonly ChatMessage[],
  visit: (message: ChatMessage, anchor: TurnAnchor) => void,
): void {
  let anchor: TurnAnchor = { userTurnOrdinal: 0 };
  for (const message of messages) {
    if (isCanonicalUserMessage(message)) {
      anchor = {
        userTurnOrdinal: anchor.userTurnOrdinal + 1,
        userMessageId: message.userMessageId,
        inputDigest: computeConversationInputDigest({
          visibleText: message.displayContent
            ?? extractUserDisplayContent(message.content)
            ?? message.content,
          images: message.images ?? [],
        }),
      };
    } else if (message.role === 'assistant') {
      visit(message, anchor);
    }
  }
}

export function captureTurnModels(messages: readonly ChatMessage[]): ConversationTurnModel[] | undefined {
  const models: ConversationTurnModel[] = [];
  forEachAssistant(messages, (message, anchor) => {
    if (!message.modelName?.trim()) return;
    models.push({
      ...anchor,
      assistantMessageId: message.assistantMessageId,
      modelName: message.modelName,
    });
  });
  return models.length > 0 ? models : undefined;
}

export function restoreTurnModels(conversation: Conversation): void {
  const models = conversation.turnModels;
  if (!models?.length) return;
  forEachAssistant(conversation.messages, (message, anchor) => {
    if (message.modelName) return;
    let candidates = message.assistantMessageId
      ? models.filter(model => model.assistantMessageId === message.assistantMessageId)
      : [];
    if (candidates.length === 0) {
      candidates = models.filter(model => {
        // Contradictory native identities must not match a replacement branch.
        if (model.assistantMessageId && message.assistantMessageId) return false;
        if (model.userMessageId && anchor.userMessageId) {
          return model.userMessageId === anchor.userMessageId
            && model.userTurnOrdinal === anchor.userTurnOrdinal
            && model.inputDigest === anchor.inputDigest;
        }
        return anchor.userTurnOrdinal > 0
          && model.userTurnOrdinal === anchor.userTurnOrdinal
          && model.inputDigest === anchor.inputDigest;
      });
    }
    const labels = new Set(candidates.map(model => model.modelName));
    if (labels.size === 1) message.modelName = candidates[0].modelName;
  });
}
