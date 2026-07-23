import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIVACY_NOTICE_VERSION,
  acceptPrivacyNotice,
  hasPrivacyConsent
} from '../dashboard/lib/privacyConsent.js';

function createStorage(settings = {}) {
  const data = { settings: { ...settings } };
  return {
    data,
    area: {
      get: async () => ({ settings: { ...data.settings } }),
      set: async value => { data.settings = { ...value.settings }; }
    }
  };
}

test('privacy consent requires the current notice version', () => {
  assert.equal(hasPrivacyConsent(undefined), false);
  assert.equal(hasPrivacyConsent({ privacyNoticeVersion: 0 }), false);
  assert.equal(hasPrivacyConsent({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION }), true);
});

test('accepting the privacy notice preserves existing settings', async () => {
  const storage = createStorage({ theme: 'light', keepOpenOnStartup: false });
  const acceptedAt = 123456789;

  const settings = await acceptPrivacyNotice(storage.area, acceptedAt);

  assert.equal(settings.theme, 'light');
  assert.equal(settings.keepOpenOnStartup, false);
  assert.equal(settings.privacyNoticeVersion, PRIVACY_NOTICE_VERSION);
  assert.equal(settings.privacyAcceptedAt, acceptedAt);
  assert.deepEqual(storage.data.settings, settings);
});
