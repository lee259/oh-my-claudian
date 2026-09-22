import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

export interface SettingsTabDefinition {
  id: string;
  label: string;
  contentId: string;
}

export interface SettingsTabBarProps {
  tabs: readonly SettingsTabDefinition[];
  initialActiveTabId: string;
  onTabChange: (tabId: string) => void;
}

export function getSettingsTabContentId(tabId: string): string {
  const safeTabId = tabId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `claudian-settings-content-${safeTabId}`;
}

export function SettingsTabBar({
  tabs,
  initialActiveTabId,
  onTabChange,
}: SettingsTabBarProps) {
  const initialTabId = tabs.some(tab => tab.id === initialActiveTabId)
    ? initialActiveTabId
    : tabs[0]?.id;
  const [activeTabId, setActiveTabId] = useState(initialTabId);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (!activeTabId) {
    return null;
  }

  const activateTab = (tabId: string, moveFocus: boolean): void => {
    if (!tabs.some(tab => tab.id === tabId)) {
      return;
    }

    setActiveTabId(tabId);
    onTabChange(tabId);
    if (moveFocus) {
      buttonRefs.current[tabId]?.focus();
    }
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLButtonElement> = event => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab) {
      activateTab(nextTab.id, true);
    }
  };

  return tabs.map(tab => {
    const isActive = tab.id === activeTabId;
    return (
      <button
        key={tab.id}
        id={`claudian-settings-tab-${tab.id}`}
        className={`claudian-settings-tab${isActive ? ' claudian-settings-tab--active' : ''}`}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={tab.contentId}
        tabIndex={isActive ? 0 : -1}
        data-tab-id={tab.id}
        ref={button => {
          buttonRefs.current[tab.id] = button;
        }}
        onClick={() => activateTab(tab.id, false)}
        onKeyDown={handleKeyDown}
      >
        {tab.label}
      </button>
    );
  });
}
