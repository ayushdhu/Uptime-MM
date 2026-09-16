import {highSeverityEvents as eventsRepo, inspections as inspectionsRepo, notes as notesRepo, photos as photosRepo, signatures as signaturesRepo, syncQueue} from '../db/repositories';
import type {SyncQueueRow} from '../domain/types';

export interface InspectionSyncState {
  /** Locked on this device. */
  lockedLocally: boolean;
  /** The server accepted the lock and generated the PDF. */
  lockedOnServer: boolean;
  serverReportSha256: string | null;
  photosPending: number;
  signaturesPending: number;
  eventsPending: number;
  notesPending: number;
  lockPending: boolean;
  itemsPending: boolean;
  /** Queue rows that have errored at least once, with their reasons. */
  errors: SyncQueueRow[];
  /** Readable list of what is still outstanding before the visit is recorded on the server. */
  outstanding: string[];
}

/**
 * What stands between this inspection and a server-side lock. Shown wherever a
 * technician could otherwise believe a visit was recorded when it was not.
 */
export function inspectionSyncState(inspectionId: string): InspectionSyncState {
  const insp = inspectionsRepo.find(inspectionId);
  const rows = syncQueue.unfinishedForInspection(inspectionId);
  const photosPending = photosRepo.forInspection(inspectionId).filter(p => !p.uploaded_at).length;
  const signaturesPending = signaturesRepo.forInspection(inspectionId).filter(s => !s.uploaded_at).length;
  const eventsPending = eventsRepo.forInspection(inspectionId).filter(e => !e.server_id).length;
  const notesPending = notesRepo.forInspection(inspectionId).filter(n => !n.synced_at).length;
  const lockPending = rows.some(r => r.entity_type === 'lock');
  const itemsPending = rows.some(r => r.entity_type === 'inspection' || r.entity_type === 'inspection_item');
  const outstanding: string[] = [];
  if (!insp?.server_id) {
    outstanding.push('inspection not yet created on the server');
  } else if (itemsPending) {
    outstanding.push('checklist items not yet uploaded');
  }
  if (photosPending) {
    outstanding.push(`${photosPending} photo${photosPending === 1 ? '' : 's'} waiting to upload`);
  }
  if (signaturesPending) {
    outstanding.push(`${signaturesPending} signature${signaturesPending === 1 ? '' : 's'} waiting to upload`);
  }
  if (eventsPending) {
    outstanding.push(`${eventsPending} High severity acknowledgment${eventsPending === 1 ? '' : 's'} waiting to upload`);
  }
  if (insp?.status === 'locked' && !insp.server_locked_at) {
    outstanding.push(lockPending ? 'lock not yet confirmed by the server' : 'lock was never queued');
  }
  if (notesPending) {
    outstanding.push(`${notesPending} note${notesPending === 1 ? '' : 's'} waiting to upload`);
  }
  return {
    lockedLocally: insp?.status === 'locked',
    lockedOnServer: Boolean(insp?.server_locked_at),
    serverReportSha256: insp?.server_report_sha256 ?? null,
    photosPending,
    signaturesPending,
    eventsPending,
    notesPending,
    lockPending,
    itemsPending,
    errors: rows.filter(r => r.last_error),
    outstanding,
  };
}
