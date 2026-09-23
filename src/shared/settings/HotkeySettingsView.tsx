export interface HotkeySettingsViewItem {
  id: string;
  label: string;
  hotkey: string | null;
}

export interface HotkeySettingsViewProps {
  items: readonly HotkeySettingsViewItem[];
  onOpenSettings: () => void;
}

export function HotkeySettingsView({
  items,
  onOpenSettings,
}: HotkeySettingsViewProps) {
  return (
    <div className="claudian-hotkey-grid">
      {items.map(item => (
        <button
          className="claudian-hotkey-item"
          key={item.id}
          type="button"
          onClick={onOpenSettings}
        >
          <span className="claudian-hotkey-name">{item.label}</span>
          {item.hotkey && <span className="claudian-hotkey-badge">{item.hotkey}</span>}
        </button>
      ))}
    </div>
  );
}
