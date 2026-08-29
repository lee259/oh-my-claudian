import { captureComposerDraft } from '@/features/chat/controllers/ComposerDraft';

describe('captureComposerDraft', () => {
  it('keeps an image-only composer draft', () => {
    const image = { id: 'image', name: 'a.png' } as any;
    expect(captureComposerDraft('', [image])).toMatchObject({
      content: '',
      images: [image],
      turnRequest: { text: '', images: [image] },
    });
  });

  it('drops an empty composer draft', () => {
    expect(captureComposerDraft('  ', undefined)).toBeNull();
  });
});
