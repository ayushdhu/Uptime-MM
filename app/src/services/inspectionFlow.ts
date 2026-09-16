import {v4 as uuid} from 'uuid';
import {
  highSeverityEvents as eventsRepo,
  inspections as inspectionsRepo,
  items as itemsRepo,
  machines as machinesRepo,
  notes as notesRepo,
  photos as photosRepo,
  signatures as signaturesRepo,
  syncQueue,
  templates as templatesRepo,
} from '../db/repositories';
import {buildWalkthroughItems, forcedSeverity, isHighFinding, itemsForMachine, lockableErrors, roundUp} from '../domain/checklist';
import type {
  ConversationChecklist,
  HighSeverityEvent,
  Inspection,
  InspectionItem,
  InspectionNote,
  InspectionType,
  MeasurementDetail,
  Severity,
  TemplateItem,
  User,
} from '../domain/types';

/** Start (or resume) a walkthrough. Locks the machine's template version and injects carried-forward rechecks. */
export function startInspection(params: {
  machineId: string;
  technician: User;
  deviceId: string;
  hourMeter: number;
  type: InspectionType;
}): Inspection {
  const existing = inspectionsRepo.inProgressForMachine(params.machineId);
  if (existing) {
    return existing;
  }
  const machine = machinesRepo.find(params.machineId);
  if (!machine) {
    throw new Error('machine not found locally; sync first');
  }
  const template = templatesRepo.find(machine.checklist_template_id);
  if (!template) {
    throw new Error('checklist template not on device; sync first');
  }
  const id = uuid();
  const inspection: Inspection = {
    client_generated_id: id,
    server_id: null,
    machine_id: machine.id,
    customer_id: machine.customer_id,
    technician_id: params.technician.id,
    checklist_template_id: template.id,
    checklist_version: template.version,
    inspection_type: params.type,
    performed_at: new Date().toISOString(),
    completed_at: null,
    synced_at: null,
    hour_meter_reading: params.hourMeter,
    status: 'in_progress',
    locked_at: null,
    device_id: params.deviceId,
  };
  inspectionsRepo.insert(inspection);
  const openEvents = eventsRepo.openForMachine(machine.id);
  itemsRepo.insertMany(buildWalkthroughItems(id, itemsForMachine(template, machine), openEvents, uuid));
  syncQueue.enqueue('inspection', id, id);
  syncQueue.enqueue('inspection_item', id, id);
  return inspection;
}

export function templateItemsFor(inspection: Inspection): TemplateItem[] {
  const template = templatesRepo.find(inspection.checklist_template_id);
  return template ? template.items : [];
}

export function templateItemByKey(inspection: Inspection): Map<string, TemplateItem> {
  return new Map(templateItemsFor(inspection).map(t => [t.key, t]));
}

export interface GradeInput {
  severity?: Severity | null;
  pass?: boolean | null;
  measurementValue?: number | null;
  measurementDetail?: MeasurementDetail;
  technicianNote?: string | null;
}

/** Apply a result. Special measurement flows can force High; round up always wins. */
export function gradeItem(item: InspectionItem, template: TemplateItem | undefined, input: GradeInput): InspectionItem {
  const detail = input.measurementDetail ?? item.measurement_detail;
  let severity = input.severity === undefined ? item.severity : input.severity;
  if (template) {
    severity = roundUp(severity, forcedSeverity(template, detail));
  }
  const updated: InspectionItem = {
    ...item,
    severity: item.result_type === 'pass_fail' ? null : severity,
    pass: item.result_type === 'pass_fail' ? (input.pass === undefined ? item.pass : input.pass) : null,
    measurement_value: input.measurementValue === undefined ? item.measurement_value : input.measurementValue,
    measurement_detail: detail,
    technician_note: input.technicianNote === undefined ? item.technician_note : input.technicianNote,
    skipped: false,
    skip_reason: null,
  };
  itemsRepo.update(updated);
  return updated;
}

export function skipItem(item: InspectionItem, reason: string): InspectionItem {
  if (!reason.trim()) {
    throw new Error('A typed reason is required to skip an item.');
  }
  const updated: InspectionItem = {...item, skipped: true, skip_reason: reason.trim(), severity: null, pass: null, done: true};
  itemsRepo.update(updated);
  return updated;
}

export function markItemDone(item: InspectionItem): InspectionItem {
  const updated = {...item, done: true};
  itemsRepo.update(updated);
  return updated;
}

/** High items that still need the conversation + signature. Failed safety items count as High. */
export function pendingHighItems(inspectionId: string): InspectionItem[] {
  const covered = new Set(eventsRepo.forInspection(inspectionId).map(e => e.inspection_item_id));
  return itemsRepo.forInspection(inspectionId).filter(i => isHighFinding(i) && !covered.has(i.client_generated_id));
}

export interface HighFlowInput {
  inspection: Inspection;
  item: InspectionItem;
  checklist: ConversationChecklist;
  outOfService: boolean;
  recheckIntervalDays: number | null;
  repairPlan: string | null;
  ownerSignatureId: string; // signature client id, type high_severity_ack
}

/** Signing creates the high_severity_events row (spec 6). */
export function recordHighSeverityEvent(input: HighFlowInput): HighSeverityEvent {
  const steps: Array<keyof ConversationChecklist> = ['item_identified_and_shown', 'photo_shown', 'recommendation_stated', 'decision_recorded'];
  const missing = steps.filter(k => !input.checklist[k]);
  if (missing.length) {
    throw new Error(`Complete every conversation step: ${missing.join(', ')}`);
  }
  const initials = (input.checklist.owner_initials ?? '').trim();
  if (initials.length < 1 || initials.length > 6) {
    throw new Error('The owner must initial the acknowledgment (1 to 6 characters).');
  }
  if (!input.outOfService && (!input.recheckIntervalDays || input.recheckIntervalDays <= 0)) {
    throw new Error('Agree a recheck interval in days when the machine stays in service.');
  }
  if (!input.outOfService && !input.repairPlan?.trim()) {
    throw new Error('Enter the repair plan when the machine stays in service.');
  }
  const sig = signaturesRepo.find(input.ownerSignatureId);
  if (!sig || sig.signature_type !== 'high_severity_ack') {
    throw new Error('Owner acknowledgment signature required.');
  }
  const event: HighSeverityEvent = {
    client_generated_id: uuid(),
    server_id: null,
    inspection_item_id: input.item.client_generated_id,
    inspection_id: input.inspection.client_generated_id,
    machine_id: input.inspection.machine_id,
    component_name: input.item.component_name,
    template_item_key: input.item.template_item_key,
    opened_at: new Date().toISOString(),
    conversation_checklist: {...input.checklist, owner_initials: initials},
    machine_out_of_service: input.outOfService,
    recheck_interval_days: input.outOfService ? null : input.recheckIntervalDays,
    repair_plan: input.outOfService ? input.repairPlan?.trim() || null : input.repairPlan!.trim(),
    owner_signature_id: input.ownerSignatureId,
    resolved_at: null,
    resolution_note: null,
    photo_urls: [],
  };
  eventsRepo.upsert(event);
  syncQueue.enqueue('high_severity_event', event.client_generated_id, input.inspection.client_generated_id);
  return event;
}

export function checkoutErrors(inspection: Inspection): string[] {
  return lockableErrors(
    inspection,
    itemsRepo.forInspection(inspection.client_generated_id),
    photosRepo.forInspection(inspection.client_generated_id),
    signaturesRepo.forInspection(inspection.client_generated_id),
    eventsRepo.forInspection(inspection.client_generated_id),
    templateItemsFor(inspection),
  );
}

/** Status -> locked, locked_at set, queued for the server lock which generates the PDF. */
export function lockInspection(inspection: Inspection): Inspection {
  const errors = checkoutErrors(inspection);
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  const at = new Date().toISOString();
  inspectionsRepo.lock(inspection.client_generated_id, at);
  syncQueue.enqueue('lock', inspection.client_generated_id, inspection.client_generated_id);
  return inspectionsRepo.find(inspection.client_generated_id)!;
}

/** Append only. Works on locked inspections; that is the whole point. */
export function appendNote(inspection: Inspection, author: User, body: string, itemId: string | null): InspectionNote {
  if (!body.trim()) {
    throw new Error('Note cannot be empty.');
  }
  const note: InspectionNote = {
    client_generated_id: uuid(),
    inspection_id: inspection.client_generated_id,
    inspection_item_id: itemId,
    author_user_id: author.id,
    author_name: author.name,
    author_role: author.role === 'admin' ? 'admin' : author.role === 'owner' ? 'owner' : 'technician',
    body: body.trim(),
    created_at: new Date().toISOString(),
    synced_at: null,
  };
  notesRepo.insert(note);
  syncQueue.enqueue('note', note.client_generated_id, inspection.client_generated_id);
  return note;
}
