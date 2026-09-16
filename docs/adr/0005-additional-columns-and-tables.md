# ADR-0005: Columns and tables added beyond spec section 4

Status: accepted. Date: 2026-09-16.

Small additions, each with its reason:

- `api_tokens` — per device/user bearer tokens (spec 9 asks for token auth
  per device/user but defines no table). Only the SHA-256 digest is stored.
- `inspection_reports` — the generated PDF's S3 key, SHA-256, size and page
  count, linked one-to-one from the inspection (spec 5.5 asks for the PDF to be
  stored with its own hash and linked).
- `inspection_items.measurement_detail` (jsonb) — structured detail for the
  special measurement flows: tire refill readings at 1 and 5 minutes, battery
  tester verdict, startup codes. The scalar `measurement_value` remains the
  primary reading.
- `client_generated_id` on `inspection_items`, `photos`, `signatures`,
  `high_severity_events` and `inspection_notes` (unique) — the spec puts it only
  on inspections, but every child row is also created offline and retried, and
  retrying must never duplicate. Write endpoints accept either a server id or a
  client id wherever a child references a sibling.
- `inspection_notes.updated_at` — present because Rails timestamps expect it;
  the trigger forbids any UPDATE so it can never differ from `created_at`.
- `discrepancy_alerts.reviewed_by_user_id` — who reviewed the alert.
- Postgres check constraints: `skip_reason` required when `skipped`,
  `recheck_interval_days` required when the machine stays in service, SHA-256
  columns must be 64 hex characters.
