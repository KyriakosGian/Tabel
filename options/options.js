/**
 * Tabel - Options Page Controller
 * Manages settings persistence via chrome.storage.local.
 * Handles export/import of tab data via IndexedDB.
 */

import { db } from '../dashboard/lib/db.js';
import { SyncManager } from '../dashboard/lib/sync.js';

class OptionsController {
  constructor() {
    this.settings = {
      theme: 'dark',
      keepOpenOnStartup: true,
      customCardOpacity: 75,
      showTabUrls: true
    };
    this.sync = new SyncManager();
    this._init();
  }

  async _init() {
    this._applyI18n();
    await this._loadSettings();
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
    document.getElementById('setting-theme').value = this.settings.theme;
    document.getElementById('setting-startup').checked = this.settings.keepOpenOnStartup ?? true;
    document.getElementById('setting-show-tab-urls').checked = this.settings.showTabUrls ?? true;

    // Custom Appearance UI
    document.getElementById('setting-bg-opacity').value = this.settings.customCardOpacity ?? 75;
    document.getElementById('bg-opacity-val').textContent = (this.settings.customCardOpacity ?? 75) + '%';

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
    // Theme switching
    if (this.settings.theme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }

    // Custom card opacity
    const opacityVal = this.settings.customCardOpacity ?? 75;
    const opacity = opacityVal / 100;
    document.documentElement.style.setProperty('--custom-card-opacity', opacity.toFixed(2));
  }

  /** Bind all event handlers */
  _bindEvents() {
    // Theme
    document.getElementById('setting-theme').addEventListener('change', (e) => {
      this.settings.theme = e.target.value;
      this._saveSettings();
    });

    // Card Opacity Slider
    const opacityInput = document.getElementById('setting-bg-opacity');
    const opacityValSpan = document.getElementById('bg-opacity-val');
    opacityInput.addEventListener('input', (e) => {
      opacityValSpan.textContent = e.target.value + '%';
      const opacity = parseInt(e.target.value) / 100;
      document.documentElement.style.setProperty('--custom-card-opacity', opacity.toFixed(2));
    });
    opacityInput.addEventListener('change', (e) => {
      this.settings.customCardOpacity = parseInt(e.target.value);
      this._saveSettings();
    });

    // Startup toggle
    document.getElementById('setting-startup').addEventListener('change', (e) => {
      this.settings.keepOpenOnStartup = e.target.checked;
      this._saveSettings();
    });

    document.getElementById('setting-show-tab-urls').addEventListener('change', (e) => {
      this.settings.showTabUrls = e.target.checked;
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
    const synced = await this.sync.pushNow();
    chrome.runtime.sendMessage({ type: 'DATA_CHANGED' }).catch(() => {});
    return synced;
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
