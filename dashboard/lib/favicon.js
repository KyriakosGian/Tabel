/**
 * Build a Chrome-managed favicon URL without storing or loading a site's
 * original favicon URL.
 */
export function createFaviconUrl(runtime, pageUrl, size = 32) {
  const faviconUrl = new URL(runtime.getURL('/_favicon/'));
  faviconUrl.searchParams.set('pageUrl', String(pageUrl ?? ''));
  faviconUrl.searchParams.set('size', String(size));
  return faviconUrl.href;
}
