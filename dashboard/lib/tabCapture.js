const BLOCKED_URL_PREFIXES = [
  'about:',
  'chrome://',
  'chrome-extension://',
  'devtools://',
  'edge://'
];
const ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:']);

export function isCapturableUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (BLOCKED_URL_PREFIXES.some(prefix => url.startsWith(prefix))) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function filterCapturableTabs(tabs, settings = {}) {
  const includePinned = settings.includePinnedTabs === true;
  const includeAudible = settings.includeAudibleTabs !== false;

  return (Array.isArray(tabs) ? tabs : []).filter(tab => {
    if (!isCapturableUrl(tab?.url)) return false;
    if (!includePinned && tab.pinned) return false;
    if (!includeAudible && tab.audible) return false;
    return true;
  });
}

export function toSavedTabRecords(tabs) {
  const newestByUrl = new Map();

  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!isCapturableUrl(tab?.url)) continue;
    const existing = newestByUrl.get(tab.url);
    const tabAccessedAt = Number(tab.lastAccessed) || 0;
    const existingAccessedAt = Number(existing?.lastAccessed) || 0;
    if (!existing || tabAccessedAt >= existingAccessedAt) {
      newestByUrl.set(tab.url, tab);
    }
  }

  return [...newestByUrl.values()]
    .map(tab => ({
      url: tab.url,
      title: tab.title || tab.url
    }));
}

export function findMostRecentTab(tabs) {
  const candidates = Array.isArray(tabs) ? [...tabs] : [];
  candidates.sort((a, b) => {
    const accessDifference = (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0);
    if (accessDifference !== 0) return accessDifference;
    if (Boolean(a.active) !== Boolean(b.active)) return a.active ? -1 : 1;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  return candidates[0] || null;
}

export async function closeCapturedTabs(tabsApi, tabs) {
  const tabIds = [...new Set(
    (Array.isArray(tabs) ? tabs : [])
      .map(tab => tab?.id)
      .filter(Number.isInteger)
  )];
  const results = await Promise.allSettled(
    tabIds.map(async tabId => tabsApi.remove(tabId))
  );
  return {
    requestedCount: tabIds.length,
    failedCount: results.filter(result => result.status === 'rejected').length
  };
}
