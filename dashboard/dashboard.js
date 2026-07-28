/**
 * Tabel - Dashboard Controller
 * Main controller that orchestrates the dashboard UI.
 * Loads data from IndexedDB, renders groups/tabs, handles search and user actions.
 */

import { db } from './lib/db.js';
import { SyncManager } from './lib/sync.js';
import { openSavedTab, openSavedTabs } from './lib/tabRestore.js';
import { acknowledgePendingSweep, getPendingSweeps } from './lib/pendingSweeps.js';
import { acceptPrivacyNotice, hasPrivacyConsent } from './lib/privacyConsent.js';
import { applyAppearance, APPEARANCE_DEFAULTS } from './lib/appearance.js';
import {
  closeCapturedTabs,
  filterCapturableTabs,
  findMostRecentTab,
  toSavedTabRecords
} from './lib/tabCapture.js';
import { createFaviconUrl } from './lib/favicon.js';
import { TabGroup } from './components/TabGroup.js';
import { DragHandler } from './components/DragHandler.js';

const CONTEXT_MENU_GROUPS_KEY = 'tabelContextMenuGroups';

class Dashboard {
  constructor() {
    this.groupComponents = new Map();
    this.dragHandler = null;
    this.sync = null;
    this._searchTimer = null;
    this._renderSig = null; // signature of the last render — skip rebuild if unchanged
    this._privacyConsentPromise = null;
    this._captureTabs = [];
    this._currentCaptureTab = null;
    this._contextMenuGroupSignature = null;
    this._colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    this.settings = {
      ...APPEARANCE_DEFAULTS,
      includePinnedTabs: false,
      includeAudibleTabs: true,
      focusRestoredTab: true
    };
    this._init();
  }

  async _init() {
    this._applyI18n();
    await this._loadThemeSettings();
    this._listenForMessages();
    await this._ensurePrivacyConsent();
    await this._processPendingSweep();
    await this._loadAndRender();
    this._setupDragHandler();
    this._bindEvents();
    await this._setupSync();
  }

  /** Require an explicit privacy acknowledgement before reading tab data. */
  async _ensurePrivacyConsent() {
    if (this._privacyConsentPromise) return this._privacyConsentPromise;

    this._privacyConsentPromise = (async () => {
      try {
        const result = await chrome.storage.local.get('settings');
        if (hasPrivacyConsent(result.settings)) return true;
      } catch (error) {
        console.warn('[Dashboard] Failed to read privacy consent:', error);
      }

      const notice = document.getElementById('privacy-notice');
      const acceptButton = document.getElementById('privacy-accept-btn');
      notice.hidden = false;
      acceptButton.focus();

      return new Promise(resolve => {
        const accept = async () => {
          acceptButton.disabled = true;
          try {
            await acceptPrivacyNotice();
            notice.hidden = true;
            acceptButton.removeEventListener('click', accept);
            resolve(true);
          } catch (error) {
            console.error('[Dashboard] Failed to save privacy consent:', error);
            this._showToast(chrome.i18n.getMessage('privacyConsentError'), 'error');
            acceptButton.disabled = false;
          }
        };

        acceptButton.addEventListener('click', accept);
      });
    })();

    return this._privacyConsentPromise;
  }

  /** Initialize cross-device sync via chrome.storage.sync */
  async _setupSync() {
    this.sync = new SyncManager({
      onRemoteUpdate: () => this._loadAndRender(),
      onError: (key) => this._showToast(chrome.i18n.getMessage(key) || 'Sync error', 'error')
    });
    try {
      await this.sync.init();
    } catch (e) {
      console.error('[Dashboard] Sync init failed:', e);
    }
  }

  /** Apply i18n strings to data-i18n elements */
  _applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.placeholder = msg;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.title = msg;
    });
    document.documentElement.lang = 'en';
    document.title = chrome.i18n.getMessage('dashboardTitle') || 'Tabel Dashboard';
  }

  /** Load theme and custom styling settings from chrome.storage */
  async _loadThemeSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
      this._applyThemeStyles(this.settings);
    } catch (e) {
      console.warn('[Dashboard] Failed to load theme settings:', e);
    }
  }

  /** Apply theme class and CSS variables to documentElement */
  _applyThemeStyles(settings) {
    if (!settings) return;
    this.settings = applyAppearance(
      document.documentElement,
      settings,
      this._colorSchemeQuery.matches
    );
  }

  /** Check extension-local storage for pending sweep data */
  async _processPendingSweep() {
    try {
      const pendingSweeps = await getPendingSweeps();

      let savedCount = 0;
      let contextSavedCount = 0;
      let failedCount = 0;
      for (const pending of pendingSweeps) {
        try {
          let processedCount;
          if (pending.destinationGroupId) {
            const result = await db.addTabsToGroup(
              pending.destinationGroupId,
              pending.tabs
            );
            processedCount = result.addedCount;
          } else {
            await db.createGroup(pending.groupName, pending.tabs, {
              sourceSweepId: pending.id,
              width: this.settings.defaultGroupWidth
            });
            processedCount = toSavedTabRecords(pending.tabs).length;
          }
          await acknowledgePendingSweep(pending.id);
          if (pending.source === 'contextMenu') {
            contextSavedCount += processedCount;
          } else {
            savedCount += processedCount;
          }
        } catch (error) {
          failedCount++;
          console.error('[Dashboard] Failed to process pending sweep:', pending.id, error);
        }
      }

      if (savedCount > 0) {
        this._showToast(
          chrome.i18n.getMessage('sweepNotification', [savedCount.toString()]),
          'success'
        );
        this.sync?.schedulePush();
      }
      if (contextSavedCount > 0) {
        this._showToast(
          chrome.i18n.getMessage('saveTabsSuccess', [String(contextSavedCount)]),
          'success'
        );
        this.sync?.schedulePush();
      }
      if (failedCount > 0) {
        this._showToast(chrome.i18n.getMessage('pendingSweepError'), 'error');
      }
    } catch (e) {
      console.error('[Dashboard] Pending sweep check failed:', e);
      this._showToast(chrome.i18n.getMessage('pendingSweepError'), 'error');
    }
  }

  /** Load all data from IndexedDB and render the UI */
  async _loadAndRender(filterQuery = '') {
    const container = document.getElementById('groups-container');
    const emptyState = document.getElementById('empty-state');

    // Gather each group's (optionally filtered) tabs up front, so we can tell
    // whether anything actually changed before touching the DOM.
    const groups = await db.getAllGroups();
    await this._cacheContextMenuGroups(groups);
    const toRender = [];
    for (const group of groups) {
      let tabs = await db.getTabsByGroup(group.id);
      if (filterQuery) {
        const q = filterQuery.toLowerCase();
        tabs = tabs.filter(t =>
          t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)
        );
        if (tabs.length === 0) continue; // skip groups with no matching tabs
      }
      toRender.push({ group, tabs });
    }

    // Skip the visible rebuild when the data is identical to the last render —
    // this is what stops the dashboard from flashing on repeated render calls.
    const sig = this._renderSignature(filterQuery, toRender);
    if (sig === this._renderSig) return;
    this._renderSig = sig;

    // Update stats
    const counts = await db.getCounts();
    document.getElementById('stat-tabs').textContent = counts.tabs;
    document.getElementById('stat-groups').textContent = counts.groups;

    // Clear previous renders
    container.innerHTML = '';
    this.groupComponents.clear();

    if (toRender.length === 0) {
      emptyState.style.display = 'flex';
      container.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    container.style.display = 'flex';

    // Use DocumentFragment for performance
    const fragment = document.createDocumentFragment();

    for (const { group, tabs } of toRender) {
      const callbacks = {
        onRestoreTab: (data) => this._restoreTab(data),
        onDeleteTab: (data) => this._deleteTab(data),
        onUpdateTab: (id, updates) => this._updateTab(id, updates),
        onUpdateGroup: (id, updates) => this._updateGroup(id, updates),
        onDeleteGroup: (id) => this._deleteGroup(id),
        onRestoreAll: (urls, groupId) => this._restoreAll(urls, groupId)
      };

      const groupComponent = new TabGroup(group, tabs, callbacks);
      fragment.appendChild(groupComponent.render());
      this.groupComponents.set(group.id, groupComponent);
    }

    container.appendChild(fragment);
  }

  /** Build a compact signature of what would be rendered, to detect no-op renders. */
  _renderSignature(filterQuery, toRender) {
    const parts = toRender.map(({ group, tabs }) =>
      [group.id, group.name, group.order, group.collapsed, group.locked, group.width, group.bgColor,
        tabs.map(t => `${t.id}:${t.order}:${t.title}:${t.url}`).join('|')
      ].join('~')
    );
    return filterQuery + '#' + parts.join('§');
  }

  /** Set up drag and drop handler */
  _setupDragHandler() {
    const container = document.getElementById('groups-container');
    this.dragHandler = new DragHandler(container, {
      onTabMoved: async (tabId, targetGroupId, newOrder, orders = {}) => {
        // Find the source group before the move
        const tab = await db.getTab(tabId);
        const sourceGroupId = tab?.groupId;

        await db.moveTab(tabId, targetGroupId, newOrder);
        await db.reorderTabs(targetGroupId, orders.targetTabIds || []);
        if (sourceGroupId && sourceGroupId !== targetGroupId) {
          await db.reorderTabs(sourceGroupId, orders.sourceTabIds || []);
        }

        // Check if source group is now empty → auto-delete
        if (sourceGroupId && sourceGroupId !== targetGroupId) {
          const remaining = await db.getTabsByGroup(sourceGroupId);
          if (remaining.length === 0) {
            await db.deleteGroup(sourceGroupId);
          }
        }

        // Rebuild so component data and group counts match the persisted move.
        this._renderSig = null;
        await this._loadAndRender();
        this.sync?.schedulePush();
      },
      onTabsReordered: async (groupId, tabIds) => {
        await db.reorderTabs(groupId, tabIds);
        this.sync?.schedulePush();
      },
      onGroupsReordered: async (groupIds) => {
        await db.reorderGroups(groupIds);
        await this._cacheContextMenuGroups(await db.getAllGroups());
        this.sync?.schedulePush();
      }
    });
  }

  /** Bind UI event handlers */
  _bindEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._loadAndRender(e.target.value.trim());
      }, 250);
    });

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('save-tabs-btn').addEventListener('click', () => {
      this._openSaveTabsDialog();
    });
    document.getElementById('save-tabs-close').addEventListener('click', () => {
      document.getElementById('save-tabs-dialog').close();
    });
    document.getElementById('save-tabs-cancel').addEventListener('click', () => {
      document.getElementById('save-tabs-dialog').close();
    });
    document.getElementById('save-tabs-scope').addEventListener('change', () => {
      this._updateSaveTabsScope();
    });
    document.getElementById('save-tabs-destination').addEventListener('change', (event) => {
      const isNewGroup = event.target.value === '__new__';
      document.getElementById('save-tabs-name-row').hidden = !isNewGroup;
      document.getElementById('save-tabs-group-name').required = isNewGroup;
    });
    document.getElementById('save-tabs-select-all').addEventListener('click', () => {
      const checkboxes = [...document.querySelectorAll('#save-tabs-list input[type="checkbox"]')];
      const shouldSelect = checkboxes.some(checkbox => !checkbox.checked);
      checkboxes.forEach(checkbox => { checkbox.checked = shouldSelect; });
      this._updateSelectedTabCount();
    });
    document.getElementById('save-tabs-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this._saveCapturedTabs();
    });
    document.getElementById('save-tabs-dialog').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });

    this._colorSchemeQuery.addEventListener('change', () => {
      if (this.settings.theme === 'system') this._applyThemeStyles(this.settings);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+F → Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      // Escape → Clear search
      if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.value = '';
        this._loadAndRender();
        searchInput.blur();
      }
    });
  }

  async _openSaveTabsDialog() {
    const dialog = document.getElementById('save-tabs-dialog');
    const submitButton = document.getElementById('save-tabs-submit');
    submitButton.disabled = true;

    try {
      const [openTabs, groups, dashboardTab] = await Promise.all([
        chrome.tabs.query({}),
        db.getAllGroups(),
        chrome.tabs.getCurrent()
      ]);

      this._captureTabs = filterCapturableTabs(openTabs, this.settings);
      const currentWindowTabs = this._captureTabs.filter(
        tab => tab.windowId === dashboardTab?.windowId
      );
      this._currentCaptureTab = findMostRecentTab(currentWindowTabs);

      this._renderCaptureDestinations(groups);
      this._renderOpenTabSelection();

      const dateLabel = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date());
      document.getElementById('save-tabs-group-name').value =
        chrome.i18n.getMessage('savedGroupDefaultName', [dateLabel]) || `Saved ${dateLabel}`;
      document.getElementById('save-tabs-scope').value = 'current';
      this._updateSaveTabsScope();

      if (!dialog.open) dialog.showModal();
    } catch (error) {
      console.error('[Dashboard] Failed to prepare tab capture:', error);
      this._showToast(chrome.i18n.getMessage('saveTabsError'), 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  _renderCaptureDestinations(groups) {
    const destination = document.getElementById('save-tabs-destination');
    destination.replaceChildren();

    const newGroupOption = document.createElement('option');
    newGroupOption.value = '__new__';
    newGroupOption.textContent = chrome.i18n.getMessage('saveTabsNewGroup') || 'New group';
    destination.appendChild(newGroupOption);

    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.locked
        ? `${group.name} (${chrome.i18n.getMessage('locked') || 'Locked'})`
        : group.name;
      option.disabled = group.locked === true;
      destination.appendChild(option);
    }

    destination.value = '__new__';
    document.getElementById('save-tabs-name-row').hidden = false;
    document.getElementById('save-tabs-group-name').required = true;
  }

  _renderOpenTabSelection() {
    const list = document.getElementById('save-tabs-list');
    list.replaceChildren();

    for (const tab of this._captureTabs) {
      const label = document.createElement('label');
      label.className = 'save-tabs-list__item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(tab.id);
      checkbox.checked = tab.highlighted === true;
      checkbox.addEventListener('change', () => this._updateSelectedTabCount());

      const favicon = document.createElement('img');
      favicon.className = 'save-tabs-list__favicon';
      favicon.src = createFaviconUrl(chrome.runtime, tab.url);
      favicon.alt = '';
      favicon.addEventListener('error', () => {
        favicon.src = '../icons/icon16.png';
      }, { once: true });

      const content = document.createElement('span');
      content.className = 'save-tabs-list__content';

      const title = document.createElement('span');
      title.className = 'save-tabs-list__title';
      title.textContent = tab.title || tab.url;

      const url = document.createElement('span');
      url.className = 'save-tabs-list__url';
      url.textContent = tab.url;

      content.append(title, url);
      label.append(checkbox, favicon, content);
      list.appendChild(label);
    }

    this._updateSelectedTabCount();
  }

  _updateSelectedTabCount() {
    const checkboxes = [...document.querySelectorAll('#save-tabs-list input[type="checkbox"]')];
    const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    document.getElementById('save-tabs-selection-count').textContent =
      chrome.i18n.getMessage('selectedTabCount', [String(selectedCount)]) ||
      `${selectedCount} selected`;
    document.getElementById('save-tabs-select-all').textContent = chrome.i18n.getMessage(
      selectedCount === checkboxes.length && checkboxes.length > 0 ? 'clearAll' : 'selectAll'
    );
  }

  _updateSaveTabsScope() {
    const scope = document.getElementById('save-tabs-scope').value;
    const selection = document.getElementById('save-tabs-selection');
    const current = document.getElementById('save-tabs-current');
    selection.hidden = scope !== 'selected';

    if (scope === 'current') {
      current.hidden = false;
      current.textContent = this._currentCaptureTab
        ? (this._currentCaptureTab.title || this._currentCaptureTab.url)
        : chrome.i18n.getMessage('noCapturableTabs');
    } else if (scope === 'all') {
      current.hidden = false;
      current.textContent = chrome.i18n.getMessage(
        'openTabCount',
        [String(this._captureTabs.length)]
      );
    } else {
      current.hidden = true;
    }
  }

  _getTabsForSelectedScope() {
    const scope = document.getElementById('save-tabs-scope').value;
    if (scope === 'current') return this._currentCaptureTab ? [this._currentCaptureTab] : [];
    if (scope === 'all') return this._captureTabs;

    const selectedIds = new Set(
      [...document.querySelectorAll('#save-tabs-list input[type="checkbox"]:checked')]
        .map(checkbox => Number(checkbox.value))
    );
    return this._captureTabs.filter(tab => selectedIds.has(tab.id));
  }

  async _saveCapturedTabs() {
    const submitButton = document.getElementById('save-tabs-submit');
    const destination = document.getElementById('save-tabs-destination').value;
    const capturedBrowserTabs = this._getTabsForSelectedScope();
    const tabs = toSavedTabRecords(capturedBrowserTabs);

    if (tabs.length === 0) {
      this._showToast(chrome.i18n.getMessage('noTabsSelected'), 'error');
      return;
    }

    submitButton.disabled = true;
    try {
      let addedCount = tabs.length;
      if (destination === '__new__') {
        const nameInput = document.getElementById('save-tabs-group-name');
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        await db.createGroup(name, tabs, { width: this.settings.defaultGroupWidth });
      } else {
        const result = await db.addTabsToGroup(destination, tabs);
        addedCount = result.addedCount;
      }

      document.getElementById('save-tabs-dialog').close();
      const closeResult = await closeCapturedTabs(chrome.tabs, capturedBrowserTabs);
      this._renderSig = null;
      try {
        await this._loadAndRender();
      } catch (renderError) {
        console.warn('[Dashboard] Saved tabs but failed to refresh the view:', renderError);
      }
      this.sync?.schedulePush();
      if (closeResult.failedCount > 0) {
        this._showToast(
          chrome.i18n.getMessage('saveTabsCloseError', [String(closeResult.failedCount)]),
          'error'
        );
      } else {
        this._showToast(
          chrome.i18n.getMessage('saveTabsSuccess', [String(addedCount)]),
          'success'
        );
      }
    } catch (error) {
      console.error('[Dashboard] Failed to save open tabs:', error);
      this._showToast(chrome.i18n.getMessage('saveTabsError'), 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  async _cacheContextMenuGroups(groups = null) {
    try {
      const currentGroups = groups || await db.getAllGroups();
      const summaries = currentGroups.map(group => ({
        id: group.id,
        name: group.name,
        locked: group.locked === true,
        order: Number(group.order) || 0
      }));
      const signature = JSON.stringify(summaries);
      if (signature === this._contextMenuGroupSignature) return;

      await chrome.storage.local.set({
        [CONTEXT_MENU_GROUPS_KEY]: summaries
      });
      this._contextMenuGroupSignature = signature;
    } catch (error) {
      console.warn('[Dashboard] Failed to update context menu groups:', error);
    }
  }

  /** Listen for messages from background script or options page */
  _listenForMessages() {
    // Keep this listener synchronous (no async/Promise return) so Chrome doesn't
    // hold the message channel open expecting a response we never send.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'REFRESH') {
        // Process any pending sweep data first (sweep from another window), then re-render.
        this._ensurePrivacyConsent()
          .then(() => this._processPendingSweep())
          .then(() => this._loadAndRender());
      } else if (msg.type === 'SHOW_PRIVACY_NOTICE') {
        this._ensurePrivacyConsent();
      } else if (msg.type === 'SETTINGS_CHANGED') {
        // Apply theme/custom styling changes dynamically in real-time
        this.settings = { ...this.settings, ...msg.settings };
        this._applyThemeStyles(this.settings);
      } else if (msg.type === 'DATA_CHANGED') {
        this._ensurePrivacyConsent().then(() => {
          this._renderSig = null;
          this._loadAndRender();
        });
      }
    });
  }

  // ─── Tab Actions ───────────────────────────────────────────

  async _restoreTab(data) {
    try {
      await openSavedTab(
        chrome.runtime,
        data.url,
        this.settings.focusRestoredTab !== false
      );
    } catch (e) {
      console.error('[Dashboard] Failed to open tab:', data.url, e);
      return; // Don't delete if the tab failed to open
    }
    await this._deleteTab(data);
  }

  async _deleteTab(data) {
    await db.deleteTab(data.id);

    // Remove from DOM
    const el = document.querySelector(`[data-tab-id="${data.id}"]`);
    if (el) el.remove();

    // Update group count
    const group = this.groupComponents.get(data.groupId);
    if (group) {
      const remainingTabs = await db.getTabsByGroup(data.groupId);
      group.updateCount(remainingTabs.length);

      // If group is now empty, remove it
      if (remainingTabs.length === 0) {
        await this._deleteGroup(data.groupId);
      }
    }

    await this._updateStats();
    this.sync?.schedulePush();
  }

  async _updateTab(tabId, updates) {
    await db.updateTab(tabId, updates);
    this.sync?.schedulePush();
  }

  // ─── Group Actions ─────────────────────────────────────────

  async _updateGroup(groupId, updates) {
    await db.updateGroup(groupId, updates);
    await this._cacheContextMenuGroups();
    this.sync?.schedulePush();
  }

  async _deleteGroup(groupId) {
    await db.deleteGroup(groupId);
    await this._cacheContextMenuGroups();

    // Remove from DOM
    const el = document.querySelector(`[data-group-id="${groupId}"]`);
    if (el) el.remove();
    this.groupComponents.delete(groupId);

    await this._updateStats();
    this.sync?.schedulePush();

    // Check if empty
    const counts = await db.getCounts();
    if (counts.groups === 0) {
      document.getElementById('empty-state').style.display = 'flex';
      document.getElementById('groups-container').style.display = 'none';
    }
  }

  async _restoreAll(urls, groupId) {
    try {
      await openSavedTabs(chrome.runtime, urls);
    } catch (e) {
      console.error('[Dashboard] Failed to open tabs:', e);
      return; // Don't delete if the tabs failed to open
    }
    await this._deleteGroup(groupId);
  }

  // ─── Utilities ─────────────────────────────────────────────

  async _updateStats() {
    const counts = await db.getCounts();
    document.getElementById('stat-tabs').textContent = counts.tabs;
    document.getElementById('stat-groups').textContent = counts.groups;
  }

  _showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--hiding');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 3000);
  }
}

// Initialize
new Dashboard();
