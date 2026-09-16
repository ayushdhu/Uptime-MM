// Types mirror the server schema (docs/spec.md section 4). Everything in the
// inspection chain is keyed on the device by its client_generated_id.

export type MachineClass = 'skid_steer' | 'wheel_loader' | 'excavator' | 'dozer' | 'farm_tractor';
export type DriveType = 'wheeled' | 'tracked';
export type EmissionsTier = 'tier_3' | 'tier_4';
export type Role = 'technician' | 'senior_technician' | 'admin' | 'owner';
export type ResultType = 'tiered' | 'pass_fail' | 'measurement';
export type Severity = 'low' | 'medium' | 'high';
export type InspectionType = 'walkthrough' | 'pm_100hr' | 'baseline';
export type InspectionStatus = 'in_progress' | 'completed' | 'locked';
export type SignatureType = 'visit_checkout' | 'high_severity_ack';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  assigned_customer_ids: string[] | null;
}

export interface Customer {
  id: string;
  name: string;
  site_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  service_cadence: 'weekly' | 'biweekly' | 'monthly';
  active: boolean;
  updated_at: string;
}

export interface TemplateMeasurement {
  unit: string;
  reference: number | null;
  reference_24v?: number;
  flow?: 'tire_refill_test' | 'battery';
}

export interface TemplateItem {
  key: string;
  component: string;
  section: string;
  walkthrough_group?: string;
  cadence: 'weekly' | 'monthly';
  cadence_label?: string;
  check_method: 'visual' | 'physical' | 'fluid_level' | 'measurement' | 'function';
  check_method_label?: string;
  result_type: ResultType;
  photo_required: boolean;
  tier_criteria: { low: string | null; medium: string | null; high: string | null };
  default_if_ambiguous: 'round_up';
  measurement: TemplateMeasurement | null;
  notes_to_tech: string | null;
  applies_when?: { drive_type?: DriveType; has_def?: boolean; emissions_tier?: EmissionsTier };
}

export interface ChecklistTemplate {
  id: string;
  machine_class: MachineClass;
  drive_type: DriveType | null;
  has_def: boolean | null;
  version: string;
  items: TemplateItem[];
  published_at: string | null;
  updated_at: string;
}

export interface Machine {
  id: string;
  customer_id: string;
  serial_number: string;
  nfc_tag_id: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  machine_class: MachineClass;
  drive_type: DriveType;
  has_def: boolean;
  emissions_tier: EmissionsTier;
  checklist_template_id: string;
  checklist_version: string;
  current_hour_meter: number | null;
  estimated_hours_per_week: number | null;
  active: boolean;
  open_high_severity_count?: number;
  updated_at: string;
}

export interface Inspection {
  client_generated_id: string;
  server_id: string | null;
  machine_id: string;
  customer_id: string;
  technician_id: string;
  checklist_template_id: string;
  checklist_version: string;
  inspection_type: InspectionType;
  performed_at: string;
  completed_at: string | null;
  synced_at: string | null;
  hour_meter_reading: number;
  status: InspectionStatus;
  locked_at: string | null;
  device_id: string;
  /** Set only when the server has accepted the lock (device-side bookkeeping). */
  server_locked_at?: string | null;
  server_report_sha256?: string | null;
}

export interface MeasurementDetail {
  tire_refill?: { initial_psi: number; one_minute_psi: number; five_minute_psi: number };
  battery?: { tester_verdict: 'good' | 'low' | 'dead' | 'bad' };
  codes?: string[];
}

export interface InspectionItem {
  client_generated_id: string;
  server_id: string | null;
  inspection_id: string; // inspection client_generated_id
  template_item_key: string;
  position: number;
  component_name: string;
  result_type: ResultType;
  severity: Severity | null;
  pass: boolean | null;
  measurement_value: number | null;
  measurement_unit: string | null;
  measurement_detail: MeasurementDetail;
  technician_note: string | null;
  skipped: boolean;
  skip_reason: string | null;
  carried_forward_from_item_id: string | null;
  done: boolean;
}

export interface Photo {
  client_generated_id: string;
  inspection_item_id: string; // item client_generated_id
  inspection_id: string;
  local_path: string | null; // null once the server confirmed and the file was deleted
  s3_key: string | null;
  sha256: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  captured_at: string;
  uploaded_at: string | null;
  remote_url: string | null;
}

export interface Signature {
  client_generated_id: string;
  server_id: string | null;
  inspection_id: string;
  signature_type: SignatureType;
  signer_name: string;
  signer_role: string;
  signer_statement: string;
  local_path: string | null;
  image_s3_key: string | null;
  sha256: string | null;
  signed_at: string;
  device_id: string;
  uploaded_at: string | null;
}

export interface ConversationChecklist {
  item_identified_and_shown: boolean;
  photo_shown: boolean;
  recommendation_stated: boolean;
  decision_recorded: boolean;
  /** Typed by the owner (ADR-0011). Required. */
  owner_initials?: string;
}

export interface HighSeverityEvent {
  client_generated_id: string;
  server_id: string | null;
  inspection_item_id: string; // item client id (or server id when pulled)
  inspection_id: string | null;
  machine_id: string;
  component_name: string;
  template_item_key: string;
  opened_at: string;
  conversation_checklist: ConversationChecklist;
  machine_out_of_service: boolean;
  recheck_interval_days: number | null;
  repair_plan: string | null;
  owner_signature_id: string;
  resolved_at: string | null;
  resolution_note: string | null;
  photo_urls: string[];
}

export interface InspectionNote {
  client_generated_id: string;
  inspection_id: string;
  inspection_item_id: string | null;
  author_user_id: string;
  author_name: string;
  author_role: 'technician' | 'admin' | 'owner';
  body: string;
  created_at: string;
  synced_at: string | null;
}

export type SyncEntity =
  | 'inspection'
  | 'inspection_item'
  | 'photo'
  | 'signature'
  | 'high_severity_event'
  | 'lock'
  | 'note';

export interface SyncQueueRow {
  id: number;
  entity_type: SyncEntity;
  entity_id: string;
  inspection_id: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at?: string | null;
  status: 'pending' | 'done' | 'failed';
  created_at: string;
}
