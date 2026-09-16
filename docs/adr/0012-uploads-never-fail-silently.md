# ADR-0012: Upload host resolution, visible sync failures, in-app PDF

Status: accepted. Date: 2026-09-16. Follows pilot run 1.

## What broke

1. With no `S3_BUCKET` and no `API_BASE_URL`, dev storage presigned
   `http://localhost:3000/dev/storage/...`. Inside an Android emulator
   `localhost` is the emulator itself, so the PUT never reached the API even
   though the API was reachable on `10.0.2.2:3000`. Photos, signatures and
   the lock stalled, and nothing told the technician.
2. Some confirms failed with `422 hash_mismatch`. The suspected write race in
   dev storage was **not** the cause: the app's base64 decoder truncated
   every file whose byte length was not a multiple of 3 (it subtracted the
   padding count after already stripping the padding characters). The two
   confirmed photos (32829, 33225 bytes) are multiples of 3; the two
   rejected ones (33233, 32149) are not. Fixed and covered by a byte-exact
   test at the pilot's sizes.
3. The report link handed the PDF URL to an external viewer without the
   bearer token (401).

## Decisions

- **Upload URLs resolve against the API host the device already uses.** Dev
  storage now presigns a path-only URL (`/dev/storage/<key>`) unless
  `API_BASE_URL` is set; the app joins path-only URLs to its configured base,
  and rewrites the origin of any absolute `/dev/storage/` URL to the API's
  origin, since dev storage is served by the API by definition. Real S3 URLs
  are on a different host by design and are used as returned. The
  alternative (trust the response, fail loudly on host mismatch) was rejected
  because S3 always mismatches.
- **No upload may fail silently.** Every queue row persists its attempt
  count, last attempt time and last failure reason (with the server's error
  code and message, and what the row is: "photo of Hoses"). The sync bar
  shows the count of failing items and the latest reason; the sync screen
  shows every row's state with a per-row retry. Failures, including a 422 on
  confirm (re-upload) and a refused lock, are retried automatically with
  backoff (30 s doubling to 5 min) up to 8 attempts before a row is marked
  as needing attention. The local photo file is kept until the server
  confirms the hash, as before.
- **Dev storage writes to a temp file, flushes, fsyncs and renames** before
  answering 200, so a reader can never see a partial object. This was not
  the cause of the 422s but the ordering assumption is the same against S3.
- **Confirm answers specific errors**: `422 hash_mismatch`, `422
  object_missing`, `404 item_not_found`, each with a readable message.
  `wrap_parameters` is off for the photos controller.
- **Lock failures are visible.** The device records `server_locked_at` only
  when the server accepts the lock. The report, inspection and machine
  screens say "locked on this tablet only, NOT yet recorded on the server"
  with the outstanding list (photos waiting, signatures waiting, lock not
  confirmed) and the last error. The server's lock validation now returns
  counted, named reasons ("14 item(s) missing a required photo: ...", "no
  checkout signature").
- **The server PDF is fetched in-app with the bearer token** into
  app-private storage, its SHA-256 checked against the hash the server
  reported at lock time, and rendered in-app. Android's WebView cannot
  display PDFs, so the existing WebView is used for the on-device HTML
  report and `react-native-pdf` (with `react-native-blob-util` for the
  authenticated download) renders the server PDF. The technician is never
  bounced to an external app. The server PDF is offered only once
  `server_locked_at` is set; before that the screen shows the on-device
  report and says there is no PDF yet.
- A `__DEV__`-only "simulate tag" input on the home screen exercises the
  tag resolution path on an emulator without NFC.
