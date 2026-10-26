import { extractToolResultContent } from '@/core/tools/toolResultContent';

describe('extractToolResultContent', () => {
  it('omits MCP image bytes from image-only display results without changing the native content', () => {
    const content = [{ type: 'image', mimeType: 'image/png', data: 'native-image-bytes' }];

    expect(extractToolResultContent(content)).toBe(JSON.stringify([
      { type: 'image', mimeType: 'image/png', data: '' },
    ]));
    expect(content[0].data).toBe('native-image-bytes');
  });

  it('omits nested image bytes without removing unrelated data or image metadata', () => {
    const content = {
      content: [{ type: 'image', mimeType: 'image/jpeg', data: 'image-bytes', annotations: { audience: ['user'] } }],
      data: 'result-data',
    };

    expect(JSON.parse(extractToolResultContent(content))).toEqual({
      content: [{ type: 'image', mimeType: 'image/jpeg', data: '', annotations: { audience: ['user'] } }],
      data: 'result-data',
    });
    expect(content.content[0].data).toBe('image-bytes');
  });

  it.each([
    { type: 'resource', mimeType: 'image/png', data: 'resource-data' },
    { type: 'image', mimeType: 'application/json', data: 'json-data' },
    { type: 'image', data: 'unknown-data' },
  ])('preserves data without a recognized image shape: %j', content => {
    expect(extractToolResultContent(content)).toBe(JSON.stringify(content));
  });
});
