# Tabel 1.5.0, Chrome Web Store release material

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

With one click, it saves the non-pinned tabs in the active window, closes the original tabs after safe persistence, and opens the Dashboard. Users can then search, sort, and restore one tab or a complete group.

Key features:

- Group open tabs.
- Search saved pages.
- Show complete saved URLs or hide them for a compact layout.
- Drag and sort groups and tabs.
- Lock, collapse, and format groups.
- Restore one tab or a complete group.
- Sync between Chrome installations through `chrome.storage.sync`.
- Import and export JSON backups.
- Use light and dark themes.

Tabel uses no Tabel account, advertisements, remote code, or developer-operated server.

## Single purpose

Tabel organizes a user's open tabs into saved groups so they can be searched, sorted, synchronized, and restored.

## Permission justifications

### tabs

Required only when the user clicks the Tabel action. It reads the URL, title, and favicon URL of non-pinned tabs in the current window, closes those tabs after safe local persistence, and creates tabs when the user restores saved pages.

### storage

Required to store settings and the crash-safe pending sweep queue in `chrome.storage.local`, and to synchronize saved groups through `chrome.storage.sync`.

### favicon

Required to display the website icons of saved tabs in the Dashboard without requesting access to webpage content.

## Remote code

Select: No, I am not using remote code.

All JavaScript, CSS, HTML, icons, and locale files are included in the extension package. No external script, font, or executable code is downloaded.

## Data usage declarations

Declare:

- Web browsing activity, specifically URLs, page titles, and favicon URLs selected by the user through the Sweep action.
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

## Distribution

- Visibility: Public.
- Regions: All regions.
- Mature content: No.

## Graphic assets

- Store icon: `release/assets/store-icon-128.png`
- Screenshot: `release/assets/screenshot-dashboard-1280x800.png`
- Small promo tile: `release/assets/promo-tile-440x280.png`

## Package

Run:

```powershell
npm run build:release
```

Upload the generated ZIP from `dist/`. The package excludes tests, documentation, release files, and the development `key` value.

The GitHub release workflow runs for a version tag such as `v1.5.0`, rebuilds the package, runs all tests, and attaches the ZIP to the GitHub Release.

After the first Store upload, open Package, select View public key, and copy the Store public key into the source manifest only if local development must use the same extension ID.

## Publisher actions

1. Create or access the Chrome Web Store developer account.
2. Enable two-step verification.
3. Pay the one-time registration fee.
4. Declare Trader or Non-Trader status and complete any required verification.
5. Upload the ZIP and complete the Store listing.
6. Submit the extension for review.
