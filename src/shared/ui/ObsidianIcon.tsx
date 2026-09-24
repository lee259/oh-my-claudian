import { setIcon } from 'obsidian';

export interface ObsidianIconProps {
  className?: string;
  icon: string;
}

/** Renders an Obsidian/Lucide icon inside a Preact-owned view. */
export function ObsidianIcon({ className, icon }: ObsidianIconProps) {
  return (
    <span
      aria-hidden="true"
      className={className ? `claudian-obsidian-icon ${className}` : 'claudian-obsidian-icon'}
      ref={(element) => {
        if (element) setIcon(element, icon);
      }}
    />
  );
}
