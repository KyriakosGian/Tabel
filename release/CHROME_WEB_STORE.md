# Tabel 2.0.0, Chrome Web Store release material

## URLs

- Store: `https://chromewebstore.google.com/detail/tabel-tab-manager/hmdklfckhfiobokdglandjdndgaefngd`
- Homepage: `https://kyriakosgian.github.io/Tabel/`
- Privacy policy: `https://kyriakosgian.github.io/Tabel/privacy/`
- Support: `https://kyriakosgian.github.io/Tabel/support/`

## Listing

- Primary language: English
- Category: Productivity, workflow and organization
- Status: Publicly available, version 2.0.0
- Name: `Tabel: Tab Manager`
- Summary: `Organize open tabs into synced visual groups, save memory, and restore them whenever you need.`

## Detailed description

Tabel organizes open Chrome tabs into clean, synchronized visual groups.

With one click, it saves the non-pinned tabs in the active window, closes the original tabs after safe persistence, and opens the Dashboard. The Dashboard can also save the most recently active eligible tab, a custom selection, or eligible tabs from every window, closing them only after persistence succeeds.

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
- View the time of the last successful sync storage operation and sync quota usage.

Tabel uses no Tabel account, advertisements, remote code, or developer-operated server.

Chrome synchronization requires the same Google Account with Chrome sync enabled on each device. Approximately 100 KB is available for saved data, deletion records, and sync metadata. If this limit is reached, your saved tabs remain available locally. The sync timestamp records a successful storage operation on this device, not confirmation that another device has received the data. Export JSON backups from Settings to keep an additional copy of saved groups and tabs. Extension settings are not included in backups.

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

- Web history, specifically open-tab URLs and page titles accessed to populate Save Tabs, and URLs and titles retained after the user saves tabs through the extension action, Dashboard, or context menu.
- Website content, specifically hyperlinks saved through Save this link.

The privacy policy also discloses user-created group names, sorting choices, and display preferences. Tabel does not continuously record browsing history or read full webpage content.

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

The 2.0.0 package is `dist/tabel-2.0.0-chrome-web-store.zip`. It excludes tests, documentation, and release files. The official Store public key is preserved so unpacked installations use the Store extension ID. Documentation-only updates do not require a new package or Store submission.

The GitHub release workflow runs when a new version tag is pushed, rebuilds the package, runs all tests, and attaches the ZIP to the GitHub Release. The tag must be `v` followed by the version in `manifest.json` and `package.json`. Do not reuse an existing release tag.

The published Store item ID is `hmdklfckhfiobokdglandjdndgaefngd`. Its public key is configured in `manifest.json` and checked by the test suite. Preserve this identity for future updates.

Before submission, verify that the screenshots match the final extension and contain only demonstration data. Verify the public privacy and support URLs and disclose that Chrome sync storage is limited to approximately 100 KB across saved data, deletion records, and sync metadata.

## Future extension updates

1. Update the version in `manifest.json` and `package.json`, and document the changes.
2. Run the tests and build the release package.
3. Upload the new package to the existing Store item, preserving its ID and public key.
4. Update the Store listing and privacy disclosures if the behavior has changed.
5. Submit the update for review and choose automatic or manual publication.
