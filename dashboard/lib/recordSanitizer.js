/**
 * Legacy versions stored a remote favicon URL with every tab. Favicons are now
 * derived from the saved page URL through Chrome's favicon API.
 */
export function sanitizeTabRecord(record) {
  const sanitized = { ...record };
  delete sanitized.favIconUrl;
  return sanitized;
}
