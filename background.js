/**
 * Tabel - Background Service Worker
 * Handles the "Sweep" action, tab capture, and message routing.
 */

// Note: ES module imports don't work directly in service workers for IndexedDB
// We'll use message passing to communicate with the dashboard

const DASHBOARD_URL = chrome.runtime.getURL('dashboard/dashboard.html');
const PENDING_SWEEP_PREFIX = 'tabel_pending_sweep_';
const PRIVACY_NOTICE_VERSION = 1;
const CONTEXT_MENU_SAVE_TAB = 'tabel-save-tab';
const CONTEXT_MENU_SAVE_LINK = 'tabel-save-link';
const CONTEXT_MENU_SAVE_LINK_NEW = 'tabel-save-link-new';
const CONTEXT_MENU_SAVE_LINK_GROUP_PREFIX = 'tabel-save-link-group:';
const CONTEXT_MENU_GROUPS_KEY = 'tabelContextMenuGroups';
let contextMenuSetupPromise = Promise.resolve();

function pendingSweepKey(id) {
  return `${PENDING_SWEEP_PREFIX}${id}`;
}

async function hasPrivacyConsent() {
  const result = await chrome.storage.local.get('settings');
  return result.settings?.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

function isSavableUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    return ['file:', 'http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function newestTabsByUrl(tabs) {
  const newestByUrl = new Map();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab?.url) continue;
    const existing = newestByUrl.get(tab.url);
    if (
      !existing ||
      (Number(tab.lastAccessed) || 0) >= (Number(existing.lastAccessed) || 0)
    ) {
      newestByUrl.set(tab.url, tab);
    }
  }
  return [...newestByUrl.values()];
}

function contextLinkTitle(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function contextMenuGroupTitle(group) {
  const fallback = chrome.i18n.getMessage('groupDefaultName') || 'Group';
  const name = String(group?.name || fallback)
    .trim()
    .replaceAll('%s', '% s')
    .slice(0, 100) || fallback;
  return group.locked
    ? `${name} (${chrome.i18n.getMessage('locked') || 'Locked'})`
    : name;
}

function savedGroupName() {
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date());
  return chrome.i18n.getMessage('savedGroupDefaultName', [dateLabel]) || `Saved ${dateLabel}`;
}

async function queueContextCapture(tabData, destinationGroupId = null) {
  const id = `context_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.local.set({
    [pendingSweepKey(id)]: {
      id,
      groupName: savedGroupName(),
      tabs: [tabData],
      timestamp: Date.now(),
      source: 'contextMenu',
      ...(destinationGroupId ? { destinationGroupId } : {})
    }
  });
  await openDashboard({ active: false, notify: true });
}

async function setupContextMenus() {
  if (!chrome.contextMenus) return;
  try {
    const stored = await chrome.storage.local.get(CONTEXT_MENU_GROUPS_KEY);
    const groups = Array.isArray(stored[CONTEXT_MENU_GROUPS_KEY])
      ? stored[CONTEXT_MENU_GROUPS_KEY]
      : [];

    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_TAB,
      title: chrome.i18n.getMessage('contextSaveThisTab') || 'Save this tab',
      contexts: ['page', 'frame']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_LINK,
      title: chrome.i18n.getMessage('contextSaveThisLink') || 'Save this link',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_LINK_NEW,
      parentId: CONTEXT_MENU_SAVE_LINK,
      title: chrome.i18n.getMessage('saveTabsNewGroup') || 'New group',
      contexts: ['link']
    });

    for (const group of groups.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))) {
      if (typeof group?.id !== 'string' || typeof group?.name !== 'string') continue;
      chrome.contextMenus.create({
        id: `${CONTEXT_MENU_SAVE_LINK_GROUP_PREFIX}${group.id}`,
        parentId: CONTEXT_MENU_SAVE_LINK,
        title: contextMenuGroupTitle(group),
        contexts: ['link'],
        enabled: group.locked !== true
      });
    }
  } catch (error) {
    console.error('[Tabel] Context menu setup failed:', error);
  }
}

function scheduleContextMenuSetup() {
  contextMenuSetupPromise = contextMenuSetupPromise.then(
    () => setupContextMenus(),
    () => setupContextMenus()
  );
  return contextMenuSetupPromise;
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
      if (!await hasPrivacyConsent()) {
        await openDashboard();
        chrome.runtime.sendMessage({ type: 'SHOW_PRIVACY_NOTICE' }).catch(() => {});
        return;
      }

      if (
        info.menuItemId === CONTEXT_MENU_SAVE_TAB &&
        isSavableUrl(tab?.url)
      ) {
        await queueContextCapture({
          url: tab.url,
          title: tab.title || tab.url
        });
      } else if (
        (
          info.menuItemId === CONTEXT_MENU_SAVE_LINK_NEW ||
          (
            typeof info.menuItemId === 'string' &&
            info.menuItemId.startsWith(CONTEXT_MENU_SAVE_LINK_GROUP_PREFIX)
          )
        ) &&
        isSavableUrl(info.linkUrl)
      ) {
        const destinationGroupId = info.menuItemId === CONTEXT_MENU_SAVE_LINK_NEW
          ? null
          : info.menuItemId.slice(CONTEXT_MENU_SAVE_LINK_GROUP_PREFIX.length);
        await queueContextCapture({
          url: info.linkUrl,
          title: contextLinkTitle(info.linkUrl)
        }, destinationGroupId);
      }
    } catch (error) {
      console.error('[Tabel] Context menu save failed:', error);
    }
  });
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CONTEXT_MENU_GROUPS_KEY]) {
      scheduleContextMenuSetup();
    }
  });
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
    const sweepableTabs = tabs.filter(tab => isSavableUrl(tab.url));

    if (sweepableTabs.length === 0) {
      // Nothing to sweep, just open dashboard
      await openDashboard();
      return;
    }

    // Collect tab data
    const tabData = newestTabsByUrl(sweepableTabs).map(tab => ({
      url: tab.url,
      title: tab.title || tab.url
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
          if (!isSavableUrl(message.url)) throw new Error('Unsupported URL');
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
          if (!Array.isArray(message.urls) || !message.urls.every(isSavableUrl)) {
            throw new Error('Unsupported URLs');
          }
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
  await scheduleContextMenuSetup();

  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.local.set({
      settings: {
        theme: 'system',
        density: 'comfortable',
        defaultGroupWidth: 50,
        tabUrlMode: 'hidden',
        fontScale: 100,
        faviconSize: 16,
        keepOpenOnStartup: true,
        customCardOpacity: 75,
        includePinnedTabs: false,
        includeAudibleTabs: true,
        focusRestoredTab: true,
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
