/**
 * Camera permission denied: the walkthrough blocks (no photo, item cannot
 * complete) and the inspection stays in_progress. Runs on in-memory SQLite.
 */
jest.mock('@op-engineering/op-sqlite', () => require('../test-support/fake-op-sqlite'));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/data/user/0/com.uptimeapp/files', mkdir: jest.fn(), exists: jest.fn(), hash: jest.fn(), stat: jest.fn(), moveFile: jest.fn(), unlink: jest.fn(), getFSInfo: jest.fn()}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn()}));

import {initForTests} from '../test-support/fake-op-sqlite';
import {getDb, setDb} from '../src/db/database';
import {customers, inspections, items, machines, photos, templates} from '../src/db/repositories';
import {itemCompletionError} from '../src/domain/checklist';
import {requestPhotoCapture} from '../src/services/photos';
import {ensureCameraPermission} from '../src/services/permissions';
import {startInspection} from '../src/services/inspectionFlow';
import {APP_PRIVATE_DIR, PHOTO_DIR} from '../src/services/files';
import {judgeFreeSpace} from '../src/services/storageGuard';
import type {ChecklistTemplate, User} from '../src/domain/types';

const user: User = {id: 'u1', name: 'Terry', email: 't@x', role: 'technician', assigned_customer_ids: ['c1']};
const template: ChecklistTemplate = {
  id: 't1', machine_class: 'skid_steer', drive_type: null, has_def: null, version: 'alpha-1', published_at: '2026-01-01T00:00:00Z', updated_at: '',
  items: [{key: 'hose', component: 'Hoses', section: 'Hydraulics', cadence: 'weekly', check_method: 'visual', result_type: 'tiered', photo_required: true, tier_criteria: {low: 'l', medium: 'm', high: 'h'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null}],
};

beforeAll(initForTests);
beforeEach(() => {
  setDb(null);
  getDb();
  customers.upsert({id: 'c1', name: 'Yard', site_address: null, contact_name: null, contact_phone: null, service_cadence: 'weekly', active: true, updated_at: ''});
  templates.upsert(template);
  machines.upsert({id: 'm1', customer_id: 'c1', serial_number: 'SN1', nfc_tag_id: 'TAG', make: 'Bobcat', model: 'S650', year: 2019, machine_class: 'skid_steer', drive_type: 'wheeled', has_def: true, emissions_tier: 'tier_4', checklist_template_id: 't1', checklist_version: 'alpha-1', current_hour_meter: 100, estimated_hours_per_week: 20, active: true, updated_at: ''});
});

test('denied camera permission blocks the walkthrough and leaves the inspection in_progress', async () => {
  const inspection = startInspection({machineId: 'm1', technician: user, deviceId: 'tab', hourMeter: 120, type: 'walkthrough'});
  const [hose] = items.forInspection(inspection.client_generated_id);
  const capture = jest.fn();
  const result = await requestPhotoCapture(inspection.client_generated_id, hose.client_generated_id, {
    ensurePermission: async () => 'denied',
    capture,
  });
  expect(result).toEqual({status: 'permission_denied', outcome: 'denied'});
  expect(capture).not.toHaveBeenCalled(); // the camera is never opened without permission
  expect(photos.forItem(hose.client_generated_id)).toEqual([]);
  expect(itemCompletionError(hose, template.items[0], 0)).toMatch(/photo/);
  expect(inspections.find(inspection.client_generated_id)!.status).toBe('in_progress');

  // Granting later lets the same item proceed.
  capture.mockResolvedValue({client_generated_id: 'p1'});
  const ok = await requestPhotoCapture(inspection.client_generated_id, hose.client_generated_id, {ensurePermission: async () => 'granted', capture});
  expect(ok.status).toBe('captured');
});

test('the permission helper requests CAMERA lazily and maps never-ask-again to blocked', async () => {
  const check = jest.fn(async () => false);
  const request = jest.fn(async () => 'never_ask_again');
  expect(await ensureCameraPermission({os: 'android', check, request})).toBe('blocked');
  expect(request).toHaveBeenCalledWith('android.permission.CAMERA', expect.objectContaining({title: 'Camera access'}));
  request.mockResolvedValue('granted');
  expect(await ensureCameraPermission({os: 'android', check, request})).toBe('granted');
  check.mockResolvedValue(true);
  request.mockClear();
  expect(await ensureCameraPermission({os: 'android', check, request})).toBe('granted');
  expect(request).not.toHaveBeenCalled(); // already granted: no prompt
});

test('photos live under the app-private files directory', () => {
  expect(APP_PRIVATE_DIR).toBe('/data/user/0/com.uptimeapp/files/uptime');
  expect(PHOTO_DIR.startsWith(APP_PRIVATE_DIR)).toBe(true);
});

test('storage guard thresholds are in bytes: warn under 2 GB, block under 500 MB', () => {
  expect(judgeFreeSpace(3 * 1024 ** 3).level).toBe('ok');
  expect(judgeFreeSpace(1.5 * 1024 ** 3).level).toBe('warn');
  expect(judgeFreeSpace(400 * 1024 ** 2).level).toBe('block');
  // A value mistakenly reported in kilobytes would look tiny and block, never silently pass.
  expect(judgeFreeSpace(3 * 1024 ** 2).level).toBe('block');
});
