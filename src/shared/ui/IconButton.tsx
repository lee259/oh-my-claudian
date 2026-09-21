import { setIcon } from 'obsidian';

export interface IconButtonProps {
  className: string;
  icon: string;
  iconClassName?: string;
  label: string;
  onClick?: () => void;
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
  onClick,
}: IconButtonProps) {
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
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
