# Uptime API

Rails 8.1 API-only backend for the Uptime pilot. PostgreSQL for everything
relational, object storage (S3 compatible) for photo, signature and report
bytes. Read `docs/spec.md` at the repository root before changing anything in
the inspection chain.

## Run locally

```sh
bundle install
bin/rails db:create db:migrate db:seed   # seeds alpha-1 checklists + pilot users outside production
bin/rails server                          # http://localhost:3000
bin/rails test
```

Postgres connection comes from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`
(defaults: localhost, 5432, postgres, none). Production uses `DATABASE_URL`.

Without `S3_BUCKET` set, object storage runs on local disk under
`tmp/storage/<env>` and presigned upload URLs point at the dev-only
`PUT /dev/storage/*key` endpoint, so the whole flow (presign, upload, server side
SHA-256 verification, PDF report) works offline. Set `S3_BUCKET`, `AWS_REGION`
and the usual AWS credentials (plus `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE=1` for
non-AWS stores) to use real object storage. `API_BASE_URL` is the public URL
the device should use for dev-storage uploads.

Seeded pilot logins (non-production only): `admin@uptime.local` /
`changeme-admin`, `senior@uptime.local` / `changeme-senior`,
`tech@uptime.local` / `changeme-tech`.

## Layout

- `db/migrate/…create_uptime_schema.rb` — every table, enum and index.
- `db/migrate/…add_immutability_triggers.rb` — the Postgres triggers that make a
  locked inspection immutable and `inspection_notes` append only. The schema is
  dumped as `db/structure.sql` so the triggers travel with it.
- `db/seeds/checklists/` — `_shared_criteria.yml` plus one YAML per machine
  class, generated from the PM checklist workbook by
  `docs/checklists/xlsx_to_yaml.py`. `ChecklistSeeder` merges shared criteria
  into every template item at seed time.
- `app/models/concerns/locked_inspection_guard.rb` — ORM mirror of the triggers.
- `app/policies/` — Pundit. Technicians only ever see machines of customers they
  are assigned to (`customer_assignments`).
- `app/services/storage.rb` — S3 / local disk facade. `hash_verifier.rb`
  recomputes SHA-256 on the stored object before a photo or signature is
  accepted. `report_generator.rb` renders the stacked severity PDF with Prawn.
- `test/integration/pilot_flow_test.rb` — the definition of done (spec 12)
  walked end to end through the HTTP API.

## API (v1)

All endpoints are under `/api/v1`, JSON, `Authorization: Bearer <token>`.
Send `X-Device-Id` and `X-Device-Time` (ISO 8601) on every request; the server
logs clock skew over 10 minutes and echoes it in `X-Clock-Skew-Seconds`.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password, device_id }` → `{ token, user }` |
| DELETE | `/auth/logout` | revokes the token |
| GET | `/me` | |
| GET | `/customers?since=` | reference data pull (scoped) |
| GET | `/checklist_templates?since=` | published templates |
| GET | `/machines?since=` | reference data pull (scoped) |
| GET | `/machines/lookup?nfc=` `?serial=` `?q=` | all resolve to the same `machines.id` |
| POST | `/machines` | setup wizard; duplicate serial returns the existing machine with `existing: true` |
| POST | `/machines/:id/retag` | senior technician+ |
| PATCH | `/machines/:id` | admin (customer reassignment on sale) |
| GET | `/machines/:id/history` | inspections, open/resolved High events, photo index |
| POST | `/inspections` | idempotent on `client_generated_id`; records discrepancy alerts |
| POST | `/inspections/:id/items` | batch, idempotent per item `client_generated_id` |
| POST | `/photos/presign` | `{ purpose: photo|signature, inspection_item_id|inspection_id, client_generated_id, content_type }` |
| POST | `/photos/confirm` | server recomputes SHA-256; `422 hash_mismatch` on mismatch |
| POST | `/inspections/:id/signatures` | `visit_checkout` or `high_severity_ack` |
| POST | `/high_severity_events` | requires every conversation step ticked and a `high_severity_ack` signature |
| POST | `/high_severity_events/:id/resolve` | senior technician+ |
| POST | `/inspections/:id/lock` | validates completeness, locks, generates the PDF |
| GET | `/inspections/:id/report` | the PDF |
| GET/POST | `/inspections/:id/notes` | append only; works on locked inspections |
| GET | `/discrepancy_alerts` | admin |

Every write to a locked inspection answers `409`. Item and signature ids in
payloads may be either server ids or the device's `client_generated_id`.
