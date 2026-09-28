import { ClaudeTaskResultInterpreter } from '@/providers/claude/runtime/ClaudeTaskResultInterpreter';

describe('ClaudeTaskResultInterpreter', () => {
  describe('hasAsyncLaunchMarker', () => {
    it('does not treat completed sync metadata with agentId as an async launch', () => {
      const interpreter = new ClaudeTaskResultInterpreter();

      expect(interpreter.hasAsyncLaunchMarker({
        status: 'completed',
        agentId: 'agent-sync',
        content: [
          { type: 'text', text: 'Final sync result.' },
          { type: 'text', text: 'agentId: agent-sync' },
        ],
      })).toBe(false);
    });

    it('treats explicit async launch markers as async', () => {
      const interpreter = new ClaudeTaskResultInterpreter();

      expect(interpreter.hasAsyncLaunchMarker({
        isAsync: true,
        status: 'async_launched',
        agentId: 'agent-async',
      })).toBe(true);
    });
  });

  describe('extractStructuredResult', () => {
    it('preserves all answer text and removes matching Claude usage metadata', () => {
      const interpreter = new ClaudeTaskResultInterpreter();

      expect(interpreter.extractStructuredResult({
        agentId: 'agent-sync',
        content: [
          { type: 'text', text: 'Final answer.' },
          { type: 'text', text: '  Indented detail.' },
          { type: 'text', text: 'agentId: agent-sync (subagent)\n<usage>tokens: 10</usage>' },
        ],
      })).toBe('Final answer.\n  Indented detail.');
    });

    it('unwraps only a complete Claude hand-back envelope', () => {
      const interpreter = new ClaudeTaskResultInterpreter();
      const wrapped = '[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n'
        + '  Final answer.\n  Keep this indentation.\n'
        + 'agentId: agent-sync (subagent)\n<usage>tokens: 10</usage>';

      expect(interpreter.extractStructuredResult({ result: wrapped })).toBe('Final answer.\nKeep this indentation.');
      expect(interpreter.extractStructuredResult({ result: 'Incomplete hand-back header' }))
        .toBe('Incomplete hand-back header');
    });
  });
});
