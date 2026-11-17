import type { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { RuntimeMessagePresentation } from '@/features/chat/sessions/RuntimeMessagePresentation';

it('routes image previews only to the currently attached renderer', () => {
  const presentation = new RuntimeMessagePresentation();
  const image = {} as HTMLImageElement;
  const original = { showRenderedImage: jest.fn() };
  const replacement = { showRenderedImage: jest.fn() };
  const detachOriginal = presentation.attach(original as unknown as MessageRenderer);
  presentation.showRenderedImage(image);
  expect(original.showRenderedImage).toHaveBeenCalledTimes(1);
  const detachReplacement = presentation.attach(replacement as unknown as MessageRenderer);
  detachOriginal();
  presentation.showRenderedImage(image);
  expect(original.showRenderedImage).toHaveBeenCalledTimes(1);
  expect(replacement.showRenderedImage).toHaveBeenCalledWith(image);
  detachReplacement();
  presentation.showRenderedImage(image);
  expect(replacement.showRenderedImage).toHaveBeenCalledTimes(1);
});
