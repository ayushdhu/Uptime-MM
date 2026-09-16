/** Photo-optional items (ADR-0010) and the initials acknowledgment (ADR-0011). */
jest.mock('@op-engineering/op-sqlite', () => require('../test-support/fake-op-sqlite'));

import {initForTests} from '../test-support/fake-op-sqlite';
import {getDb, setDb} from '../src/db/database';
import {customers, items, machines, signatures, templates} from '../src/db/repositories';
import {itemCompletionError, lockableErrors, photoRequired} from '../src/domain/checklist';
import {checkoutErrors, gradeItem, lockInspection, markItemDone, recordHighSeverityEvent, startInspection} from '../src/services/inspectionFlow';
import type {ChecklistTemplate, TemplateItem, User} from '../src/domain/types';

const user: User = {id: 'u1', name: 'Terry', email: 't@x', role: 'technician', assigned_customer_ids: ['c1']};
const alarm: TemplateItem = {key: 'backup_alarm', component: 'Backup alarm', section: 'Safety', cadence: 'weekly', check_method: 'function', result_type: 'pass_fail', photo_required: false, tier_criteria: {low: 'PASS: sounds', medium: null, high: 'FAIL: silent'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null};
const belt: TemplateItem = {key: 'seat_belt', component: 'Seat belt', section: 'Safety', cadence: 'weekly', check_method: 'function', result_type: 'pass_fail', photo_required: true, tier_criteria: {low: 'PASS', medium: null, high: 'FAIL'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null};
const hose: TemplateItem = {key: 'hose', component: 'Hoses', section: 'Hydraulics', cadence: 'weekly', check_method: 'visual', result_type: 'tiered', photo_required: true, tier_criteria: {low: 'l', medium: 'm', high: 'h'}, default_if_ambiguous: 'round_up', measurement: null, notes_to_tech: null};
const template: ChecklistTemplate = {id: 't1', machine_class: 'skid_steer', drive_type: null, has_def: null, version: 'alpha-2', published_at: '2026-01-01T00:00:00Z', updated_at: '', items: [alarm, belt, hose]};

beforeAll(initForTests);
beforeEach(() => {
  setDb(null);
  getDb();
  customers.upsert({id: 'c1', name: 'Yard', site_address: null, contact_name: null, contact_phone: null, service_cadence: 'weekly', active: true, updated_at: ''});
  templates.upsert(template);
  machines.upsert({id: 'm1', customer_id: 'c1', serial_number: 'SN1', nfc_tag_id: 'TAG', make: 'B', model: 'S', year: 2019, machine_class: 'skid_steer', drive_type: 'wheeled', has_def: false, emissions_tier: 'tier_3', checklist_template_id: 't1', checklist_version: 'alpha-2', current_hour_meter: 1, estimated_hours_per_week: 1, active: true, updated_at: ''});
});

test('photo_required comes from the template item, not the check method; carried-forward rechecks always need one', () => {
  expect(photoRequired(alarm)).toBe(false);
  expect(photoRequired(belt)).toBe(true);
  expect(photoRequired(undefined)).toBe(true);
  expect(photoRequired(alarm, {carried_forward_from_item_id: 'orig'})).toBe(true);
});

test('a photo-optional item completes and locks without a photo; a required one does not', () => {
  const insp = startInspection({machineId: 'm1', technician: user, deviceId: 'tab', hourMeter: 5, type: 'walkthrough'});
  let [a, b] = items.forInspection(insp.client_generated_id);
  const h = items.forInspection(insp.client_generated_id)[2];
  expect(itemCompletionError({...a, pass: true}, alarm, 0)).toBeNull();
  expect(itemCompletionError({...b, pass: true}, belt, 0)).toMatch(/photo/);
  a = markItemDone(gradeItem(a, alarm, {pass: true}));
  b = markItemDone(gradeItem(b, belt, {pass: true}));
  markItemDone(gradeItem(h, hose, {severity: 'low'}));
  signatures.insert({client_generated_id: 's1', server_id: null, inspection_id: insp.client_generated_id, signature_type: 'visit_checkout', signer_name: 'O', signer_role: 'owner', signer_statement: '', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'tab', uploaded_at: null});
  const errs = checkoutErrors(insp);
  expect(errs).toEqual(['Seat belt: Take at least one photo before grading this item.', 'Hoses: Take at least one photo before grading this item.']);
  expect(() => lockInspection(insp)).toThrow(/Seat belt/);
  // the pure rule agrees
  expect(lockableErrors(insp, [a], [], signatures.forInspection(insp.client_generated_id), [], template.items)).toEqual([]);
});

test('the High acknowledgment requires initials and a signature, not a statement', () => {
  const insp = startInspection({machineId: 'm1', technician: user, deviceId: 'tab', hourMeter: 5, type: 'walkthrough'});
  const h = items.forInspection(insp.client_generated_id)[2];
  const high = gradeItem(h, hose, {severity: 'high'});
  signatures.insert({client_generated_id: 'ack', server_id: null, inspection_id: insp.client_generated_id, signature_type: 'high_severity_ack', signer_name: 'Olly', signer_role: 'owner', signer_statement: '', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'tab', uploaded_at: null});
  const steps = {item_identified_and_shown: true, photo_shown: true, recommendation_stated: true, decision_recorded: true};
  const base = {inspection: insp, item: high, outOfService: true, recheckIntervalDays: null, repairPlan: null, ownerSignatureId: 'ack'};
  expect(() => recordHighSeverityEvent({...base, checklist: steps})).toThrow(/initial/);
  expect(() => recordHighSeverityEvent({...base, checklist: {...steps, owner_initials: 'toolong'}})).toThrow(/initial/);
  expect(() => recordHighSeverityEvent({...base, checklist: {...steps, owner_initials: 'OO'}, ownerSignatureId: 'missing'})).toThrow(/signature/);
  const ev = recordHighSeverityEvent({...base, checklist: {...steps, owner_initials: ' oo '}});
  expect(ev.conversation_checklist.owner_initials).toBe('oo');
  expect(signatures.find('ack')!.signer_statement).toBe(''); // statement is optional evidence, empty is fine
});
