/**
 * Tabel - Options Page Controller
 * Manages settings persistence via chrome.storage.local.
 * Handles export/import of tab data via IndexedDB.
 */

import { db } from '../dashboard/lib/db.js';
import { validateData } from '../dashboard/lib/validateData.js';
import { SyncManager, SYNC_STATUS_KEY } from '../dashboard/lib/sync.js';
import { createBackup, latestBackup, verifyBackup } from '../dashboard/lib/backups.js';
import { checksum, readConfig, snapshotData, SYNC_CONFIG_KEY, SyncError, syncErrorCode } from '../dashboard/lib/syncCommon.js';
import { confirmAction } from './confirmation.js';
import {
  applyAppearance,
  APPEARANCE_DEFAULTS,
  normalizeAppearance
} from '../dashboard/lib/appearance.js';

const CONTEXT_MENU_GROUPS_KEY = 'tabelContextMenuGroups';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

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
    this._busy = false;
    this._init();
  }

  async _init() {
    this._applyI18n();
    await this._loadSettings();
    await this._loadStatistics();
    await this._loadSyncStatus();
    this._bindEvents();
    await this._loadBackupStatus();
    await this.sync.init();
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
      if (e.target.files[0]) this._runAction(() => this._importData(e.target.files[0]));
    });

    // Delete All
    document.getElementById('btn-delete-all').addEventListener('click', () => this._runAction(() => this._deleteAll()));
    document.getElementById('setting-sync-provider').addEventListener('change', event =>
      this._runAction(() => this._changeProvider(event.target.value)));
    document.getElementById('btn-sync-now').addEventListener('click', () => this._runAction(async () => {
      if (!await this.sync.syncNow()) throw new SyncError(this.sync.lastError || 'syncOperationError');
      this._showToast(chrome.i18n.getMessage('syncComplete'));
    }));
    document.getElementById('btn-clean-sync').addEventListener('click', () => this._runAction(async () => {
      await this.sync.cleanUnused();
      this._showToast(chrome.i18n.getMessage('syncCleanupComplete'));
    }));
    document.getElementById('btn-reset-cloud').addEventListener('click', () => this._runAction(() => this._resetCloud()));
    document.getElementById('btn-clear-chrome').addEventListener('click', () => this._runAction(async () => {
      if (!await confirmAction({
        title: chrome.i18n.getMessage('settingsClearChromeCloud'),
        description: chrome.i18n.getMessage('clearChromeReview'),
        phrase: 'CLEAR', checkboxLabel: chrome.i18n.getMessage('clearChromeAcknowledgement'),
        actionLabel: chrome.i18n.getMessage('settingsClearChromeCloud')
      })) return;
      await this.sync.clearChromeCloud();
      this._showToast(chrome.i18n.getMessage('chromeCloudCleared'));
    }));
    document.getElementById('btn-adopt-cloud').addEventListener('click', () => this._runAction(() => this._adoptCloud()));
    document.getElementById('btn-restore-backup').addEventListener('click', () => this._runAction(() => this._restoreBackup()));
    document.getElementById('btn-clear-backups').addEventListener('click', () => this._runAction(async () => {
      if (!await confirmAction({
        title: chrome.i18n.getMessage('settingsClearBackups'),
        description: chrome.i18n.getMessage('clearBackupsReview'),
        phrase: 'DELETE', actionLabel: chrome.i18n.getMessage('settingsClearBackups')
      })) return;
      const config = await readConfig();
      if (config.chromeRecovery) throw new SyncError('syncRecoveryPending');
      await db.clearBackups();
    }));

    // Refresh the overview when the user returns from the Dashboard.
    window.addEventListener('focus', () => {
      this._loadStatistics();
      this._loadSyncStatus();
      this._loadBackupStatus();
    });
    this._colorSchemeQuery.addEventListener('change', () => {
      if (this.settings.theme === 'system') this._applyStyles();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[SYNC_STATUS_KEY] || changes[SYNC_CONFIG_KEY])) this._loadSyncStatus();
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
      if (!file || file.size > MAX_IMPORT_BYTES) throw new Error('Import file is too large');
      const text = await file.text();
      const data = JSON.parse(text);

      validateData(data);
      const current = await db.exportAll();
      if (!await confirmAction({
        title: chrome.i18n.getMessage('settingsImport'),
        description: chrome.i18n.getMessage('confirmImport'),
        actionLabel: chrome.i18n.getMessage('settingsImport')
      })) return;

      const backup = await createBackup('before-import');
      await this._requireUnchanged(current, backup.data);
      await db.importAll(data, { expectedCurrent: backup.data });
      const synced = await this._syncDataAndRefresh();
      await this._loadStatistics();
      this._showToast(
        chrome.i18n.getMessage(synced ? 'importSuccess' : 'localSavedSyncPending'),
        synced ? 'success' : 'error'
      );
    } catch (e) {
      throw e;
    } finally {
      document.getElementById('import-file').value = '';
    }
  }

  /** Delete all data */
  async _deleteAll() {
    const current = await db.exportAll();
    if (!await confirmAction({
      title: chrome.i18n.getMessage('deleteAll'),
      description: chrome.i18n.getMessage('deleteAllReview', [String(current.groups.length), String(current.items.length)]),
      phrase: 'DELETE', actionLabel: chrome.i18n.getMessage('deleteAll')
    })) return;
      const backup = await createBackup('before-delete-all');
      await this._requireUnchanged(current, backup.data);
      await db.clearAll({ expectedCurrent: backup.data });
      const synced = await this._syncDataAndRefresh();
      await this._loadStatistics();
      this._showToast(
        chrome.i18n.getMessage(synced ? 'deleteAllSuccess' : 'localDeletedSyncPending'),
        synced ? 'success' : 'error'
      );
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

  async _runAction(action) {
    if (this._busy) return;
    this._busy = true;
    const controls = document.querySelectorAll('.sync-actions button, #setting-sync-provider, #btn-import, #btn-delete-all, #btn-restore-backup, #btn-clear-backups');
    controls.forEach(control => { control.disabled = true; });
    try {
      await action();
    } catch (error) {
      const code = /Saved data changed/i.test(error?.message || '') ? 'syncChangedError' : syncErrorCode(error);
      this._showToast(chrome.i18n.getMessage(code) || chrome.i18n.getMessage('syncOperationError'), 'error');
    } finally {
      this._busy = false;
      controls.forEach(control => { control.disabled = false; });
      await Promise.all([this._loadSyncStatus(), this._loadStatistics(), this._loadBackupStatus()]);
    }
  }

  async _requireUnchanged(first, second) {
    if (await checksum(snapshotData(first)) !== await checksum(snapshotData(second))) throw new SyncError('syncChangedError');
  }

  async _changeProvider(provider) {
    if (provider === 'chrome' && !await confirmAction({
      title: chrome.i18n.getMessage('settingsChromeSync'),
      description: chrome.i18n.getMessage('chromeConnectReview'),
      actionLabel: chrome.i18n.getMessage('syncConnect')
    })) return;
    await this.sync.setProvider(provider);
    if (provider === 'chrome' && !await this.sync.syncNow()) {
      throw new SyncError(this.sync.lastError || 'syncOperationError');
    }
  }

  async _resetCloud() {
    const config = await readConfig();
    const current = await db.exportAll();
    if (!await confirmAction({
      title: chrome.i18n.getMessage('settingsResetCloud'),
      description: chrome.i18n.getMessage('resetCloudReview', [String(current.groups.length), String(current.items.length)]),
      phrase: 'RESET', actionLabel: chrome.i18n.getMessage('settingsResetCloud'),
      checkboxLabel: config.provider === 'chrome' ? chrome.i18n.getMessage('resetLegacyAcknowledgement') : ''
    })) return;
    await this._requireUnchanged(current, await db.exportAll());
    await this.sync.resetCloud({ expectedCurrent: current });
    await this._syncDataAndRefresh();
    this._showToast(chrome.i18n.getMessage('cloudResetComplete'));
  }

  async _adoptCloud() {
    if (!await confirmAction({
      title: chrome.i18n.getMessage('settingsAdoptCloud'),
      description: chrome.i18n.getMessage('adoptCloudReview'),
      phrase: 'REPLACE', actionLabel: chrome.i18n.getMessage('settingsAdoptCloud')
    })) return;
    await this.sync.adoptCloud();
    await this._syncDataAndRefresh();
    this._showToast(chrome.i18n.getMessage('syncComplete'));
  }

  async _restoreBackup() {
    const backup = await latestBackup();
    if (!backup) throw new SyncError('backupUnavailable');
    const data = await verifyBackup(backup);
    const current = await db.exportAll();
    if (!await confirmAction({
      title: chrome.i18n.getMessage('settingsRestoreBackup'),
      description: chrome.i18n.getMessage('restoreBackupReview', [
        new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(backup.createdAt),
        String(data.groups.length), String(data.items.length)
      ]),
      actionLabel: chrome.i18n.getMessage('settingsRestoreBackup')
    })) return;
    const safety = await createBackup('before-backup-restore');
    await this._requireUnchanged(current, safety.data);
    await db.importAll(data, { expectedCurrent: safety.data });
    const synced = await this._syncDataAndRefresh();
    this._showToast(chrome.i18n.getMessage(synced ? 'backupRestored' : 'localSavedSyncPending'), synced ? 'success' : 'error');
  }

  async _loadBackupStatus() {
    const backups = await db.getBackups();
    document.getElementById('settings-backup-summary').textContent = chrome.i18n.getMessage('backupSummary', [String(backups.length)]);
    document.getElementById('btn-restore-backup').disabled = this._busy || backups.length === 0;
    document.getElementById('btn-clear-backups').disabled = this._busy || backups.length === 0;
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
      const request = this._statusRequest = (this._statusRequest || 0) + 1;
      const [diagnostics, bytesInUse] = await Promise.all([
        this.sync.diagnostics(),
        chrome.storage.sync.getBytesInUse(null)
      ]);
      if (request !== this._statusRequest) return;
      const { config, status } = diagnostics;
      const formatTime = timestamp => timestamp > 0 ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(timestamp) : chrome.i18n.getMessage('settingsSyncNotYet');

      const quotaBytes = Number(chrome.storage.sync.QUOTA_BYTES) || 102400;
      const usedBytes = Math.max(0, Number(bytesInUse) || 0);
      const percent = Math.min(100, (usedBytes / quotaBytes) * 100);
      const formatKb = bytes => {
        const value = bytes / 1024;
        return value >= 10 ? value.toFixed(0) : value.toFixed(1);
      };

      document.getElementById('settings-last-sync').textContent = formatTime(status.lastPushAt);
      document.getElementById('settings-last-pull').textContent = formatTime(status.lastPullAt);
      document.getElementById('settings-sync-quota').textContent =
        `${formatKb(usedBytes)} KB / ${formatKb(quotaBytes)} KB`;
      document.getElementById('settings-sync-quota-fill').style.width = `${percent.toFixed(1)}%`;
      const meter = document.getElementById('settings-sync-quota-meter');
      meter.setAttribute('aria-valuenow', percent.toFixed(1));
      meter.title = `${percent.toFixed(1)}%`;
      document.getElementById('setting-sync-provider').value = config.provider;
      const state = document.getElementById('settings-sync-state');
      state.dataset.error = String(!!status.error && config.provider !== 'local');
      state.textContent = config.provider === 'local' ? chrome.i18n.getMessage('syncLocalStatus') :
        status.error ? chrome.i18n.getMessage(status.error) :
        status.pending ? chrome.i18n.getMessage('syncPendingStatus') :
        chrome.i18n.getMessage('syncReadyStatus');
      document.getElementById('sync-active-bytes').textContent = `${formatKb(diagnostics.activeBytes)} KB`;
      document.getElementById('sync-deletion-bytes').textContent = `${formatKb(diagnostics.deletionBytes)} KB`;
      document.getElementById('sync-deletion-count').textContent = diagnostics.deletionCount;
      document.getElementById('sync-unused-bytes').textContent = `${formatKb(diagnostics.unusedBytes)} KB`;
      document.getElementById('sync-metadata-bytes').textContent = `${formatKb(diagnostics.metadataBytes)} KB`;
      document.getElementById('sync-blocking-devices').textContent = diagnostics.blockingDevices;
      for (const id of ['btn-sync-now', 'btn-clean-sync', 'btn-reset-cloud']) {
        document.getElementById(id).disabled = this._busy || config.provider === 'local';
      }
      document.getElementById('btn-adopt-cloud').hidden = !['syncResetRequired', 'syncLegacyClientError'].includes(status.error);
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
