import type {
  ChecklistTemplate,
  Inspection,
  InspectionItem,
  HighSeverityEvent,
  Machine,
  MeasurementDetail,
  Photo,
  Severity,
  Signature,
  TemplateItem,
} from './types';

export const CONVERSATION_STEPS: Array<keyof HighSeverityEvent['conversation_checklist']> = [
  'item_identified_and_shown',
  'photo_shown',
  'recommendation_stated',
  'decision_recorded',
];

/** year > 2010 and DEF cap present => Tier 4, else Tier 3. */
export function deriveEmissionsTier(year: number | null, hasDef: boolean): 'tier_3' | 'tier_4' {
  return (year ?? 0) > 2010 && hasDef ? 'tier_4' : 'tier_3';
}

/** Conditional template items (tracks vs tires, DEF, Tier 3 only) filtered for one machine. */
export function itemsForMachine(template: ChecklistTemplate, machine: Pick<Machine, 'drive_type' | 'has_def' | 'emissions_tier'>): TemplateItem[] {
  return template.items.filter(item => {
    const cond = item.applies_when;
    if (!cond) {
      return true;
    }
    if (cond.drive_type && cond.drive_type !== machine.drive_type) {
      return false;
    }
    if (cond.has_def !== undefined && cond.has_def !== machine.has_def) {
      return false;
    }
    if (cond.emissions_tier && cond.emissions_tier !== machine.emissions_tier) {
      return false;
    }
    return true;
  });
}

export type MachineVariant = Pick<Machine, 'machine_class' | 'drive_type' | 'has_def'>;

const STAGE_RANK: Record<string, number> = {alpha: 0, beta: 1, rc: 2, v: 3};

export function versionSortKey(version: string): [number, number] {
  const m = /^([a-z]*)-?(\d+)$/i.exec(version);
  if (!m) {
    return [3, 0];
  }
  return [STAGE_RANK[m[1].toLowerCase()] ?? 3, parseInt(m[2], 10)];
}

/** Highest published version matching (machine_class, drive_type, has_def); specific beats wildcard. */
export function selectTemplate(templates: ChecklistTemplate[], variant: MachineVariant): ChecklistTemplate | null {
  const candidates = templates.filter(
    t =>
      t.published_at &&
      t.machine_class === variant.machine_class &&
      (t.drive_type === null || t.drive_type === variant.drive_type) &&
      (t.has_def === null || t.has_def === variant.has_def),
  );
  if (candidates.length === 0) {
    return null;
  }
  const score = (t: ChecklistTemplate) => {
    const [stage, num] = versionSortKey(t.version);
    return [stage, num, t.drive_type === null ? 0 : 1, t.has_def === null ? 0 : 1];
  };
  return candidates.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) {
        return sb[i] - sa[i];
      }
    }
    return 0;
  })[0];
}

/**
 * Special measurement flows (spec 4.3):
 *  - Tire refill test: if the 5 minute reading is below the 1 minute reading, auto High.
 *  - Battery: any tester verdict of low, dead or bad is auto High regardless of cause.
 * Returns the severity the rules force, or null when the technician grades it.
 */
export function forcedSeverity(item: TemplateItem, detail: MeasurementDetail): Severity | null {
  const flow = item.measurement?.flow;
  if (flow === 'tire_refill_test' && detail.tire_refill) {
    const {one_minute_psi, five_minute_psi} = detail.tire_refill;
    if (five_minute_psi < one_minute_psi) {
      return 'high';
    }
  }
  if (flow === 'battery' && detail.battery) {
    if (detail.battery.tester_verdict !== 'good') {
      return 'high';
    }
  }
  return null;
}

/** Round up: when in doubt the higher tier is the default (spec 4.3). */
export function roundUp(a: Severity | null, b: Severity | null): Severity | null {
  const rank: Record<Severity, number> = {low: 1, medium: 2, high: 3};
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return rank[a] >= rank[b] ? a : b;
}

export function photoRequired(item: Pick<TemplateItem, 'result_type' | 'photo_required'>): boolean {
  // Every tiered or pass_fail item needs a photo before it can be marked done. Measurement
  // items follow the template flag (always true in alpha-1).
  return item.result_type !== 'measurement' || item.photo_required;
}

/** Whether an item can be marked done. Photo first, then a result, or an explicit skip reason. */
export function itemCompletionError(item: InspectionItem, template: TemplateItem | undefined, photoCount: number): string | null {
  if (item.skipped) {
    return item.skip_reason && item.skip_reason.trim().length > 0 ? null : 'A typed reason is required to skip an item.';
  }
  const needsPhoto = template ? photoRequired(template) : true;
  if (needsPhoto && photoCount === 0) {
    return 'Take at least one photo before grading this item.';
  }
  switch (item.result_type) {
    case 'tiered':
      return item.severity ? null : 'Grade the item Low, Medium or High.';
    case 'pass_fail':
      return item.pass === null ? 'Mark the item Pass or Fail.' : null;
    case 'measurement':
      if (item.measurement_value === null && !hasDetail(item.measurement_detail)) {
        return 'Enter the measurement.';
      }
      return item.severity ? null : 'Grade the measurement Low, Medium or High.';
  }
}

function hasDetail(detail: MeasurementDetail): boolean {
  return Boolean(detail.tire_refill || detail.battery || (detail.codes && detail.codes.length));
}

export function highItems(items: InspectionItem[]): InspectionItem[] {
  return items.filter(i => !i.skipped && (i.severity === 'high' || (i.result_type === 'pass_fail' && i.pass === false)));
}

/** A failed safety item is a High finding for the conversation flow too. */
export function isHighFinding(item: InspectionItem): boolean {
  return !item.skipped && (item.severity === 'high' || (item.result_type === 'pass_fail' && item.pass === false));
}

export function tierCounts(items: InspectionItem[]): Record<Severity | 'pass' | 'fail' | 'skipped', number> {
  const counts = {low: 0, medium: 0, high: 0, pass: 0, fail: 0, skipped: 0};
  for (const item of items) {
    if (item.skipped) {
      counts.skipped++;
    } else if (item.severity) {
      counts[item.severity]++;
    } else if (item.pass === true) {
      counts.pass++;
    } else if (item.pass === false) {
      counts.fail++;
    }
  }
  return counts;
}

/** Mirrors Inspection#lockable_errors on the server. */
export function lockableErrors(
  inspection: Inspection,
  items: InspectionItem[],
  photos: Photo[],
  signatures: Signature[],
  events: HighSeverityEvent[],
  templateItems: TemplateItem[],
): string[] {
  const errors: string[] = [];
  const byKey = new Map(templateItems.map(t => [t.key, t]));
  const photoCount = (itemId: string) => photos.filter(p => p.inspection_item_id === itemId).length;
  for (const item of items) {
    const err = itemCompletionError(item, byKey.get(item.template_item_key), photoCount(item.client_generated_id));
    if (err) {
      errors.push(`${item.component_name}: ${err}`);
    }
  }
  const eventItemIds = new Set(events.map(e => e.inspection_item_id));
  for (const item of highItems(items)) {
    if (!eventItemIds.has(item.client_generated_id)) {
      errors.push(`${item.component_name}: complete the High severity conversation and owner signature.`);
    }
  }
  if (!signatures.some(s => s.signature_type === 'visit_checkout')) {
    errors.push('Visit checkout signature required.');
  }
  if (inspection.status === 'locked') {
    errors.push('Inspection is already locked.');
  }
  return errors;
}

/** Carry forward: every open High event on the machine becomes a mandatory recheck item at the top. */
export function buildWalkthroughItems(
  inspectionId: string,
  templateItems: TemplateItem[],
  openEvents: HighSeverityEvent[],
  newId: () => string,
): InspectionItem[] {
  const items: InspectionItem[] = [];
  let position = 0;
  for (const ev of openEvents) {
    items.push({
      client_generated_id: newId(),
      server_id: null,
      inspection_id: inspectionId,
      template_item_key: ev.template_item_key,
      position: position++,
      component_name: `RECHECK: ${ev.component_name}`,
      result_type: 'tiered',
      severity: null,
      pass: null,
      measurement_value: null,
      measurement_unit: null,
      measurement_detail: {},
      technician_note: null,
      skipped: false,
      skip_reason: null,
      carried_forward_from_item_id: ev.inspection_item_id,
      done: false,
    });
  }
  for (const t of templateItems) {
    items.push({
      client_generated_id: newId(),
      server_id: null,
      inspection_id: inspectionId,
      template_item_key: t.key,
      position: position++,
      component_name: t.component,
      result_type: t.result_type,
      severity: null,
      pass: null,
      measurement_value: null,
      measurement_unit: t.measurement?.unit ?? null,
      measurement_detail: {},
      technician_note: null,
      skipped: false,
      skip_reason: null,
      carried_forward_from_item_id: null,
      done: false,
    });
  }
  return items;
}
