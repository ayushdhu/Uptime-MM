import {buildReportHtml, findingText, tierOf} from '../src/report/html';
import type {InspectionItem, TemplateItem} from '../src/domain/types';

const item = (over: Partial<InspectionItem>): InspectionItem => ({
  client_generated_id: 'i',
  server_id: null,
  inspection_id: 'insp',
  template_item_key: 'hose',
  position: 0,
  component_name: 'Hoses',
  result_type: 'tiered',
  severity: null,
  pass: null,
  measurement_value: null,
  measurement_unit: null,
  measurement_detail: {},
  technician_note: null,
  skipped: false,
  skip_reason: null,
  carried_forward_from_item_id: null,
  done: true,
  ...over,
});
const template: TemplateItem = {
  key: 'hose',
  component: 'Hoses',
  section: 'Hydraulics',
  cadence: 'weekly',
  check_method: 'visual',
  result_type: 'tiered',
  photo_required: true,
  tier_criteria: {low: 'minor abrasion', medium: 'cracking', high: 'steady leak'},
  default_if_ambiguous: 'round_up',
  measurement: null,
  notes_to_tech: null,
};

test('tier mapping: severity, failed safety items are High, passes are not findings', () => {
  expect(tierOf(item({severity: 'medium'}))).toBe('medium');
  expect(tierOf(item({result_type: 'pass_fail', pass: false}))).toBe('high');
  expect(tierOf(item({result_type: 'pass_fail', pass: true}))).toBeNull();
  expect(tierOf(item({skipped: true, severity: 'high'}))).toBeNull();
});

test('finding text is the matched criteria, with measurement and carry forward annotations', () => {
  expect(findingText(item({severity: 'high'}), template)).toBe('steady leak');
  expect(findingText(item({severity: 'low', measurement_value: 12.6, measurement_unit: 'volts'}), template)).toBe('12.6 volts. minor abrasion');
  expect(findingText(item({severity: 'high', carried_forward_from_item_id: 'x'}), template)).toMatch(/carried forward/);
});

test('report renders pages in High, Medium, Low order and omits empty tiers; photos never appear', () => {
  const html = buildReportHtml({
    inspection: {
      client_generated_id: 'insp',
      server_id: null,
      machine_id: 'm',
      customer_id: 'c',
      technician_id: 'u',
      checklist_template_id: 't',
      checklist_version: 'alpha-1',
      inspection_type: 'walkthrough',
      performed_at: '2026-09-16T10:00:00Z',
      completed_at: null,
      synced_at: null,
      hour_meter_reading: 120,
      status: 'locked',
      locked_at: '2026-09-16T11:00:00Z',
      device_id: 'd',
    },
    machine: {id: 'm', customer_id: 'c', serial_number: 'SN1', nfc_tag_id: null, make: 'Bobcat', model: 'S650', year: 2019, machine_class: 'skid_steer', drive_type: 'wheeled', has_def: true, emissions_tier: 'tier_4', checklist_template_id: 't', checklist_version: 'alpha-1', current_hour_meter: 120, estimated_hours_per_week: 20, active: true, updated_at: ''},
    customer: {id: 'c', name: 'Pilot <Yard>', site_address: null, contact_name: null, contact_phone: null, service_cadence: 'weekly', active: true, updated_at: ''},
    technicianName: 'Terry',
    items: [item({client_generated_id: 'a', severity: 'low'}), item({client_generated_id: 'b', severity: 'high', technician_note: 'dripping'})],
    templateItems: [template],
    signatures: [{client_generated_id: 's', server_id: null, inspection_id: 'insp', signature_type: 'visit_checkout', signer_name: 'Olly', signer_role: 'owner', signer_statement: 'fine', local_path: null, image_s3_key: null, sha256: null, signed_at: '2026-09-16T11:00:00Z', device_id: 'd', uploaded_at: null}],
    events: [],
    ackImages: {},
  });
  const high = html.indexOf('HIGH severity findings');
  const low = html.indexOf('LOW severity findings');
  expect(high).toBeGreaterThan(-1);
  expect(low).toBeGreaterThan(high);
  expect(html).not.toContain('MEDIUM severity findings');
  expect(html).toContain('Pilot &lt;Yard&gt;');
  expect(html).toContain('steady leak');
  expect(html).toContain('dripping');
  expect(html).toContain('Signed: Olly (owner)');
  expect(html).not.toContain('<img');
});
