import {
  decodeDshModelId,
  encodeDshModelId,
} from '@/providers/dsh/models';

describe('dsh model ids', () => {
  it('keeps the configured model behind the dsh namespace', () => {
    expect(encodeDshModelId('deepseek-chat')).toBe('dsh:deepseek-chat');
    expect(decodeDshModelId('dsh:deepseek-chat')).toBe('deepseek-chat');
    expect(decodeDshModelId('deepseek-chat')).toBeNull();
  });
});
