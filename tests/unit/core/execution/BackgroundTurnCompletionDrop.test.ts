import {
  backgroundTurnCompletionDropMessage,
  reportBackgroundTurnCompletionDrop,
} from '@/core/execution/BackgroundTurnCompletionDrop';
import type {
  ProviderDiagnosticLogRecord,
  ProviderDiagnosticLogSink,
} from '@/core/providers/ProviderDiagnosticLog';

describe('background turn completion drop diagnostics', () => {
  it('names the turn and the cause on one line', () => {
    expect(backgroundTurnCompletionDropMessage({
      cause: 'open-tools',
      providerId: 'antigravity',
      turnId: 'turn-1',
    })).toBe('background turn turn-1 produced no reviewable completion: open-tools');
  });

  it('leaves out a turn id it never received', () => {
    expect(backgroundTurnCompletionDropMessage({
      cause: 'no-visible-output',
      providerId: 'antigravity',
    })).toBe('background turn produced no reviewable completion: no-visible-output');
  });

  it('writes the cause to the provider diagnostic log', () => {
    const write = jest.fn(async (_record: ProviderDiagnosticLogRecord) => undefined);
    const sink: ProviderDiagnosticLogSink = { write };

    reportBackgroundTurnCompletionDrop(sink, {
      cause: 'stale-completion-sequence',
      providerId: 'antigravity',
      sequence: 4,
      sessionInstanceId: 'instance-1',
      turnId: 'turn-1',
    });

    expect(write).toHaveBeenCalledWith({
      event: 'background-turn-completion-dropped',
      message: 'background turn turn-1 produced no reviewable completion: stale-completion-sequence',
      source: 'antigravity',
    });
  });

  it('stays silent without a sink and swallows a failed write', async () => {
    expect(() => reportBackgroundTurnCompletionDrop(undefined, {
      cause: 'run-active',
      providerId: 'antigravity',
    })).not.toThrow();

    const write = jest.fn(async (_record: ProviderDiagnosticLogRecord) => {
      throw new Error('disk full');
    });
    expect(() => reportBackgroundTurnCompletionDrop({ write }, {
      cause: 'run-active',
      providerId: 'antigravity',
    })).not.toThrow();
    await Promise.resolve();
  });
});
