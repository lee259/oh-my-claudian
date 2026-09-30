let lastModalInstance: any;

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');

  class MockModal {
    static instances: MockModal[] = [];
    app: any;
    modalEl = { addClass: jest.fn() };
    contentEl = { empty: jest.fn() };
    isClosed = false;

    constructor(app: any) {
      this.app = app;
      MockModal.instances.push(this);
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastModalInstance = this;
    }

    setTitle = jest.fn();
    open() { this.onOpen(); }
    close() {
      this.isClosed = true;
      this.onClose();
    }
    onOpen() {}
    onClose() {}
  }

  class MockTextComponent {
    static instances: MockTextComponent[] = [];
    value = '';
    inputEl = {
      addEventListener: jest.fn(),
      focus: jest.fn(),
      select: jest.fn(),
      setAttribute: jest.fn(),
    };

    constructor() {
      MockTextComponent.instances.push(this);
    }
    setValue(value: string) { this.value = value; return this; }
    getValue() { return this.value; }
    setPlaceholder(_placeholder: string) { return this; }
  }

  class MockSetting {
    static buttons: Array<{ label: string; clickHandler?: () => void }> = [];
    static textInputs: MockTextComponent[] = [];

    constructor(_container: unknown) {}
    addText(callback: (text: MockTextComponent) => void) {
      const text = new MockTextComponent();
      MockSetting.textInputs.push(text);
      callback(text);
      return this;
    }
    addButton(callback: (button: any) => void) {
      const button = {
        label: '',
        clickHandler: undefined as (() => void) | undefined,
        setButtonText(label: string) { this.label = label; return this; },
        setCta() { return this; },
        onClick(handler: () => void) { this.clickHandler = handler; return this; },
      };
      MockSetting.buttons.push(button);
      callback(button);
      return this;
    }
  }

  return {
    ...actual,
    Modal: MockModal,
    Setting: MockSetting,
    TextComponent: MockTextComponent,
  };
});

import { Setting } from 'obsidian';

import { ConversationRenameModal } from '@/features/chat/ui/ConversationRenameModal';

const mockSetting = Setting as typeof Setting & {
  buttons: Array<{ label: string; clickHandler?: () => void }>;
  textInputs: Array<{ setValue: (value: string) => unknown }>;
};

describe('ConversationRenameModal', () => {
  beforeEach(() => {
    lastModalInstance = null;
    mockSetting.buttons = [];
    mockSetting.textInputs = [];
  });

  it('saves the trimmed title and closes the modal', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new ConversationRenameModal({} as any, 'Old title', onSave);
    modal.open();

    expect(mockSetting.textInputs[0]).toBeDefined();
    mockSetting.textInputs[0].setValue('  New title  ');

    const saveButton = mockSetting.buttons.find(button => button.label === 'Save');
    expect(saveButton).toBeDefined();

    saveButton?.clickHandler?.();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith('New title');
    expect(lastModalInstance.isClosed).toBe(true);
  });
});
