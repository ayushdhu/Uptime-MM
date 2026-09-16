# Uptime iPad app

React Native (bare, TypeScript) app for the technician walkthrough. iPad first.
Offline first: every action writes to SQLite on the device and a sync queue
pushes to the Rails API when a connection is available.

## Run

```sh
npm install
cd ios && bundle install && bundle exec pod install && cd ..
npm run ios -- --simulator "iPad Pro 11-inch (M4)"
npm test          # jest: checklist rules, sync ordering, report, sync engine against in-memory SQLite
npm run typecheck
```

Sign in with a technician account; the server URL is editable on the login
screen (default `http://localhost:3000`). Reference data (customers, assigned
machines, published checklist templates, open High events) is pulled on every
sync.

Xcode project notes: `Info.plist` carries the camera and NFC usage strings;
`UptimeApp.entitlements` enables the NFC reader session (attach it to the target
under Signing & Capabilities → Near Field Communication Tag Reading).

## Layout

- `src/domain/` — types mirroring the server schema and the pure rules:
  conditional item filtering, template selection, the tire refill and battery
  auto-High rules, round up, completion and lock checks, carry-forward rechecks.
- `src/db/` — SQLite schema (mirrors the inspection chain plus `sync_queue`) and
  repositories. Locked inspections refuse writes at the repository level.
- `src/sync/` — queue ordering (parent before child) and the `SyncEngine`:
  pull reference data, then push inspections → items → photos (presign, PUT,
  confirm with SHA-256, only then delete the local file) → signatures →
  High severity events → lock → notes. Everything is idempotent on
  `client_generated_id`. Local inspections purge 30 days after confirmed sync.
- `src/services/` — camera capture into app private storage with SHA-256 at
  capture, NFC read/write, signature PNGs, storage guard (warn < 2 GB, block
  < 500 MB), the inspection workflow.
- `src/screens/` — login, home (NFC tap + search), unregistered tag, setup
  wizard (fixed 10 step order), machine, walkthrough (one item per screen,
  photo before grading, High most prominent, typed skip reason), High severity
  conversation flow with owner signature, checkout (summary, signer statement,
  signature, lock), on-device HTML report, inspection detail with append-only
  notes and senior-technician resolution of open High items, photo browser by
  visit or by item, sync status.
- `src/report/html.ts` — the stacked severity report rendered from local data.

## Native modules

`react-native-nfc-manager`, `react-native-image-picker` (camera, `saveToPhotos:
false`), `@op-engineering/op-sqlite`, `react-native-fs` (private storage and
`hash(path, 'sha256')`), `react-native-signature-canvas` + `react-native-webview`,
`@react-native-community/netinfo`, `react-native-device-info`.
