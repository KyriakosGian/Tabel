/**
 * Ask the background service worker to restore saved tabs.
 * A rejected or unsuccessful response prevents the caller from deleting saved data.
 */

function requireSuccess(response) {
  if (!response?.success) {
    throw new Error(response?.error || 'Chrome did not confirm that the tab was opened.');
  }
  return response;
}

export async function openSavedTab(runtime, url, active = true) {
  const response = await runtime.sendMessage({ type: 'OPEN_TAB', url, active });
  return requireSuccess(response);
}

export async function openSavedTabs(runtime, urls) {
  const response = await runtime.sendMessage({ type: 'OPEN_TABS', urls });
  return requireSuccess(response);
}
