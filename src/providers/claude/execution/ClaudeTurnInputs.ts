import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** Native user sends owned by one requested Claude run. */
export class ClaudeTurnInputs {
  readonly #ids: string[] = [];
  readonly #unconsumed = new Set<string>();
  readonly #undeliveredSteers = new Set<string>();
  #settled = false;

  constructor(primaryId: string) {
    this.#ids.push(primaryId);
    this.#unconsumed.add(primaryId);
  }

  get primaryId(): string {
    return this.#ids[0];
  }

  get ids(): readonly string[] {
    return this.#ids;
  }

  get settled(): boolean {
    return this.#settled;
  }

  addSteer(id: string): void {
    if (this.#settled) throw new Error('Claude turn inputs are already settled');
    this.#ids.push(id);
    this.#unconsumed.add(id);
    this.#undeliveredSteers.add(id);
  }

  hasUndeliveredSteers(): boolean {
    return this.#undeliveredSteers.size > 0;
  }

  wasConsumed(id: string): boolean {
    return this.#ids.includes(id) && !this.#unconsumed.has(id);
  }

  matches(message: SDKMessage): boolean | undefined {
    if (!this.#ids.length || (message.type !== 'assistant'
      && message.type !== 'stream_event' && message.type !== 'result')) {
      return undefined;
    }
    const echoedIds = getEchoedUserMessageIds(message);
    if (echoedIds === null) {
      return message.type === 'result' && message.queued_turn_count !== undefined
        && message.queued_turn_count > 0 ? false : undefined;
    }
    return echoedIds.some(id => this.#ids.includes(id));
  }

  /** Records replay and consumption evidence from Claude's SDK stream. */
  observe(message: SDKMessage): string | undefined {
    if (this.#settled) return undefined;
    const replayedId = getReplayedUserMessageId(message);
    if (replayedId && this.#undeliveredSteers.delete(replayedId)) return replayedId;
    if (message.type !== 'result' || this.matches(message) === false) return undefined;

    const consumedIds = getEchoedUserMessageIds(message);
    if (consumedIds === null) {
      this.#settleAll();
      return undefined;
    }
    for (const id of consumedIds) {
      this.#unconsumed.delete(id);
      this.#undeliveredSteers.delete(id);
    }
    if (this.#unconsumed.size === 0 || message.queued_turn_count === 0) {
      this.#settled = true;
      this.#undeliveredSteers.clear();
    }
    return undefined;
  }

  #settleAll(): void {
    this.#unconsumed.clear();
    this.#undeliveredSteers.clear();
    this.#settled = true;
  }
}

export function getReplayedUserMessageId(message: SDKMessage): string | undefined {
  return message.type === 'user'
    && 'isReplay' in message
    && message.isReplay === true
    && message.parent_tool_use_id === null
    ? message.uuid
    : undefined;
}

function getEchoedUserMessageIds(message: SDKMessage): readonly string[] | null {
  if (message.type !== 'result') return null;
  const userMessageUuids = (message as SDKMessage & {
    user_message_uuids?: string[];
  }).user_message_uuids;
  if (userMessageUuids?.length) return userMessageUuids;
  return message.user_message_uuid ? [message.user_message_uuid] : null;
}
