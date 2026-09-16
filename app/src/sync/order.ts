import type {SyncEntity, SyncQueueRow} from '../domain/types';

/**
 * Sync order (spec 7.3): parent before child, always.
 * inspections -> items -> photos -> signatures -> high severity events -> lock -> notes.
 * Within an inspection the queue is processed in this order; across inspections,
 * oldest first. A failing parent blocks its children for that run.
 */
export const ENTITY_RANK: Record<SyncEntity, number> = {
  inspection: 0,
  inspection_item: 1,
  photo: 2,
  signature: 3,
  high_severity_event: 4,
  lock: 5,
  note: 6,
};

export function orderQueue(rows: SyncQueueRow[]): SyncQueueRow[] {
  const firstSeen = new Map<string, number>();
  rows.forEach(r => {
    if (!firstSeen.has(r.inspection_id)) {
      firstSeen.set(r.inspection_id, r.id);
    }
  });
  return [...rows].sort((a, b) => {
    const ia = firstSeen.get(a.inspection_id)!;
    const ib = firstSeen.get(b.inspection_id)!;
    if (ia !== ib) {
      return ia - ib;
    }
    const ra = ENTITY_RANK[a.entity_type];
    const rb = ENTITY_RANK[b.entity_type];
    if (ra !== rb) {
      return ra - rb;
    }
    return a.id - b.id;
  });
}
