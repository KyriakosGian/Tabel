/**
 * Tabel - Background Service Worker
 * Handles the "Sweep" action, tab capture, and message routing.
 */

// Note: ES module imports don't work directly in service workers for IndexedDB
// We'll use message passing to communicate with the dashboard

const DASHBOARD_URL = chrome.runtime.getURL('dashboard/dashboard.html');
const PENDING_SWEEP_PREFIX = 'tabel_pending_sweep_';
const PRIVACY_NOTICE_VERSION = 1;

function pendingSweepKey(id) {
  return `${PENDING_SWEEP_PREFIX}${id}`;
}

async function hasPrivacyConsent() {
  const result = await chrome.storage.local.get('settings');
  return result.settings?.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

// ─── Action Click Handler (Sweep) ────────────────────────────
chrome.action.onClicked.addListener(async () => {
  try {
    // Never read browser tab data before the user accepts the privacy notice.
    if (!await hasPrivacyConsent()) {
      await openDashboard();
      chrome.runtime.sendMessage({ type: 'SHOW_PRIVACY_NOTICE' }).catch(() => {});
      return;
    }

    // Query all non-pinned tabs in the current window
    const tabs = await chrome.tabs.query({
      currentWindow: true,
      pinned: false
    });

    // Filter out the dashboard tab, chrome:// pages, and the new tab page
    const sweepableTabs = tabs.filter(tab =>
      tab.url &&
      !tab.url.startsWith('chrome://') &&
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('about:') &&
      !tab.url.startsWith('edge://') &&
      tab.url !== 'about:blank'
    );

    if (sweepableTabs.length === 0) {
      // Nothing to sweep, just open dashboard
      await openDashboard();
      return;
    }

    // Collect tab data
    const tabData = sweepableTabs.map(tab => ({
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || ''
    }));

    // Create sweep group name with timestamp
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const groupName = `${chrome.i18n.getMessage('groupDefaultName')} — ${y}/${mo}/${d} ${h}:${mi}`;

    // Persist each sweep separately. The dashboard removes it only after the
    // IndexedDB write succeeds, so browser or page failures cannot lose the data.
    const sweepId = `sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.local.set({
      [pendingSweepKey(sweepId)]: {
        id: sweepId,
        groupName,
        tabs: tabData,
        timestamp: Date.now()
      }
    });

    // Close swept tabs
    const tabIds = sweepableTabs.map(t => t.id);
    await chrome.tabs.remove(tabIds);

    // Open dashboard and, if it's already open, tell it to pick up the pending sweep.
    await openDashboard({ notify: true });

  } catch (error) {
    console.error('[Tabel] Sweep failed:', error);
  }
});

// ─── Open or Focus Dashboard ─────────────────────────────────
async function openDashboard(options = {}) {
  const {
    active = true,
    pinned = true,
    index = 0,
    notify = false
  } = options;

  // Check if dashboard is already open (in any window)
  const existingTabs = await chrome.tabs.query({ url: DASHBOARD_URL });

  if (existingTabs.length > 0) {
    const tab = existingTabs[0];

    // Make sure it is pinned
    if (!tab.pinned && pinned) {
      await chrome.tabs.update(tab.id, { pinned: true });
    }

    // Move to correct index if needed
    if (index !== undefined && tab.index !== index) {
      try {
        await chrome.tabs.move(tab.id, { index: index });
      } catch (e) {
        console.warn('[Tabel] Failed to move tab to index:', index, e);
      }
    }

    // Focus if requested
    if (active) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }

    // Only after a real sweep do we ask an already-open dashboard to pick up the
    // pending data. On startup/install there is nothing to refresh, so we skip it —
    // otherwise every launch triggers a needless re-render that looks like a reload.
    if (notify) {
      chrome.runtime.sendMessage({ type: 'REFRESH' }).catch(() => {});
    }
  } else {
    // Create new dashboard tab
    await chrome.tabs.create({
      url: DASHBOARD_URL,
      active: active,
      pinned: pinned,
      index: index
    });
  }
}

// ─── Message Handler ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'OPEN_TAB':
      (async () => {
        try {
          const tab = await chrome.tabs.create({
            url: message.url,
            active: message.active ?? true
          });
          sendResponse({ success: true, tabId: tab?.id ?? null });
        } catch (error) {
          console.error('[Tabel] Failed to open tab:', error);
          sendResponse({ success: false, error: error?.message || String(error) });
        }
      })();
      return true;

    case 'OPEN_TABS':
      (async () => {
        const createdTabIds = [];
        try {
          // Open sequentially so the response represents the result of every request.
          for (let i = 0; i < message.urls.length; i++) {
            const tab = await chrome.tabs.create({
              url: message.urls[i],
              active: i === 0
            });
            if (tab?.id !== undefined) createdTabIds.push(tab.id);
          }
          sendResponse({ success: true, createdTabIds });
        } catch (error) {
          console.error('[Tabel] Failed to open tabs:', error);
          sendResponse({
            success: false,
            error: error?.message || String(error),
            createdTabIds
          });
        }
      })();
      return true;

  }
});

// ─── Installation Handler ────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.local.set({
      settings: {
        theme: 'dark',
        keepOpenOnStartup: true,
        language: chrome.i18n.getUILanguage().startsWith('el') ? 'el' : 'en',
        privacyNoticeVersion: 0
      }
    });

    // Open dashboard on first install (pinned, index 0, active)
    await openDashboard({ active: true, pinned: true, index: 0 });
  }
});

// ─── Startup Handler ─────────────────────────────────────────
chrome.runtime.onStartup.addListener(() => {
  // Delay execution slightly to ensure Chrome's window manager is fully initialized
  setTimeout(async () => {
    try {
      const result = await chrome.storage.local.get('settings');
      const keepOpen = result.settings?.keepOpenOnStartup ?? true;
      if (keepOpen) {
        // Pinned, index 0, active: false (prevents taking focus away from user's restore pages)
        await openDashboard({ active: false, pinned: true, index: 0 });
      }
    } catch (error) {
      console.warn('[Tabel] Startup handler failed:', error);
      // Retry once after a longer delay
      setTimeout(async () => {
        try {
          const result = await chrome.storage.local.get('settings');
          if (result.settings?.keepOpenOnStartup ?? true) {
            await openDashboard({ active: false, pinned: true, index: 0 });
          }
        } catch (e) {
          console.error('[Tabel] Startup retry also failed:', e);
        }
      }, 3000);
    }
  }, 1000);
});
