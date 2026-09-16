/**
 * Pilot run 1 regressions: nothing about an upload may fail silently.
 *  - dev-storage presign URLs resolve against the API host the device already uses
 *  - an unreachable upload host is a visible, retried queue error, not a stall
 *  - a 422 on confirm is surfaced with the server's reason and retried
 *  - a lock the server refuses shows the outstanding items
 */
jest.mock('@op-engineering/op-sqlite', () => require('../test-support/fake-op-sqlite'));

import {initForTests} from '../test-support/fake-op-sqlite';
import {ApiClient} from '../src/api/client';
import {getDb, setDb} from '../src/db/database';
import {customers, inspections, items, machines, photos, signatures, syncQueue, templates} from '../src/db/repositories';
import {SyncEngine, nextRetryDelayMs, type FileSystem} from '../src/sync/engine';
import {inspectionSyncState} from '../src/services/syncStatus';
import {gradeItem, lockInspection, markItemDone, startInspection} from '../src/services/inspectionFlow';
import type {ChecklistTemplate, InspectionItem, Photo, User} from '../src/domain/types';

const user: User = {id: 'u1', name: 'Terry', email: 't@x', role: 'technician', assigned_customer_ids: ['c1']};
const template: ChecklistTemplate = {
  id: 't1', machine_class: 'skid_steer', drive_type: null, has_def: null, version: 'alpha-2', published_at: '2026-01-01T00:00:00Z', updated_at: '',
  items: [{key: 'hose', component: 'Hoses', section: 'Hydraulics', cadence: 'weekly', check_method: 'visual', result_type: 'tiered', photo_required: true, tier_criteria: {low: 'l', medium: 'm', high: 'h'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null}],
};
const sha = (s: string) => require('crypto').createHash('sha256').update(s).digest('hex') as string;

interface Opts {
  presignHost: string; // origin the server puts in upload_url ('' = path only)
  reachable: Set<string>; // origins that accept PUT
  confirmFailsTimes?: number; // how many confirms answer 422 before succeeding
  lockRefusal?: string[] | null;
}

function server(opts: Opts, calls: string[]): typeof fetch {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  let seq = 0;
  const id = () => `srv-${++seq}`;
  const objects = new Map<string, string>();
  let confirmFailures = opts.confirmFailsTimes ?? 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const origin = url.replace(/^(https?:\/\/[^/]+).*$/, '$1');
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const now = new Date().toISOString();
    if (method === 'PUT') {
      if (!opts.reachable.has(origin)) {
        throw new TypeError('Network request failed');
      }
      objects.set(path.replace(/^\/dev\/storage\//, '').replace(/^\//, ''), new TextDecoder().decode(init!.body as ArrayBuffer));
      return new Response('', {status: 200});
    }
    if (method === 'GET') {
      return json(200, {data: [], server_time: now});
    }
    if (path === '/api/v1/inspections') {
      return json(201, {data: {id: id(), status: 'in_progress', synced_at: now}, server_time: now});
    }
    if (/\/items$/.test(path)) {
      return json(200, {data: body.items.map((it: {client_generated_id: string}) => ({id: id(), client_generated_id: it.client_generated_id})), server_time: now});
    }
    if (path === '/api/v1/photos/presign') {
      const key = `inspections/x/photos/${body.client_generated_id}.jpg`;
      // '' = path-only dev URL; localhost = absolute dev URL (the pilot bug); anything else = an S3-style host.
      const uploadUrl = opts.presignHost === '' || opts.presignHost.includes('localhost') ? `${opts.presignHost}/dev/storage/${key}` : `${opts.presignHost}/${key}`;
      return json(200, {upload_url: uploadUrl, s3_key: key, content_type: 'image/jpeg', server_time: now});
    }
    if (path === '/api/v1/photos/confirm') {
      if (confirmFailures > 0) {
        confirmFailures--;
        return json(422, {error: 'hash_mismatch', message: 'stored object does not match the supplied SHA-256. Re-upload the object and confirm again.'});
      }
      const obj = objects.get(body.s3_key);
      if (obj === undefined) {
        return json(422, {error: 'object_missing', message: 'no object at that key'});
      }
      if (sha(obj) !== body.sha256) {
        return json(422, {error: 'hash_mismatch', message: 'hash mismatch'});
      }
      return json(201, {data: {id: id(), url: `http://server/${body.s3_key}`, uploaded_at: now}, server_time: now});
    }
    if (/\/signatures$/.test(path)) {
      return json(201, {data: {id: id()}, server_time: now});
    }
    if (/\/lock$/.test(path)) {
      if (opts.lockRefusal) {
        return json(422, {error: 'not_lockable', details: opts.lockRefusal});
      }
      return json(200, {data: {id: 'x', status: 'locked', locked_at: now, synced_at: now, report: {sha256: 'a'.repeat(64), page_count: 2}}, server_time: now});
    }
    return json(404, {error: 'not_found', message: path});
  }) as typeof fetch;
}

const files = new Map<string, string>();
const fs: FileSystem = {
  async readFile(p) {
    return new TextEncoder().encode(files.get(p)!).buffer as ArrayBuffer;
  },
  async deleteFile(p) {
    files.delete(p);
  },
  async exists(p) {
    return files.has(p);
  },
};

function seedInspection(): {inspectionId: string; item: InspectionItem; photo: Photo} {
  customers.upsert({id: 'c1', name: 'Yard', site_address: null, contact_name: null, contact_phone: null, service_cadence: 'weekly', active: true, updated_at: ''});
  templates.upsert(template);
  machines.upsert({id: 'm1', customer_id: 'c1', serial_number: 'SN1', nfc_tag_id: 'TAG', make: 'B', model: 'S', year: 2019, machine_class: 'skid_steer', drive_type: 'wheeled', has_def: false, emissions_tier: 'tier_3', checklist_template_id: 't1', checklist_version: 'alpha-2', current_hour_meter: 1, estimated_hours_per_week: 1, active: true, updated_at: ''});
  const insp = startInspection({machineId: 'm1', technician: user, deviceId: 'tab', hourMeter: 5, type: 'walkthrough'});
  const [item] = items.forInspection(insp.client_generated_id);
  const content = 'jpeg bytes not a multiple of three!'; // 35 bytes
  const path = '/photos/p1.jpg';
  files.set(path, content);
  const photo: Photo = {client_generated_id: 'p1', inspection_item_id: item.client_generated_id, inspection_id: insp.client_generated_id, local_path: path, s3_key: null, sha256: sha(content), byte_size: content.length, width: null, height: null, captured_at: 'now', uploaded_at: null, remote_url: null};
  photos.insert(photo);
  syncQueue.enqueue('photo', 'p1', insp.client_generated_id);
  markItemDone(gradeItem(item, template.items[0], {severity: 'low'}));
  return {inspectionId: insp.client_generated_id, item, photo};
}

beforeAll(initForTests);
beforeEach(() => {
  setDb(null);
  getDb();
  files.clear();
});

test('a dev-storage presign pointing at localhost is resolved against the API host and the upload succeeds', async () => {
  const calls: string[] = [];
  const api = new ApiClient({baseUrl: 'http://10.0.2.2:3000', token: 't', deviceId: 'tab', fetchImpl: server({presignHost: 'http://localhost:3000', reachable: new Set(['http://10.0.2.2:3000'])}, calls)});
  seedInspection();
  const report = await new SyncEngine(api, fs).run();
  expect(report.errors).toEqual([]);
  expect(calls.find(c => c.startsWith('PUT'))).toBe('PUT http://10.0.2.2:3000/dev/storage/inspections/x/photos/p1.jpg');
  expect(photos.find('p1')!.uploaded_at).not.toBeNull();
  expect(files.size).toBe(0);
});

test('a path-only presign URL is joined to the API base', () => {
  const api = new ApiClient({baseUrl: 'http://10.0.2.2:3000', token: 't', deviceId: 'tab'});
  expect(api.resolveUploadUrl('/dev/storage/a/b.jpg')).toBe('http://10.0.2.2:3000/dev/storage/a/b.jpg');
  expect(api.resolveUploadUrl('http://127.0.0.1:3000/dev/storage/a/b.jpg')).toBe('http://10.0.2.2:3000/dev/storage/a/b.jpg');
  expect(api.resolveUploadUrl('https://bucket.s3.amazonaws.com/a/b.jpg?X-Amz-Signature=1')).toBe('https://bucket.s3.amazonaws.com/a/b.jpg?X-Amz-Signature=1');
});

test('an unreachable upload host becomes a visible, retried queue error instead of a silent stall', async () => {
  const calls: string[] = [];
  const api = new ApiClient({baseUrl: 'http://10.0.2.2:3000', token: 't', deviceId: 'tab', fetchImpl: server({presignHost: 'https://uploads.example.invalid', reachable: new Set()}, calls)});
  seedInspection();
  const report = await new SyncEngine(api, fs).run();
  expect(report.failed).toBe(1);
  const summary = syncQueue.errorSummary();
  expect(summary.erroredCount).toBe(1);
  expect(summary.lastError).toMatch(/photo of Hoses: upload_unreachable: could not reach https:\/\/uploads.example.invalid\/inspections/);
  const row = syncQueue.unfinished().find(r => r.entity_type === 'photo')!;
  expect(row.status).toBe('pending'); // retried automatically, not dropped
  expect(row.attempts).toBe(1);
  expect(row.last_attempt_at).not.toBeNull();
  expect(photos.find('p1')!.local_path).toBe('/photos/p1.jpg'); // local file kept
  expect(nextRetryDelayMs(1)).toBe(30_000);
  expect(nextRetryDelayMs(4)).toBe(240_000);
  expect(nextRetryDelayMs(9)).toBe(300_000);
  // A second run retries the same row.
  await new SyncEngine(api, fs).run();
  expect(syncQueue.unfinished().find(r => r.entity_type === 'photo')!.attempts).toBe(2);
});

test('a 422 on confirm surfaces the server reason and is retried until it succeeds; the photo is never dropped', async () => {
  const calls: string[] = [];
  const api = new ApiClient({baseUrl: 'http://server', token: 't', deviceId: 'tab', fetchImpl: server({presignHost: '', reachable: new Set(['http://server']), confirmFailsTimes: 1}, calls)});
  seedInspection();
  const first = await new SyncEngine(api, fs).run();
  expect(first.failed).toBe(1);
  expect(first.errors[0]).toMatch(/photo of Hoses: hash_mismatch: stored object does not match/);
  const row = syncQueue.unfinished().find(r => r.entity_type === 'photo')!;
  expect(row.status).toBe('pending');
  expect(row.last_error).toMatch(/hash_mismatch/);
  expect(photos.find('p1')!.uploaded_at).toBeNull();
  expect(files.has('/photos/p1.jpg')).toBe(true);
  const second = await new SyncEngine(api, fs).run();
  expect(second.failed).toBe(0);
  expect(photos.find('p1')!.uploaded_at).not.toBeNull();
  expect(calls.filter(c => c.startsWith('PUT')).length).toBe(2); // re-uploaded before the second confirm
});

test('a lock the server refuses is shown with the outstanding items and the inspection is not marked recorded', async () => {
  const calls: string[] = [];
  const api = new ApiClient({baseUrl: 'http://server', token: 't', deviceId: 'tab', fetchImpl: server({presignHost: '', reachable: new Set(['http://server']), lockRefusal: ['14 item(s) missing a required photo: Hoses', 'no checkout signature']}, calls)});
  const {inspectionId} = seedInspection();
  signatures.insert({client_generated_id: 's1', server_id: null, inspection_id: inspectionId, signature_type: 'visit_checkout', signer_name: 'O', signer_role: 'owner', signer_statement: '', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'tab', uploaded_at: null});
  syncQueue.enqueue('signature', 's1', inspectionId);
  lockInspection(inspections.find(inspectionId)!);
  const report = await new SyncEngine(api, fs).run();
  expect(report.errors).toEqual(['inspection lock: server refused to lock: 14 item(s) missing a required photo: Hoses; no checkout signature']);
  const state = inspectionSyncState(inspectionId);
  expect(state.lockedLocally).toBe(true);
  expect(state.lockedOnServer).toBe(false);
  expect(state.outstanding).toContain('lock not yet confirmed by the server');
  expect(state.errors[0].last_error).toMatch(/server refused to lock/);
});

test('a lock the server accepts records server_locked_at and the report hash', async () => {
  const calls: string[] = [];
  const api = new ApiClient({baseUrl: 'http://server', token: 't', deviceId: 'tab', fetchImpl: server({presignHost: '', reachable: new Set(['http://server'])}, calls)});
  const {inspectionId} = seedInspection();
  signatures.insert({client_generated_id: 's1', server_id: null, inspection_id: inspectionId, signature_type: 'visit_checkout', signer_name: 'O', signer_role: 'owner', signer_statement: '', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'tab', uploaded_at: null});
  syncQueue.enqueue('signature', 's1', inspectionId);
  lockInspection(inspections.find(inspectionId)!);
  const state0 = inspectionSyncState(inspectionId);
  expect(state0.outstanding).toEqual(expect.arrayContaining(['inspection not yet created on the server', '1 photo waiting to upload', '1 signature waiting to upload']));
  await new SyncEngine(api, fs).run();
  const state = inspectionSyncState(inspectionId);
  expect(state.lockedOnServer).toBe(true);
  expect(state.serverReportSha256).toBe('a'.repeat(64));
  expect(state.outstanding).toEqual([]);
});
