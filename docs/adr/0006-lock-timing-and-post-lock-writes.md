# ADR-0006: Lock timing and the only permitted post-lock writes

Status: accepted. Date: 2026-09-16.

## Context

The device locks the inspection at checkout, usually offline, before anything
has reached the server. The server also needs to lock, and the PDF is
generated on the server after sync.

## Decision

- The device sets `status = locked` and `locked_at` locally at checkout and
  refuses further edits at the repository level.
- The sync engine pushes the inspection, items, photos, signatures and High
  severity events first, then `POST /inspections/:id/lock` with the device's
  `locked_at`. The server validates completeness (every item resulted or
  explicitly skipped, a photo on every tiered/pass_fail item, a signed High
  event for every High item, a checkout signature), locks, and generates the
  PDF in the same transaction.
- After the server lock, the database triggers permit exactly: `synced_at` on
  the inspection, and `uploaded_at` / `retention_state` / `thumbnail_s3_key` /
  `s3_url` on photos, via dedicated SQL functions. Inserting items, photos or
  signatures into a locked inspection is rejected (the spec names UPDATE and
  DELETE; INSERT is rejected too because a late child row would change the
  record).
- Notes are append only and are the one write that works on a locked
  inspection, from the app and the API.
- A lock retry that receives 409 (already locked) is treated as success by the
  sync engine.

## Consequences

Photo confirmations must complete before the lock is sent; the queue order
guarantees this, and a photo that fails hash verification blocks the lock for
that inspection until it is fixed or re-captured, so a record never locks with
a photo the server could not verify.
