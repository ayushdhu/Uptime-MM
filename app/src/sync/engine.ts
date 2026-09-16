import {ApiClient, ApiError, type ServerHighSeverityEvent} from '../api/client';
import {getMeta, setMeta} from '../db/database';
import {
  customers as customersRepo,
  highSeverityEvents as eventsRepo,
  inspections as inspectionsRepo,
  items as itemsRepo,
  machines as machinesRepo,
  notes as notesRepo,
  photos as photosRepo,
  signatures as signaturesRepo,
  syncQueue,
  templates as templatesRepo,
} from '../db/repositories';
import type {HighSeverityEvent, SyncQueueRow} from '../domain/types';
import {orderQueue} from './order';

export interface FileSystem {
  readFile(path: string): Promise<ArrayBuffer | Blob>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface SyncReport {
  pushed: number;
  failed: number;
  pulled: {customers: number; machines: number; templates: number; events: number};
  errors: string[];
  lastSyncAt: string;
}

const MAX_ATTEMPTS = 8;
const RETENTION_DAYS = 30;

/**
 * Offline first sync (spec section 7). Everything is idempotent on
 * client_generated_id, so retrying never duplicates. Local photo files are
 * deleted only after the server confirms the hash.
 */
export class SyncEngine {
  private running = false;

  constructor(private api: ApiClient, private fs: FileSystem, private log: (msg: string) => void = () => {}) {}

  get isRunning(): boolean {
    return this.running;
  }

  async run(): Promise<SyncReport> {
    if (this.running) {
      throw new Error('sync already running');
    }
    this.running = true;
    const report: SyncReport = {pushed: 0, failed: 0, pulled: {customers: 0, machines: 0, templates: 0, events: 0}, errors: [], lastSyncAt: ''};
    try {
      await this.pull(report);
      await this.push(report);
      inspectionsRepo.purgeSyncedBefore(new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString());
      report.lastSyncAt = new Date().toISOString();
      setMeta('last_sync_at', report.lastSyncAt);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Reference data down first: customers, machines, templates; then open High events. Server wins. */
  async pull(report: SyncReport): Promise<void> {
    const since = getMeta('pull_cursor');
    const startedAt = new Date().toISOString();
    const [c, m, t] = await Promise.all([this.api.customers(since), this.api.machines(since), this.api.templates(since)]);
    c.data.forEach(x => customersRepo.upsert(x));
    m.data.forEach(x => machinesRepo.upsert(x));
    t.data.forEach(x => templatesRepo.upsert(x));
    report.pulled.customers = c.data.length;
    report.pulled.machines = m.data.length;
    report.pulled.templates = t.data.length;
    const events = await this.api.openHighSeverityEvents();
    events.data.forEach(e => eventsRepo.upsert(toLocalEvent(e)));
    report.pulled.events = events.data.length;
    // Use the server clock for the cursor so device clock skew cannot skip rows.
    setMeta('pull_cursor', c.server_time ?? startedAt);
  }

  async push(report: SyncReport): Promise<void> {
    const rows = orderQueue(syncQueue.pending());
    const blocked = new Set<string>();
    for (const row of rows) {
      if (blocked.has(row.inspection_id)) {
        continue;
      }
      try {
        await this.pushRow(row);
        syncQueue.markDone(row.id);
        report.pushed++;
      } catch (e) {
        const err = e as Error;
        const giveUp = row.attempts + 1 >= MAX_ATTEMPTS || (err instanceof ApiError && err.status === 422);
        syncQueue.markError(row.id, err.message, giveUp);
        report.failed++;
        report.errors.push(`${row.entity_type} ${row.entity_id}: ${err.message}`);
        this.log(`sync ${row.entity_type} ${row.entity_id} failed: ${err.message}`);
        if (err instanceof ApiError && err.isUnauthorized) {
          throw err;
        }
        // Parent before child: a failed parent blocks the rest of this inspection for this run.
        blocked.add(row.inspection_id);
      }
    }
  }

  private serverInspectionId(inspectionId: string): string {
    const insp = inspectionsRepo.find(inspectionId);
    if (!insp) {
      throw new Error(`inspection ${inspectionId} missing locally`);
    }
    if (!insp.server_id) {
      throw new Error('inspection not yet acknowledged by server');
    }
    return insp.server_id;
  }

  private async pushRow(row: SyncQueueRow): Promise<void> {
    switch (row.entity_type) {
      case 'inspection':
        return this.pushInspection(row.entity_id);
      case 'inspection_item':
        return this.pushItems(row.inspection_id);
      case 'photo':
        return this.pushPhoto(row.entity_id);
      case 'signature':
        return this.pushSignature(row.entity_id);
      case 'high_severity_event':
        return this.pushEvent(row.entity_id);
      case 'lock':
        return this.pushLock(row.inspection_id);
      case 'note':
        return this.pushNote(row.entity_id);
    }
  }

  private async pushInspection(id: string): Promise<void> {
    const insp = inspectionsRepo.find(id);
    if (!insp) {
      return;
    }
    const res = await this.api.createInspection(insp);
    inspectionsRepo.setServerId(id, res.data.id, res.data.synced_at ?? res.server_time);
  }

  private async pushItems(inspectionId: string): Promise<void> {
    const serverId = this.serverInspectionId(inspectionId);
    const list = itemsRepo.forInspection(inspectionId);
    if (list.length === 0) {
      return;
    }
    const res = await this.api.createItems(serverId, list);
    res.data.forEach(it => itemsRepo.setServerId(it.client_generated_id, it.id));
  }

  /** presign -> PUT -> confirm (server recomputes the hash) -> delete the local file. Never optimistic. */
  private async pushPhoto(id: string): Promise<void> {
    const photo = photosRepo.find(id);
    if (!photo) {
      return;
    }
    if (photo.uploaded_at) {
      await this.deleteLocal(photo.client_generated_id, photo.local_path);
      return;
    }
    if (!photo.local_path || !(await this.fs.exists(photo.local_path))) {
      throw new Error('local photo file missing before upload; cannot sync');
    }
    const presigned = await this.api.presign({
      purpose: 'photo',
      inspection_item_id: photo.inspection_item_id,
      client_generated_id: photo.client_generated_id,
      content_type: 'image/jpeg',
    });
    const bytes = await this.fs.readFile(photo.local_path);
    await this.api.putPresigned(presigned.upload_url, bytes, presigned.content_type);
    const confirmed = await this.api.confirmPhoto({
      s3_key: presigned.s3_key,
      sha256: photo.sha256,
      inspection_item_id: photo.inspection_item_id,
      client_generated_id: photo.client_generated_id,
      captured_at: photo.captured_at,
      byte_size: photo.byte_size,
      width: photo.width,
      height: photo.height,
    });
    photosRepo.markUploaded(id, presigned.s3_key, confirmed.data.uploaded_at ?? confirmed.server_time, confirmed.data.url ?? null);
    await this.deleteLocal(id, photo.local_path);
  }

  private async deleteLocal(photoId: string, path: string | null): Promise<void> {
    if (path && (await this.fs.exists(path))) {
      await this.fs.deleteFile(path);
    }
    photosRepo.clearLocalPath(photoId);
  }

  private async pushSignature(id: string): Promise<void> {
    const sig = signaturesRepo.find(id);
    if (!sig) {
      return;
    }
    const serverId = this.serverInspectionId(sig.inspection_id);
    let imageKey = sig.image_s3_key;
    if (sig.local_path && sig.sha256 && !sig.uploaded_at) {
      const presigned = await this.api.presign({
        purpose: 'signature',
        inspection_id: serverId,
        client_generated_id: sig.client_generated_id,
        content_type: 'image/png',
      });
      const bytes = await this.fs.readFile(sig.local_path);
      await this.api.putPresigned(presigned.upload_url, bytes, 'image/png');
      imageKey = presigned.s3_key;
    }
    const res = await this.api.createSignature(serverId, {...sig, image_s3_key: imageKey});
    signaturesRepo.markUploaded(id, res.data.id, imageKey, new Date().toISOString());
  }

  private async pushEvent(id: string): Promise<void> {
    const ev = eventsRepo.find(id);
    if (!ev || ev.server_id) {
      return;
    }
    const res = await this.api.createHighSeverityEvent(ev);
    eventsRepo.setServerId(id, res.data.id);
  }

  private async pushLock(inspectionId: string): Promise<void> {
    const insp = inspectionsRepo.find(inspectionId);
    if (!insp) {
      return;
    }
    const serverId = this.serverInspectionId(inspectionId);
    try {
      const res = await this.api.lock(serverId, insp.locked_at ?? new Date().toISOString());
      inspectionsRepo.markSynced(inspectionId, res.data.synced_at ?? res.server_time);
    } catch (e) {
      // Already locked on the server (a retry after a dropped response): that is success.
      if (e instanceof ApiError && e.isLocked) {
        inspectionsRepo.markSynced(inspectionId, new Date().toISOString());
        return;
      }
      throw e;
    }
  }

  private async pushNote(id: string): Promise<void> {
    const note = notesRepo.find(id);
    if (!note) {
      return;
    }
    const serverId = this.serverInspectionId(note.inspection_id);
    await this.api.createNote(serverId, note);
    notesRepo.markSynced(id, new Date().toISOString());
  }
}

export function toLocalEvent(e: ServerHighSeverityEvent): HighSeverityEvent {
  return {
    client_generated_id: e.client_generated_id,
    server_id: e.id,
    inspection_item_id: e.inspection_item_id,
    inspection_id: e.inspection_id,
    machine_id: e.machine_id,
    component_name: e.component_name,
    template_item_key: e.template_item_key,
    opened_at: e.opened_at,
    conversation_checklist: e.conversation_checklist,
    machine_out_of_service: e.machine_out_of_service,
    recheck_interval_days: e.recheck_interval_days,
    repair_plan: e.repair_plan,
    owner_signature_id: e.owner_signature_id,
    resolved_at: e.resolved_at,
    resolution_note: e.resolution_note,
    photo_urls: (e.photos ?? []).map(p => p.url),
  };
}
