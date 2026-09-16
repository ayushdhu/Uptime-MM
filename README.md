# Uptime

Documentation product delivered through a preventative maintenance service for
heavy equipment. A technician walks every machine through a fixed checklist,
photographs every inspection point, grades wear items Low / Medium / High and
produces a signed, timestamped, immutable record. The record is the product.

Read [`docs/spec.md`](docs/spec.md) before changing anything. Departures from
it are recorded in [`docs/adr/`](docs/adr/).

```
api/    Rails 8 API (PostgreSQL, S3 compatible storage, Prawn PDF reports)
app/    React Native iPad app (offline first, SQLite + sync queue)
docs/   the spec, ADRs, checklist tooling
uptime_pm_checklists_alpha1.xlsx   the PM checklist workbook (alpha-1)
```

## Quick start

Backend (needs Postgres 16 and Ruby 3.3):

```sh
cd api
bundle install
bin/rails db:create db:migrate db:seed    # seeds alpha-1 checklists and pilot users
bin/rails test
bin/rails server                          # http://localhost:3000
```

App (needs Node 22, Xcode, CocoaPods):

```sh
cd app
npm install
npm test && npm run typecheck
cd ios && bundle exec pod install && cd ..
npm run ios -- --simulator "iPad Pro 11-inch (M4)"
```

Sign in on the iPad with `tech@uptime.local` / `changeme-tech` (seeded outside
production) pointing at your machine's address, tap **Sync now**, then tap the
seeded skid steer (serial `PILOT-SS-0001`, tag `04A1B2C3D4E5F6`) or search for
it.

## Pilot run book (definition of done, spec 12)

1. **Tap the tag**: Home → Tap NFC tag → machine opens. Unregistered tags offer
   "link by serial" or the setup wizard (senior technician).
2. **Walk through offline**: airplane mode on. Every item needs a photo before
   the grading buttons unlock; skipping needs a typed reason; High is the big
   button.
3. **High finding**: at the end of the walk the High severity conversation
   runs for each High item: tick the four steps, record the decision, owner
   statement in their words, owner signature.
4. **Lock and report**: checkout shows counts, signer statement and signature;
   signing locks the inspection and shows the stacked High / Medium / Low
   report rendered from the iPad.
5. **Sync**: back online, Sync now. Photos are presigned, uploaded, confirmed
   by hash and only then deleted from the iPad (the Sync screen shows the
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
- `app`: 18 jest tests covering the checklist rules, sync ordering, the report
  and the sync engine running the real repositories on in-memory SQLite
  against a fake server that checks hashes and idempotency.
