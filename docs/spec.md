# Uptime Machine Monitoring: MVP Build Spec

This document is the source of truth for building the Uptime pilot app. Read it fully before writing code. Where it says MVP, that is what gets built now. Where it says LATER, design the schema so it can be added without migration pain, but do not build it.

## 1. What Uptime is

Uptime is a documentation product delivered through a preventative maintenance service for heavy equipment (skid steers, wheel loaders, excavators, dozers, farm tractors). A technician visits a customer site, walks every machine through a fixed checklist, photographs every inspection point, grades each wear item Low / Medium / High, and produces a signed, timestamped, immutable record.

The record is the product. Everything in the design serves one goal: an inspection history that holds up as evidence years later. Treat the data layer as the most important part of the system.

Uptime inspects, documents, flags, and communicates. It does not diagnose or repair. The app must never present findings as a diagnosis.

## 2. Stack (fixed, do not substitute)

* Mobile app: React Native (iPad first; technicians carry an iPad on every visit)
* Backend: Ruby on Rails (API only mode)
* Database: PostgreSQL
* Photo storage: S3 compatible object storage
* Auth: Rails backed, role based (see section 8)

Postgres is chosen over MySQL/MariaDB because checklist templates vary per machine class and are stored as versioned JSONB alongside strict relational tables with foreign keys.

## 3. MVP scope

IN for the pilot (built now):

1. NFC tag scan to open a machine record, with serial number search as fallback
2. Machine setup wizard that assigns a Unique Machine ID and locks a checklist template
3. Inspection walkthrough: every checklist item, in order, with mandatory photo capture on every item
4. Severity tiering (Low / Medium / High) and pass/fail for safety items
5. High severity handling flow with structured conversation checklist and on screen owner signature
6. Report generation (three page stacked severity report)
7. Offline first: a full walkthrough including photos completes with no connection and syncs later
8. Immutable inspection records with append only notes

OUT of the MVP (schema should anticipate them):

* Stripe billing, invoices, payment terms, credit applications
* Owner / customer accounts and the read only owner portal
* Notification engine (100 Hr Check scheduling notices, PM reminders)
* Third party mechanic quote marketplace
* AI photo grading
* Self serve documentation tier

## 4. Data model

All identifiers are UUIDs. All tables carry Rails `created_at` / `updated_at`. Money is never stored in the MVP.

### 4.1 Core principle

History belongs to the machine, not the customer. Every inspection, checklist item, photo, and note chains back to `machines.id`. Selling a machine to another customer is one update to `machines.customer_id`; the entire history follows.

### 4.2 Tables

**customers**

* id (uuid, PK)
* name
* billing_address, site_address
* contact_name, contact_phone, contact_email
* service_cadence (enum: weekly, biweekly, monthly)
* payment_terms (enum: due_on_receipt, net_30, net_60; default due_on_receipt) LATER
* active (boolean)

**machines**

* id (uuid, PK) — this is the Unique Machine ID. Never changes for the life of the machine.
* customer_id (uuid, FK customers, NOT NULL, indexed)
* serial_number (string, UNIQUE, NOT NULL, indexed) — permanent secondary lookup
* nfc_tag_id (string, UNIQUE, nullable, indexed) — current tag; nullable so a lost tag never orphans the record
* make, model, year
* machine_class (enum: skid_steer, wheel_loader, excavator, dozer, farm_tractor)
* drive_type (enum: wheeled, tracked)
* has_def (boolean) — DEF cap physically present
* emissions_tier (enum: tier_3, tier_4) — derived: year > 2010 and has_def = tier_4, else tier_3
* checklist_template_id (uuid, FK checklist_templates, NOT NULL) — locked at setup, auto loads every visit
* current_hour_meter (integer) — last logged reading
* estimated_hours_per_week (integer) — owner supplied at setup, used for 100 Hr projection LATER
* next_100hr_due_at_hours (integer) — computed LATER
* active (boolean)

Rules:

* Lookup by NFC tag, serial number, or customer name must all resolve to the same `machines.id`.
* Re tagging = update `nfc_tag_id` on the existing row. Never create a new machine for a new tag.
* Serial number is validated for uniqueness at setup. If a serial already exists, the wizard opens that machine instead of creating a duplicate.

**nfc_tag_history** (audit trail of tag reassignments)

* id, machine_id (FK), nfc_tag_id, assigned_at, removed_at, assigned_by_user_id

**checklist_templates**

* id (uuid, PK)
* machine_class (enum, same as machines)
* drive_type (enum, nullable) — nullable means applies to both
* has_def (boolean, nullable) — nullable means applies to both
* version (string, NOT NULL) — e.g. `alpha-1`, `alpha-2`, `v1`, `v2`
* items (jsonb, NOT NULL) — ordered array, schema in 4.3
* published_at (timestamp, nullable) — only published templates are selectable
* UNIQUE (machine_class, drive_type, has_def, version)

Rules:

* Templates are immutable once published. A change = a new row with a new version.
* An inspection stores the exact template version it was performed against. Old reports always render against their own version, never the latest.
* The setup wizard picks the highest published version matching (machine_class, drive_type, has_def).

**inspections**

* id (uuid, PK)
* machine_id (uuid, FK machines, NOT NULL, indexed)
* customer_id (uuid, FK customers, NOT NULL) — denormalized snapshot of who owned the machine at inspection time; do not update on machine sale
* technician_id (uuid, FK users, NOT NULL)
* checklist_template_id (uuid, FK checklist_templates, NOT NULL)
* checklist_version (string, NOT NULL) — copied at creation, belt and braces
* inspection_type (enum: walkthrough, pm_100hr, baseline) — baseline = first ever visit on a machine
* performed_at (timestamp, NOT NULL) — real world time the tech started the check on site, from the device clock. This is the legally meaningful timestamp.
* completed_at (timestamp, nullable) — set when the tech finishes the walkthrough
* synced_at (timestamp, nullable) — when the server received it. Will differ from performed_at, sometimes by hours.
* hour_meter_reading (integer, NOT NULL)
* status (enum: in_progress, completed, locked)
* locked_at (timestamp, nullable)
* device_id (string) — which iPad produced it
* client_generated_id (uuid, UNIQUE) — generated on device, used for idempotent sync

Rules:

* Two technicians inspecting the same machine on the same day produce two inspection rows. Never merge or overwrite. Flag a `discrepancy_alert` for office review when this happens (LATER: alert delivery; MVP: just record both).
* Once status = locked, the row and all child rows are immutable at the database level (see 4.5).

**inspection_items**

* id (uuid, PK)
* inspection_id (uuid, FK inspections, NOT NULL, indexed)
* template_item_key (string, NOT NULL) — stable key from the template JSON, e.g. `hyd_hose_main`
* position (integer) — order in the walkthrough
* component_name (string) — snapshot of the template label at inspection time
* result_type (enum: tiered, pass_fail, measurement)
* severity (enum: low, medium, high, nullable) — for tiered items
* pass (boolean, nullable) — for pass_fail items
* measurement_value (decimal, nullable), measurement_unit (string, nullable) — tire psi, battery volts, hour meter
* technician_note (text, nullable) — written during the walkthrough only
* skipped (boolean, default false), skip_reason (text) — must be explicit; silent gaps are not allowed
* carried_forward_from_item_id (uuid, FK inspection_items, nullable) — see High carry forward, section 6

**photos**

* id (uuid, PK)
* inspection_item_id (uuid, FK inspection_items, NOT NULL, indexed)
* s3_key (string, NOT NULL)
* s3_url (string) — derived, may be presigned at read time
* sha256 (string, NOT NULL, 64 hex chars) — computed on device before upload, verified by server after upload
* byte_size (integer)
* captured_at (timestamp, NOT NULL) — device clock at capture
* uploaded_at (timestamp, nullable)
* width, height
* thumbnail_s3_key (string, nullable)
* retention_state (enum: full, thumbnail_only) — full for 12 months, then compressed LATER

Rules:

* Postgres stores metadata only. Image bytes live in S3.
* Every inspection_item with result_type tiered or pass_fail requires at least one photo before the item can be marked done. No exceptions, no severity based skipping.
* The server recomputes SHA 256 on receipt and rejects the upload if it does not match the client supplied hash.

**inspection_notes** (append only)

* id (uuid, PK)
* inspection_id (uuid, FK inspections, NOT NULL, indexed)
* inspection_item_id (uuid, FK inspection_items, nullable) — null means note applies to the whole inspection
* author_user_id (uuid, FK users, NOT NULL)
* author_role (enum snapshot: technician, admin, owner)
* body (text, NOT NULL)
* created_at (timestamp) — no updated_at semantics; rows are never edited or deleted

This is the only way to add information to a locked inspection. "The tech missed X" becomes a note, never an edit.

**high_severity_events**

* id (uuid, PK)
* inspection_item_id (uuid, FK inspection_items, NOT NULL)
* machine_id (uuid, FK machines, NOT NULL, indexed) — denormalized for fast "open High items on this machine" queries
* opened_at (timestamp, NOT NULL)
* conversation_checklist (jsonb) — see section 6 for the structure
* machine_out_of_service (boolean, NOT NULL)
* recheck_interval_days (integer, nullable) — required when out_of_service = false
* repair_plan (text, nullable)
* owner_signature_id (uuid, FK signatures, NOT NULL)
* resolved_at (timestamp, nullable)
* resolved_by_user_id (uuid, nullable)
* resolved_in_inspection_id (uuid, FK inspections, nullable)
* resolution_note (text)

Rules:

* While `resolved_at` is null, the event is OPEN. Every subsequent inspection on the same machine must include a mandatory recheck item for it (see section 6).

**signatures**

* id (uuid, PK)
* inspection_id (uuid, FK inspections, NOT NULL)
* signature_type (enum: visit_checkout, high_severity_ack)
* signer_name (string, NOT NULL) — typed by the signer
* signer_role (string) — owner, foreman, designated representative
* signer_statement (text) — the owner's own words as entered, not the tech's paraphrase
* image_s3_key, sha256 — the signature strokes rendered to PNG, stored like a photo
* signed_at (timestamp, NOT NULL) — device clock
* device_id

**users**

* id (uuid, PK)
* name, email, phone
* role (enum: technician, senior_technician, admin, owner) — owner role is for customer portal, LATER
* customer_id (uuid, FK, nullable) — set only for owner role
* active (boolean)

**consumable_records** (schema now, minimal UI in MVP)

* id, machine_id (FK), inspection_id (FK, nullable)
* consumable_type (enum: fuel_filter, air_filter, hydraulic_filter, cabin_filter, engine_oil, hydraulic_oil, belt_pto, belt_ac, belt_alternator, other)
* changed_at (date), hour_meter_at_change (integer)
* source (enum: uptime_changed, date_read_from_part, unknown)
* interval_hours (integer, nullable) — manufacturer interval for next due
* note

Overdue logic (LATER, but the data supports it): if source = uptime_changed or date_read_from_part, count down from changed_at / hour_meter_at_change. If source = unknown, the app cannot compute overdue and the tech is prompted at checkout to offer a filter change as a separate signed add on.

**sync_queue** (device side only, in SQLite / local store, not Postgres)

* see section 7

### 4.3 Checklist template JSON schema

`checklist_templates.items` is an ordered array. Each element:

```json
{
  "key": "hyd_hose_main",
  "component": "Hydraulic hoses (main circuit)",
  "section": "Hydraulics",
  "cadence": "weekly",
  "check_method": "visual",
  "result_type": "tiered",
  "photo_required": true,
  "tier_criteria": {
    "low": "Minor surface discoloration or light abrasion on outer sleeve. No active leak, no cracking.",
    "medium": "Visible cracking or abrasion partway through outer layer. Occasional weeping under load, not a steady drip.",
    "high": "Steady active leak, dripping or pooling under load, OR cracking through to exposed inner braiding or metal."
  },
  "default_if_ambiguous": "round_up",
  "measurement": null,
  "notes_to_tech": "Check full length including behind cylinder mounts."
}
```

Field rules:

* `cadence`: `weekly` or `monthly`. Monthly items only appear in a walkthrough when the inspection_type is pm_100hr or the customer cadence makes it due. MVP: show all items every time and let the tech mark not_applicable if needed; filtering by cadence is LATER.
* `check_method`: `visual`, `physical`, `fluid_level`, `measurement`, `function`. Belts and bolts are `physical` (tug / deflection) on every class except skid_steer where they are `visual` only due to compartment access.
* `result_type`: `tiered` (Low/Medium/High), `pass_fail` (safety and function items: seatbelt, backup alarm, PWAS, PTO shields, interlocks), or `measurement` (tire psi, battery volts, hour meter; may also carry a tier).
* `default_if_ambiguous`: always `round_up`. The UI must make the higher tier the path of least resistance when the tech hesitates.
* `measurement`: for measurement items, `{ "unit": "psi", "reference": null }` or `{ "unit": "volts", "reference": 12.6 }`. Battery reference scales with system voltage (12.6 for 12 V, 25.2 for 24 V).

Special measurement flows the UI must support:

* Tire low pressure test: if a tire reads low, tech refills, records psi at 1 minute and again at 5 minutes. If the 5 minute reading is below the 1 minute reading, the item auto grades High.
* Battery: any reading the tester reports as low, dead, or bad auto grades High regardless of root cause.

### 4.4 Seed templates

Seed one `alpha-1` template per machine class from the checklist spreadsheets (Skid Steer, Wheel Loader, Excavator, Dozer, Farm Tractor). Shared component criteria (hoses, belts, tires, battery, electrical connections, hydraulic cylinders, pins and bushings, tracks, fluid levels, lug nuts) are identical across classes and should be defined once in a shared criteria file and merged into each template at seed time so they never drift.

Seeds live in `db/seeds/checklists/<machine_class>.yml` plus `db/seeds/checklists/_shared_criteria.yml`.

### 4.5 Immutability enforcement

Do not rely on application code alone.

* Add a Postgres trigger on `inspections`, `inspection_items`, `photos`, and `signatures` that raises an exception on UPDATE or DELETE when the parent inspection has status = locked. The only permitted UPDATE on a locked inspection is setting `synced_at` and photo `uploaded_at` / `retention_state` via a dedicated function.
* `inspection_notes` has a trigger rejecting all UPDATE and DELETE unconditionally.
* Rails models mirror this with `readonly?` returning true once locked, so the ORM fails fast before hitting the trigger.
* No soft delete anywhere in the inspection chain. Deletion of a machine or customer is not a feature. Use `active = false`.

### 4.6 Indexes

* machines: (serial_number) unique, (nfc_tag_id) unique, (customer_id)
* inspections: (machine_id, performed_at desc), (client_generated_id) unique, (technician_id, performed_at)
* inspection_items: (inspection_id, position)
* photos: (inspection_item_id), (sha256)
* high_severity_events: (machine_id) where resolved_at is null
* inspection_notes: (inspection_id, created_at)

## 5. App flows

### 5.1 Machine lookup

1. Tap NFC tag → read tag ID → resolve to machine → open machine screen.
2. Fallback: search field accepting serial number or customer name → list → open machine.
3. If the tag reads but no machine matches, show "Unregistered tag" with two options: link to an existing machine (by serial) or start the setup wizard.

### 5.2 Setup wizard (creates a machine)

Order is fixed:

1. Machine type: Skid Steer / Loader / Excavator / Tractor / Dozer
2. Wheeled or tracked
3. DEF cap present? (physical check, yes/no)
4. Year (used with step 3 to derive emissions tier)
5. Make, model, serial number (serial uniqueness check happens here)
6. Current hour meter reading
7. Estimated hours per week (owner supplied)
8. Customer assignment
9. Write NFC tag and link it (or skip and link later)
10. Select template: highest published version matching the answers; show which version was locked.

On completion, the app immediately starts a `baseline` inspection. The baseline is not a separate exercise; it is the first walkthrough and captures pre existing condition.

### 5.3 Inspection walkthrough

* One item per screen, in template order. Show component name, check method, and the three tier criteria in plain text on screen.
* Photo capture is mandatory before the tier / pass / measurement controls unlock. Multiple photos per item allowed.
* Tier buttons: Low / Medium / High. High is visually prominent. Pass/fail items show Pass / Fail.
* Optional technician note per item.
* Cannot advance without a result. Skip requires a typed reason.
* Open High items from prior inspections on this machine are injected at the top of the walkthrough as mandatory recheck items (see 6).
* Progress bar and item count visible at all times.
* Selecting High on any item opens the High severity flow (6) at the end of the walkthrough, not immediately, so the tech finishes the walk first.

### 5.4 Checkout

1. Summary screen: counts by tier, list of High items, list of open carried forward items and whether each was rechecked.
2. Owner (or delegated signer) enters their name, role, and their own statement in their own words.
3. Signature capture.
4. Inspection status → locked. locked_at set. Report generated.
5. Sync begins if online.

### 5.5 Report

Generated as a PDF on the server after sync (and rendered on device from local data if offline).

* Page order: High, Medium, Low. A page is omitted entirely if that tier has zero items.
* Each page is a table: Component | Finding (tier criteria text that matched) | Technician note.
* Header on every page: customer, machine (make/model/serial/Unique ID), hour meter, performed_at, technician, checklist version.
* Footer: signer name, role, signed_at. High page additionally shows the High severity acknowledgment signature.
* Photos are NOT in the report. They are browsable in the app per machine, by visit date or by checklist item.
* Store the generated PDF in S3 with its own SHA 256, linked from the inspection.

## 6. High severity handling

A High finding is a conversation, not a notification.

When a walkthrough contains one or more High items, checkout cannot begin until the High severity flow is completed for each:

1. Show the item, its photos, and the matched criteria.
2. Structured conversation checklist (stored as `conversation_checklist` JSONB), each step must be ticked:
   * Item identified and shown to the owner
   * Photo shown to the owner
   * Recommendation stated (repair before further use)
   * Decision recorded: machine out of service (yes/no)
   * If no: recheck interval agreed (days) and repair plan entered
3. Owner statement in their own words.
4. Owner signature (`signature_type = high_severity_ack`).
5. Signing creates the `high_severity_events` row and generates the High page of the report.

Carry forward:

* On every subsequent inspection of that machine, each open High event produces a mandatory recheck item at the top of the walkthrough, with `carried_forward_from_item_id` pointing at the original. It requires a fresh photo and a fresh tier.
* The item stays open until a technician explicitly marks it resolved during a walkthrough, with a resolution note. Resolution sets `resolved_at`, `resolved_by_user_id`, `resolved_in_inspection_id`.
* A resolved High event still appears in history. It never disappears.

## 7. Offline first sync

The device is the system of record until the server acknowledges.

Local store: SQLite (via a React Native SQLite binding), mirroring the inspection chain tables plus a `sync_queue`.

Rules:

1. Everything a technician does writes locally first. The app must complete a full walkthrough, High flow, checkout, and signature with airplane mode on.
2. Photos are written to app private storage (not the camera roll), hashed with SHA 256 at capture, and queued.
3. Sync order: customers/machines/templates down first (reference data), then inspections up, then inspection_items, then photos, then signatures, then notes. Parent before child, always.
4. Every upload is idempotent using `client_generated_id`. Retrying never duplicates.
5. Photo upload: request a presigned S3 PUT from Rails, upload, then call Rails to confirm with the SHA 256. Rails verifies the object hash matches. Only after Rails confirms does the device delete the local file. Never delete optimistically.
6. Local photo files are deleted only after server confirmation. Local inspection rows are retained for 30 days after confirmed sync, then purged.
7. Show a persistent sync status indicator: pending items count, last successful sync time, and a manual "Sync now" button.
8. Storage guard: before starting a walkthrough, check free space. Warn below 2 GB, block below 500 MB with a clear message to sync or free space. Do not silently fail mid walkthrough.
9. Conflicts: there are none by design. Inspections are append only and keyed by client id. Reference data (machines, customers) is server authoritative; if a machine was edited on the server while the device was offline, server wins on next pull.
10. Clock: use device time for `performed_at` and `captured_at`, and also record the server receipt time. Log a warning if device clock and server clock differ by more than 10 minutes at sync.

## 8. Roles and permissions (MVP subset)

* technician: read assigned machines and their history; create inspections, items, photos, notes, signatures; cannot edit locked records; cannot create customers.
* senior_technician: technician plus machine setup wizard, NFC re tagging, marking High events resolved.
* admin: everything above plus customers, users, template publishing, viewing all inspections, viewing discrepancy alerts.
* owner: LATER. Read only over own machines plus notes. Schema is in place; do not build the UI.

Enforce in Rails with a policy layer (Pundit or equivalent). The API must never return a machine to a technician who is not assigned to its customer.

## 9. API shape (Rails)

JSON API, versioned under `/api/v1`. Token auth per device/user.

* `GET /machines/lookup?nfc=...` and `?serial=...` and `?q=...`
* `POST /machines` (wizard payload) → returns machine with locked template
* `POST /machines/:id/retag`
* `GET /checklist_templates?since=...` (pull published templates)
* `POST /inspections` (idempotent on client_generated_id)
* `POST /inspections/:id/items` (batch)
* `POST /photos/presign` → `{ upload_url, s3_key }`
* `POST /photos/confirm` → `{ s3_key, sha256, inspection_item_id, captured_at }` verifies hash
* `POST /inspections/:id/signatures`
* `POST /inspections/:id/lock`
* `POST /inspections/:id/notes` (append only)
* `POST /high_severity_events`, `POST /high_severity_events/:id/resolve`
* `GET /machines/:id/history` (inspections, open High events, photos index)
* `GET /inspections/:id/report.pdf`

All write endpoints reject changes to locked inspections with 409.

## 10. Reports of discrepancy (MVP: record only)

When a second inspection on the same machine is created with `performed_at` on the same calendar day as an existing one by a different technician, create a `discrepancy_alerts` row (machine_id, inspection_a_id, inspection_b_id, created_at, reviewed_at nullable). Admin sees a list. Delivery of alerts is LATER.

## 11. Repository layout

```
uptime/
  api/          Rails API (Postgres, S3, PDF generation)
  app/          React Native (iPad first)
  docs/         this spec, checklist YAML sources, ADRs
```

Use `docs/adr/` for any decision that departs from this spec, with the reason.

## 12. Definition of done for the pilot

The pilot is done when, on one physical skid steer in the yard, a technician can:

1. Tap the tag and open the machine
2. Complete a full walkthrough offline with a photo on every item
3. Trigger a High finding, complete the conversation checklist, capture the owner signature
4. Lock the inspection and see a three page (or fewer) report
5. Sync, and see local photos removed after server confirmation
6. On the next visit, be forced to recheck the open High item with a new photo
7. Append a note to the locked inspection and be blocked from editing it

Then run 10 to 15 inspections across the yard's machines and log every gap.
