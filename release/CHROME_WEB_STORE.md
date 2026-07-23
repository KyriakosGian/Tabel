# Tabel 1.4.0, Chrome Web Store release material

## URLs

- Homepage: `https://kyriakosgian.github.io/Tabel/`
- Privacy policy: `https://kyriakosgian.github.io/Tabel/privacy/`
- Support: `https://kyriakosgian.github.io/Tabel/support/`

## Primary language

Greek

## Category

Productivity

## Store listing metadata

### Greek

- Name: `Tabel — Διαχείριση Καρτελών`
- Summary: `Οργανώστε τις ανοιχτές καρτέλες σε συγχρονισμένες ομάδες, εξοικονομήστε μνήμη και επαναφέρετέ τις όποτε χρειάζεται.`

### English

- Name: `Tabel — Tab Manager`
- Summary: `Organize open tabs into synced visual groups, save memory, and restore them whenever you need.`

## Greek detailed description

Το Tabel οργανώνει τις ανοιχτές καρτέλες του Chrome σε καθαρές, συγχρονισμένες ομάδες.

Με ένα κλικ αποθηκεύει τις μη καρφιτσωμένες καρτέλες του ενεργού παραθύρου, κλείνει τις αρχικές καρτέλες και ανοίγει το Dashboard. Από εκεί μπορείτε να αναζητήσετε, να ταξινομήσετε και να επαναφέρετε μία καρτέλα ή ολόκληρη ομάδα.

Βασικές λειτουργίες:

- Ομαδοποίηση ανοιχτών καρτελών
- Αναζήτηση αποθηκευμένων σελίδων
- Μεταφορά και ταξινόμηση ομάδων και καρτελών
- Κλείδωμα, σύμπτυξη και μορφοποίηση ομάδων
- Επαναφορά μίας καρτέλας ή ολόκληρης ομάδας
- Συγχρονισμός μεταξύ εγκαταστάσεων Chrome μέσω chrome.storage.sync
- Εισαγωγή και εξαγωγή αντιγράφων ασφαλείας JSON
- Φωτεινό και σκοτεινό θέμα

Το Tabel δεν χρησιμοποιεί λογαριασμό Tabel, διαφημίσεις, απομακρυσμένο κώδικα ή διακομιστή που ελέγχεται από τον δημιουργό.

## English detailed description

Tabel organizes open Chrome tabs into clean, synchronized visual groups.

With one click, it saves the non-pinned tabs in the active window, closes the original tabs, and opens the Dashboard. From there, users can search, sort, and restore one tab or a complete group.

Key features:

- Group open tabs
- Search saved pages
- Drag and sort groups and tabs
- Lock, collapse, and format groups
- Restore one tab or a complete group
- Sync between Chrome installations through chrome.storage.sync
- Import and export JSON backups
- Light and dark themes

Tabel uses no Tabel account, advertisements, remote code, or developer-operated server.

## Single purpose

Greek:

Το Tabel οργανώνει τις ανοιχτές καρτέλες του χρήστη σε αποθηκευμένες ομάδες, ώστε να μπορούν να αναζητηθούν, να ταξινομηθούν, να συγχρονιστούν και να επαναφερθούν.

English:

Tabel organizes a user's open tabs into saved groups so they can be searched, sorted, synchronized, and restored.

## Permission justifications

### tabs

Required only when the user clicks the Tabel action. It reads the URL, title, and favicon URL of non-pinned tabs in the current window, closes those tabs after safe local persistence, and creates tabs when the user restores saved pages.

### storage

Required to store settings and the crash-safe pending sweep queue in chrome.storage.local, and to synchronize saved groups through chrome.storage.sync.

### favicon

Required to display the website icons of saved tabs in the Dashboard without requesting access to webpage content.

## Remote code

Select: No, I am not using remote code.

All JavaScript, CSS, HTML, icons, and locale files are included in the extension package. No external script, font, or executable code is downloaded.

## Data usage declarations

The extension handles user data even when it stays on the device. Declare:

- Web browsing activity, specifically the URLs, page titles, and favicon URLs selected by the user through the Sweep action.
- User-generated content, specifically group names created by the user.

Data use:

- Providing the tab organization, search, synchronization, backup, and restore features.
- No advertising.
- No analytics or tracking.
- No sale of data.
- No transfer to a developer-operated server.
- No human access to user data.
- Synchronization only through Google Chrome's chrome.storage.sync service.

Certify every applicable Limited Use statement in the Privacy practices tab.

## Suggested distribution

- Visibility: Public, after the local production tests are complete.
- Regions: All regions.
- Mature content: No.

Use Private only if trusted testers must install through the Chrome Web Store before the public launch. Private, Unlisted, and Public submissions all go through review.

## Graphic assets

- Store icon: `release/assets/store-icon-128.png`
- Screenshot: `release/assets/screenshot-dashboard-1280x800.png`
- Small promo tile: `release/assets/promo-tile-440x280.png`

## Package

Run:

```powershell
npm run build:release
```

Upload the generated file from `dist/`. The generated package excludes tests, documentation, release files, and the development `key` value.

The GitHub release workflow runs for a version tag such as `v1.4.0`, rebuilds the package, runs all tests, and attaches the ZIP to the GitHub Release.

After the first upload, open Package, select View public key, and place the Web Store public key in the source manifest if the local development installation must use the same extension ID as the Store item.

## Actions that require the publisher

1. Create or access the Chrome Web Store developer account.
2. Enable two-step verification.
3. Pay the one-time registration fee.
4. Declare Trader or Non-Trader status and complete any required verification.
5. Enable GitHub Pages from the `main` branch and the `/docs` folder of `KyriakosGian/Tabel`.
6. Verify the published GitHub Pages URL in Google Search Console if an official publisher URL is desired.
7. Upload the ZIP, complete the listing fields, and submit it for review.
