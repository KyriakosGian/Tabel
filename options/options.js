/**
 * Tabel - Options Page Controller
 * Manages settings persistence via chrome.storage.local.
 * Handles export/import of tab data via IndexedDB.
 */

import { db } from '../dashboard/lib/db.js';
import { SyncManager, SYNC_STATUS_KEY } from '../dashboard/lib/sync.js';
import {
  applyAppearance,
  APPEARANCE_DEFAULTS,
  normalizeAppearance
} from '../dashboard/lib/appearance.js';

const CONTEXT_MENU_GROUPS_KEY = 'tabelContextMenuGroups';

class OptionsController {
  constructor() {
    this.settings = {
      ...APPEARANCE_DEFAULTS,
      keepOpenOnStartup: true,
      includePinnedTabs: false,
      includeAudibleTabs: true,
      focusRestoredTab: true
    };
    this._colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    this.sync = new SyncManager();
    this._init();
  }

  async _init() {
    this._applyI18n();
    await this._loadSettings();
    await this._loadStatistics();
    await this._loadSyncStatus();
    this._bindEvents();
  }

  /** Apply i18n */
  _applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    });
    document.documentElement.lang = 'en';
    document.title = chrome.i18n.getMessage('settingsTitle') || 'Tabel Settings';
    document.getElementById('app-version').textContent = `Tabel v${chrome.runtime.getManifest().version}`;
  }

  /** Load settings from storage */
  async _loadSettings() {
    const result = await chrome.storage.local.get('settings');
    if (result.settings) {
      this.settings = { ...this.settings, ...result.settings };
    }

    // Apply to UI
    this.settings = normalizeAppearance(this.settings);
    this._syncAppearanceControls();
    document.getElementById('setting-startup').checked = this.settings.keepOpenOnStartup ?? true;
    document.getElementById('setting-focus-restored-tab').checked =
      this.settings.focusRestoredTab ?? true;
    document.getElementById('setting-include-pinned-tabs').checked =
      this.settings.includePinnedTabs === true;
    document.getElementById('setting-include-audible-tabs').checked =
      this.settings.includeAudibleTabs !== false;

    // Apply styles to options page itself
    this._applyStyles();
  }

  /** Save settings to storage */
  async _saveSettings() {
    await chrome.storage.local.set({ settings: this.settings });
    this._applyStyles();

    // Broadcast setting changes for real-time sync with dashboard.
    // .catch swallows the rejection when no dashboard page is open to receive it.
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', settings: this.settings }).catch(() => {});

    this._showToast(chrome.i18n.getMessage('settingsSaved') || 'Settings saved!');
  }

  /** Apply styling variables to DocumentElement */
  _applyStyles() {
    this.settings = applyAppearance(
      document.documentElement,
      this.settings,
      this._colorSchemeQuery.matches
    );
    this._updateAppearancePreview();
  }

  _syncAppearanceControls() {
    document.getElementById('setting-theme').value = this.settings.theme;
    document.getElementById('setting-density').value = this.settings.density;
    document.getElementById('setting-default-group-width').value =
      String(this.settings.defaultGroupWidth);
    document.getElementById('setting-tab-url-mode').value = this.settings.tabUrlMode;
    document.getElementById('setting-bg-opacity').value = this.settings.customCardOpacity;
    document.getElementById('bg-opacity-val').textContent =
      `${this.settings.customCardOpacity}%`;
    document.getElementById('setting-font-scale').value = this.settings.fontScale;
    document.getElementById('font-scale-val').textContent = `${this.settings.fontScale}%`;
    document.getElementById('setting-favicon-size').value = this.settings.faviconSize;
    document.getElementById('favicon-size-val').textContent =
      `${this.settings.faviconSize} px`;
  }

  _updateAppearancePreview() {
    const preview = document.getElementById('appearance-preview');
    preview.dataset.density = this.settings.density;
    preview.dataset.tabUrlMode = this.settings.tabUrlMode;
  }

  /** Bind all event handlers */
  _bindEvents() {
    // Theme
    document.getElementById('setting-theme').addEventListener('change', (e) => {
      this.settings.theme = e.target.value;
      this._saveSettings();
    });
    document.getElementById('setting-density').addEventListener('change', (e) => {
      this.settings.density = e.target.value;
      this._saveSettings();
    });
    document.getElementById('setting-default-group-width').addEventListener('change', (e) => {
      this.settings.defaultGroupWidth = Number(e.target.value);
      this._saveSettings();
    });
    document.getElementById('setting-tab-url-mode').addEventListener('change', (e) => {
      this.settings.tabUrlMode = e.target.value;
      this._saveSettings();
    });

    // Card Opacity Slider
    const opacityInput = document.getElementById('setting-bg-opacity');
    const opacityValSpan = document.getElementById('bg-opacity-val');
    opacityInput.addEventListener('input', (e) => {
      opacityValSpan.textContent = e.target.value + '%';
      this.settings.customCardOpacity = parseInt(e.target.value, 10);
      this._applyStyles();
    });
    opacityInput.addEventListener('change', (e) => {
      this.settings.customCardOpacity = parseInt(e.target.value, 10);
      this._saveSettings();
    });

    const fontInput = document.getElementById('setting-font-scale');
    fontInput.addEventListener('input', (e) => {
      this.settings.fontScale = parseInt(e.target.value, 10);
      document.getElementById('font-scale-val').textContent = `${e.target.value}%`;
      this._applyStyles();
    });
    fontInput.addEventListener('change', () => this._saveSettings());

    const faviconInput = document.getElementById('setting-favicon-size');
    faviconInput.addEventListener('input', (e) => {
      this.settings.faviconSize = parseInt(e.target.value, 10);
      document.getElementById('favicon-size-val').textContent = `${e.target.value} px`;
      this._applyStyles();
    });
    faviconInput.addEventListener('change', () => this._saveSettings());

    document.getElementById('btn-reset-appearance').addEventListener('click', async () => {
      this.settings = { ...this.settings, ...APPEARANCE_DEFAULTS };
      this._syncAppearanceControls();
      await this._saveSettings();
    });

    // Startup toggle
    document.getElementById('setting-startup').addEventListener('change', (e) => {
      this.settings.keepOpenOnStartup = e.target.checked;
      this._saveSettings();
    });

    document.getElementById('setting-include-pinned-tabs').addEventListener('change', (e) => {
      this.settings.includePinnedTabs = e.target.checked;
      this._saveSettings();
    });

    document.getElementById('setting-include-audible-tabs').addEventListener('change', (e) => {
      this.settings.includeAudibleTabs = e.target.checked;
      this._saveSettings();
    });

    document.getElementById('setting-focus-restored-tab').addEventListener('change', (e) => {
      this.settings.focusRestoredTab = e.target.checked;
      this._saveSettings();
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => this._exportData());

    // Import
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) this._importData(e.target.files[0]);
    });

    // Delete All
    document.getElementById('btn-delete-all').addEventListener('click', () => this._deleteAll());

    // Refresh the overview when the user returns from the Dashboard.
    window.addEventListener('focus', () => {
      this._loadStatistics();
      this._loadSyncStatus();
    });
    this._colorSchemeQuery.addEventListener('change', () => {
      if (this.settings.theme === 'system') this._applyStyles();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SYNC_STATUS_KEY]) this._loadSyncStatus();
    });
  }

  /** Export all data to JSON file */
  async _exportData() {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `tabel-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();

      URL.revokeObjectURL(url);
      this._showToast(chrome.i18n.getMessage('exportSuccess') || 'Exported successfully!');
    } catch (e) {
      console.error('[Options] Export failed:', e);
      this._showToast(chrome.i18n.getMessage('exportError') || 'Export failed.', 'error');
    }
  }

  /** Import data from JSON file */
  async _importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data.groups) || !Array.isArray(data.items)) {
        throw new Error('Invalid format');
      }

      await db.importAll(data);
      const synced = await this._syncDataAndRefresh();
      await this._loadStatistics();
      this._showToast(
        chrome.i18n.getMessage(synced ? 'importSuccess' : 'syncQuotaError'),
        synced ? 'success' : 'error'
      );
    } catch (e) {
      console.error('[Options] Import failed:', e);
      this._showToast(chrome.i18n.getMessage('importError') || 'Import failed.', 'error');
    } finally {
      document.getElementById('import-file').value = '';
    }
  }

  /** Delete all data */
  async _deleteAll() {
    const msg = chrome.i18n.getMessage('confirmDeleteAll') || 'Are you sure you want to delete ALL data?';
    if (!confirm(msg)) return;

    try {
      await db.clearAll();
      const synced = await this._syncDataAndRefresh();
      await this._loadStatistics();
      this._showToast(
        chrome.i18n.getMessage(synced ? 'deleteAllSuccess' : 'syncQuotaError'),
        synced ? 'success' : 'error'
      );
    } catch (e) {
      console.error('[Options] Delete all failed:', e);
      this._showToast(chrome.i18n.getMessage('deleteAllError') || 'Error deleting data.', 'error');
    }
  }

  async _syncDataAndRefresh() {
    const groups = await db.getAllGroups();
    await chrome.storage.local.set({
      [CONTEXT_MENU_GROUPS_KEY]: groups.map(group => ({
        id: group.id,
        name: group.name,
        locked: group.locked === true,
        order: Number(group.order) || 0
      }))
    });
    const synced = await this.sync.pushNow();
    chrome.runtime.sendMessage({ type: 'DATA_CHANGED' }).catch(() => {});
    return synced;
  }

  /** Load a compact local overview without sending analytics anywhere. */
  async _loadStatistics() {
    try {
      const [counts, groups] = await Promise.all([
        db.getCounts(),
        db.getAllGroups()
      ]);
      const average = counts.groups > 0
        ? (counts.tabs / counts.groups).toFixed(1)
        : '0';
      const validDates = groups
        .map(group => Number(group.createdAt))
        .filter(Number.isFinite);
      const oldestTimestamp = validDates.length > 0
        ? Math.min(...validDates)
        : null;
      const oldest = oldestTimestamp
        ? new Intl.DateTimeFormat('en', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
          }).format(new Date(oldestTimestamp))
        : '—';

      document.getElementById('settings-stat-tabs').textContent = counts.tabs;
      document.getElementById('settings-stat-groups').textContent = counts.groups;
      document.getElementById('settings-stat-average').textContent = average;
      document.getElementById('settings-stat-oldest').textContent = oldest;
    } catch (error) {
      console.warn('[Options] Failed to load statistics:', error);
    }
  }

  async _loadSyncStatus() {
    try {
      const [local, bytesInUse] = await Promise.all([
        chrome.storage.local.get(SYNC_STATUS_KEY),
        chrome.storage.sync.getBytesInUse(null)
      ]);
      const lastSuccessfulSyncAt = Number(
        local[SYNC_STATUS_KEY]?.lastSuccessfulSyncAt
      );
      const lastSync = lastSuccessfulSyncAt > 0
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
          }).format(new Date(lastSuccessfulSyncAt))
        : (chrome.i18n.getMessage('settingsSyncNotYet') || 'Not yet');

      const quotaBytes = Number(chrome.storage.sync.QUOTA_BYTES) || 102400;
      const usedBytes = Math.max(0, Number(bytesInUse) || 0);
      const percent = Math.min(100, (usedBytes / quotaBytes) * 100);
      const formatKb = bytes => {
        const value = bytes / 1024;
        return value >= 10 ? value.toFixed(0) : value.toFixed(1);
      };

      document.getElementById('settings-last-sync').textContent = lastSync;
      document.getElementById('settings-sync-quota').textContent =
        `${formatKb(usedBytes)} KB / ${formatKb(quotaBytes)} KB`;
      document.getElementById('settings-sync-quota-fill').style.width = `${percent.toFixed(1)}%`;
      const meter = document.getElementById('settings-sync-quota-meter');
      meter.setAttribute('aria-valuenow', percent.toFixed(1));
      meter.title = `${percent.toFixed(1)}%`;
    } catch (error) {
      console.warn('[Options] Failed to load sync status:', error);
    }
  }

  /** Show toast notification */
  _showToast(message, type = 'success') {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastIn 0.25s ease-in reverse forwards';
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2500);
  }

}

// Initialize
new OptionsController();
