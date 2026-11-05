import { setIcon } from 'obsidian';

export interface IconButtonProps {
  className: string;
  icon: string;
  iconClassName?: string;
  label: string;
  ariaExpanded?: boolean;
  ariaHasPopup?: 'menu';
  onClick?: (event: MouseEvent) => void;
}

/**
 * A small Preact-owned action button that keeps Obsidian icon rendering at the
 * view boundary and prevents its action from activating an enclosing surface.
 */
export function IconButton({
  className,
  icon,
  iconClassName,
  label,
  ariaExpanded,
  ariaHasPopup,
  onClick,
}: IconButtonProps) {
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span
        className={iconClassName}
        aria-hidden="true"
        ref={(element) => {
          if (element) setIcon(element, icon);
        }}
      />
    </button>
  );
}
