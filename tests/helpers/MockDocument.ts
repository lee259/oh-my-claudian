import { createMockEl, type MockElement } from '@test/helpers/MockElement';

export interface MockDocument {
  body: MockElement;
  createElement: (tagName: string) => MockElement;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
}

export function createMockDocument(): MockDocument {
  return {
    body: createMockEl('body'),
    createElement: (tagName: string) => createMockEl(tagName),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

export function installMockDocument(): () => void {
  const originalDocument = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = createMockDocument() as unknown as Document;

  return () => {
    (globalThis as { document?: Document }).document = originalDocument;
  };
}
