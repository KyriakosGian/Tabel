# Changelog

## 2.2.0, 2026-10-18

- Published on the [Chrome Web Store](https://chromewebstore.google.com/detail/tabel-tab-manager/hmdklfckhfiobokdglandjdndgaefngd). Publication confirmed on October 20, 2026.
- Redesign Settings with four focused sections, automatic-save feedback, a live appearance preview, and project links in the footer.
- Reuse Dashboard typography, maximum width, color tokens, and shared density rules. Keep deletion and recovery tools separate from everyday preferences.

- Stop stale uploads from overwriting newly arrived imports. Recheck the merged snapshot before writing and preserve newer chunks during cleanup.
- Report incomplete multi-chunk downloads as pending instead of leaving a misleading ready status.
- Retry partially propagated reset metadata without misidentifying updated devices as legacy clients.
- Resume background downloads on remote storage changes after the service worker restarts.
- Report failed uploads after cloud adoption instead of showing a success message.
- Distinguish local Chrome Sync writes from confirmed receipt by another device. Receipt reporting requires the updated extension on both devices.
- Simplify Settings with a normal Sync action and a recovery review showing each copy's saved-link count. Keep destructive maintenance tools under Recovery tools.
- Cancel recovery if either reviewed copy changes before confirmation.
- Provide an isolated test package with a separate stable extension ID for validation on two computers.

## 2.1.0, 2026-10-12

- Now available on the [Chrome Web Store](https://chromewebstore.google.com/detail/tabel-tab-manager/hmdklfckhfiobokdglandjdndgaefngd).
- Added Local Only mode alongside Chrome Sync.
- Added resumable Chrome Sync compaction and reset checkpoints for recovery from full storage or interrupted writes.
- Added separate upload/download timestamps, pending/error state, deletion history diagnostics, and manual sync retry.
- Added unused-data cleanup and explicit Chrome cloud clearing that preserves local links and pauses Chrome synchronization.
- Protected Delete All with typed confirmation and verified local safety backups. Added restore and backup cleanup controls.
- Kept up to five safety backups with a 50 MiB total budget and pinned checkpoints needed by unfinished recovery jobs.
- Reused saved tab identifiers on recapture to avoid unnecessary deletion history.
- Removed unused imported record fields from storage and sync while preserving supported group and tab properties.
- Added periodic background sync and expanded regression coverage for quota recovery, reset fencing, and backup failures.
- Avoided unchanged automatic uploads and serialized device identity creation across extension pages and the background worker.

## 2.0.0, 2026-09-17

- Now available publicly on the [Chrome Web Store](https://chromewebstore.google.com/detail/tabel-tab-manager/hmdklfckhfiobokdglandjdndgaefngd). Installation links and documentation now point to the Store. The extension package is unchanged.
- Adopted the official Chrome Web Store public key and extension ID.
- Added migration instructions for the separate storage used by earlier test installations.
- Made capture, import, and sync merges atomic to avoid partial saves and overlapping database writes.
- Serialized sync operations within and across open extension pages.
- Measured sync chunks by UTF-8 size, including JSON escaping, to respect per-item storage limits.
- Validated imported and synchronized records before database changes.
- Added confirmation before replacing saved data through import and a 5 MB import limit.
- Restricted restored addresses to supported HTTP, HTTPS, and file URLs.
- Updated privacy disclosures, support guidance, and Store listing material.
- Removed unused database helpers and expanded regression coverage.

## 1.6.1, 2026-07-30

- Preserved the configured public manifest key in downloadable ZIP packages.
- Fixed cross-device synchronization for unpacked installations by keeping a stable extension ID.
- Added release checks that prevent packages with a missing or changed public key.

## 1.6.0, 2026-07-29

- Stopped storing and synchronizing external favicon URLs.
- Added conservative tombstone cleanup after a 90-day retention period and acknowledgement by every known device.
- Unified the Dashboard and Settings visual foundation.
- Added a setting to control focus when restoring one saved link.
- Added local tab and group statistics to Settings.
- Added selective tab capture from the Dashboard for one tab, selected tabs, or every window, with closure only after successful persistence.
- Added safe insertion into existing unlocked groups.
- Added pinned-tab and audible-tab capture filters.
- Added System theme, three density levels, default group width, URL display modes, font size, favicon size, live preview, and appearance reset.
- Added the last successful synchronization time and sync quota usage to Settings.
- Added context menu actions for saving the current page or a selected link, including a link destination submenu that keeps page focus.
- Standardized URL deduplication so a new capture replaces every older saved copy.
- New tabs saved into an existing group now appear at the top.

## 1.5.0, 2026-07-26

- Added a setting to show or hide tab URLs for a more compact Dashboard.
- Replaced the domain-only secondary line with the complete saved URL.
- Kept the extension interface and document language set to English.

## 1.4.0, 2026-07-23

- Added a privacy notice and explicit consent before tab collection.
- Prepared the privacy policy and Chrome Web Store release material.
- Added an English GitHub Pages presentation website.
- Added automated tests and GitHub Releases through GitHub Actions.

## 1.3.0, 2026-07-19

- Added deletion synchronization through tombstones.
- Added a durable pending sweep queue with persistence confirmation.
- Synchronized tab moves, sorting, imports, and Delete All.
- Fixed HTML structure, localization, and version display.
- Removed external Google Fonts.
- Expanded automated test coverage.

## 1.2.1, 2026-07-19

- Confirmed successful tab creation before deleting saved data.
- Added automated tests.
- Removed a temporary homepage URL and unused files.
- Removed dead code and the unnecessary `activeTab` permission.

## 1.2.0, 2026-06-06

- Added cross-device synchronization through `chrome.storage.sync`.
- Improved merging of local and synchronized data.
- Fixed event listeners, internationalization, and rendering.

## 1.1.0, 2026-05-22

- Added a light theme and transparency setting.
- Improved drag and drop.
- Added an optional dashboard launch on browser startup.

## 1.0.0, 2026-05-21

- Initial release.
