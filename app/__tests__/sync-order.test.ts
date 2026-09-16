import {orderQueue} from '../src/sync/order';
import type {SyncQueueRow} from '../src/domain/types';

const row = (id: number, entity_type: SyncQueueRow['entity_type'], inspection_id: string): SyncQueueRow => ({
  id,
  entity_type,
  entity_id: `${entity_type}-${id}`,
  inspection_id,
  attempts: 0,
  last_error: null,
  status: 'pending',
  created_at: '',
});

test('parent before child within an inspection, oldest inspection first', () => {
  const rows = [
    row(1, 'photo', 'A'),
    row(2, 'inspection_item', 'A'),
    row(3, 'inspection', 'B'),
    row(4, 'inspection', 'A'),
    row(5, 'note', 'A'),
    row(6, 'lock', 'A'),
    row(7, 'signature', 'A'),
    row(8, 'high_severity_event', 'A'),
    row(9, 'inspection_item', 'B'),
  ];
  expect(orderQueue(rows).map(r => `${r.inspection_id}:${r.entity_type}`)).toEqual([
    'A:inspection',
    'A:inspection_item',
    'A:photo',
    'A:signature',
    'A:high_severity_event',
    'A:lock',
    'A:note',
    'B:inspection',
    'B:inspection_item',
  ]);
});
