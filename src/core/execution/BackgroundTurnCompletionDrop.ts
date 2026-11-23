import type {
  ProviderDiagnosticLogRecord,
  ProviderDiagnosticLogSink,
} from '../providers/ProviderDiagnosticLog';
import type { ProviderId } from '../providers/types';

/**
 * Why a background turn produced no reviewable completion.
 *
 * A turn that settles ends in `background_turn_completed`; every value below is a branch that discarded the
 * turn or the completion before the chat could report it. Naming the branch turns "the reply never showed up"
 * into one line in the provider diagnostic log.
 */
export type BackgroundTurnCompletionDropCause =
  /** A requested run owns the reply, so no background turn opens. */
  | 'run-active'
  | 'session-disposed'
  /** The notification names another provider session. */
  | 'foreign-session'
  /** A session without the provider system prompt (title, metadata, and other auxiliary work). */
  | 'auxiliary-session'
  /** The quiet-window timer expired while a tool was still open, so nothing settled the turn. */
  | 'open-tools'
  /** The chat coordinator has no session binding for the event. */
  | 'no-binding'
  | 'stale-binding'
  | 'foreign-session-instance'
  /** A start event carried no sequence. */
  | 'malformed-start'
  | 'duplicate-start'
  | 'replayed-completed-turn'
  /** A completion arrived for an unknown turn or out of order. */
  | 'stale-completion-sequence'
  /** The tab replaced its presentation before the event was handled. */
  | 'superseded-presentation'
  /** The tab kept no render state for the turn. */
  | 'missing-render-state'
  /** The turn settled without content to show, so no reviewable settlement was reported. */
  | 'no-visible-output';

export interface BackgroundTurnCompletionDropReport {
  readonly cause: BackgroundTurnCompletionDropCause;
  readonly providerId: ProviderId;
  readonly sequence?: number;
  readonly sessionInstanceId?: string;
  readonly turnId?: string;
}

/** One stable, content-free line. */
export function backgroundTurnCompletionDropMessage(
  report: BackgroundTurnCompletionDropReport,
): string {
  const turn = report.turnId ? `background turn ${report.turnId}` : 'background turn';
  return `${turn} produced no reviewable completion: ${report.cause}`;
}

/** Writes the drop to the provider diagnostic log; a missing sink or a failed write never reaches the chat path. */
export function reportBackgroundTurnCompletionDrop(
  sink: ProviderDiagnosticLogSink | undefined,
  report: BackgroundTurnCompletionDropReport,
): void {
  if (!sink) return;
  const record: ProviderDiagnosticLogRecord = {
    event: 'background-turn-completion-dropped',
    message: backgroundTurnCompletionDropMessage(report),
    source: report.providerId,
  };
  void sink.write(record).catch(() => undefined);
}
