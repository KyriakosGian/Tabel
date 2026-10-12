# Tabel 2.1.0, Chrome Web Store release material

## URLs

- Store: `https://chromewebstore.google.com/detail/tabel-tab-manager/hmdklfckhfiobokdglandjdndgaefngd`
- Homepage: `https://kyriakosgian.github.io/Tabel/`
- Privacy policy: `https://kyriakosgian.github.io/Tabel/privacy/`
- Support: `https://kyriakosgian.github.io/Tabel/support/`

## Listing

- Primary language: English
- Category: Productivity, workflow and organization
- Status: The 2.1.0 update is approved for submission and awaits Chrome Web Store publication.
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
- Choose Local Only or Chrome Sync.
- Recover from full Chrome Sync storage and clear old Chrome cloud data without deleting local links.
- Require typed confirmation for Delete All and keep verified local safety backups.
- Import and export JSON backups.
- Use System, Light, or Dark theme and three density levels.
- Adjust font size, favicon size, default group width, and URL display.
- View local tab and group statistics.
- View separate upload/download times, pending errors, deletion history, and storage use.

Tabel uses no Tabel account, advertisements, remote code, or developer-operated server.

Chrome Sync requires the same Chrome account and enabled extension data synchronization, and provides approximately 100 KB. Upload failures keep data local, and timestamps do not confirm receipt on other devices. Update or stop older versions before a Chrome cloud reset. Export JSON for backups that survive uninstalling Tabel. Verified local safety backups retain up to five copies with a 50 MiB total budget.

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

### alarms

Required to resume pending synchronization and check for remote changes every five minutes while Chrome is running. The alarm is removed in Local Only mode.

## Remote code

Select: No, I am not using remote code.

All JavaScript, CSS, HTML, icons, and locale files are included in the extension package. No external script, font, or executable code is downloaded.

## Data usage declarations

Declare:

- Web history, specifically open-tab URLs and page titles accessed to populate Save Tabs, and URLs and titles retained after the user saves tabs through the extension action, Dashboard, or context menu.
- Website content, specifically hyperlinks saved through Save this link.

The privacy policy also discloses group names, display preferences, deletion history, and local safety backups. Tabel does not continuously record browsing history or read full webpage content.

Data use:

- Tab organization, search, synchronization, backup, and restoration.
- No advertising.
- No analytics or tracking.
- No sale of data.
- No transfer to a developer-operated server.
- No human access to user data.
- Synchronization through Google Chrome Sync when enabled by the user.

Certify every applicable Limited Use statement in the Privacy practices tab.

## Version 2.1.0 release notes

Tabel 2.1.0 adds recovery from full Chrome Sync, separate sync status, safe cloud clearing/reset, and typed Delete All with verified local backups. Repeated capture preserves tab IDs to reduce unnecessary deletion history.

## Distribution

- Visibility: Public.
- Regions: All regions.
- Mature content: No.

## Graphic assets

- Store icon: `icons/icon128.png`
- Screenshot: `docs/assets/dashboard-preview.png`
- Settings screenshot: `docs/assets/settings-preview.png`
- Delete All confirmation screenshot: `release/assets/delete-all-confirmation-1280x800.png`
- Small promo tile: `release/assets/promo-tile-440x280.png`

## Package

Run:

```powershell
npm run build:release
```

The 2.1.0 package is `dist/tabel-2.1.0-chrome-web-store.zip`. It excludes tests, documentation, and release files. The official public key and extension ID are preserved.

The GitHub release workflow runs when a new version tag is pushed, rebuilds the package, runs all tests, and attaches the ZIP to the GitHub Release. The tag must be `v` followed by the version in `manifest.json` and `package.json`. Do not reuse an existing release tag.

The published Store item ID is `hmdklfckhfiobokdglandjdndgaefngd`. Its public key is configured in `manifest.json` and checked by the test suite. Preserve this identity for future updates.

Before submission, verify Chrome Sync on two test installations with a dedicated test account. Use the updated 2.1 Store screenshots with demonstration data. Verify the public privacy/support pages and disclose the Chrome Sync limit, safety backup retention, and older-version reset requirements.

## Future extension updates

1. Update the version in `manifest.json` and `package.json`, and document the changes.
2. Run the tests and build the release package.
3. Upload the new package to the existing Store item, preserving its ID and public key.
4. Update the Store listing and privacy disclosures if the behavior has changed.
5. Submit the update for review and choose automatic or manual publication.
