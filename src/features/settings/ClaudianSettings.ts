import type { App, Plugin, SettingDefinitionItem } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { type ComponentChild,h } from 'preact';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities, ProviderId } from '../../core/providers/types';
import { AgentSkillRepository } from '../../core/skills/AgentSkillRepository';
import type { ChatViewPlacement } from '../../core/types/settings';
import {
  getAvailableLocales,
  getLocaleDisplayName,
  resolveLocale,
  setLocale,
  t,
} from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import { AgentSkillSettings } from '../../shared/settings/AgentSkillSettings';
import { destroyCliInstallationCards } from '../../shared/settings/CliInstallationCard';
import {
  type EnvironmentSettingsSectionHandle,
  renderEnvironmentSettingsSection,
} from '../../shared/settings/EnvironmentSettingsSection';
import { GeneralGettingStartedView } from '../../shared/settings/GeneralGettingStartedView';
import {
  GeneralSettingsLayout,
  type GeneralSettingsSection,
} from '../../shared/settings/GeneralSettingsLayout';
import { HotkeySettingsView } from '../../shared/settings/HotkeySettingsView';
import { NavigationMappingsView } from '../../shared/settings/NavigationMappingsView';
import { ProviderCapabilityMatrixView } from '../../shared/settings/ProviderCapabilityMatrixView';
import { frameSettingsGroups } from '../../shared/settings/SettingsGroups';
import { SettingsSelectListView } from '../../shared/settings/SettingsSelectListView';
import { SettingsSliderView } from '../../shared/settings/SettingsSliderView';
import {
  getSettingsTabContentId,
  SettingsTabBar,
  type SettingsTabDefinition,
} from '../../shared/settings/SettingsTabBar';
import { SettingsTextFieldsView } from '../../shared/settings/SettingsTextFieldsView';
import { SettingsToggleListView } from '../../shared/settings/SettingsToggleListView';
import { createPreactRoot, type PreactRoot } from '../../shared/ui/PreactRoot';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { getObsidianLanguage } from '../../utils/obsidianCompat';
import {
  MAX_WARM_AGENT_PROCESSES,
  MIN_WARM_AGENT_PROCESSES,
} from '../chat/execution/WarmExecutionPool';
import type { FeatureHost } from '../FeatureHost';
import { AgentSkillManagementCoordinator } from './AgentSkillManagementCoordinator';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';

type SettingsTabId = string;
type CapabilityMatrixKey = keyof Pick<
  ProviderCapabilities,
  | 'supportsPlanMode'
  | 'supportsRewind'
  | 'supportsFork'
  | 'supportsProviderCommands'
  | 'supportsImageAttachments'
  | 'supportsMcpTools'
  | 'supportsTurnSteer'
>;

const PROVIDER_CAPABILITY_ROWS: ReadonlyArray<{
  key: CapabilityMatrixKey;
  label: TranslationKey;
}> = [
  { key: 'supportsPlanMode', label: 'settings.capabilityMatrix.rows.planMode' },
  { key: 'supportsRewind', label: 'settings.capabilityMatrix.rows.rewind' },
  { key: 'supportsFork', label: 'settings.capabilityMatrix.rows.fork' },
  { key: 'supportsProviderCommands', label: 'settings.capabilityMatrix.rows.providerCommands' },
  { key: 'supportsImageAttachments', label: 'settings.capabilityMatrix.rows.imageAttachments' },
  { key: 'supportsMcpTools', label: 'settings.capabilityMatrix.rows.mcpTools' },
  { key: 'supportsTurnSteer', label: 'settings.capabilityMatrix.rows.turnSteer' },
];
type AppWithCommands = App & {
  commands?: {
    executeCommandById: (id: string) => boolean;
  };
};
type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Oh My Claudian';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

export class ClaudianSettingTab extends PluginSettingTab {
  plugin: FeatureHost;
  private activeTab: SettingsTabId = 'general';
  private refreshTitleModelOptions: (() => void) | null = null;
  private displayGeneration = 0;
  private customContextLimitRefreshTimer: number | null = null;
  private readonly pendingCustomContextLimitRefreshProviders = new Set<ProviderId>();
  private readonly agentSkillCoordinator: AgentSkillManagementCoordinator;
  private settingsTabsRoot: PreactRoot | null = null;
  private generalSettingsRoot: PreactRoot | null = null;
  private generalGettingStartedRoot: PreactRoot | null = null;
  private generalCapabilityMatrixRoot: PreactRoot | null = null;
  private generalDisplayRoot: PreactRoot | null = null;
  private generalHotkeysRoot: PreactRoot | null = null;
  private generalEnvironmentHandle: EnvironmentSettingsSectionHandle | null = null;
  private generalNavigationMappingsRoot: PreactRoot | null = null;
  private readonly generalControlRoots = new Set<PreactRoot>();

  constructor(app: App, plugin: FeatureHost & Plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.agentSkillCoordinator = new AgentSkillManagementCoordinator(
      new AgentSkillRepository(plugin.storage.getAdapter()),
      () => plugin.notifyAgentSkillsChanged(),
    );
  }

  /**
   * Declarative settings definitions for Obsidian 1.13.0+ settings search.
   * Claudian still builds its settings imperatively in display(); this empty
   * array satisfies the contract so the tab is registered in search.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    const displayGeneration = ++this.displayGeneration;
    this.agentSkillCoordinator.resetSubscriptions();
    destroyCliInstallationCards(this.containerEl);
    this.generalGettingStartedRoot?.unmount();
    this.generalGettingStartedRoot = null;
    this.generalCapabilityMatrixRoot?.unmount();
    this.generalCapabilityMatrixRoot = null;
    this.generalDisplayRoot?.unmount();
    this.generalDisplayRoot = null;
    for (const root of this.generalControlRoots) {
      root.unmount();
    }
    this.generalControlRoots.clear();
    this.generalHotkeysRoot?.unmount();
    this.generalHotkeysRoot = null;
    this.generalEnvironmentHandle?.destroy();
    this.generalEnvironmentHandle = null;
    this.generalNavigationMappingsRoot?.unmount();
    this.generalNavigationMappingsRoot = null;
    this.generalSettingsRoot?.unmount();
    this.generalSettingsRoot = null;
    this.settingsTabsRoot?.unmount();
    this.settingsTabsRoot = null;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');
    this.refreshTitleModelOptions = null;

    setLocale(resolveLocale(this.plugin.settings.locale, getObsidianLanguage()));

    const providerTabs = ProviderRegistry.getRegisteredProviderIds();
    const tabIds: SettingsTabId[] = ['general', ...providerTabs];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    const tabBar = containerEl.createDiv({ cls: 'claudian-settings-tabs' });
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', t('settings.title'));
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();
    const renderedProviderTabs = new Set<ProviderId>();

    const tabDefinitions: SettingsTabDefinition[] = tabIds.map(id => ({
      id,
      label: id === 'general'
        ? t('settings.tabs.general')
        : ProviderRegistry.getProviderDisplayName(id),
      contentId: getSettingsTabContentId(id),
    }));

    const activateTab = (id: SettingsTabId): void => {
      this.activeTab = id;
      for (const tabId of tabIds) {
        const content = tabContents.get(tabId);
        const isActive = tabId === id;
        content?.toggleClass('claudian-settings-tab-content--active', isActive);
        if (content) {
          content.hidden = !isActive;
        }
      }
      if (id !== 'general') {
        void renderProviderTab(id);
      }
    };

    this.settingsTabsRoot = createPreactRoot(tabBar);
    this.settingsTabsRoot.render(h(SettingsTabBar, {
      tabs: tabDefinitions,
      initialActiveTabId: this.activeTab,
      onTabChange: activateTab,
    }));

    const renderProviderTab = async (providerId: ProviderId): Promise<void> => {
      if (renderedProviderTabs.has(providerId)) {
        return;
      }
      renderedProviderTabs.add(providerId);

      const content = tabContents.get(providerId);
      if (!content) {
        return;
      }
      destroyCliInstallationCards(content);
      content.empty();
      content.createDiv({
        cls: 'claudian-settings-provider-loading',
        text: `Loading ${ProviderRegistry.getProviderDisplayName(providerId)} settings...`,
      });

      try {
        await ProviderWorkspaceRegistry.ensureInitialized(
          this.plugin.providerHost,
          providerId,
          'settings-tab',
        );
        await ProviderWorkspaceRegistry.prepareSettings(providerId);
        if (displayGeneration !== this.displayGeneration) {
          return;
        }

        content.empty();
        const renderer = ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId);
        if (!renderer) {
          content.createDiv({ text: 'Provider settings are unavailable.' });
          return;
        }
        renderer.render(content, {
          plugin: this.plugin.providerHost,
          renderAgentSkillSettings: (target, _targetProviderId) => {
            new AgentSkillSettings(target, this.agentSkillCoordinator, this.app);
          },
          renderHiddenProviderCommandSetting: (
            target,
            targetProviderId,
            copy,
          ) => this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
          notifyProviderModelOptionsChanged: (changedProviderId) => {
            this.notifyProviderModelOptionsChanged(changedProviderId);
          },
          renderCustomContextLimits: (target, targetProviderId) => (
            this.renderCustomContextLimits(target, targetProviderId)
          ),
        });
        frameSettingsGroups(content);
      } catch (error) {
        if (displayGeneration !== this.displayGeneration) {
          return;
        }
        renderedProviderTabs.delete(providerId);
        destroyCliInstallationCards(content);
        content.empty();
        const message = error instanceof Error ? error.message : 'Unknown error';
        content.createDiv({
          cls: 'claudian-setting-validation claudian-setting-validation-error',
          text: `Could not load provider settings: ${message}`,
        });
      }
    };

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: [
          'claudian-settings-tab-content',
          id === 'general' ? 'claudian-settings-general' : 'claudian-settings-provider-content',
          id === this.activeTab ? 'claudian-settings-tab-content--active' : '',
        ].filter(Boolean).join(' '),
      });
      content.id = getSettingsTabContentId(id);
      content.setAttribute('role', 'tabpanel');
      content.setAttribute('aria-labelledby', `claudian-settings-tab-${id}`);
      content.hidden = id !== this.activeTab;
      tabContents.set(id, content);
    }

    this.renderGeneralTab(tabContents.get('general')!);

    if (this.activeTab !== 'general') {
      void renderProviderTab(this.activeTab);
    }
  }

  private mountGeneralControl(container: HTMLElement, view: ComponentChild): PreactRoot {
    const root = createPreactRoot(container);
    this.generalControlRoots.add(root);
    root.render(view);
    return root;
  }

  private renderGeneralTab(container: HTMLElement): void {
    this.mountGeneralControl(container.createDiv(), h(SettingsSelectListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'interface-language',
        name: t('settings.language.name'),
        description: t('settings.language.desc'),
        value: this.plugin.settings.locale,
        options: [
          { value: '', label: t('settings.language.followObsidian') },
          ...getAvailableLocales().map(locale => ({
            value: locale,
            label: getLocaleDisplayName(locale),
          })),
        ],
      }],
      onChange: async (id, value) => {
        if (id !== 'interface-language') return;
        const locale = value as Locale;
        setLocale(resolveLocale(locale, getObsidianLanguage()));
        await this.plugin.mutateSettings((settings) => {
          settings.locale = locale;
        });
        this.display();
      },
    }));

    const sections: readonly GeneralSettingsSection[] = [
      {
        id: 'getting-started',
        title: t('settings.gettingStarted.title'),
        description: t('settings.gettingStarted.desc'),
      },
      {
        id: 'capability-matrix',
        title: t('settings.capabilityMatrix.title'),
        description: t('settings.capabilityMatrix.desc'),
      },
      { id: 'setup', title: t('settings.setup') },
      { id: 'display', title: t('settings.display') },
      { id: 'conversations', title: t('settings.conversations') },
      { id: 'content', title: t('settings.content') },
      { id: 'input', title: t('settings.input') },
      { id: 'hotkeys', title: t('settings.hotkeys') },
      { id: 'environment', title: t('settings.environment') },
      { id: 'advanced', title: t('common.advanced') },
    ];
    const sectionContainers = new Map<string, HTMLElement>();
    this.generalSettingsRoot?.unmount();
    this.generalSettingsRoot = createPreactRoot(container.createDiv({
      cls: 'claudian-settings-general-layout-host',
    }));
    this.generalSettingsRoot.render(h(GeneralSettingsLayout, {
      sections,
      onSectionMount: (id, element) => {
        if (element) {
          sectionContainers.set(id, element);
        } else {
          sectionContainers.delete(id);
        }
      },
    }));

    if (sections.some(section => !sectionContainers.has(section.id))) {
      return;
    }

    const section = (id: string): HTMLElement => sectionContainers.get(id)!;
    const gettingStarted = section('getting-started');
    this.generalGettingStartedRoot?.unmount();
    this.generalGettingStartedRoot = createPreactRoot(gettingStarted);
    this.generalGettingStartedRoot.render(h(GeneralGettingStartedView, {
      steps: [
        t('settings.gettingStarted.stepProvider'),
        t('settings.gettingStarted.stepReadiness'),
        t('settings.gettingStarted.stepChat'),
      ],
      actionLabel: t('settings.gettingStarted.openChat.button'),
      actionDescription: t('settings.gettingStarted.openChat.desc'),
      onOpenChat: () => {
        (this.plugin.app as AppWithCommands).commands
          ?.executeCommandById('oh-my-claudian:open-view');
      },
    }));

    this.generalCapabilityMatrixRoot?.unmount();
    this.generalCapabilityMatrixRoot = createPreactRoot(section('capability-matrix'));
    this.generalCapabilityMatrixRoot.render(h(ProviderCapabilityMatrixView, {
      providerLabel: t('settings.capabilityMatrix.provider'),
      supportedLabel: t('settings.capabilityMatrix.supported'),
      unsupportedLabel: t('settings.capabilityMatrix.unsupported'),
      rows: PROVIDER_CAPABILITY_ROWS.map(row => ({
        key: row.key,
        label: t(row.label),
      })),
      providers: ProviderRegistry.getRegisteredProviderIds().map(providerId => ({
        label: ProviderRegistry.getProviderDisplayName(providerId),
        supportedKeys: PROVIDER_CAPABILITY_ROWS
          .filter(row => ProviderRegistry.getCapabilities(providerId)[row.key])
          .map(row => row.key),
      })),
    }));

    // --- Workspace and layout ---

    const setup = section('setup');
    this.mountGeneralControl(setup, h(SettingsSelectListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'chat-view-placement',
        name: t('settings.chatViewPlacement.name'),
        description: t('settings.chatViewPlacement.desc'),
        value: this.plugin.settings.chatViewPlacement,
        options: [
          { value: 'right-sidebar', label: t('settings.chatViewPlacement.rightSidebar') },
          { value: 'left-sidebar', label: t('settings.chatViewPlacement.leftSidebar') },
          { value: 'main-tab', label: t('settings.chatViewPlacement.mainTab') },
        ],
      }],
      onChange: async (id, value) => {
        if (id !== 'chat-view-placement') return;
        await this.plugin.mutateSettings((settings) => {
          settings.chatViewPlacement = value as ChatViewPlacement;
        });
      },
    }));

    // --- Chat display ---

    const display = section('display');
    this.generalDisplayRoot?.unmount();
    this.generalDisplayRoot = createPreactRoot(display);
    this.generalDisplayRoot.render(h(SettingsToggleListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [
        {
          id: 'enable-auto-scroll',
          name: t('settings.enableAutoScroll.name'),
          description: t('settings.enableAutoScroll.desc'),
          value: this.plugin.settings.enableAutoScroll ?? true,
        },
        {
          id: 'show-tab-titles-by-default',
          name: t('settings.showTabTitlesByDefault.name'),
          description: t('settings.showTabTitlesByDefault.desc'),
          value: this.plugin.settings.showTabTitlesByDefault ?? false,
        },
        {
          id: 'defer-math-rendering',
          name: t('settings.deferMathRenderingDuringStreaming.name'),
          description: t('settings.deferMathRenderingDuringStreaming.desc'),
          value: this.plugin.settings.deferMathRenderingDuringStreaming ?? true,
        },
        {
          id: 'expand-file-edits-by-default',
          name: t('settings.expandFileEditsByDefault.name'),
          description: t('settings.expandFileEditsByDefault.desc'),
          value: this.plugin.settings.expandFileEditsByDefault ?? false,
        },
      ],
      onChange: async (id, value) => {
        switch (id) {
          case 'enable-auto-scroll':
            await this.plugin.mutateSettings((settings) => {
              settings.enableAutoScroll = value;
            });
            return;
          case 'show-tab-titles-by-default':
            await this.plugin.mutateSettings((settings) => {
              settings.showTabTitlesByDefault = value;
            });
            for (const view of this.plugin.getAllViews()) {
              view.refreshTabControls();
            }
            return;
          case 'defer-math-rendering':
            await this.plugin.mutateSettings((settings) => {
              settings.deferMathRenderingDuringStreaming = value;
            });
            return;
          case 'expand-file-edits-by-default':
            await this.plugin.mutateSettings((settings) => {
              settings.expandFileEditsByDefault = value;
            });
            return;
        }
      },
    }));

    // --- Conversations ---

    const conversations = section('conversations');
    this.mountGeneralControl(conversations, h(SettingsToggleListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'enable-auto-title-generation',
        name: t('settings.autoTitle.name'),
        description: t('settings.autoTitle.desc'),
        value: this.plugin.settings.enableAutoTitleGeneration,
      }],
      onChange: async (id, value) => {
        if (id !== 'enable-auto-title-generation') {
          return;
        }
        await this.plugin.mutateSettings((settings) => {
          settings.enableAutoTitleGeneration = value;
        });
        this.display();
      },
    }));

    if (this.plugin.settings.enableAutoTitleGeneration) {
      this.mountGeneralControl(conversations.createDiv(), h(SettingsSelectListView, {
        saveLabels: this.getSettingsSaveLabels(),
        items: [{
          id: 'title-generation-language',
          name: t('settings.titleLanguage.name'),
          description: t('settings.titleLanguage.desc'),
          value: this.plugin.settings.titleGenerationLocale || '',
          options: [
            { value: '', label: t('settings.titleLanguage.followInterface') },
            ...getAvailableLocales().map(locale => ({
              value: locale,
              label: getLocaleDisplayName(locale),
            })),
          ],
        }],
        onChange: async (id, value) => {
          if (id !== 'title-generation-language') {
            return;
          }
          await this.plugin.mutateSettings((settings) => {
            settings.titleGenerationLocale = value;
          });
        },
      }));

      const titleModelRoot = this.mountGeneralControl(
        conversations.createDiv(),
        h(SettingsSelectListView, this.getTitleModelSelectProps()),
      );
      this.refreshTitleModelOptions = () => {
        titleModelRoot.render(h(SettingsSelectListView, this.getTitleModelSelectProps()));
      };
    }

    // --- Content ---

    const content = section('content');
    this.mountGeneralControl(content, h(SettingsTextFieldsView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [
        {
          id: 'user-name',
          name: t('settings.userName.name'),
          description: t('settings.userName.desc'),
          value: this.plugin.settings.userName,
          placeholder: t('settings.userName.name'),
        },
        {
          id: 'system-prompt',
          name: t('settings.systemPrompt.name'),
          description: t('settings.systemPrompt.desc'),
          value: this.plugin.settings.systemPrompt,
          placeholder: t('settings.systemPrompt.name'),
          kind: 'textarea',
          rows: 6,
          cols: 50,
        },
        {
          id: 'excluded-tags',
          name: t('settings.excludedTags.name'),
          description: t('settings.excludedTags.desc'),
          value: this.plugin.settings.excludedTags.join('\n'),
          placeholder: 'System\nprivate\ndraft',
          kind: 'textarea',
          rows: 4,
          cols: 30,
        },
        {
          id: 'media-folder',
          name: t('settings.mediaFolder.name'),
          description: t('settings.mediaFolder.desc'),
          value: this.plugin.settings.mediaFolder,
          placeholder: 'Attachments',
          className: 'claudian-settings-media-input',
        },
      ],
      onChange: async (id, value) => {
        await this.plugin.mutateSettings((settings) => {
          switch (id) {
            case 'user-name':
              settings.userName = value;
              break;
            case 'system-prompt':
              settings.systemPrompt = value;
              break;
            case 'excluded-tags':
              settings.excludedTags = value
                .split(/\r?\n/)
                .map(entry => entry.trim().replace(/^#/, ''))
                .filter(entry => entry.length > 0);
              break;
            case 'media-folder':
              settings.mediaFolder = value.trim();
              break;
          }
        });
      },
      onBlur: async (id) => {
        if (id === 'user-name' || id === 'system-prompt' || id === 'media-folder') {
          await this.restartServiceForPromptChange();
        }
      },
    }));

    this.mountGeneralControl(content, h(SettingsToggleListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'use-claudian-system-prompt',
        name: t('settings.useClaudianSystemPrompt.name'),
        description: t('settings.useClaudianSystemPrompt.desc'),
        value: this.plugin.settings.useClaudianSystemPrompt === true,
      }],
      onChange: async (id, value) => {
        if (id !== 'use-claudian-system-prompt') return;
        await this.plugin.mutateSettings((settings) => {
          settings.useClaudianSystemPrompt = value;
        });
        await this.restartServiceForPromptChange();
      },
    }));

    // --- Input ---

    const input = section('input');
    this.mountGeneralControl(input, h(SettingsToggleListView, {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'require-command-or-control-enter',
        name: t('settings.requireCommandOrControlEnterToSend.name'),
        description: t('settings.requireCommandOrControlEnterToSend.desc'),
        value: this.plugin.settings.requireCommandOrControlEnterToSend ?? false,
      }],
      onChange: async (id, value) => {
        if (id !== 'require-command-or-control-enter') return;
        await this.plugin.mutateSettings((settings) => {
          settings.requireCommandOrControlEnterToSend = value;
        });
      },
    }));

    this.generalNavigationMappingsRoot?.unmount();
    this.generalNavigationMappingsRoot = createPreactRoot(input);
    this.generalNavigationMappingsRoot.render(h(NavigationMappingsView, {
      name: t('settings.navMappings.name'),
      description: t('settings.navMappings.desc'),
      placeholder: 'Map w scrollup\nmap s scrolldown\nmap i focusinput',
      initialValue: buildNavMappingText(this.plugin.settings.keyboardNavigation),
      validate: (value) => parseNavMappings(value).error ?? null,
      onSave: async (value) => {
        const result = parseNavMappings(value);
        if (!result.settings) {
          return buildNavMappingText(this.plugin.settings.keyboardNavigation);
        }

        await this.plugin.mutateSettings((settings) => {
          settings.keyboardNavigation.scrollUpKey = result.settings!.scrollUp;
          settings.keyboardNavigation.scrollDownKey = result.settings!.scrollDown;
          settings.keyboardNavigation.focusInputKey = result.settings!.focusInput;
        });
        return buildNavMappingText(this.plugin.settings.keyboardNavigation);
      },
      onInvalid: (error) => {
        new Notice(`${t('common.error')}: ${error}`);
      },
    }));

    // --- Hotkeys ---

    const hotkeys = section('hotkeys');
    this.generalHotkeysRoot?.unmount();
    this.generalHotkeysRoot = createPreactRoot(hotkeys);
    this.generalHotkeysRoot.render(h(HotkeySettingsView, {
      items: [
        {
          id: 'inline-edit',
          label: t('settings.inlineEditHotkey.name'),
          hotkey: getHotkeyForCommand(this.app, 'oh-my-claudian:inline-edit'),
        },
        {
          id: 'open-chat',
          label: t('settings.openChatHotkey.name'),
          hotkey: getHotkeyForCommand(this.app, 'oh-my-claudian:open-view'),
        },
        {
          id: 'new-session',
          label: t('settings.newSessionHotkey.name'),
          hotkey: getHotkeyForCommand(this.app, 'oh-my-claudian:new-session'),
        },
        {
          id: 'new-tab',
          label: t('settings.newTabHotkey.name'),
          hotkey: getHotkeyForCommand(this.app, 'oh-my-claudian:new-tab'),
        },
        {
          id: 'close-tab',
          label: t('settings.closeTabHotkey.name'),
          hotkey: getHotkeyForCommand(this.app, 'oh-my-claudian:close-current-tab'),
        },
      ],
      onOpenSettings: () => openHotkeySettings(this.app),
    }));

    // --- Environment ---

    const environment = section('environment');
    this.generalEnvironmentHandle = renderEnvironmentSettingsSection({
      container: environment,
      plugin: this.plugin.providerHost,
      scope: 'shared',
      name: 'Shared environment',
      desc: 'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
      placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      usePreactEnvironmentField: true,
      usePreactSnippetList: true,
    });

    // --- Advanced ---

    const advanced = section('advanced');
    this.mountGeneralControl(advanced, h(SettingsSliderView, {
      saveLabels: this.getSettingsSaveLabels(),
      name: t('settings.maxWarmAgentProcesses.name'),
      description: t('settings.maxWarmAgentProcesses.desc'),
      min: MIN_WARM_AGENT_PROCESSES,
      max: MAX_WARM_AGENT_PROCESSES,
      step: 1,
      value: this.plugin.settings.maxWarmAgentProcesses ?? 5,
      onChange: async (value) => {
        await this.plugin.mutateSettings((settings) => {
          settings.maxWarmAgentProcesses = value;
        });
        try {
          const reconciled = await this.plugin.warmExecutionPool.reconcileLimit();
          if (!reconciled) {
            new Notice(
              'The new concurrent running session limit will apply as busy sessions become idle.',
            );
          }
        } catch (error) {
          new Notice(
            error instanceof Error
              ? error.message
              : 'Failed to release excess warm agent processes.',
          );
        }
      },
    }));
  }

  private getTitleModelSelectProps() {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    return {
      saveLabels: this.getSettingsSaveLabels(),
      items: [{
        id: 'title-generation-model',
        name: t('settings.titleModel.name'),
        description: t('settings.titleModel.desc'),
        value: this.plugin.settings.titleGenerationModel || '',
        options: [
          { value: '', label: t('settings.titleModel.auto') },
          ...ProviderRegistry.getTitleGenerationModelOptions(settingsBag),
        ],
      }],
      onChange: async (id: string, value: string) => {
        if (id !== 'title-generation-model') return;
        await this.plugin.mutateSettings((settings) => {
          ProviderSettingsCoordinator.applyTitleGenerationModelSelection(settings, value);
        });
      },
    };
  }

  private getSettingsSaveLabels() {
    return {
      saving: t('settings.saveFeedback.saving'),
      saved: t('settings.saveFeedback.saved'),
      error: t('settings.saveFeedback.error'),
    };
  }

  private notifyProviderModelOptionsChanged(providerId: ProviderId): void {
    this.plugin.notifyProviderChatOptionsChanged(providerId);
    this.refreshTitleModelOptions?.();
  }

  private scheduleCustomContextLimitRefresh(providerId: ProviderId): void {
    this.pendingCustomContextLimitRefreshProviders.add(providerId);
    if (this.customContextLimitRefreshTimer !== null) {
      window.clearTimeout(this.customContextLimitRefreshTimer);
    }
    this.customContextLimitRefreshTimer = window.setTimeout(() => {
      this.customContextLimitRefreshTimer = null;
      const providers = Array.from(this.pendingCustomContextLimitRefreshProviders);
      this.pendingCustomContextLimitRefreshProviders.clear();
      for (const pendingProviderId of providers) {
        this.notifyProviderModelOptionsChanged(pendingProviderId);
      }
    }, 150);
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.hiddenProviderCommands = {
                ...settings.hiddenProviderCommands,
                [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
              };
            });
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const envVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables(providerId),
    );
    for (const modelId of ProviderRegistry.getChatUIConfig(providerId).getCustomModelIds(envVars)) {
      uniqueModelIds.add(modelId);
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'claudian-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customModelOverrides.name'),
      cls: 'claudian-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'claudian-context-limits-desc' });
    descEl.setText(t('settings.customModelOverrides.desc'));

    const listEl = container.createDiv({ cls: 'claudian-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];
      const currentAlias = this.plugin.settings.customModelAliases?.[modelId] ?? '';

      const itemEl = listEl.createDiv({ cls: 'claudian-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'claudian-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'claudian-context-limits-input-wrapper' });
      const aliasInputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: t('settings.customModelAliases.placeholder'),
        cls: 'claudian-context-alias-input',
        value: currentAlias,
      });
      aliasInputEl.setAttribute('aria-label', `Alias for ${modelId}`);
      aliasInputEl.title = 'Custom label shown in the model selector. Leave empty to use the default.';

      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'claudian-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });
      inputEl.setAttribute('aria-label', `Context window for ${modelId}`);

      const validationEl = inputWrapper.createDiv({ cls: 'claudian-context-limit-validation claudian-hidden' });

      const saveAlias = async (): Promise<void> => {
        const existing = this.plugin.settings.customModelAliases[modelId] ?? '';
        const trimmed = aliasInputEl.value.trim();
        if (trimmed === existing) {
          aliasInputEl.value = existing;
          return;
        }

        await this.plugin.mutateSettings((settings) => {
          settings.customModelAliases ??= {};
          if (trimmed) {
            settings.customModelAliases[modelId] = trimmed;
          } else {
            delete settings.customModelAliases[modelId];
          }
        });
        this.notifyProviderModelOptionsChanged(providerId);
      };

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!trimmed) {
          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('claudian-hidden', false);
            inputEl.classList.add('claudian-input-error');
            return;
          }

          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        }
        await this.plugin.mutateSettings((settings) => {
          settings.customContextLimits ??= {};
          if (!trimmed) {
            delete settings.customContextLimits[modelId];
          } else {
            settings.customContextLimits[modelId] = parseContextLimit(trimmed)!;
          }
        });
        this.scheduleCustomContextLimitRefresh(providerId);
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
      });
      aliasInputEl.addEventListener('blur', () => {
        void saveAlias();
      });
      aliasInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          aliasInputEl.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          aliasInputEl.value = this.plugin.settings.customModelAliases?.[modelId] ?? '';
          aliasInputEl.blur();
        }
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    try {
      await this.plugin.providerHost.runProviderExecutionTransition(
        ProviderRegistry.getRegisteredProviderIds(),
        async () => undefined,
      );
    } catch {
      // Changes will apply when the next provider execution starts.
    }
  }
}
