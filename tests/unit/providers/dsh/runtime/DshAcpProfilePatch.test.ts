import { getDshAcpProfilePatchContent } from '@/providers/dsh/runtime/DshAcpProfilePatch';

describe('DshAcpProfilePatch', () => {
  it('mirrors the selected provider and model without pinning a default route', () => {
    expect(getDshAcpProfilePatchContent('["opencode","claude-fable-5"]')).toBe([
      '- id: acp',
      '  config:',
      '    provider: "opencode"',
      '    model: "claude-fable-5"',
      '',
    ].join('\n'));
  });

  it('leaves the profile unchanged when the selected model is not an ACP route pair', () => {
    expect(getDshAcpProfilePatchContent('not-a-route')).toBe('');
  });
});
