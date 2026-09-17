# Tabel

Tabel is a Chrome extension that saves and organizes open tabs into visual groups.

Version 2.0.0. Manifest V3. English interface.

[Official website](https://kyriakosgian.github.io/Tabel/) | [Report a problem](https://github.com/KyriakosGian/Tabel/issues) | [Releases](https://github.com/KyriakosGian/Tabel/releases)

![Tabel Dashboard](release/assets/screenshot-dashboard-1280x800.png)

![Tabel Settings](docs/assets/settings-preview.png)

## Features

- Save non-pinned tabs from the active window.
- Save the most recent tab, selected open tabs, or eligible tabs from every window, then close them after successful persistence.
- Add captured tabs to the top of an existing unlocked group.
- Save a page or link from the Chrome context menu and send a link to a new or existing group.
- Keep only the newest saved copy when the same URL is captured again.
- Restore one tab or a complete group.
- Search, rename, delete, sort, and move groups and tabs.
- Hide tab URLs or show a domain or complete address.
- Customize density, font size, favicon size, default group width, and group layout.
- Use System, Light, or Dark theme with a live appearance preview.
- Sync saved groups through `chrome.storage.sync`.
- View saved-tab statistics, the last successful sync, and current sync quota usage.
- Import and export JSON backups.

## Local installation

1. Download the [Tabel 2.0.0 ZIP](https://github.com/KyriakosGian/Tabel/releases/download/v2.0.0/tabel-2.0.0-chrome-web-store.zip) and extract it to a permanent folder.
2. Open `chrome://extensions/` in Chrome and enable Developer mode.
3. Select Load unpacked.
4. Select the extracted directory containing `manifest.json`.

The Chrome Web Store listing is being prepared and is not yet published.

## Upgrading from 1.x

Version 2.0.0 uses the official Chrome Web Store identity. It uses separate storage from the earlier test installations.

1. Before replacing or reloading an older installation, export a JSON backup from its Settings. Back up each computer if they contain different data.
2. Load 2.0.0 from a separate folder and verify its extension ID is `hmdklfckhfiobokdglandjdndgaefngd`.
3. Import the backup containing the data you want to keep into 2.0.0 on your primary computer. Import replaces saved data and can synchronize that replacement to other devices.
4. Install the same version on your other computers, enable Chrome sync with the same Google Account, and check that the saved groups appear.
5. Remove the old installation only after verifying the new data. Keep your backup.

## Tests

Node.js 22 or later is required.

```bash
npm test
```

The test suite uses the built-in `node:test` runner and requires no third-party packages.

## Public release

- `docs/` contains the GitHub Pages website, privacy policy, and support page.
- `release/` contains the Chrome Web Store copy, graphic assets, and release notes.
- `npm run build:release` creates a clean Chrome Web Store ZIP in `dist/`.
- GitHub Actions runs the test suite for every push and pull request.
- A version tag such as `v2.0.0` creates a GitHub Release and attaches the Store ZIP.

## Create a release

```bash
npm test
npm run build:release
git tag v2.0.0
git push origin v2.0.0
```

The tag must match the versions in `manifest.json` and `package.json`.

## Project structure

```text
Tabel/
|-- background.js
|-- manifest.json
|-- dashboard/
|-- options/
|-- styles/
|-- icons/
|-- _locales/
|-- docs/
|-- release/
|-- scripts/
`-- tests/
```

## Data storage

- IndexedDB stores groups and tabs.
- `chrome.storage.local` stores settings, privacy consent, sync status, a context-menu group index, and crash-safe pending capture data.
- `chrome.storage.sync` synchronizes saved groups between installations with the same extension ID and Google Account when Chrome sync is enabled.
- Chrome sync provides approximately 100 KB for saved data, deletion records, and sync metadata. Settings shows quota usage. Tabs remain local if a sync write fails.
- Website icons are rendered through Chrome's favicon API and are not stored or synchronized.
- The public manifest key identifies the extension. It is not a password or a credential for accessing another user's data.

## License

Tabel is released under the [MIT License](LICENSE).
