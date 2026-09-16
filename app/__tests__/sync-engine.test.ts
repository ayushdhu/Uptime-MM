/**
 * Runs the real repositories and SyncEngine against an in-memory SQLite and a
 * fake server that mimics the Rails API's idempotency and hash verification.
 */
import {initForTests} from '../test-support/fake-op-sqlite';
import {ApiClient} from '../src/api/client';
import {getDb, setDb} from '../src/db/database';
import {highSeverityEvents, inspections, items, machines, photos, signatures, syncQueue, templates, notes, customers} from '../src/db/repositories';
import {SyncEngine, type FileSystem} from '../src/sync/engine';
import type {ChecklistTemplate, InspectionItem, Photo, User} from '../src/domain/types';
import {appendNote, gradeItem, lockInspection, markItemDone, recordHighSeverityEvent, startInspection} from '../src/services/inspectionFlow';

jest.mock('@op-engineering/op-sqlite', () => require('../test-support/fake-op-sqlite'));

// ---- fake server -----------------------------------------------------------
type Store = {
  inspections: Map<string, {id: string; status: string; locked_at?: string}>;
  items: Map<string, string>;
  objects: Map<string, string>; // s3_key -> bytes
  photos: Map<string, {id: string}>;
  signatures: Map<string, {id: string}>;
  events: Map<string, {id: string}>;
  notes: Map<string, {id: string}>;
  calls: string[];
};

function sha256Hex(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').createHash('sha256').update(s).digest('hex');
}

function fakeServer(store: Store): typeof fetch {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  let seq = 0;
  const id = () => `srv-${++seq}`;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    store.calls.push(`${method} ${path}`);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const now = new Date().toISOString();
    if (path.startsWith('/dev/storage/') && method === 'PUT') {
      const bytes = init!.body instanceof ArrayBuffer ? new TextDecoder().decode(init!.body) : String(init!.body);
      store.objects.set(path.slice('/dev/storage/'.length), bytes);
      return new Response('', {status: 200});
    }
    if (path.startsWith('/api/v1/customers') || path.startsWith('/api/v1/machines?') || path === '/api/v1/machines' || path.startsWith('/api/v1/checklist_templates')) {
      return json(200, {data: [], server_time: now});
    }
    if (path.startsWith('/api/v1/high_severity_events?open')) {
      return json(200, {data: [], server_time: now});
    }
    if (path === '/api/v1/inspections' && method === 'POST') {
      const cid = body.inspection.client_generated_id;
      const existing = store.inspections.get(cid);
      if (existing) {
        return json(200, {data: {...existing, client_generated_id: cid, synced_at: now}, existing: true, server_time: now});
      }
      const rec = {id: id(), status: 'in_progress'};
      store.inspections.set(cid, rec);
      return json(201, {data: {...rec, client_generated_id: cid, synced_at: now}, server_time: now});
    }
    const m = /^\/api\/v1\/inspections\/([^/]+)\/(items|signatures|lock|notes)$/.exec(path);
    if (m) {
      const insp = [...store.inspections.values()].find(i => i.id === m[1]);
      if (!insp) {
        return json(404, {error: 'not_found'});
      }
      if (insp.status === 'locked' && m[2] !== 'notes') {
        return json(409, {error: 'conflict', message: 'inspection is locked'});
      }
      if (m[2] === 'items') {
        const out = body.items.map((it: {client_generated_id: string}) => {
          if (!store.items.has(it.client_generated_id)) {
            store.items.set(it.client_generated_id, id());
          }
          return {id: store.items.get(it.client_generated_id), client_generated_id: it.client_generated_id};
        });
        return json(200, {data: out, server_time: now});
      }
      if (m[2] === 'signatures') {
        const cid = body.signature.client_generated_id;
        if (body.signature.image_s3_key) {
          const obj = store.objects.get(body.signature.image_s3_key);
          if (!obj || sha256Hex(obj) !== body.signature.sha256) {
            return json(422, {error: 'hash_mismatch', message: 'bad signature hash'});
          }
        }
        if (!store.signatures.has(cid)) {
          store.signatures.set(cid, {id: id()});
        }
        return json(201, {data: {id: store.signatures.get(cid)!.id}, server_time: now});
      }
      if (m[2] === 'lock') {
        insp.status = 'locked';
        insp.locked_at = body.locked_at;
        return json(200, {data: {...insp, synced_at: now}, server_time: now});
      }
      if (m[2] === 'notes') {
        const cid = body.note.client_generated_id;
        if (!store.notes.has(cid)) {
          store.notes.set(cid, {id: id()});
        }
        return json(201, {data: store.notes.get(cid), server_time: now});
      }
    }
    if (path === '/api/v1/photos/presign') {
      const key = body.purpose === 'photo' ? `inspections/x/photos/${body.client_generated_id}.jpg` : `inspections/x/signatures/${body.client_generated_id}.png`;
      return json(200, {upload_url: `http://server/dev/storage/${key}`, s3_key: key, content_type: body.content_type, server_time: now});
    }
    if (path === '/api/v1/photos/confirm') {
      const obj = store.objects.get(body.s3_key);
      if (!obj) {
        return json(422, {error: 'object_missing', message: 'upload the object before confirming'});
      }
      if (sha256Hex(obj) !== body.sha256) {
        return json(422, {error: 'hash_mismatch', message: 'hash mismatch'});
      }
      if (!store.photos.has(body.client_generated_id)) {
        store.photos.set(body.client_generated_id, {id: id()});
      }
      return json(201, {data: {id: store.photos.get(body.client_generated_id)!.id, url: `http://server/${body.s3_key}`, uploaded_at: now}, server_time: now});
    }
    if (path === '/api/v1/high_severity_events' && method === 'POST') {
      const cid = body.high_severity_event.client_generated_id;
      if (!store.events.has(cid)) {
        store.events.set(cid, {id: id()});
      }
      return json(201, {data: store.events.get(cid), server_time: now});
    }
    return json(404, {error: 'not_found', message: path});
  }) as typeof fetch;
}

// ---- fake filesystem ---------------------------------------------------------
function fakeFs(files: Map<string, string>): FileSystem {
  return {
    async readFile(path) {
      const s = files.get(path);
      if (s === undefined) {
        throw new Error('ENOENT');
      }
      return new TextEncoder().encode(s).buffer as ArrayBuffer;
    },
    async deleteFile(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
  };
}

const user: User = {id: 'u1', name: 'Terry', email: 't@x', role: 'technician', assigned_customer_ids: ['c1']};

const template: ChecklistTemplate = {
  id: 't1',
  machine_class: 'skid_steer',
  drive_type: null,
  has_def: null,
  version: 'alpha-1',
  published_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  items: [
    {key: 'hose', component: 'Hoses', section: 'Hydraulics', cadence: 'weekly', check_method: 'visual', result_type: 'tiered', photo_required: true, tier_criteria: {low: 'l', medium: 'm', high: 'h'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null},
    {key: 'belt', component: 'Belt', section: 'Belts', cadence: 'weekly', check_method: 'visual', result_type: 'tiered', photo_required: true, tier_criteria: {low: 'l', medium: 'm', high: 'h'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null},
  ],
};

function addPhoto(files: Map<string, string>, it: InspectionItem, content: string): Photo {
  const path = `/photos/${it.client_generated_id}-${files.size}.jpg`;
  files.set(path, content);
  const p: Photo = {
    client_generated_id: `photo-${files.size}`,
    inspection_item_id: it.client_generated_id,
    inspection_id: it.inspection_id,
    local_path: path,
    s3_key: null,
    sha256: sha256Hex(content),
    byte_size: content.length,
    width: null,
    height: null,
    captured_at: new Date().toISOString(),
    uploaded_at: null,
    remote_url: null,
  };
  try {
    photos.insert(p);
  } catch (e) {
    files.delete(path); // mirrors capturePhoto: no orphaned file when the insert is refused
    throw e;
  }
  syncQueue.enqueue('photo', p.client_generated_id, it.inspection_id);
  return p;
}

beforeAll(async () => {
  await initForTests();
});

let store: Store;
let files: Map<string, string>;
let engine: SyncEngine;

beforeEach(() => {
  setDb(null);
  getDb();
  store = {inspections: new Map(), items: new Map(), objects: new Map(), photos: new Map(), signatures: new Map(), events: new Map(), notes: new Map(), calls: []};
  files = new Map();
  const api = new ApiClient({baseUrl: 'http://server', token: 'tok', deviceId: 'ipad', fetchImpl: fakeServer(store)});
  engine = new SyncEngine(api, fakeFs(files));
  customers.upsert({id: 'c1', name: 'Yard', site_address: null, contact_name: null, contact_phone: null, service_cadence: 'weekly', active: true, updated_at: ''});
  templates.upsert(template);
  machines.upsert({id: 'm1', customer_id: 'c1', serial_number: 'SN1', nfc_tag_id: 'TAG', make: 'Bobcat', model: 'S650', year: 2019, machine_class: 'skid_steer', drive_type: 'wheeled', has_def: true, emissions_tier: 'tier_4', checklist_template_id: 't1', checklist_version: 'alpha-1', current_hour_meter: 100, estimated_hours_per_week: 20, active: true, updated_at: ''});
});

test('full offline walkthrough with a High finding syncs parent-before-child, verifies hashes, deletes local photos only after confirmation, then locks', async () => {
  const inspection = startInspection({machineId: 'm1', technician: user, deviceId: 'ipad', hourMeter: 120, type: 'baseline'});
  let [hose, belt] = items.forInspection(inspection.client_generated_id);
  addPhoto(files, hose, 'hose-bytes');
  addPhoto(files, belt, 'belt-bytes');
  hose = markItemDone(gradeItem(hose, template.items[0], {severity: 'high', technicianNote: 'dripping'}));
  belt = markItemDone(gradeItem(belt, template.items[1], {severity: 'low'}));

  // High flow: owner acknowledgment signature + event
  files.set('/sig/ack.png', 'ack-png');
  signatures.insert({client_generated_id: 'sig-ack', server_id: null, inspection_id: inspection.client_generated_id, signature_type: 'high_severity_ack', signer_name: 'Olly', signer_role: 'owner', signer_statement: 'park it', local_path: '/sig/ack.png', image_s3_key: null, sha256: sha256Hex('ack-png'), signed_at: 'now', device_id: 'ipad', uploaded_at: null});
  syncQueue.enqueue('signature', 'sig-ack', inspection.client_generated_id);
  recordHighSeverityEvent({inspection, item: hose, checklist: {item_identified_and_shown: true, photo_shown: true, recommendation_stated: true, decision_recorded: true}, outOfService: true, recheckIntervalDays: null, repairPlan: null, ownerSignatureId: 'sig-ack'});

  // Checkout signature and lock, all still offline
  signatures.insert({client_generated_id: 'sig-out', server_id: null, inspection_id: inspection.client_generated_id, signature_type: 'visit_checkout', signer_name: 'Olly', signer_role: 'owner', signer_statement: 'ok', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'ipad', uploaded_at: null});
  syncQueue.enqueue('signature', 'sig-out', inspection.client_generated_id);
  const locked = lockInspection(inspection);
  expect(locked.status).toBe('locked');
  expect(() => items.update({...belt, severity: 'medium'})).toThrow(/locked/);
  expect(() => addPhoto(files, belt, 'late')).toThrow(/locked/);

  const note = appendNote(locked, user, 'Missed the stem cap', null);
  expect(notes.forInspection(locked.client_generated_id)).toHaveLength(1);

  // Sync everything
  const report = await engine.run();
  expect(report.errors).toEqual([]);
  expect(report.failed).toBe(0);

  const order = store.calls.filter(c => c.startsWith('POST')).map(c => c.replace(/srv-\d+/, ':id'));
  expect(order).toEqual([
    'POST /api/v1/inspections',
    'POST /api/v1/inspections/:id/items',
    'POST /api/v1/photos/presign',
    'POST /api/v1/photos/confirm',
    'POST /api/v1/photos/presign',
    'POST /api/v1/photos/confirm',
    'POST /api/v1/photos/presign',
    'POST /api/v1/inspections/:id/signatures',
    'POST /api/v1/inspections/:id/signatures',
    'POST /api/v1/high_severity_events',
    'POST /api/v1/inspections/:id/lock',
    'POST /api/v1/inspections/:id/notes',
  ]);
  // local photo files deleted only after confirmation
  expect([...files.keys()].filter(k => k.startsWith('/photos'))).toEqual([]);
  expect(photos.pendingLocalCount()).toBe(0);
  expect(photos.forItem(hose.client_generated_id)[0].uploaded_at).not.toBeNull();
  expect(inspections.find(inspection.client_generated_id)!.server_id).toMatch(/^srv-/);
  expect(inspections.find(inspection.client_generated_id)!.synced_at).not.toBeNull();
  expect(highSeverityEvents.forInspection(inspection.client_generated_id)[0].server_id).toMatch(/^srv-/);
  expect(notes.find(note.client_generated_id)!.synced_at).not.toBeNull();
  expect(syncQueue.pendingCount()).toBe(0);
  expect(store.inspections.size).toBe(1);

  // Re-running is a no-op: nothing duplicated
  const again = await engine.run();
  expect(again.pushed).toBe(0);
  expect(store.inspections.size).toBe(1);
  expect(store.photos.size).toBe(2);
});

test('a photo whose bytes changed after hashing is rejected and kept on device; the parent chain is not advanced', async () => {
  const inspection = startInspection({machineId: 'm1', technician: user, deviceId: 'ipad', hourMeter: 120, type: 'walkthrough'});
  const [hose] = items.forInspection(inspection.client_generated_id);
  const p = addPhoto(files, hose, 'original');
  files.set(p.local_path!, 'tampered');
  const report = await engine.run();
  expect(report.failed).toBe(1);
  expect(report.errors[0]).toMatch(/hash mismatch/);
  expect(photos.find(p.client_generated_id)!.local_path).toBe(p.local_path);
  expect(files.has(p.local_path!)).toBe(true);
  expect(syncQueue.failed().map(r => r.entity_type)).toEqual(['photo']);
});

test('a lock retry after the server already locked counts as success', async () => {
  const inspection = startInspection({machineId: 'm1', technician: user, deviceId: 'ipad', hourMeter: 120, type: 'walkthrough'});
  const list = items.forInspection(inspection.client_generated_id);
  list.forEach(it => {
    addPhoto(files, it, `bytes-${it.client_generated_id}`);
    markItemDone(gradeItem(it, undefined, {severity: 'low'}));
  });
  signatures.insert({client_generated_id: 'sig-out', server_id: null, inspection_id: inspection.client_generated_id, signature_type: 'visit_checkout', signer_name: 'Olly', signer_role: 'owner', signer_statement: 'ok', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'ipad', uploaded_at: null});
  syncQueue.enqueue('signature', 'sig-out', inspection.client_generated_id);
  lockInspection(inspection);
  await engine.run();
  // Simulate a dropped response: queue the lock again.
  syncQueue.enqueue('lock', inspection.client_generated_id, inspection.client_generated_id);
  const report = await engine.run();
  expect(report.failed).toBe(0);
  expect(syncQueue.pendingCount()).toBe(0);
});

test('inspections are purged 30 days after confirmed sync, never before', () => {
  const inspection = startInspection({machineId: 'm1', technician: user, deviceId: 'ipad', hourMeter: 120, type: 'walkthrough'});
  const list = items.forInspection(inspection.client_generated_id);
  list.forEach(it => markItemDone(gradeItem(it, undefined, {severity: 'low'})));
  expect(inspections.purgeSyncedBefore(new Date().toISOString())).toBe(0); // not locked/synced, queue pending
  syncQueue.pending().forEach(r => syncQueue.markDone(r.id));
  inspections.lock(inspection.client_generated_id, '2026-01-01T00:00:00Z');
  inspections.markSynced(inspection.client_generated_id, '2026-01-02T00:00:00Z');
  expect(inspections.purgeSyncedBefore('2026-01-01T00:00:00Z')).toBe(0);
  expect(inspections.purgeSyncedBefore('2026-03-01T00:00:00Z')).toBe(1);
  expect(inspections.find(inspection.client_generated_id)).toBeNull();
  expect(items.forInspection(inspection.client_generated_id)).toEqual([]);
});
