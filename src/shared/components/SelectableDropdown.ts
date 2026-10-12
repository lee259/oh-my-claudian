import { type FunctionComponent, h } from 'preact';

import { createPreactRoot, type PreactRoot } from '../ui/PreactRoot';
import { SelectableDropdownView, type SelectableDropdownViewProps } from './SelectableDropdownView';

export interface SelectableDropdownOptions {
  listClassName: string;
  itemClassName: string;
  emptyClassName: string;
  fixed?: boolean;
  fixedClassName?: string;
  accessibility?: { inputEl: HTMLElement; label: string };
}

export interface SelectableDropdownRenderOptions<T> {
  items: T[];
  selectedIndex: number;
  emptyText: string;
  renderItem: (item: T, itemEl: HTMLElement) => void;
  getItemClass?: (item: T) => string | string[] | undefined;
  onItemClick?: (item: T, index: number, e: MouseEvent) => void;
  onItemHover?: (item: T, index: number) => void;
}

let nextListboxId = 0;

export class SelectableDropdown<T> {
  private readonly listboxId = `claudian-suggestions-${++nextListboxId}`;
  private readonly writtenAttributes = new Map<string, string>();
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private options: SelectableDropdownOptions;
  private items: T[] = [];
  private itemEls: HTMLElement[] = [];
  private selectedIndex = 0;
  private root: PreactRoot | null = null;

  constructor(containerEl: HTMLElement, options: SelectableDropdownOptions) {
    this.containerEl = containerEl;
    this.options = options;
  }

  isVisible(): boolean {
    return this.dropdownEl?.hasClass('visible') ?? false;
  }

  getElement(): HTMLElement | null {
    return this.dropdownEl;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedItem(): T | null {
    return this.items[this.selectedIndex] ?? null;
  }

  getItems(): T[] {
    return this.items;
  }

  hide(): void {
    this.releaseInputAttributes();
    if (this.dropdownEl) {
      this.dropdownEl.removeClass('visible');
    }
  }

  destroy(): void {
    this.releaseInputAttributes();
    this.root?.unmount();
    this.root = null;
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  render(options: SelectableDropdownRenderOptions<T>): void {
    this.items = options.items;
    this.selectedIndex = options.selectedIndex;

    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }

    this.itemEls = [];
    this.releaseInputAttributes();

    if (!this.canMountPreact()) {
      this.renderLegacy(options);
      this.dropdownEl.addClass('visible');
      this.updateInputAccessibility();
      return;
    }

    this.root ??= createPreactRoot(this.dropdownEl);

    const view = SelectableDropdownView as FunctionComponent<SelectableDropdownViewProps<T>>;
    this.root?.render(
      h(view, {
        items: options.items,
        selectedIndex: this.selectedIndex,
        itemClassName: this.options.itemClassName,
        emptyClassName: this.options.emptyClassName,
        emptyText: options.emptyText,
        renderItem: options.renderItem,
        getItemClass: options.getItemClass,
        onItemClick: (item, index, e) => {
          this.selectedIndex = index;
          this.updateSelection();
          options.onItemClick?.(item, index, e);
        },
        onItemHover: (item, index) => {
          this.selectedIndex = index;
          this.updateSelection();
          options.onItemHover?.(item, index);
        },
        itemEls: this.itemEls,
        listboxId: this.options.accessibility ? this.listboxId : undefined,
      }),
    );

    this.dropdownEl.addClass('visible');
    this.updateInputAccessibility();
  }

  private renderLegacy(options: SelectableDropdownRenderOptions<T>): void {
    this.dropdownEl?.empty();

    if (options.items.length === 0) {
      const emptyEl = this.dropdownEl?.createDiv({ cls: this.options.emptyClassName });
      emptyEl?.setText(options.emptyText);
      return;
    }

    for (let i = 0; i < options.items.length; i++) {
      const item = options.items[i];
      const itemEl = this.dropdownEl!.createDiv({ cls: this.options.itemClassName });
      const extraClass = options.getItemClass?.(item);

      if (Array.isArray(extraClass)) {
        extraClass.forEach(cls => itemEl.addClass(cls));
      } else if (extraClass) {
        itemEl.addClass(extraClass);
      }

      if (i === this.selectedIndex) {
        itemEl.addClass('selected');
      }

      if (this.options.accessibility) {
        itemEl.setAttribute('aria-selected', String(i === this.selectedIndex));
        itemEl.setAttribute('role', 'option');
        itemEl.setAttribute('id', `${this.listboxId}-option-${i}`);
      }
      options.renderItem(item, itemEl);
      itemEl.addEventListener('click', (e) => {
        this.selectedIndex = i;
        this.updateSelection();
        options.onItemClick?.(item, i, e);
      });
      itemEl.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
        options.onItemHover?.(item, i);
      });
      this.itemEls.push(itemEl);
    }
  }

  updateSelection(): void {
    this.itemEls.forEach((itemEl, index) => {
      if (this.options.accessibility) itemEl.setAttribute('aria-selected', String(index === this.selectedIndex));
      if (index === this.selectedIndex) {
        itemEl.addClass('selected');
        itemEl.scrollIntoView({ block: 'nearest' });
      } else {
        itemEl.removeClass('selected');
      }
    });
    this.updateInputAccessibility();
  }

  private updateInputAccessibility(): void {
    if (!this.options.accessibility || !this.isVisible()) return;
    this.setInputAttribute('aria-autocomplete', 'list');
    this.setInputAttribute('aria-haspopup', 'listbox');
    this.setInputAttribute('aria-controls', this.listboxId);
    const selected = this.itemEls[this.selectedIndex];
    if (selected) {
      this.setInputAttribute('aria-activedescendant', selected.id);
    } else {
      const input = this.options.accessibility.inputEl;
      if (input.getAttribute('aria-activedescendant') === this.writtenAttributes.get('aria-activedescendant')) {
        input.removeAttribute('aria-activedescendant');
      }
      this.writtenAttributes.delete('aria-activedescendant');
    }
  }

  private setInputAttribute(attribute: string, value: string): void {
    this.writtenAttributes.set(attribute, value);
    this.options.accessibility?.inputEl.setAttribute(attribute, value);
  }

  private releaseInputAttributes(): void {
    const input = this.options.accessibility?.inputEl;
    const controls = input?.getAttribute('aria-controls');
    // A different popup may have taken over the same textarea.
    if (!controls || controls === this.listboxId) {
      for (const [attribute, value] of this.writtenAttributes) {
        if (input?.getAttribute(attribute) === value) input.removeAttribute(attribute);
      }
    }
    this.writtenAttributes.clear();
  }

  moveSelection(delta: number): void {
    const maxIndex = this.items.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + delta));
    this.updateSelection();
  }

  private createDropdownElement(): HTMLElement {
    const className = this.options.fixed && this.options.fixedClassName
      ? `${this.options.listClassName} ${this.options.fixedClassName}`
      : this.options.listClassName;

    const element = this.containerEl.createDiv({ cls: className });
    if (this.options.accessibility) {
      element.setAttribute('id', this.listboxId);
      element.setAttribute('role', 'listbox');
      element.setAttribute('aria-label', this.options.accessibility.label);
    }
    return element;
  }

  private canMountPreact(): boolean {
    return this.containerEl.nodeType === 1
      && typeof this.containerEl.ownerDocument?.createElement === 'function';
  }
}
