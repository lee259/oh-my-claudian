import type { JSX } from 'preact';

export interface SelectableDropdownViewProps<T> {
  items: T[];
  selectedIndex: number;
  itemClassName: string;
  emptyClassName: string;
  emptyText: string;
  renderItem: (item: T, itemEl: HTMLElement) => void;
  getItemClass?: (item: T) => string | string[] | undefined;
  onItemClick?: (item: T, index: number, e: MouseEvent) => void;
  onItemHover?: (item: T, index: number) => void;
  itemEls: Array<HTMLElement | undefined>;
}

export function SelectableDropdownView<T>({
  items,
  selectedIndex,
  itemClassName,
  emptyClassName,
  emptyText,
  renderItem,
  getItemClass,
  onItemClick,
  onItemHover,
  itemEls,
}: SelectableDropdownViewProps<T>) {
  if (items.length === 0) {
    return <div className={emptyClassName}>{emptyText}</div>;
  }

  return items.map((item, index) => {
    const extraClass = getItemClass?.(item);
    const className = [
      itemClassName,
      index === selectedIndex ? 'selected' : '',
      ...(Array.isArray(extraClass) ? extraClass : [extraClass ?? '']),
    ].filter(Boolean).join(' ');

    const assignItemElement = (itemEl: HTMLElement | null): void => {
      if (!itemEl) return;
      itemEls[index] = itemEl;
      // Legacy callers populate the item element imperatively. Clear that
      // content before Preact reuses the element for a later render.
      itemEl.replaceChildren();
      renderItem(item, itemEl);
    };

    const handleClick: JSX.MouseEventHandler<HTMLDivElement> = event => {
      onItemClick?.(item, index, event as unknown as MouseEvent);
    };

    return (
      <div
        className={className}
        ref={assignItemElement}
        onClick={handleClick}
        onMouseEnter={() => onItemHover?.(item, index)}
      />
    );
  });
}
