# Tabel 2.0.0, Chrome Web Store release material

## URLs

- Homepage: `https://kyriakosgian.github.io/Tabel/`
- Privacy policy: `https://kyriakosgian.github.io/Tabel/privacy/`
- Support: `https://kyriakosgian.github.io/Tabel/support/`

## Listing

- Primary language: English
- Category: Productivity
- Name: `Tabel: Tab Manager`
- Summary: `Organize open tabs into synced visual groups, save memory, and restore them whenever you need.`

## Detailed description

Tabel organizes open Chrome tabs into clean, synchronized visual groups.

With one click, it saves the non-pinned tabs in the active window, closes the original tabs after safe persistence, and opens the Dashboard. The Dashboard can also save one tab, a custom selection, or eligible tabs from every window, closing them only after persistence succeeds.

Key features:

- Group open tabs.
- Save selected tabs safely and add them to an existing group.
- Place newly saved tabs at the top of an existing group and keep only the newest copy of a repeated URL.
- Save the current page or send a link to a new or existing group from the Chrome context menu.
- Search saved pages.
- Hide saved URLs or show a domain or complete address.
- Drag and sort groups and tabs.
- Lock, collapse, and format groups.
- Restore one tab or a complete group.
- Sync between Chrome installations through `chrome.storage.sync`.
- Import and export JSON backups.
- Use System, Light, or Dark theme and three density levels.
- Adjust font size, favicon size, default group width, and URL display.
- View local tab and group statistics.
- View the last successful sync and sync quota usage.

Tabel uses no Tabel account, advertisements, remote code, or developer-operated server.

Chrome synchronization requires the same Google Account with Chrome sync enabled on each device. Approximately 100 KB is available for saved data, deletion records, and sync metadata. If this limit is reached, your saved tabs remain available locally. Export JSON backups from Settings to keep an additional copy.

## Single purpose

Tabel organizes a user's open tabs into saved groups so they can be searched, sorted, synchronized, and restored.

## Permission justifications

### tabs

Required when the user clicks the Tabel action, uses Save Tabs in the Dashboard, or selects a Tabel context menu command. Save Tabs reads URLs and titles of open tabs to display the selection list. Only chosen tabs or links are retained. Saved URLs are also used when restoring pages.

### storage

Required to store settings, the context-menu group index, and the crash-safe pending capture queue in `chrome.storage.local`, and to synchronize saved groups through `chrome.storage.sync`.

### favicon

Required to display website icons through Chrome's favicon API without storing external favicon URLs or requesting access to webpage content.

### contextMenus

Required to provide the user-invoked Save this tab and Save this link commands. Tabel processes a page or link only after the user selects one of these commands.

## Remote code

Select: No, I am not using remote code.

All JavaScript, CSS, HTML, icons, and locale files are included in the extension package. No external script, font, or executable code is downloaded.

## Data usage declarations

Declare:

- Web browsing activity, specifically open-tab URLs and page titles accessed to populate Save Tabs, and URLs and titles retained after the user saves tabs through the Sweep action, Dashboard, or context menu.
- User-generated content, specifically group names created by the user.

Data use:

- Tab organization, search, synchronization, backup, and restoration.
- No advertising.
- No analytics or tracking.
- No sale of data.
- No transfer to a developer-operated server.
- No human access to user data.
- Synchronization only through Google Chrome's `chrome.storage.sync` service.

Certify every applicable Limited Use statement in the Privacy practices tab.

## Version 2.0.0 release notes

Tabel 2.0.0 adopts the official Chrome Web Store identity, improves capture and synchronization reliability, and validates backups before replacing saved data.

## Distribution

- Visibility: Public.
- Regions: All regions.
- Mature content: No.

## Graphic assets

- Store icon: `icons/icon128.png`
- Screenshot: `docs/assets/dashboard-preview.png`
- Settings screenshot: `docs/assets/settings-preview.png`
- Small promo tile: `release/assets/promo-tile-440x280.png`

## Package

Run:

```powershell
npm run build:release
```

Upload `dist/tabel-2.0.0-chrome-web-store.zip` as an updated package in the existing Store draft. The package excludes tests, documentation, and release files. The official Store public key is preserved so unpacked installations use the Store extension ID.

The GitHub release workflow runs for a version tag such as `v2.0.0`, rebuilds the package, runs all tests, and attaches the ZIP to the GitHub Release.

The Store item ID is `hmdklfckhfiobokdglandjdndgaefngd`. Its public key is configured in `manifest.json` and checked by the test suite. The Store listing remains a draft until explicitly submitted for review.

Before submission, verify that the screenshots match the final extension and contain only demonstration data. Verify the public privacy and support URLs and disclose that Chrome sync storage is limited to approximately 100 KB across saved data, deletion records, and sync metadata.

## Publisher actions

1. Create or access the Chrome Web Store developer account.
2. Enable two-step verification.
3. Pay the one-time registration fee.
4. Declare Trader or Non-Trader status and complete any required verification.
5. Upload the ZIP and complete the Store listing.
6. Submit the extension for review.
