# Tabel

Chrome extension για αποθήκευση και οργάνωση ανοιχτών καρτελών σε ομάδες.

Έκδοση 1.4.0, Manifest V3, ελληνικό και αγγλικό περιβάλλον.

![Tabel Dashboard](release/assets/screenshot-dashboard-1280x800.png)

## Λειτουργίες

- Αποθήκευση των μη καρφιτσωμένων καρτελών του ενεργού παραθύρου.
- Επαναφορά μίας καρτέλας ή ολόκληρης ομάδας.
- Αναζήτηση, μετονομασία, διαγραφή και drag and drop.
- Επιλογή εμφάνισης ομάδων και φωτεινού ή σκοτεινού θέματος.
- Συγχρονισμός συσκευών μέσω `chrome.storage.sync`.
- Εισαγωγή και εξαγωγή δεδομένων σε JSON.
- Ελληνικό και αγγλικό περιβάλλον.

## Εγκατάσταση

1. Άνοιξε το `chrome://extensions/` στον Chrome.
2. Ενεργοποίησε το Developer mode.
3. Επίλεξε Load unpacked.
4. Επίλεξε τον βασικό φάκελο του project.

## Tests

Απαιτείται Node.js 22 ή νεότερο.

```bash
npm test
```

Τα tests χρησιμοποιούν το ενσωματωμένο `node:test` και δεν χρειάζονται πρόσθετα πακέτα.

## Δημόσια διάθεση

- Το `docs/` περιέχει τη δίγλωσση one page παρουσίαση για GitHub Pages.
- Οι σελίδες απορρήτου και υποστήριξης βρίσκονται επίσης στο `docs/`.
- Το `release/` περιέχει τα κείμενα και τα γραφικά του Chrome Web Store.
- Η εντολή `npm run build:release` δημιουργεί καθαρό ZIP στον φάκελο `dist/`.
- Το GitHub Actions εκτελεί τα tests σε κάθε push και pull request.
- Ένα tag της μορφής `v1.4.0` δημιουργεί αυτόματα GitHub Release με το ZIP του Chrome Web Store.

## Δημιουργία έκδοσης

```bash
npm test
npm run build:release
git tag v1.4.0
git push origin v1.4.0
```

Το tag πρέπει να συμφωνεί με την έκδοση των `manifest.json` και `package.json`.

## Δομή

```text
Tabel-app/
├── background.js
├── manifest.json
├── dashboard/
├── options/
├── icons/
├── _locales/
├── docs/
├── release/
├── scripts/
└── tests/
```

## Αποθήκευση δεδομένων

- IndexedDB για ομάδες και καρτέλες.
- `chrome.storage.local` για ρυθμίσεις, αποδοχή απορρήτου και την ασφαλή ουρά sweep.
- `chrome.storage.sync` για συγχρονισμό συσκευών.

## Άδεια

MIT. Δες το αρχείο `LICENSE`.
