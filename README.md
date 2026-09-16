# Uptime

Documentation product delivered through a preventative maintenance service for
heavy equipment. A technician walks every machine through a fixed checklist,
photographs every inspection point, grades wear items Low / Medium / High and
produces a signed, timestamped, immutable record. The record is the product.

Read [`docs/spec.md`](docs/spec.md) before changing anything. Departures from
it are recorded in [`docs/adr/`](docs/adr/).

```
api/    Rails 8 API (PostgreSQL, S3 compatible storage, Prawn PDF reports)
app/    React Native Android tablet app (offline first, SQLite + sync queue)
docs/   the spec, ADRs, checklist tooling
uptime_pm_checklists_alpha1.xlsx   the PM checklist workbook (alpha-1)
```

The pilot device is an **Android tablet with NFC** (ADR-0009). Many Android
tablets ship without an NFC reader; whoever buys the hardware must check for
NFC explicitly. Tags are NTAG213/215/216.

## Quick start

Backend (needs Postgres 16 and Ruby 3.3):

```sh
cd api
bundle install
bin/rails db:create db:migrate db:seed    # seeds alpha-1 checklists and pilot users
bin/rails test
bin/rails server                          # http://localhost:3000
```

App (needs Node 22, JDK 17, the Android SDK; see `app/README.md` for the Linux setup):

```sh
cd app
npm install
npm test && npm run typecheck
npx react-native run-android          # tablet connected over USB with USB debugging on
```

Sign in on the tablet with `tech@uptime.local` / `changeme-tech` (seeded outside
production) pointing at your machine's address, tap **Sync now**, then hold the
tablet against the seeded skid steer's tag (serial `PILOT-SS-0001`, tag
`04A1B2C3D4E5F6`) or search for it.

## Pilot run book (definition of done, spec 12)

1. **Tap the tag**: with the app open on Home (or closed), hold the tablet
   against the machine tag; the machine opens. NFC must be on in system
   settings; if it is off the app says so and offers serial search.
   Unregistered tags offer "link by serial" or the setup wizard (senior
   technician).
2. **Walk through offline**: airplane mode on. The first photo asks for camera
   permission; refusing it blocks the walkthrough (photos are mandatory) and
   leaves the inspection in progress. Every item needs a photo before the
   grading buttons unlock; skipping needs a typed reason; High is the big
   button.
3. **High finding**: at the end of the walk the High severity conversation
   runs for each High item: tick the four steps, record the decision, owner
   statement in their words, owner signature.
4. **Lock and report**: checkout shows counts, signer statement and signature;
   signing locks the inspection and shows the stacked High / Medium / Low
   report rendered on the tablet.
5. **Sync**: back online, Sync now. Photos are presigned, uploaded, confirmed
   by hash and only then deleted from the tablet (the Sync screen shows the
   count of photo files still on device). The server locks, generates the PDF
   and stores it with its own SHA-256.
6. **Next visit**: the open High item is injected at the top as a mandatory
   recheck needing a fresh photo and tier. A senior technician marks it
   resolved from the inspection screen after that visit syncs.
7. **Notes on a locked record**: the inspection screen only offers "Append
   note"; the database trigger refuses any edit to the locked chain.

## Verification

- `api`: 19 tests / 296 assertions covering the Postgres immutability triggers,
  ORM guards, template selection and versioning, and an end to end HTTP walk
  of the pilot flow (`test/integration/pilot_flow_test.rb`).
- `app`: 27 jest tests covering the checklist rules, sync ordering, the report,
  the sync engine running the real repositories on in-memory SQLite against a
  fake server that checks hashes and idempotency, the NFC foreground lifecycle
  and debounce, and the camera-permission-denied path.
