import {getDb} from './database';
import type {
  ChecklistTemplate,
  Customer,
  HighSeverityEvent,
  Inspection,
  InspectionItem,
  InspectionNote,
  Machine,
  Photo,
  Signature,
  SyncEntity,
  SyncQueueRow,
} from '../domain/types';

type Row = Record<string, unknown>;

function all<T>(sql: string, params: unknown[] = []): T[] {
  const res = getDb().executeSync(sql, params as never[]);
  return (res.rows ?? []) as T[];
}

function run(sql: string, params: unknown[] = []): void {
  getDb().executeSync(sql, params as never[]);
}

const bool = (v: unknown): boolean => v === 1 || v === true;
const nullableBool = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));

// ---------------------------------------------------------------- reference data

export const customers = {
  upsert(c: Customer): void {
    run(
      `INSERT OR REPLACE INTO customers(id, name, site_address, contact_name, contact_phone, service_cadence, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [c.id, c.name, c.site_address, c.contact_name, c.contact_phone, c.service_cadence, c.active ? 1 : 0, c.updated_at],
    );
  },
  all(): Customer[] {
    return all<Row>('SELECT * FROM customers WHERE active = 1 ORDER BY name').map(r => ({...r, active: bool(r.active)}) as Customer);
  },
  find(id: string): Customer | null {
    const r = all<Row>('SELECT * FROM customers WHERE id = ?', [id])[0];
    return r ? ({...r, active: bool(r.active)} as Customer) : null;
  },
};

export const templates = {
  upsert(t: ChecklistTemplate): void {
    run(
      `INSERT OR REPLACE INTO checklist_templates(id, machine_class, drive_type, has_def, version, items_json, published_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [t.id, t.machine_class, t.drive_type, t.has_def === null ? null : t.has_def ? 1 : 0, t.version, JSON.stringify(t.items), t.published_at, t.updated_at],
    );
  },
  all(): ChecklistTemplate[] {
    return all<Row>('SELECT * FROM checklist_templates').map(toTemplate);
  },
  find(id: string): ChecklistTemplate | null {
    const r = all<Row>('SELECT * FROM checklist_templates WHERE id = ?', [id])[0];
    return r ? toTemplate(r) : null;
  },
};

function toTemplate(r: Row): ChecklistTemplate {
  return {
    id: r.id as string,
    machine_class: r.machine_class as ChecklistTemplate['machine_class'],
    drive_type: (r.drive_type as ChecklistTemplate['drive_type']) ?? null,
    has_def: nullableBool(r.has_def),
    version: r.version as string,
    items: JSON.parse(r.items_json as string),
    published_at: (r.published_at as string) ?? null,
    updated_at: r.updated_at as string,
  };
}

export const machines = {
  upsert(m: Machine): void {
    run(
      `INSERT OR REPLACE INTO machines(id, customer_id, serial_number, nfc_tag_id, make, model, year, machine_class, drive_type,
         has_def, emissions_tier, checklist_template_id, checklist_version, current_hour_meter, estimated_hours_per_week, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [m.id, m.customer_id, m.serial_number, m.nfc_tag_id, m.make, m.model, m.year, m.machine_class, m.drive_type, m.has_def ? 1 : 0,
        m.emissions_tier, m.checklist_template_id, m.checklist_version, m.current_hour_meter, m.estimated_hours_per_week, m.active ? 1 : 0, m.updated_at],
    );
  },
  find(id: string): Machine | null {
    const r = all<Row>('SELECT * FROM machines WHERE id = ?', [id])[0];
    return r ? toMachine(r) : null;
  },
  byNfc(tag: string): Machine | null {
    const r = all<Row>('SELECT * FROM machines WHERE nfc_tag_id = ?', [tag])[0];
    return r ? toMachine(r) : null;
  },
  bySerial(serial: string): Machine | null {
    const r = all<Row>('SELECT * FROM machines WHERE upper(serial_number) = ?', [serial.trim().toUpperCase()])[0];
    return r ? toMachine(r) : null;
  },
  search(q: string): Machine[] {
    const like = `%${q.trim().toUpperCase()}%`;
    return all<Row>(
      `SELECT m.* FROM machines m JOIN customers c ON c.id = m.customer_id
       WHERE upper(m.serial_number) LIKE ? OR upper(c.name) LIKE ? ORDER BY m.serial_number LIMIT 50`,
      [like, like],
    ).map(toMachine);
  },
  all(): Machine[] {
    return all<Row>('SELECT * FROM machines WHERE active = 1 ORDER BY serial_number').map(toMachine);
  },
};

function toMachine(r: Row): Machine {
  return {...(r as unknown as Machine), has_def: bool(r.has_def), active: bool(r.active)};
}

// ---------------------------------------------------------------- inspection chain

export const inspections = {
  insert(i: Inspection): void {
    run(
      `INSERT INTO inspections(client_generated_id, server_id, machine_id, customer_id, technician_id, checklist_template_id,
         checklist_version, inspection_type, performed_at, completed_at, synced_at, hour_meter_reading, status, locked_at, device_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [i.client_generated_id, i.server_id, i.machine_id, i.customer_id, i.technician_id, i.checklist_template_id, i.checklist_version,
        i.inspection_type, i.performed_at, i.completed_at, i.synced_at, i.hour_meter_reading, i.status, i.locked_at, i.device_id],
    );
  },
  find(id: string): Inspection | null {
    return (all<Inspection>('SELECT * FROM inspections WHERE client_generated_id = ?', [id])[0] as Inspection) ?? null;
  },
  forMachine(machineId: string): Inspection[] {
    return all<Inspection>('SELECT * FROM inspections WHERE machine_id = ? ORDER BY performed_at DESC', [machineId]);
  },
  inProgressForMachine(machineId: string): Inspection | null {
    return all<Inspection>(`SELECT * FROM inspections WHERE machine_id = ? AND status = 'in_progress' ORDER BY performed_at DESC`, [machineId])[0] ?? null;
  },
  setServerId(id: string, serverId: string, syncedAt: string): void {
    run('UPDATE inspections SET server_id = ?, synced_at = ? WHERE client_generated_id = ?', [serverId, syncedAt, id]);
  },
  /** The only local status transitions: in_progress -> completed -> locked. Locked rows are never updated again. */
  complete(id: string, at: string): void {
    run(`UPDATE inspections SET status = 'completed', completed_at = ? WHERE client_generated_id = ? AND status = 'in_progress'`, [at, id]);
  },
  lock(id: string, at: string): void {
    run(`UPDATE inspections SET status = 'locked', locked_at = ?, completed_at = COALESCE(completed_at, ?) WHERE client_generated_id = ? AND status <> 'locked'`, [at, at, id]);
  },
  markSynced(id: string, at: string): void {
    run('UPDATE inspections SET synced_at = ? WHERE client_generated_id = ?', [at, id]);
  },
  /** The server accepted the lock and generated the report. Bookkeeping only. */
  markServerLocked(id: string, at: string, reportSha256: string | null): void {
    run('UPDATE inspections SET server_locked_at = ?, server_report_sha256 = ?, synced_at = ? WHERE client_generated_id = ?', [at, reportSha256, at, id]);
  },
  /** Local rows are retained 30 days after confirmed sync, then purged (spec 7.6). */
  purgeSyncedBefore(cutoffIso: string): number {
    const ids = all<{client_generated_id: string}>(
      `SELECT i.client_generated_id FROM inspections i WHERE i.status = 'locked' AND i.synced_at IS NOT NULL AND i.synced_at < ?
         AND NOT EXISTS (SELECT 1 FROM sync_queue q WHERE q.inspection_id = i.client_generated_id AND q.status <> 'done')
         AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.inspection_id = i.client_generated_id AND p.local_path IS NOT NULL)`,
      [cutoffIso],
    ).map(r => r.client_generated_id);
    for (const id of ids) {
      run('DELETE FROM photos WHERE inspection_id = ?', [id]);
      run('DELETE FROM inspection_items WHERE inspection_id = ?', [id]);
      run('DELETE FROM signatures WHERE inspection_id = ?', [id]);
      run('DELETE FROM inspection_notes WHERE inspection_id = ?', [id]);
      run('DELETE FROM sync_queue WHERE inspection_id = ?', [id]);
      run('DELETE FROM inspections WHERE client_generated_id = ?', [id]);
    }
    return ids.length;
  },
};

function assertNotLocked(inspectionId: string): void {
  const insp = inspections.find(inspectionId);
  if (insp && insp.status === 'locked') {
    throw new Error('Inspection is locked and cannot be changed. Add a note instead.');
  }
}

export const items = {
  insertMany(list: InspectionItem[]): void {
    for (const it of list) {
      assertNotLocked(it.inspection_id);
      run(
        `INSERT INTO inspection_items(client_generated_id, server_id, inspection_id, template_item_key, position, component_name, result_type,
           severity, pass, measurement_value, measurement_unit, measurement_detail_json, technician_note, skipped, skip_reason,
           carried_forward_from_item_id, done)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [it.client_generated_id, it.server_id, it.inspection_id, it.template_item_key, it.position, it.component_name, it.result_type,
          it.severity, it.pass === null ? null : it.pass ? 1 : 0, it.measurement_value, it.measurement_unit, JSON.stringify(it.measurement_detail),
          it.technician_note, it.skipped ? 1 : 0, it.skip_reason, it.carried_forward_from_item_id, it.done ? 1 : 0],
      );
    }
  },
  forInspection(inspectionId: string): InspectionItem[] {
    return all<Row>('SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY position', [inspectionId]).map(toItem);
  },
  find(id: string): InspectionItem | null {
    const r = all<Row>('SELECT * FROM inspection_items WHERE client_generated_id = ?', [id])[0];
    return r ? toItem(r) : null;
  },
  update(it: InspectionItem): void {
    assertNotLocked(it.inspection_id);
    run(
      `UPDATE inspection_items SET severity = ?, pass = ?, measurement_value = ?, measurement_unit = ?, measurement_detail_json = ?,
         technician_note = ?, skipped = ?, skip_reason = ?, done = ? WHERE client_generated_id = ?`,
      [it.severity, it.pass === null ? null : it.pass ? 1 : 0, it.measurement_value, it.measurement_unit, JSON.stringify(it.measurement_detail),
        it.technician_note, it.skipped ? 1 : 0, it.skip_reason, it.done ? 1 : 0, it.client_generated_id],
    );
  },
  setServerId(id: string, serverId: string): void {
    run('UPDATE inspection_items SET server_id = ? WHERE client_generated_id = ?', [serverId, id]);
  },
};

function toItem(r: Row): InspectionItem {
  return {
    ...(r as unknown as InspectionItem),
    pass: nullableBool(r.pass),
    skipped: bool(r.skipped),
    done: bool(r.done),
    measurement_detail: JSON.parse((r.measurement_detail_json as string) || '{}'),
  };
}

export const photos = {
  insert(p: Photo): void {
    assertNotLocked(p.inspection_id);
    run(
      `INSERT INTO photos(client_generated_id, inspection_item_id, inspection_id, local_path, s3_key, sha256, byte_size, width, height,
         captured_at, uploaded_at, remote_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.client_generated_id, p.inspection_item_id, p.inspection_id, p.local_path, p.s3_key, p.sha256, p.byte_size, p.width, p.height,
        p.captured_at, p.uploaded_at, p.remote_url],
    );
  },
  forItem(itemId: string): Photo[] {
    return all<Photo>('SELECT * FROM photos WHERE inspection_item_id = ? ORDER BY captured_at', [itemId]);
  },
  forInspection(inspectionId: string): Photo[] {
    return all<Photo>('SELECT * FROM photos WHERE inspection_id = ? ORDER BY captured_at', [inspectionId]);
  },
  find(id: string): Photo | null {
    return all<Photo>('SELECT * FROM photos WHERE client_generated_id = ?', [id])[0] ?? null;
  },
  /** Upload bookkeeping only; permitted after lock. */
  markUploaded(id: string, s3Key: string, uploadedAt: string, remoteUrl: string | null): void {
    run('UPDATE photos SET s3_key = ?, uploaded_at = ?, remote_url = ? WHERE client_generated_id = ?', [s3Key, uploadedAt, remoteUrl, id]);
  },
  clearLocalPath(id: string): void {
    run('UPDATE photos SET local_path = NULL WHERE client_generated_id = ?', [id]);
  },
  pendingLocalCount(): number {
    return all<{n: number}>('SELECT COUNT(*) AS n FROM photos WHERE local_path IS NOT NULL')[0]?.n ?? 0;
  },
};

export const signatures = {
  insert(s: Signature): void {
    assertNotLocked(s.inspection_id);
    run(
      `INSERT INTO signatures(client_generated_id, server_id, inspection_id, signature_type, signer_name, signer_role, signer_statement,
         local_path, image_s3_key, sha256, signed_at, device_id, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.client_generated_id, s.server_id, s.inspection_id, s.signature_type, s.signer_name, s.signer_role, s.signer_statement, s.local_path,
        s.image_s3_key, s.sha256, s.signed_at, s.device_id, s.uploaded_at],
    );
  },
  forInspection(inspectionId: string): Signature[] {
    return all<Signature>('SELECT * FROM signatures WHERE inspection_id = ? ORDER BY signed_at', [inspectionId]);
  },
  find(id: string): Signature | null {
    return all<Signature>('SELECT * FROM signatures WHERE client_generated_id = ?', [id])[0] ?? null;
  },
  markUploaded(id: string, serverId: string, s3Key: string | null, uploadedAt: string): void {
    run('UPDATE signatures SET server_id = ?, image_s3_key = ?, uploaded_at = ? WHERE client_generated_id = ?', [serverId, s3Key, uploadedAt, id]);
  },
};

export const highSeverityEvents = {
  upsert(e: HighSeverityEvent): void {
    run(
      `INSERT OR REPLACE INTO high_severity_events(client_generated_id, server_id, inspection_item_id, inspection_id, machine_id, component_name,
         template_item_key, opened_at, conversation_checklist_json, machine_out_of_service, recheck_interval_days, repair_plan,
         owner_signature_id, resolved_at, resolution_note, photo_urls_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [e.client_generated_id, e.server_id, e.inspection_item_id, e.inspection_id, e.machine_id, e.component_name, e.template_item_key, e.opened_at,
        JSON.stringify(e.conversation_checklist), e.machine_out_of_service ? 1 : 0, e.recheck_interval_days, e.repair_plan, e.owner_signature_id,
        e.resolved_at, e.resolution_note, JSON.stringify(e.photo_urls)],
    );
  },
  openForMachine(machineId: string): HighSeverityEvent[] {
    return all<Row>('SELECT * FROM high_severity_events WHERE machine_id = ? AND resolved_at IS NULL ORDER BY opened_at', [machineId]).map(toEvent);
  },
  allForMachine(machineId: string): HighSeverityEvent[] {
    return all<Row>('SELECT * FROM high_severity_events WHERE machine_id = ? ORDER BY opened_at DESC', [machineId]).map(toEvent);
  },
  forInspection(inspectionId: string): HighSeverityEvent[] {
    return all<Row>('SELECT * FROM high_severity_events WHERE inspection_id = ? ORDER BY opened_at', [inspectionId]).map(toEvent);
  },
  find(id: string): HighSeverityEvent | null {
    const r = all<Row>('SELECT * FROM high_severity_events WHERE client_generated_id = ? OR server_id = ?', [id, id])[0];
    return r ? toEvent(r) : null;
  },
  setServerId(id: string, serverId: string): void {
    run('UPDATE high_severity_events SET server_id = ? WHERE client_generated_id = ?', [serverId, id]);
  },
  resolveLocally(id: string, at: string, note: string): void {
    run('UPDATE high_severity_events SET resolved_at = ?, resolution_note = ? WHERE client_generated_id = ? OR server_id = ?', [at, note, id, id]);
  },
};

function toEvent(r: Row): HighSeverityEvent {
  return {
    ...(r as unknown as HighSeverityEvent),
    machine_out_of_service: bool(r.machine_out_of_service),
    conversation_checklist: JSON.parse(r.conversation_checklist_json as string),
    photo_urls: JSON.parse((r.photo_urls_json as string) || '[]'),
  };
}

export const notes = {
  /** Append only: there is no update or delete. */
  insert(n: InspectionNote): void {
    run(
      `INSERT INTO inspection_notes(client_generated_id, inspection_id, inspection_item_id, author_user_id, author_name, author_role, body, created_at, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [n.client_generated_id, n.inspection_id, n.inspection_item_id, n.author_user_id, n.author_name, n.author_role, n.body, n.created_at, n.synced_at],
    );
  },
  forInspection(inspectionId: string): InspectionNote[] {
    return all<InspectionNote>('SELECT * FROM inspection_notes WHERE inspection_id = ? ORDER BY created_at', [inspectionId]);
  },
  find(id: string): InspectionNote | null {
    return all<InspectionNote>('SELECT * FROM inspection_notes WHERE client_generated_id = ?', [id])[0] ?? null;
  },
  markSynced(id: string, at: string): void {
    run('UPDATE inspection_notes SET synced_at = ? WHERE client_generated_id = ?', [at, id]);
  },
};

export const syncQueue = {
  enqueue(entityType: SyncEntity, entityId: string, inspectionId: string): void {
    const existing = all<{id: number}>(
      `SELECT id FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND status <> 'done'`,
      [entityType, entityId],
    );
    if (existing.length) {
      return;
    }
    run(`INSERT INTO sync_queue(entity_type, entity_id, inspection_id, created_at) VALUES (?,?,?,?)`, [
      entityType,
      entityId,
      inspectionId,
      new Date().toISOString(),
    ]);
  },
  pending(): SyncQueueRow[] {
    return all<SyncQueueRow>(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY id`);
  },
  /** Every unfinished row, oldest first, with its error state. */
  unfinished(): SyncQueueRow[] {
    return all<SyncQueueRow>(`SELECT * FROM sync_queue WHERE status <> 'done' ORDER BY id`);
  },
  unfinishedForInspection(inspectionId: string): SyncQueueRow[] {
    return all<SyncQueueRow>(`SELECT * FROM sync_queue WHERE status <> 'done' AND inspection_id = ? ORDER BY id`, [inspectionId]);
  },
  /** Persisted error state for the status bar: survives app restarts, unlike the last run's report. */
  errorSummary(): {erroredCount: number; failedCount: number; lastError: string | null; lastAttemptAt: string | null} {
    const counts = all<{errored: number; failed: number}>(
      `SELECT SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errored,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM sync_queue WHERE status <> 'done'`,
    )[0];
    const last = all<{last_error: string; last_attempt_at: string | null}>(
      `SELECT last_error, last_attempt_at FROM sync_queue WHERE status <> 'done' AND last_error IS NOT NULL ORDER BY last_attempt_at DESC, id DESC LIMIT 1`,
    )[0];
    return {erroredCount: counts?.errored ?? 0, failedCount: counts?.failed ?? 0, lastError: last?.last_error ?? null, lastAttemptAt: last?.last_attempt_at ?? null};
  },
  pendingCount(): number {
    return all<{n: number}>(`SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'`)[0]?.n ?? 0;
  },
  failed(): SyncQueueRow[] {
    return all<SyncQueueRow>(`SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY id`);
  },
  markDone(id: number): void {
    run(`UPDATE sync_queue SET status = 'done', last_error = NULL WHERE id = ?`, [id]);
  },
  markError(id: number, error: string, giveUp: boolean): void {
    run(`UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, last_attempt_at = ?, status = ? WHERE id = ?`, [
      error,
      new Date().toISOString(),
      giveUp ? 'failed' : 'pending',
      id,
    ]);
  },
  retryFailed(): void {
    run(`UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE status = 'failed'`);
  },
  retryRow(id: number): void {
    run(`UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE id = ?`, [id]);
  },
};
