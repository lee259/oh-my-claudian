import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** Acceptance of one steer handed to native input, settled by delivery evidence. */
export interface ClaudeSteerDelivery {
  readonly content: string;
  resolve(accepted: boolean): void;
  reject(error: Error): void;
}

/** Native user sends and steer delivery owned by one requested Claude run. */
export class ClaudeTurnInputs {
  readonly #ids: string[] = [];
  readonly #unconsumed = new Set<string>();
  readonly #undeliveredSteers = new Map<string, ClaudeSteerDelivery>();
  #abandoned = false;
  #reportsSessionState = false;
  #awaitingIdle = false;
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

  addSteer(id: string, delivery: ClaudeSteerDelivery): void {
    if (this.#settled) throw new Error('Claude Code turn inputs are already settled');
    this.#ids.push(id);
    this.#unconsumed.add(id);
    this.#undeliveredSteers.set(id, delivery);
  }

  hasUndeliveredSteers(): boolean {
    return this.#undeliveredSteers.size > 0;
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

  /** Accepts a replayed steer and returns its canonical input for the transcript. */
  deliver(id: string): string | undefined {
    const delivery = this.#undeliveredSteers.get(id);
    if (!delivery || this.#abandoned) return undefined;
    this.#undeliveredSteers.delete(id);
    delivery.resolve(true);
    return delivery.content;
  }

  abandon(): void {
    if (this.#abandoned) return;
    this.#abandoned = true;
    // Keep entries while Claude's command queue may still hold them after Stop.
    for (const delivery of this.#undeliveredSteers.values()) {
      delivery.reject(new Error('Claude Code run ended before the steer was delivered.'));
    }
  }

  /** Records native consumption and turn-over evidence; replays use deliver(). */
  observe(message: SDKMessage): void {
    if (this.#settled) return;
    if (message.type === 'system' && message.subtype === 'session_state_changed') {
      this.#reportsSessionState = true;
      if (message.state === 'idle' && this.#awaitingIdle) this.#settled = true;
      return;
    }
    if (message.type !== 'result' || this.matches(message) === false) return;
    const confirms = Boolean((message as SDKMessage & { user_message_uuids?: string[] }).user_message_uuids?.length)
      || (message.subtype === 'success' && !message.is_error);
    const consumedIds = getEchoedUserMessageIds(message);
    if (consumedIds === null) {
      for (const id of this.#unconsumed) this.#consume(id, confirms);
      this.#settled = true;
      return;
    }
    for (const id of consumedIds) this.#consume(id, confirms);
    if (this.#unconsumed.size === 0) {
      this.#settled = true;
    } else if (this.#reportsSessionState) {
      // queue count can be zero while a late steer waits for its own native turn.
      this.#awaitingIdle = true;
    } else if (message.queued_turn_count === 0) {
      this.#settled = true;
    }
  }

  #consume(id: string, confirms: boolean): void {
    this.#unconsumed.delete(id);
    const delivery = this.#undeliveredSteers.get(id);
    if (!delivery || !confirms) return;
    this.#undeliveredSteers.delete(id);
    if (!this.#abandoned) delivery.resolve(true);
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
