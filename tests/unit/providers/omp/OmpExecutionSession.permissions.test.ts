jest.mock('cross-spawn', () => jest.fn());
jest.mock('@/providers/omp/runtime/OmpRuntimeEnvironment', () => ({
  resolveOmpRuntimeEnvironment: async () => ({}),
}));

import { createMockChildProcess } from '@test/helpers/MockChildProcess';
import spawn from 'cross-spawn';

import type { ProviderApprovalInteractionRequest, ProviderExecutionRun } from '@/core/execution';
import { OmpExecutionSession } from '@/providers/omp/execution/OmpExecutionSession';

describe('OmpExecutionSession permission routing', () => {
  it('presents a Bash approval with the executing session identity instead of cancelling it as stale', async () => {
    const proc = createMockChildProcess();
    jest.mocked(spawn).mockReturnValue(proc);
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
      proc.emit('close', 0, null);
      return true;
    });
    let promptId: number | string | undefined;
    let permissionOutcome: unknown;
    const reply = (id: number | string, result: unknown) => {
      proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    };
    proc.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') reply(message.id, { protocolVersion: 1 });
        else if (message.method === 'session/new') reply(message.id, { sessionId: 'native-omp-session' });
        else if (message.method === 'session/prompt') {
          promptId = message.id;
          proc.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 'bash-approval',
            method: 'session/request_permission',
            params: {
              sessionId: 'native-omp-session',
              toolCall: { toolCallId: 'bash-1', title: 'Bash', rawInput: { command: 'pwd' } },
              options: [
                { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
                { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
              ],
            },
          })}\n`);
        } else if (message.id === 'bash-approval') {
          permissionOutcome = message.result;
          reply(promptId!, { stopReason: 'end_turn' });
        }
      }
    });

    const presentedApproval = jest.fn();
    let run: ProviderExecutionRun;
    const requestApproval = jest.fn(async (request: ProviderApprovalInteractionRequest) => {
      // Match the chat coordinator's session/turn fence at the provider boundary.
      if (request.sessionInstanceId !== session.sessionInstanceId || request.turnId !== run.turnId) {
        throw new Error('Stale provider interaction');
      }
      presentedApproval(request);
      return { interactionId: request.interactionId, decision: 'allow' as const };
    });
    const session = new OmpExecutionSession({
      settings: {},
      getResolvedProviderCliPath: async () => '/configured/omp',
    } as never, {
      interactionPort: {
        requestApproval,
        dismissInteraction: jest.fn(),
        askUserQuestion: jest.fn(),
        requestPlanDecision: jest.fn(),
      },
      lifecycle: 'persistent',
      nativePersistence: 'provider-default',
      vaultWorkingDirectory: '/vault',
    });
    try {
      run = session.execute({
        configuration: { permissionMode: 'always-ask', systemInstructions: { kind: 'provider-default' } },
        input: [{ text: 'Run pwd', type: 'text' }],
        signal: new AbortController().signal,
        toolPolicy: { kind: 'provider-default' },
      } as never);
      for await (const event of run.events) void event;

      expect(presentedApproval).toHaveBeenCalledWith(expect.objectContaining({
        sessionInstanceId: session.sessionInstanceId,
        turnId: run.turnId,
        toolName: 'Bash',
      }));
      expect(permissionOutcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    } finally {
      await session.dispose();
    }
  });
});
