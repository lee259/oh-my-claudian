import type { ImageAttachment } from '@/core/types';
import {
  cloneQueuedMessage,
  toQueuedChatTurn,
} from '@/features/chat/controllers/QueuedTurn';
import type { QueuedMessage } from '@/features/chat/state/types';

const image: ImageAttachment = {
  data: 'image-data',
  id: 'image-1',
  mediaType: 'image/png',
  name: 'image.png',
  size: 1,
  source: 'paste',
};

describe('QueuedTurn', () => {
  it('clones queue snapshots without sharing mutable request collections', () => {
    const original: QueuedMessage = {
      browserContext: null,
      canvasContext: null,
      content: 'follow up',
      editorContext: null,
      images: [image],
      turnRequest: {
        contextFiles: ['notes/plan.md'],
        enabledMcpServers: new Set(['github']),
        externalContextPaths: ['/project'],
        images: [image],
        text: 'follow up',
      },
    };

    const cloned = cloneQueuedMessage(original);
    cloned.images?.push({ ...image, id: 'image-2' });
    cloned.turnRequest?.contextFiles?.push('notes/todo.md');
    cloned.turnRequest?.enabledMcpServers?.add('filesystem');
    cloned.turnRequest?.externalContextPaths?.push('/other-project');

    expect(original.images).toHaveLength(1);
    expect(original.turnRequest?.contextFiles).toEqual(['notes/plan.md']);
    expect(original.turnRequest?.enabledMcpServers).toEqual(new Set(['github']));
    expect(original.turnRequest?.externalContextPaths).toEqual(['/project']);
  });

  it('converts legacy queue messages into a provider-neutral turn request', () => {
    const legacy: QueuedMessage = {
      browserContext: {
        selectedText: 'browser selection',
        source: 'web',
        url: 'https://example.com',
      },
      canvasContext: { canvasPath: 'diagram.canvas', nodeIds: ['node-1'] },
      content: 'legacy message',
      editorContext: {
        mode: 'selection',
        notePath: 'notes/plan.md',
        selectedText: 'editor selection',
        startLine: 4,
      },
      images: [image],
    };

    expect(toQueuedChatTurn(legacy)).toEqual({
      displayContent: 'legacy message',
      request: {
        browserSelection: legacy.browserContext,
        canvasSelection: legacy.canvasContext,
        editorSelection: legacy.editorContext,
        images: [image],
        text: 'legacy message',
      },
    });
  });

});
