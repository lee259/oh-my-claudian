import {
  buildImageAttachmentFromBase64,
  normalizeImageMediaType,
  parseImageDataUri,
} from '@/utils/imageAttachment';

describe('image attachment media types', () => {
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'image/svg+xml'])(
    'rejects unsupported and inherited media types (%p)', (mediaType) => {
      expect(normalizeImageMediaType(mediaType)).toBeNull();
      expect(parseImageDataUri(`data:${mediaType};base64,YQ==`)).toBeNull();
      expect(buildImageAttachmentFromBase64({ id: 'image', data: 'YQ==', mediaType })).toBeNull();
    },
  );

  it.each(['', null, 42])('rejects missing and non-string media types (%p)', mediaType => {
    expect(normalizeImageMediaType(mediaType)).toBeNull();
  });

  it.each([
    [' IMAGE/PNG ', 'image/png'],
    ['image/jpg', 'image/jpeg'],
    ['image/jpeg', 'image/jpeg'],
    ['image/gif', 'image/gif'],
    ['image/webp', 'image/webp'],
  ])('normalizes supported media types (%s)', (input, expected) => {
    expect(normalizeImageMediaType(input)).toBe(expected);
  });

  it('preserves valid image data and generates a canonical filename', () => {
    expect(parseImageDataUri('data:image/jpg;base64,YQ==')).toEqual({
      data: 'YQ==', mediaType: 'image/jpeg',
    });
    expect(buildImageAttachmentFromBase64({ id: 'image', data: ' YQ== ', mediaType: 'image/jpg' }))
      .toEqual({ id: 'image', data: 'YQ==', mediaType: 'image/jpeg', name: 'image.jpg', size: 1, source: 'paste' });
  });
});
