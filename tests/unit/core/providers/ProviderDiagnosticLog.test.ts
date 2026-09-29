import {
  sanitizeDiagnosticArguments,
  sanitizeProviderDiagnosticLogRecord,
} from '@/core/providers/ProviderDiagnosticLog';

describe('ProviderDiagnosticLog', () => {
  it('redacts sensitive launch argument values and system prompt content', () => {
    expect(sanitizeDiagnosticArguments([
      '--mode',
      'rpc',
      '--api-key',
      'secret-value',
      '--system-prompt=private instructions',
      '--append-system-prompt',
      'more private instructions',
      '--extension',
      '/Users/example/.pi/extensions/custom.js',
    ])).toEqual([
      '--mode',
      'rpc',
      '--api-key',
      '[REDACTED]',
      '--system-prompt=[REDACTED]',
      '--append-system-prompt',
      '[REDACTED]',
      '--extension',
      '/Users/example/.pi/extensions/custom.js',
    ]);
  });

  it('sanitizes credentials in log messages and command fields', () => {
    expect(sanitizeProviderDiagnosticLogRecord({
      command: 'agent-token=secret-value',
      event: 'execution-error',
      message: 'Provider rejected bearer secret-value',
      source: 'pi',
    })).toEqual({
      command: 'agent-token=[REDACTED]',
      event: 'execution-error',
      message: 'Provider rejected bearer [REDACTED]',
      source: 'pi',
    });
  });
});
