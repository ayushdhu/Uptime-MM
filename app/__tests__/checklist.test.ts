import {
  buildWalkthroughItems,
  deriveEmissionsTier,
  forcedSeverity,
  itemCompletionError,
  itemsForMachine,
  lockableErrors,
  roundUp,
  selectTemplate,
  versionSortKey,
} from '../src/domain/checklist';
import type {ChecklistTemplate, HighSeverityEvent, Inspection, InspectionItem, TemplateItem} from '../src/domain/types';

const tpl = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  key: 'hose',
  component: 'Hydraulic hoses',
  section: 'Hydraulics',
  cadence: 'weekly',
  check_method: 'visual',
  result_type: 'tiered',
  photo_required: true,
  tier_criteria: {low: 'l', medium: 'm', high: 'h'},
  default_if_ambiguous: 'round_up',
  measurement: null,
  notes_to_tech: null,
  ...over,
});

const template = (over: Partial<ChecklistTemplate> = {}): ChecklistTemplate => ({
  id: 't1',
  machine_class: 'skid_steer',
  drive_type: null,
  has_def: null,
  version: 'alpha-1',
  items: [
    tpl(),
    tpl({key: 'tires', component: 'Tires', applies_when: {drive_type: 'wheeled'}}),
    tpl({key: 'tracks', component: 'Tracks', applies_when: {drive_type: 'tracked'}}),
    tpl({key: 'def', component: 'DEF tank', applies_when: {has_def: true}}),
    tpl({key: 'carbon', component: 'Exhaust carbon clear', applies_when: {emissions_tier: 'tier_3'}}),
  ],
  published_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const item = (over: Partial<InspectionItem> = {}): InspectionItem => ({
  client_generated_id: 'i1',
  server_id: null,
  inspection_id: 'insp',
  template_item_key: 'hose',
  position: 0,
  component_name: 'Hydraulic hoses',
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
  done: false,
  ...over,
});

describe('emissions tier', () => {
  it('derives tier 4 only for post-2010 machines with a DEF cap', () => {
    expect(deriveEmissionsTier(2015, true)).toBe('tier_4');
    expect(deriveEmissionsTier(2015, false)).toBe('tier_3');
    expect(deriveEmissionsTier(2009, true)).toBe('tier_3');
    expect(deriveEmissionsTier(null, true)).toBe('tier_3');
  });
});

describe('itemsForMachine', () => {
  it('drops conditional items that do not apply', () => {
    const keys = (m: Parameters<typeof itemsForMachine>[1]) => itemsForMachine(template(), m).map(i => i.key);
    expect(keys({drive_type: 'wheeled', has_def: true, emissions_tier: 'tier_4'})).toEqual(['hose', 'tires', 'def']);
    expect(keys({drive_type: 'tracked', has_def: false, emissions_tier: 'tier_3'})).toEqual(['hose', 'tracks', 'carbon']);
  });
});

describe('selectTemplate', () => {
  it('picks the highest published version and prefers a specific variant at the same version', () => {
    const base = template();
    const v2 = template({id: 'v2', version: 'alpha-2'});
    const unpublished = template({id: 'v3', version: 'v1', published_at: null});
    const specific = template({id: 'spec', version: 'alpha-2', drive_type: 'tracked'});
    const variant = {machine_class: 'skid_steer' as const, drive_type: 'tracked' as const, has_def: false};
    expect(selectTemplate([base, v2, unpublished], variant)?.id).toBe('v2');
    expect(selectTemplate([base, v2, specific], variant)?.id).toBe('spec');
    expect(selectTemplate([base, v2, specific], {...variant, drive_type: 'wheeled'})?.id).toBe('v2');
    expect(selectTemplate([base], {...variant, machine_class: 'dozer'})).toBeNull();
  });
  it('sorts alpha < beta < v and numerically', () => {
    const sorted = ['v10', 'alpha-9', 'v2', 'beta-1', 'v1'].sort((a, b) => {
      const [sa, na] = versionSortKey(a);
      const [sb, nb] = versionSortKey(b);
      return sa - sb || na - nb;
    });
    expect(sorted).toEqual(['alpha-9', 'beta-1', 'v1', 'v2', 'v10']);
  });
});

describe('special measurement flows', () => {
  const tire = tpl({key: 'tire', result_type: 'measurement', measurement: {unit: 'psi', reference: null, flow: 'tire_refill_test'}});
  const battery = tpl({key: 'batt', result_type: 'measurement', measurement: {unit: 'volts', reference: 12.6, flow: 'battery'}});
  it('auto grades High when the 5 minute reading is below the 1 minute reading', () => {
    expect(forcedSeverity(tire, {tire_refill: {initial_psi: 60, one_minute_psi: 58, five_minute_psi: 55}})).toBe('high');
    expect(forcedSeverity(tire, {tire_refill: {initial_psi: 60, one_minute_psi: 58, five_minute_psi: 58}})).toBeNull();
  });
  it('auto grades High for any battery tester verdict other than good', () => {
    expect(forcedSeverity(battery, {battery: {tester_verdict: 'low'}})).toBe('high');
    expect(forcedSeverity(battery, {battery: {tester_verdict: 'bad'}})).toBe('high');
    expect(forcedSeverity(battery, {battery: {tester_verdict: 'good'}})).toBeNull();
  });
  it('rounds up: the forced tier never lowers a technician grade', () => {
    expect(roundUp('low', 'high')).toBe('high');
    expect(roundUp('high', 'low')).toBe('high');
    expect(roundUp('medium', null)).toBe('medium');
    expect(roundUp(null, null)).toBeNull();
  });
});

describe('itemCompletionError', () => {
  it('requires a photo before a result and a typed reason to skip', () => {
    expect(itemCompletionError(item(), tpl(), 0)).toMatch(/photo/);
    expect(itemCompletionError(item(), tpl(), 1)).toMatch(/Low, Medium or High/);
    expect(itemCompletionError(item({severity: 'low'}), tpl(), 1)).toBeNull();
    expect(itemCompletionError(item({skipped: true, skip_reason: ''}), tpl(), 0)).toMatch(/reason/);
    expect(itemCompletionError(item({skipped: true, skip_reason: 'attachment removed'}), tpl(), 0)).toBeNull();
    expect(itemCompletionError(item({result_type: 'pass_fail'}), tpl({result_type: 'pass_fail'}), 1)).toMatch(/Pass or Fail/);
    expect(itemCompletionError(item({result_type: 'measurement', measurement_value: 12.6}), tpl({result_type: 'measurement'}), 1)).toMatch(/Grade/);
  });
});

describe('carry forward and lockability', () => {
  const inspection: Inspection = {
    client_generated_id: 'insp',
    server_id: null,
    machine_id: 'm',
    customer_id: 'c',
    technician_id: 'u',
    checklist_template_id: 't1',
    checklist_version: 'alpha-1',
    inspection_type: 'walkthrough',
    performed_at: '2026-09-16T10:00:00Z',
    completed_at: null,
    synced_at: null,
    hour_meter_reading: 100,
    status: 'in_progress',
    locked_at: null,
    device_id: 'd',
  };
  const openEvent: HighSeverityEvent = {
    client_generated_id: 'ev',
    server_id: 'srv-ev',
    inspection_item_id: 'orig-item',
    inspection_id: 'prev',
    machine_id: 'm',
    component_name: 'Hydraulic hoses',
    template_item_key: 'hose',
    opened_at: '2026-09-01T00:00:00Z',
    conversation_checklist: {item_identified_and_shown: true, photo_shown: true, recommendation_stated: true, decision_recorded: true},
    machine_out_of_service: false,
    recheck_interval_days: 7,
    repair_plan: 'replace',
    owner_signature_id: 'sig',
    resolved_at: null,
    resolution_note: null,
    photo_urls: [],
  };

  it('injects a mandatory recheck at the top for every open High event', () => {
    let n = 0;
    const items = buildWalkthroughItems('insp', [tpl()], [openEvent], () => `id-${n++}`);
    expect(items).toHaveLength(2);
    expect(items[0].carried_forward_from_item_id).toBe('orig-item');
    expect(items[0].component_name).toMatch(/RECHECK/);
    expect(items[0].position).toBe(0);
    expect(items[1].template_item_key).toBe('hose');
    expect(items[1].carried_forward_from_item_id).toBeNull();
  });

  it('cannot lock until every item is resulted with a photo, every High has an event, and checkout is signed', () => {
    const high = item({severity: 'high'});
    const photo = {client_generated_id: 'p', inspection_item_id: 'i1', inspection_id: 'insp', local_path: '/x', s3_key: null, sha256: 'a'.repeat(64), byte_size: 1, width: null, height: null, captured_at: 'now', uploaded_at: null, remote_url: null};
    const checkout = {client_generated_id: 's', server_id: null, inspection_id: 'insp', signature_type: 'visit_checkout' as const, signer_name: 'O', signer_role: 'owner', signer_statement: 'ok', local_path: null, image_s3_key: null, sha256: null, signed_at: 'now', device_id: 'd', uploaded_at: null};
    expect(lockableErrors(inspection, [high], [], [], [], [tpl()])).toEqual([
      'Hydraulic hoses: Take at least one photo before grading this item.',
      'Hydraulic hoses: complete the High severity conversation and owner signature.',
      'Visit checkout signature required.',
    ]);
    const ev = {...openEvent, inspection_item_id: 'i1', inspection_id: 'insp'};
    expect(lockableErrors(inspection, [high], [photo], [checkout], [ev], [tpl()])).toEqual([]);
    expect(lockableErrors({...inspection, status: 'locked'}, [high], [photo], [checkout], [ev], [tpl()])).toEqual(['Inspection is already locked.']);
  });
});
