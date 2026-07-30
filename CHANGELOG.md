# Changelog

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
