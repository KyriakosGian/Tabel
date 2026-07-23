export const PRIVACY_NOTICE_VERSION = 1;

export function hasPrivacyConsent(settings) {
  return settings?.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

export async function acceptPrivacyNotice(
  storageArea = chrome.storage.local,
  acceptedAt = Date.now()
) {
  const result = await storageArea.get('settings');
  const settings = {
    ...(result.settings || {}),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privacyAcceptedAt: acceptedAt
  };

  await storageArea.set({ settings });
  return settings;
}
