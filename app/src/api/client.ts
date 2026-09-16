import type {
  ChecklistTemplate,
  Customer,
  HighSeverityEvent,
  Inspection,
  InspectionItem,
  InspectionNote,
  Machine,
  Signature,
  User,
} from '../domain/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
  get isLocked(): boolean {
    return this.status === 409;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ApiConfig {
  baseUrl: string;
  token: string | null;
  deviceId: string;
  fetchImpl?: typeof fetch;
}

export interface Envelope<T> {
  data: T;
  server_time: string;
  existing?: boolean;
  discrepancy_alert_ids?: string[];
}

/** Thin JSON client. Every request carries the device id and device clock. */
export class ApiClient {
  clockSkewSeconds = 0;
  constructor(private config: ApiConfig) {}

  setToken(token: string | null): void {
    this.config.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown, raw?: {bytes: string | Blob | ArrayBuffer; contentType: string}): Promise<T> {
    const f = this.config.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Device-Id': this.config.deviceId,
      'X-Device-Time': new Date().toISOString(),
    };
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }
    let payload: RequestInit['body'] | undefined;
    if (raw) {
      headers['Content-Type'] = raw.contentType;
      payload = raw.bytes as RequestInit['body'];
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await f(`${this.config.baseUrl}${path}`, {method, headers, body: payload});
    const skew = res.headers.get('X-Clock-Skew-Seconds');
    if (skew) {
      this.clockSkewSeconds = parseInt(skew, 10);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const j = (json ?? {}) as {error?: string; message?: string; details?: unknown};
      throw new ApiError(res.status, j.error ?? String(res.status), j.message ?? (Array.isArray(j.details) ? j.details.join('; ') : res.statusText), j.details);
    }
    return json as T;
  }

  /** PUT raw bytes to a presigned URL (S3 or the dev storage endpoint). No auth header. */
  async putPresigned(url: string, bytes: Blob | ArrayBuffer, contentType: string): Promise<void> {
    const f = this.config.fetchImpl ?? fetch;
    const res = await f(url, {method: 'PUT', headers: {'Content-Type': contentType}, body: bytes as RequestInit['body']});
    if (!res.ok) {
      throw new ApiError(res.status, 'upload_failed', `upload failed with ${res.status}`);
    }
  }

  login(email: string, password: string, deviceId: string) {
    return this.request<{token: string; user: User; server_time: string}>('POST', '/api/v1/auth/login', {email, password, device_id: deviceId});
  }
  logout() {
    return this.request<void>('DELETE', '/api/v1/auth/logout');
  }
  me() {
    return this.request<Envelope<User>>('GET', '/api/v1/me');
  }
  customers(since: string | null) {
    return this.request<Envelope<Customer[]>>('GET', `/api/v1/customers${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  machines(since: string | null) {
    return this.request<Envelope<Machine[]>>('GET', `/api/v1/machines${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  templates(since: string | null) {
    return this.request<Envelope<ChecklistTemplate[]>>('GET', `/api/v1/checklist_templates${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  openHighSeverityEvents() {
    return this.request<Envelope<ServerHighSeverityEvent[]>>('GET', '/api/v1/high_severity_events?open=true');
  }
  lookupMachine(params: {nfc?: string; serial?: string; q?: string}) {
    const qs = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&');
    return this.request<Envelope<Machine | Machine[]>>('GET', `/api/v1/machines/lookup?${qs}`);
  }
  createMachine(payload: Record<string, unknown>) {
    return this.request<Envelope<Machine>>('POST', '/api/v1/machines', {machine: payload});
  }
  retag(machineId: string, nfcTagId: string) {
    return this.request<Envelope<Machine>>('POST', `/api/v1/machines/${machineId}/retag`, {nfc_tag_id: nfcTagId});
  }
  machineHistory(machineId: string) {
    return this.request<Envelope<MachineHistory>>('GET', `/api/v1/machines/${machineId}/history`);
  }
  createInspection(i: Inspection) {
    return this.request<Envelope<ServerInspection>>('POST', '/api/v1/inspections', {
      inspection: {
        client_generated_id: i.client_generated_id,
        machine_id: i.machine_id,
        inspection_type: i.inspection_type,
        performed_at: i.performed_at,
        completed_at: i.completed_at,
        hour_meter_reading: i.hour_meter_reading,
        device_id: i.device_id,
      },
    });
  }
  createItems(serverInspectionId: string, list: InspectionItem[]) {
    return this.request<Envelope<ServerItem[]>>('POST', `/api/v1/inspections/${serverInspectionId}/items`, {
      items: list.map(it => ({
        client_generated_id: it.client_generated_id,
        template_item_key: it.template_item_key,
        position: it.position,
        component_name: it.component_name,
        result_type: it.result_type,
        severity: it.severity,
        pass: it.pass,
        measurement_value: it.measurement_value,
        measurement_unit: it.measurement_unit,
        measurement_detail: it.measurement_detail,
        technician_note: it.technician_note,
        skipped: it.skipped,
        skip_reason: it.skip_reason,
        carried_forward_from_item_id: it.carried_forward_from_item_id,
      })),
    });
  }
  presign(payload: {purpose: 'photo' | 'signature'; inspection_item_id?: string; inspection_id?: string; client_generated_id: string; content_type: string}) {
    return this.request<{upload_url: string; s3_key: string; content_type: string}>('POST', '/api/v1/photos/presign', payload);
  }
  confirmPhoto(payload: {s3_key: string; sha256: string; inspection_item_id: string; client_generated_id: string; captured_at: string; byte_size: number; width: number | null; height: number | null}) {
    return this.request<Envelope<{id: string; url: string; uploaded_at: string}>>('POST', '/api/v1/photos/confirm', payload);
  }
  createSignature(serverInspectionId: string, s: Signature) {
    return this.request<Envelope<{id: string}>>('POST', `/api/v1/inspections/${serverInspectionId}/signatures`, {
      signature: {
        client_generated_id: s.client_generated_id,
        signature_type: s.signature_type,
        signer_name: s.signer_name,
        signer_role: s.signer_role,
        signer_statement: s.signer_statement,
        image_s3_key: s.image_s3_key,
        sha256: s.sha256,
        signed_at: s.signed_at,
        device_id: s.device_id,
      },
    });
  }
  createHighSeverityEvent(e: HighSeverityEvent) {
    return this.request<Envelope<{id: string}>>('POST', '/api/v1/high_severity_events', {
      high_severity_event: {
        client_generated_id: e.client_generated_id,
        inspection_item_id: e.inspection_item_id,
        opened_at: e.opened_at,
        conversation_checklist: e.conversation_checklist,
        machine_out_of_service: e.machine_out_of_service,
        recheck_interval_days: e.recheck_interval_days,
        repair_plan: e.repair_plan,
        owner_signature_id: e.owner_signature_id,
      },
    });
  }
  resolveHighSeverityEvent(id: string, inspectionServerId: string, note: string) {
    return this.request<Envelope<{id: string; resolved_at: string}>>('POST', `/api/v1/high_severity_events/${id}/resolve`, {
      inspection_id: inspectionServerId,
      resolution_note: note,
    });
  }
  lock(serverInspectionId: string, lockedAt: string) {
    return this.request<Envelope<ServerInspection>>('POST', `/api/v1/inspections/${serverInspectionId}/lock`, {locked_at: lockedAt});
  }
  createNote(serverInspectionId: string, n: InspectionNote) {
    return this.request<Envelope<{id: string}>>('POST', `/api/v1/inspections/${serverInspectionId}/notes`, {
      note: {client_generated_id: n.client_generated_id, inspection_item_id: n.inspection_item_id, body: n.body},
    });
  }
  notes(serverInspectionId: string) {
    return this.request<Envelope<ServerNote[]>>('GET', `/api/v1/inspections/${serverInspectionId}/notes`);
  }
  reportUrl(serverInspectionId: string): string {
    return `${this.config.baseUrl}/api/v1/inspections/${serverInspectionId}/report`;
  }
}

export interface ServerInspection {
  id: string;
  client_generated_id: string;
  status: 'in_progress' | 'completed' | 'locked';
  synced_at: string | null;
  locked_at: string | null;
  performed_at: string;
  report?: {sha256: string; page_count: number} | null;
}
export interface ServerItem {
  id: string;
  client_generated_id: string;
}
export interface ServerHighSeverityEvent {
  id: string;
  client_generated_id: string;
  inspection_item_id: string;
  inspection_id: string;
  machine_id: string;
  component_name: string;
  template_item_key: string;
  opened_at: string;
  conversation_checklist: HighSeverityEvent['conversation_checklist'];
  machine_out_of_service: boolean;
  recheck_interval_days: number | null;
  repair_plan: string | null;
  owner_signature_id: string;
  resolved_at: string | null;
  resolution_note: string | null;
  photos: Array<{url: string}>;
}
export interface ServerNote {
  id: string;
  client_generated_id: string;
  inspection_item_id: string | null;
  author_user_id: string;
  author_name: string;
  author_role: 'technician' | 'admin' | 'owner';
  body: string;
  created_at: string;
}
export interface MachineHistory {
  machine: Machine;
  inspections: Array<{
    id: string;
    client_generated_id: string;
    performed_at: string;
    status: string;
    technician_name: string;
    hour_meter_reading: number;
    checklist_version: string;
    inspection_type: string;
    tier_counts: Record<string, number>;
    report_available: boolean;
  }>;
  open_high_severity_events: ServerHighSeverityEvent[];
  resolved_high_severity_events: ServerHighSeverityEvent[];
  photos: Array<{id: string; url: string; captured_at: string; inspection_id: string; performed_at: string; template_item_key: string; component_name: string}>;
}
