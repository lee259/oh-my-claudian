import type { RequestedRunChannel } from '../../core/execution';
import { AcpExecutionEventNormalizer } from './AcpExecutionEventNormalizer';
import type { AcpNormalizedUpdate } from './AcpSessionUpdateNormalizer';
import type { AcpToolStreamAdapter } from './AcpToolStreamAdapter';
import { buildAcpUsageInfo } from './buildAcpUsageInfo';
import type { AcpUsageUpdate } from './types';

export type AcpSessionMetadataUpdate = Extract<
  AcpNormalizedUpdate,
  { type: 'commands' | 'config_options' | 'current_mode' }
>;

export interface AcpRequestedTurnOptions {
  readonly run: RequestedRunChannel;
  readonly toolStreamAdapter?: AcpToolStreamAdapter;
  readonly onAccept?: () => void;
}

/** Protocol mechanics of one requested ACP prompt turn. */
export class AcpRequestedTurn {
  private readonly normalizer: AcpExecutionEventNormalizer;
  private accepted = false;
  private accepting = false;
  private latestContextUsage: AcpUsageUpdate | null = null;

  constructor(private readonly options: AcpRequestedTurnOptions) {
    const { run } = options;
    this.normalizer = new AcpExecutionEventNormalizer({
      mapUsage: usage => {
        if (this.accepting) this.latestContextUsage = usage;
        return buildAcpUsageInfo({ contextWindow: usage });
      },
      scope: {
        executionId: run.executionId,
        kind: 'requested',
        sessionInstanceId: run.sessionInstanceId,
        turnId: run.turnId,
      },
      ...(options.toolStreamAdapter ? { toolStreamAdapter: options.toolStreamAdapter } : {}),
    });
  }

  get acceptingLiveOutput(): boolean {
    return this.accepting && !this.options.run.isTerminal;
  }

  get contextUsage(): AcpUsageUpdate | null {
    return this.latestContextUsage;
  }

  beginLiveOutput(): void {
    this.normalizer.reset();
    this.accepting = true;
  }

  accept(nativeUserMessageId?: string | null): void {
    if (this.accepted || this.options.run.isTerminal) return;
    this.accepted = true;
    this.options.onAccept?.();
    this.options.run.emit({
      accepted: true,
      ...(nativeUserMessageId ? { nativeUserMessageId } : {}),
      type: 'turn_started',
    });
  }

  handleUpdate(update: unknown): AcpSessionMetadataUpdate | undefined {
    const result = this.normalizer.normalize(update);
    if (result.metadata && isMetadata(result.metadata)) return result.metadata;
    if (!this.acceptingLiveOutput) return undefined;
    this.accept();
    for (const event of result.events) this.options.run.emit(event);
    return undefined;
  }

  dispose(): void {
    this.normalizer.dispose();
  }
}

function isMetadata(update: AcpNormalizedUpdate): update is AcpSessionMetadataUpdate {
  return update.type === 'commands'
    || update.type === 'config_options'
    || update.type === 'current_mode';
}
