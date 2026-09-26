import type { EventRef, TFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';
import { h } from 'preact';

import { StartupProfiler } from '../../core/performance/StartupProfiler';
import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import {
  getProviderSettingsSnapshotWithModel,
  resolveConversationModel,
} from '../../core/providers/conversationModel';
import { resolveProviderCustomContextLimit } from '../../core/providers/modelSelection';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { type AppTabManagerState, DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import {
  OH_MY_CLAUDIAN_ROOT_CLASS,
  VIEW_TYPE_CLAUDIAN,
} from '../../core/types';
import { t } from '../../i18n/i18n';
import { createPreactRoot, type PreactRoot } from '../../shared/ui/PreactRoot';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
  scheduleDelayedFrame,
} from '../../utils/animationFrame';
import type { FeatureHost, FeatureTabManagerHost } from '../FeatureHost';
import type { HistoryConversationStatus } from './controllers/ConversationController';
import { refreshWelcomeContent } from './rendering/WelcomeRenderer';
import { MentionCacheCoordinator } from './services/MentionCacheCoordinator';
import { TabStatePersistenceCoordinator } from './services/TabStatePersistenceCoordinator';
import {
  commitProvisionalTab,
  getTabProviderId,
  sendTabInputMessageFromExplicitEnterShortcut,
  updatePlanModeUI,
} from './tabs/Tab';
import { TabManager } from './tabs/TabManager';
import type { TabData, TabId } from './tabs/types';
import { HistorySearchView } from './ui/HistorySearchView';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

const HISTORY_SURFACE_REFRESH_DELAY_MS = 200;

export class ClaudianView extends ItemView {
  private plugin: FeatureHost;

  // Tab management
  private tabManager: TabManager | null = null;
  private mentionCacheCoordinator: MentionCacheCoordinator | null = null;
  private chatPanelEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;
  private inputFooterEl: HTMLElement | null = null;
  private inputNavRowHostEl: HTMLElement | null = null;
  private activeInputSlotEl: HTMLElement | null = null;
  private activeInputTabId: TabId | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private newTabButtonEl: HTMLElement | null = null;

  // History elements
  private historyDropdown: HTMLElement | null = null;
  private historyListHostEl: HTMLElement | null = null;
  private historySearchRoot: PreactRoot | null = null;
  private historySearchQuery = '';
  private historyRenderAbortController: AbortController | null = null;
  private isArchiveSessionView = false;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  private tabStatePersistence: TabStatePersistenceCoordinator;

  constructor(leaf: WorkspaceLeaf, plugin: FeatureHost) {
    super(leaf);
    this.plugin = plugin;
    this.tabStatePersistence = new TabStatePersistenceCoordinator(
      state => this.plugin.storage.setTabManagerState(state),
    );

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this);
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'Oh My Claudian';
  }

  getIcon(): string {
    return 'bot';
  }

  /** Refreshes composer labels after the interface locale changes. */
  refreshComposerLocale(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.refreshComposerLocale?.();
    }
  }

  /** Refreshes model-dependent UI across all tabs (used after settings/env changes). */
  refreshModelSelector(changedProviderId?: ProviderId): void {
    this.tabManager?.reconcileProviderAvailability();
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      const providerId = getTabProviderId(tab, this.plugin);
      if (
        changedProviderId
        && tab.conversationId !== null
        && providerId !== changedProviderId
      ) {
        continue;
      }
      const conversation = tab.conversationId
        ? this.plugin.getConversationSync(tab.conversationId)
        : null;
      const modelOverride = conversation
        ? resolveConversationModel(this.plugin.settings, providerId, conversation).model
        : tab.conversationId === null
        ? tab.draftModel
        : null;
      const providerSettings = getProviderSettingsSnapshotWithModel(
        this.plugin.settings,
        providerId,
        modelOverride,
      );
      const model = providerSettings.model;
      const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
      const contextWindow = uiConfig.getContextWindowSize(
        model,
        providerSettings.customContextLimits,
        providerSettings,
      );

      if (tab.state.usage) {
        tab.state.usage = recalculateUsageForModel(
          tab.state.usage,
          model,
          contextWindow,
          resolveProviderCustomContextLimit(
            providerId,
            model,
            providerSettings.customContextLimits,
          ),
        );
      }

      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();
      tab.ui.modeSelector?.updateDisplay();
      tab.ui.modeSelector?.renderOptions();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
      tab.ui.permissionToggle?.updateDisplay();
      tab.ui.serviceTierToggle?.updateDisplay();
    }

    if (!changedProviderId) {
      this.tabManager?.primeProviderExecution();
    }
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  invalidateProviderResources(providerIds: ProviderId[], generation: number): void {
    this.tabManager?.invalidateProviderResources(providerIds, generation);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  async onOpen() {
    const span = StartupProfiler.start('view-open');
    try {
      await this.onOpenImpl();
    } finally {
      StartupProfiler.finish(span);
    }
  }

  private async onOpenImpl() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container', OH_MY_CLAUDIAN_ROOT_CLASS);

    this.navRowContent = this.buildNavRowContent();
    this.buildViewLayout();
    if (!this.tabContentEl) return;

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
          this.updateInputLocation();
          this.syncProviderBrandColor();
        },
        onActiveTabChanged: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
          this.updateInputLocation();
          this.syncProviderBrandColor();
          this.persistCurrentTabState();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
          this.updateInputLocation();
          this.syncProviderBrandColor();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
          this.updateInputLocation();
          this.persistCurrentTabState();
        },
        onTabStreamingChanged: () => {
          this.updateTabBar();
          this.notifyConversationRuntimeStateChanged();
        },
        onTabWorkChanged: () => {
          this.updateTabBar();
          this.notifyConversationRuntimeStateChanged();
        },
        onTabRewindingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => {
          this.updateTabBar();
          this.updateConversationHeaders();
        },
        onTabAttentionChanged: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
        },
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.notifyConversationNavigationChanged();
          this.syncProviderBrandColor();
          this.updateHomeSurfaceState();
          this.persistCurrentTabState();
        },
        onTabProviderChanged: () => {
          this.updateTabBar();
          this.syncProviderBrandColor();
        },
      }
    );
    this.mentionCacheCoordinator = new MentionCacheCoordinator(
      () => (this.tabManager?.getAllTabs() ?? []).map(tab => ({
        fileContextManager: tab.ui.fileContextManager,
      })),
    );

    this.wireEventHandlers();
    await this.restoreCurrentTab();
    this.syncProviderBrandColor();
    this.attachNavRowContentToInputFooter();
    this.updateInputLocation();
    this.updateTabBarVisibility();
  }

  async onClose() {
    this.cancelHistoryRendering();
    this.destroyHistorySurface();
    if (this.pendingHistorySurfaceUpdate) {
      cancelScheduledAnimationFrame(this.pendingHistorySurfaceUpdate);
      this.pendingHistorySurfaceUpdate = null;
    }
    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    try {
      await this.flushCurrentTabState();
    } catch {
      // The storage boundary reports persistence failures. Teardown must still complete.
    } finally {
      this.tabStatePersistence?.dispose();
      try {
        this.restoreActiveInputToTabContent();
        await this.tabManager?.destroy();
      } finally {
        this.tabManager = null;
        this.mentionCacheCoordinator = null;

        this.scope = null;
      }
    }
  }

  // ============================================
  // UI Building
  // ============================================

  private buildViewLayout(): void {
    if (!this.viewContainerEl) return;

    this.chatPanelEl = this.viewContainerEl.createDiv({ cls: 'claudian-chat-panel' });
    this.tabContentEl = this.chatPanelEl.createDiv({ cls: 'claudian-tab-content-container' });
    this.historyDropdown = this.chatPanelEl.createDiv({ cls: 'claudian-history-menu' });
    this.buildInputFooter();
  }

  /** Presentation-only data and actions for the empty chat home surface. */
  getWelcomeHomeOptions() {
    return {
      getConversations: () => this.plugin.getConversationList(),
      isConversationRunning: (conversationId: string) => {
        const localTab = this.findTabWithConversation(conversationId);
        if (localTab) return localTab.state.isStreaming;

        const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
        if (!crossViewResult || crossViewResult.view === this) return false;

        const crossViewTab = crossViewResult.view.getTabManager()?.getTab(crossViewResult.tabId);
        return crossViewTab?.state.isStreaming ?? false;
      },
      onBack: () => {
        void this.activateOrCreateDraftTab().catch(() => new Notice(t('chat.errors.returnHome')));
      },
      onOpenConversation: (conversationId: string) => {
        void this.openHistoryConversation(conversationId).catch(() => {
          new Notice(t('chat.errors.openConversation'));
        });
      },
      onRenameConversation: (conversationId: string, title: string) => {
        void this.plugin.renameConversation(conversationId, title).catch(() => {
          new Notice(t('chat.errors.renameConversation'));
        });
      },
      onArchiveConversation: (conversationId: string) => {
        void this.setConversationArchived(conversationId, true).catch(() => {
          new Notice(t('chat.errors.archiveSession'));
        });
      },
      onOpenHistory: () => this.toggleHistoryDropdown(),
      onOpenSettings: () => {
        const app = this.plugin.app as typeof this.plugin.app & {
          setting?: {
            open: () => void;
            openTabById: (id: string) => void;
          };
        };
        const setting = app.setting;
        if (!setting) return;

        setting.open();
        setting.openTabById('oh-my-claudian');
      },
      onNewConversation: () => this.requestNewConversation(),
    };
  }

  /**
   * Builds the active tab nav row content.
   * The wrapper is moved to the active tab's nav row on tab switches.
   */
  private buildNavRowContent(): HTMLElement {
    const wrapper = this.containerEl.createDiv({ cls: 'claudian-input-nav-content' });

    const navActionsEl = wrapper.createDiv({ cls: 'claudian-input-nav-actions' });

    this.newTabButtonEl = navActionsEl.createEl('button', {
      cls: 'claudian-input-nav-btn claudian-new-tab-btn',
      attr: { type: 'button' },
    });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.setAttribute('aria-label', t('chat.history.newTab'));
    this.newTabButtonEl.addEventListener('click', () => this.requestNewTab());

    const newBtn = navActionsEl.createEl('button', {
      cls: 'claudian-input-nav-btn claudian-new-conversation-btn',
      attr: { type: 'button' },
    });
    setIcon(newBtn, 'square-pen');
    newBtn.setAttribute('aria-label', t('chat.home.newConversation'));
    newBtn.addEventListener('click', () => this.requestNewConversation());

    // History dropdown
    const historyContainer = navActionsEl.createDiv({ cls: 'claudian-history-container' });
    const historyBtn = historyContainer.createEl('button', {
      cls: 'claudian-input-nav-btn',
      attr: { type: 'button' },
    });
    setIcon(historyBtn, 'history');
    historyBtn.setAttribute('aria-label', t('chat.home.history'));

    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    return wrapper;
  }

  private requestNewTab(): void {
    void this.createNewTab().catch(() => new Notice(t('chat.errors.createTab')));
  }

  private requestNewConversation(): void {
    void (async () => {
      await this.tabManager?.createNewConversation({ force: true });
      this.updateHistoryDropdown();
    })().catch(() => new Notice(t('chat.errors.createConversation')));
  }

  private requestDualNew(): void {
    void this.activateOrCreateDraftTab()
      .catch(() => new Notice(t('chat.errors.startConversation')));
  }

  private async activateOrCreateDraftTab(): Promise<void> {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === null) {
      activeTab.dom.inputEl.focus();
      return;
    }

    const draftTab = this.findMostRecentUnboundTab();
    if (draftTab) {
      await this.tabManager?.switchToTab(draftTab.id);
      draftTab.dom.inputEl.focus();
      return;
    }

    await this.createNewTab();
  }

  async handleNewConversationCommand(): Promise<boolean> {
    await this.activateOrCreateDraftTab();
    return true;
  }

  async handleNewSessionPlan(planContent: string): Promise<boolean> {
    await this.createNewTab();
    const inputController = this.tabManager?.getActiveTab()?.controllers.inputController;
    if (!inputController) {
      throw new Error('New conversation input is unavailable');
    }
    void inputController.sendMessage({ content: planContent }).catch(() => {
      new Notice(t('chat.errors.approvedPlan'));
    });
    return true;
  }

  private findMostRecentUnboundTab(): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    for (let index = tabs.length - 1; index >= 0; index -= 1) {
      if (tabs[index].conversationId === null) {
        return tabs[index];
      }
    }
    return null;
  }

  private buildInputFooter(): void {
    if (!this.chatPanelEl) return;

    this.inputFooterEl = this.chatPanelEl.createDiv({ cls: 'claudian-input-footer' });
    this.inputNavRowHostEl = this.inputFooterEl.createDiv({
      cls: 'claudian-input-nav-row claudian-view-input-nav-row',
    });
    this.activeInputSlotEl = this.inputFooterEl.createDiv({ cls: 'claudian-active-input-slot' });
  }

  private attachNavRowContentToInputFooter(): void {
    if (!this.inputNavRowHostEl || !this.navRowContent) return;

    this.inputNavRowHostEl.appendChild(this.navRowContent);
  }

  private updateInputLocation(): void {
    const activeTab = this.tabManager?.getActiveTab();
    this.updateHomeSurfaceState(activeTab);
    if (!this.activeInputSlotEl) return;

    if (!activeTab) {
      this.activeInputSlotEl.empty();
      this.activeInputTabId = null;
      return;
    }

    if (this.activeInputTabId && this.activeInputTabId !== activeTab.id) {
      const previousTab = this.tabManager?.getTab(this.activeInputTabId);
      if (previousTab) {
        previousTab.dom.contentEl.appendChild(previousTab.dom.inputComposerEl);
      }
    }

    if (this.activeInputTabId === activeTab.id) {
      if (activeTab.dom.inputComposerEl.parentElement !== this.activeInputSlotEl) {
        this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
      }
      return;
    }

    this.activeInputSlotEl.empty();
    this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
    this.activeInputTabId = activeTab.id;
  }

  private updateHomeSurfaceState(activeTab = this.tabManager?.getActiveTab()): void {
    const isHome = !!activeTab
      && activeTab.conversationId === null
      && activeTab.state?.messages?.length === 0;
    this.viewContainerEl?.toggleClass('claudian-home-state', isHome);
    this.viewContainerEl?.toggleClass('claudian-conversation-state', !!activeTab && !isHome);

    // The input footer sits outside individual tab content. Mirror the state
    // there so its navigation row cannot depend on the outer view wrapper.
    this.inputFooterEl?.toggleClass('claudian-home-state', isHome);
    this.inputFooterEl?.toggleClass('claudian-conversation-state', !!activeTab && !isHome);

    for (const tab of this.tabManager?.getAllTabs?.() ?? []) {
      const isActive = tab.id === activeTab?.id;
      tab.dom.contentEl.toggleClass('claudian-home-state', isActive && isHome);
      tab.dom.contentEl.toggleClass(
        'claudian-conversation-state',
        isActive && !!activeTab && !isHome,
      );
    }

    this.updateConversationHeaders();
  }

  private updateConversationHeaders(): void {
    for (const tab of this.tabManager?.getAllTabs?.() ?? []) {
      if (typeof tab.dom?.updateConversationHeader !== 'function') continue;
      const title = tab.conversationId
        ? this.plugin.getConversationSync?.(tab.conversationId)?.title
        : null;
      const isHome = tab.conversationId === null && tab.state.messages?.length === 0;
      tab.dom.updateConversationHeader(
        title?.trim() || t('chat.home.title'),
        isHome,
        tab.conversationId,
      );
    }
  }

  private restoreActiveInputToTabContent(): void {
    if (!this.activeInputTabId) return;

    const activeInputTab = this.tabManager?.getTab(this.activeInputTabId);
    if (activeInputTab) {
      activeInputTab.dom.contentEl.appendChild(activeInputTab.dom.inputComposerEl);
    }
    this.activeInputSlotEl?.empty();
    this.activeInputTabId = null;
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateNewTabButtonVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) return;
    tab.dom.inputEl.focus();
  }

  private updateTabBar(): void {
    // Internal tab state remains available to the runtime, but numbered tab
    // navigation is no longer rendered in the composer.
  }

  private updateTabBarVisibility(): void {
    // Kept as a lifecycle hook for callers that also refresh other controls.
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.setNewButtonAvailability(this.newTabButtonEl, canCreateTab);
  }

  private setNewButtonAvailability(button: HTMLElement | null, isAvailable: boolean): void {
    if (!button) return;

    button.toggleClass('claudian-hidden', !isAvailable);
    if (isAvailable) {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-hidden');
      return;
    }

    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-hidden', 'true');
  }

  /** Sets `data-provider` on the root container so CSS brand color follows the active provider. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
      this.cancelHistoryRendering();
      this.destroyHistorySurface();
      this.historySearchQuery = '';
    } else {
      this.historyDropdown.addClass('visible');
      this.renderHistoryDropdown();
    }
  }

  private historyDropdownDirty = true;
  private historySurfaceRendered = false;
  private pendingHistorySurfaceUpdate: ScheduledAnimationFrame | null = null;

  private updateHistoryDropdown(): void {
    this.historyDropdownDirty = true;
    if (this.historyDropdown?.hasClass('visible')) {
      this.renderHistoryDropdown();
    }
  }

  private scheduleHistorySurfaceUpdate(): void {
    if (this.pendingHistorySurfaceUpdate) return;

    this.pendingHistorySurfaceUpdate = scheduleDelayedFrame(() => {
      this.pendingHistorySurfaceUpdate = null;
      this.updateHistoryDropdown();
    }, HISTORY_SURFACE_REFRESH_DELAY_MS, this.containerEl?.ownerDocument.defaultView ?? null);
  }

  private hasActiveStreamingOrBackgroundWork(): boolean {
    return this.tabManager?.getAllTabs().some(tab => (
      tab.state.isStreaming || tab.session.hasBackgroundWork
    )) ?? false;
  }

  private renderHistoryDropdown(): void {
    if (!this.historyDropdown || !this.historyDropdownDirty) return;

    this.cancelHistoryRendering();
    const abortController = new AbortController();
    this.historyRenderAbortController = abortController;

    const span = this.historySurfaceRendered ? null : StartupProfiler.start('history-list-render');
    this.historySurfaceRendered = true;

    try {
      if (this.viewContainerEl?.hasClass('claudian-home-state')) {
        this.renderHomeHistorySurface(abortController.signal);
      } else {
        this.renderHistorySurfaceWithSearch(abortController.signal);
      }
      this.historyDropdownDirty = false;
    } finally {
      if (span) {
        StartupProfiler.finish(span);
      }
    }
  }

  private renderHomeHistorySurface(signal: AbortSignal): void {
    if (!this.historyDropdown) return;

    if (
      !this.historyListHostEl
      || this.historyListHostEl.parentElement !== this.historyDropdown
      || !this.historyListHostEl.classList.contains('claudian-home-history-list-host')
    ) {
      this.createHistorySearchSurface('claudian-home-history-list-host');
    }

    const historyListHostEl = this.historyListHostEl;
    if (!historyListHostEl) return;

    this.renderHistorySurface(
      historyListHostEl,
      signal,
      {
        showOpenStateActions: false,
        showOpenStateIndicators: false,
        showOpenStateLabels: false,
        searchQuery: this.historySearchQuery,
      },
    );
  }

  private renderHistorySurfaceWithSearch(signal: AbortSignal): void {
    if (!this.historyDropdown) return;

    if (
      !this.historyListHostEl
      || this.historyListHostEl.parentElement !== this.historyDropdown
      || !this.historyListHostEl.classList.contains('claudian-history-list-host')
    ) {
      this.createHistorySearchSurface('claudian-history-list-host');
    }

    const historyListHostEl = this.historyListHostEl;
    if (!historyListHostEl) return;

    this.renderHistorySurface(
      historyListHostEl,
      signal,
      { searchQuery: this.historySearchQuery },
    );
  }

  private createHistorySearchSurface(listHostClass: string): void {
    if (!this.historyDropdown) return;

    this.historySearchRoot?.unmount();
    this.historyDropdown.empty();
    const searchHost = this.historyDropdown.createDiv({
      cls: 'claudian-home-history-search-host',
    });
    this.historySearchRoot = createPreactRoot(searchHost);
    this.historySearchRoot.render(h(HistorySearchView, {
      initialQuery: this.historySearchQuery,
      onQueryChange: (query) => {
        this.historySearchQuery = query;
        this.historyDropdownDirty = true;
        this.renderHistoryDropdown();
      },
    }));
    this.historyListHostEl = this.historyDropdown.createDiv({ cls: listHostClass });
  }

  private destroyHistorySurface(): void {
    this.historySearchRoot?.unmount();
    this.historySearchRoot = null;
    this.historyListHostEl = null;
  }


  private renderHistorySurface(
    container: HTMLElement,
    signal: AbortSignal,
    overrides: {
      searchQuery?: string;
      showOpenStateActions?: boolean;
      showOpenStateIndicators?: boolean;
      showOpenStateLabels?: boolean;
    } = {},
  ): void {
    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;
    if (!conversationController) {
      container.empty();
      return;
    }

    const isArchiveView = this.isArchiveSessionView;
    conversationController.renderHistoryDropdown(container, {
      onSelectConversation: (id) => this.openHistoryConversation(id),
      getConversationStatus: (id) => this.getHistoryConversationStatus(id),
      onRerender: () => this.updateHistoryDropdown(),
      showOpenStateLabels: overrides.showOpenStateLabels ?? false,
      showOpenStateIndicators: overrides.showOpenStateIndicators ?? false,
      showHistoryHeader: false,
      showOpenStateActions: overrides.showOpenStateActions ?? !isArchiveView,
      preserveListState: true,
      onRequestInlineRename: ({ beginRename, conversationId }) => {
        const restoreAndRename = () => {
          if (signal.aborted || this.historyDropdown !== container) return;
          const targetItem = Array.from(
            container.querySelectorAll<HTMLElement>('.claudian-history-item'),
          ).find(item => item.getAttribute('data-conversation-id') === conversationId);
          if (!targetItem) return;

          container.addClass('visible');
          beginRename(targetItem);
        };
        scheduleAnimationFrame(
          restoreAndRename,
          container.ownerDocument.defaultView,
        );
      },
      sessionScope: isArchiveView ? 'archived' : 'active',
      sessionActionMode: isArchiveView ? 'archived' : 'active',
      searchQuery: overrides.searchQuery,
      allowConversationSelection: !isArchiveView,
      onSetConversationPinned: (id: string, isPinned: boolean) => (
        this.setConversationPinned(id, isPinned)
      ),
      onSetConversationArchived: (id: string, isArchived: boolean) => (
        this.setConversationArchived(id, isArchived)
      ),
      onBeforeRestoreListState: (target: HTMLElement) => (
        this.buildHistoryArchiveNavigation(target)
      ),
      signal,
    });
  }

  private handleWorkspaceFileOpen(file: TFile): void {
    this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
  }

  private handleLinkedNoteMetadataChanged(file: TFile | null): void {
    this.tabManager?.getActiveTab()?.ui.fileContextManager
      ?.handleActiveFileMetadataChanged(file);
  }

  private setArchiveSessionView(isArchiveSessionView: boolean): void {
    if (this.isArchiveSessionView === isArchiveSessionView) return;
    this.isArchiveSessionView = isArchiveSessionView;
    this.historyDropdownDirty = true;
    if (this.historyDropdown?.hasClass('visible')) {
      this.renderHistoryDropdown();
    }
  }

  private buildHistoryArchiveNavigation(container: HTMLElement): void {
    const list = container.querySelector<HTMLElement>('.claudian-history-list');
    if (!list) return;

    const label = this.isArchiveSessionView
      ? t('chat.history.sessions')
      : t('chat.history.archive');
    const control = list.createDiv({ cls: 'claudian-history-archive-control' });
    control.setAttribute('role', 'button');
    control.setAttribute('tabindex', '0');
    control.setAttribute('aria-label', label);
    const icon = control.createSpan({ cls: 'claudian-session-nav-icon' });
    setIcon(icon, this.isArchiveSessionView ? 'arrow-left' : 'archive');
    control.createSpan({ cls: 'claudian-session-nav-label', text: label });
    const toggleArchiveView = (): void => {
      this.setArchiveSessionView(!this.isArchiveSessionView);
    };
    control.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleArchiveView();
    });
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      toggleArchiveView();
    });
    list.insertBefore(control, list.firstChild);
  }

  private async setConversationPinned(
    conversationId: string,
    isPinned: boolean,
  ): Promise<void> {
    await this.plugin.setConversationPinned(conversationId, isPinned);
    if (!isPinned) return;

    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      if (tab.conversationId === conversationId) {
        commitProvisionalTab(tab);
      }
    }
  }

  private async setConversationArchived(
    conversationId: string,
    isArchived: boolean,
  ): Promise<void> {
    if (!isArchived) {
      await this.plugin.setConversationArchived(conversationId, false);
      return;
    }

    const openTabs = this.getOpenConversationTabs(conversationId);
    if (openTabs.some(({ tab }) => tab.state.isStreaming)) {
      new Notice(t('chat.errors.runningArchive'));
      return;
    }

    for (const { manager, tab } of openTabs) {
      const didClose = await manager.closeTab(tab.id);
      if (!didClose) {
        throw new Error('Failed to close the session before archiving');
      }
    }
    await this.plugin.setConversationArchived(conversationId, true);
  }

  private getOpenConversationTabs(conversationId: string): Array<{
    manager: FeatureTabManagerHost;
    tab: TabData;
  }> {
    const managers = new Set(
      this.plugin.getAllViews()
        .map(view => view.getTabManager())
        .filter((manager): manager is NonNullable<typeof manager> => manager !== null),
    );
    if (this.tabManager) {
      managers.add(this.tabManager);
    }

    const openTabs: Array<{ manager: FeatureTabManagerHost; tab: TabData }> = [];
    for (const manager of managers) {
      for (const tab of manager.getAllTabs()) {
        if (tab.conversationId === conversationId) {
          openTabs.push({ manager, tab });
        }
      }
    }
    return openTabs;
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    const activeTab = this.tabManager?.getActiveTab();
    const openOptions = activeTab?.state.isStreaming
      ? { preferNewTab: true }
      : undefined;
    await this.tabManager?.openConversation(conversationId, openOptions);
    this.historyDropdown?.removeClass('visible');
    this.cancelHistoryRendering();
  }

  private cancelHistoryRendering(): void {
    this.historyRenderAbortController?.abort();
    this.historyRenderAbortController = null;
    this.historyDropdownDirty = true;
  }

  private getHistoryConversationStatus(conversationId: string): HistoryConversationStatus {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return {
        attention: activeTab.state.attention,
        openState: 'current',
        isRunning: activeTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(activeTab),
      };
    }

    const localTab = this.findTabWithConversation(conversationId);
    if (localTab) {
      return {
        attention: localTab.state.attention,
        openState: 'open',
        isRunning: localTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(localTab),
      };
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      const crossViewTab = crossViewResult.view.getTabManager()?.getTab(crossViewResult.tabId);
      return {
        attention: crossViewTab?.state.attention,
        openState: 'open',
        isRunning: crossViewTab?.state.isStreaming ?? false,
        location: 'other-view',
      };
    }

    return {
      openState: 'closed',
      isRunning: false,
      location: 'current-view',
    };
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  private getHistoryTabIndex(tab: TabData): number | undefined {
    const index = this.tabManager?.getAllTabs().findIndex(candidate => candidate.id === tab.id) ?? -1;
    return index >= 0 ? index + 1 : undefined;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', (event: MouseEvent) => {
      if (event.target && this.historyDropdown?.contains(event.target as Node)) {
        return;
      }
      this.historyDropdown?.removeClass('visible');
    });

    // View-level Shift+Tab cycles the active provider's permission modes.
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey && !e.isComposing) {
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const permissionToggle = activeTab.ui.permissionToggle;
        if (!permissionToggle?.canCycle?.()) return;
        commitProvisionalTab(activeTab);
        if (permissionToggle.cycleMode?.((mode) => {
          const providerId = getTabProviderId(activeTab, this.plugin);
          const currentMode = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
            this.plugin.settings,
            providerId,
          ).permissionMode as string;
          if (mode === 'plan' && currentMode !== 'plan') {
            activeTab.state.prePlanPermissionMode = currentMode;
          }
          void updatePlanModeUI(activeTab, this.plugin, mode, { syncExecution: true })
            .then(() => {
              if (mode !== 'plan') activeTab.state.prePlanPermissionMode = null;
            })
            .catch((error: unknown) => {
              const activeMode = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
                this.plugin.settings,
                providerId,
              ).permissionMode;
              if (activeMode !== 'plan') activeTab.state.prePlanPermissionMode = null;
              new Notice(error instanceof Error ? error.message : 'Failed to change permission mode.');
            });
        })) e.preventDefault();
      }
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab?.controllers.conversationController?.cancelInlineRename()) return false;
      if (this.historyDropdown?.hasClass('visible')) {
        this.toggleHistoryDropdown();
        return false;
      }
      if (!e.defaultPrevented) {
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    this.eventRefs.push(
      this.plugin.app.vault.on('create', () => this.mentionCacheCoordinator?.markStructureDirty()),
      this.plugin.app.vault.on('delete', () => this.mentionCacheCoordinator?.markStructureDirty()),
      this.plugin.app.vault.on('rename', () => this.mentionCacheCoordinator?.markStructureDirty()),
      this.plugin.app.vault.on('modify', () => this.mentionCacheCoordinator?.markFilesDirty())
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.handleWorkspaceFileOpen(file);
        }
      })
    );

    // Metadata changes re-evaluate the auto-linked current note (excluded tags)
    this.registerEvent(
      this.plugin.app.metadataCache.on('changed', (file) => {
        this.handleLinkedNoteMetadataChanged(file);
      })
    );
    this.registerEvent(
      this.plugin.app.metadataCache.on('resolve', (file) => {
        this.handleLinkedNoteMetadataChanged(file);
      })
    );
    this.registerEvent(
      this.plugin.app.metadataCache.on('resolved', () => {
        this.handleLinkedNoteMetadataChanged(null);
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Current tab persistence
  // ============================================

  private async restoreCurrentTab(): Promise<void> {
    if (!this.tabManager) return;

    const persistedState = await this.plugin.storage.getTabManagerState();
    const currentTab = persistedState?.openTabs.find(
      tab => tab.tabId === persistedState.activeTabId,
    );
    if (currentTab) {
      await this.tabManager.createTab(currentTab.conversationId, currentTab.tabId);
      return;
    }

    await this.tabManager.createTab();
  }

  private persistCurrentTabState(): void {
    const state = this.getPersistedCurrentTabState();
    if (state) this.tabStatePersistence?.update(state);
  }

  getPersistedCurrentTabState(): AppTabManagerState | null {
    const activeTab = this.tabManager?.getActiveTab();
    if (!activeTab) return null;

    return {
      openTabs: [{
        tabId: activeTab.id,
        conversationId: activeTab.conversationId,
      }],
      activeTabId: activeTab.id,
    };
  }

  /** Flushes the current tab identity before view or plugin shutdown. */
  async flushCurrentTabState(): Promise<void> {
    const state = this.getPersistedCurrentTabState();
    if (!state || !this.tabStatePersistence) return;
    this.tabStatePersistence.update(state);
    await this.tabStatePersistence.flush();
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Focuses the active tab's composer. */
  focusActiveInput(): void {
    this.tabManager?.getActiveTab()?.dom.inputEl.focus();
  }

  /** Appends text to the active composer without sending it. */
  appendToActiveInput(text: string): boolean {
    const activeTab = this.tabManager?.getActiveTab();
    const inputEl = activeTab?.dom.inputEl;
    if (!inputEl || !text) return false;

    commitProvisionalTab(activeTab);

    const currentValue = inputEl.value;
    const separator = currentValue && !/\s$/.test(currentValue) ? ' ' : '';
    inputEl.value = `${currentValue}${separator}${text}`;

    const cursorPosition = inputEl.value.length;
    inputEl.selectionStart = cursorPosition;
    inputEl.selectionEnd = cursorPosition;

    const EventConstructor = inputEl.ownerDocument.defaultView?.Event ?? Event;
    inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    inputEl.focus();
    return true;
  }

  notifyConversationListChanged(): void {
    // Title generation can finish while the first response is still streaming.
    // Keep the detail header in sync even when history rendering is deferred.
    this.updateConversationHeaders();
    this.refreshWelcomeHomeSurface();
    this.historyDropdownDirty = true;
    if (this.hasActiveStreamingOrBackgroundWork()) {
      if (this.pendingHistorySurfaceUpdate) {
        cancelScheduledAnimationFrame(this.pendingHistorySurfaceUpdate);
        this.pendingHistorySurfaceUpdate = null;
      }
      return;
    }
    this.scheduleHistorySurfaceUpdate();
  }

  /** Refreshes the active home list, whose conversations are supplied lazily. */
  private refreshWelcomeHomeSurface(): void {
    const activeTab = this.tabManager?.getActiveTab?.();
    if (!activeTab || activeTab.state.messages?.length !== 0) return;
    refreshWelcomeContent(activeTab.dom.welcomeEl);
  }

  private notifyConversationNavigationChanged(): void {
    this.updateHistoryDropdown();
    for (const view of this.plugin.getAllViews()) {
      if (view !== this) {
        view.notifyConversationListChanged();
      }
    }
  }

  private notifyConversationRuntimeStateChanged(): void {
    this.refreshConversationRuntimeState();
    for (const view of this.plugin.getAllViews()) {
      if (view !== this) {
        view.refreshConversationRuntimeState();
      }
    }
  }

  /** Refreshes runtime status surfaces immediately without waiting for list debounce. */
  refreshConversationRuntimeState(): void {
    this.updateConversationHeaders();
    this.refreshWelcomeHomeSurface();
    if (this.pendingHistorySurfaceUpdate) {
      cancelScheduledAnimationFrame(this.pendingHistorySurfaceUpdate);
      this.pendingHistorySurfaceUpdate = null;
    }
    this.updateHistoryDropdown();
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Gets shared view controls that should preserve active tab selection context. */
  getSharedSelectionFocusScopeEls(): HTMLElement[] {
    return [
      this.inputNavRowHostEl,
    ].filter((el): el is HTMLElement => el !== null);
  }
}
