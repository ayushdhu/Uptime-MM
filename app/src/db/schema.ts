// Local SQLite schema. Mirrors the inspection chain tables plus reference
// data and the sync queue (spec section 7). The device is the system of
// record until the server acknowledges.
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS customers (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, site_address TEXT, contact_name TEXT, contact_phone TEXT,
     service_cadence TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS checklist_templates (
     id TEXT PRIMARY KEY, machine_class TEXT NOT NULL, drive_type TEXT, has_def INTEGER, version TEXT NOT NULL,
     items_json TEXT NOT NULL, published_at TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS machines (
     id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, serial_number TEXT NOT NULL, nfc_tag_id TEXT,
     make TEXT, model TEXT, year INTEGER, machine_class TEXT NOT NULL, drive_type TEXT NOT NULL,
     has_def INTEGER NOT NULL, emissions_tier TEXT NOT NULL, checklist_template_id TEXT NOT NULL,
     checklist_version TEXT NOT NULL, current_hour_meter INTEGER, estimated_hours_per_week INTEGER,
     active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS machines_serial ON machines(serial_number)`,
  `CREATE INDEX IF NOT EXISTS machines_nfc ON machines(nfc_tag_id)`,
  `CREATE TABLE IF NOT EXISTS inspections (
     client_generated_id TEXT PRIMARY KEY, server_id TEXT, machine_id TEXT NOT NULL, customer_id TEXT NOT NULL,
     technician_id TEXT NOT NULL, checklist_template_id TEXT NOT NULL, checklist_version TEXT NOT NULL,
     inspection_type TEXT NOT NULL, performed_at TEXT NOT NULL, completed_at TEXT, synced_at TEXT,
     hour_meter_reading INTEGER NOT NULL, status TEXT NOT NULL, locked_at TEXT, device_id TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS inspections_machine ON inspections(machine_id, performed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS inspection_items (
     client_generated_id TEXT PRIMARY KEY, server_id TEXT, inspection_id TEXT NOT NULL, template_item_key TEXT NOT NULL,
     position INTEGER NOT NULL, component_name TEXT NOT NULL, result_type TEXT NOT NULL, severity TEXT, pass INTEGER,
     measurement_value REAL, measurement_unit TEXT, measurement_detail_json TEXT NOT NULL DEFAULT '{}',
     technician_note TEXT, skipped INTEGER NOT NULL DEFAULT 0, skip_reason TEXT, carried_forward_from_item_id TEXT,
     done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS items_inspection ON inspection_items(inspection_id, position)`,
  `CREATE TABLE IF NOT EXISTS photos (
     client_generated_id TEXT PRIMARY KEY, inspection_item_id TEXT NOT NULL, inspection_id TEXT NOT NULL,
     local_path TEXT, s3_key TEXT, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, width INTEGER, height INTEGER,
     captured_at TEXT NOT NULL, uploaded_at TEXT, remote_url TEXT)`,
  `CREATE INDEX IF NOT EXISTS photos_item ON photos(inspection_item_id)`,
  `CREATE TABLE IF NOT EXISTS signatures (
     client_generated_id TEXT PRIMARY KEY, server_id TEXT, inspection_id TEXT NOT NULL, signature_type TEXT NOT NULL,
     signer_name TEXT NOT NULL, signer_role TEXT NOT NULL, signer_statement TEXT NOT NULL, local_path TEXT,
     image_s3_key TEXT, sha256 TEXT, signed_at TEXT NOT NULL, device_id TEXT NOT NULL, uploaded_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS high_severity_events (
     client_generated_id TEXT PRIMARY KEY, server_id TEXT, inspection_item_id TEXT NOT NULL, inspection_id TEXT,
     machine_id TEXT NOT NULL, component_name TEXT NOT NULL, template_item_key TEXT NOT NULL, opened_at TEXT NOT NULL,
     conversation_checklist_json TEXT NOT NULL, machine_out_of_service INTEGER NOT NULL, recheck_interval_days INTEGER,
     repair_plan TEXT, owner_signature_id TEXT NOT NULL, resolved_at TEXT, resolution_note TEXT,
     photo_urls_json TEXT NOT NULL DEFAULT '[]')`,
  `CREATE INDEX IF NOT EXISTS hse_machine_open ON high_severity_events(machine_id, resolved_at)`,
  `CREATE TABLE IF NOT EXISTS inspection_notes (
     client_generated_id TEXT PRIMARY KEY, inspection_id TEXT NOT NULL, inspection_item_id TEXT, author_user_id TEXT NOT NULL,
     author_name TEXT NOT NULL, author_role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, synced_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
     id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, inspection_id TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sync_queue_status ON sync_queue(status, id)`,
];

/** Columns added after v1. Applied with ALTER TABLE when missing (SQLite has no IF NOT EXISTS for columns). */
export const COLUMN_MIGRATIONS: Array<{table: string; column: string; ddl: string}> = [
  {table: 'sync_queue', column: 'last_attempt_at', ddl: 'TEXT'},
  {table: 'inspections', column: 'server_locked_at', ddl: 'TEXT'},
  {table: 'inspections', column: 'server_report_sha256', ddl: 'TEXT'},
];
