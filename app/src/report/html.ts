import type {HighSeverityEvent, Inspection, InspectionItem, Machine, Signature, TemplateItem, Customer} from '../domain/types';

export interface ReportData {
  inspection: Inspection;
  machine: Machine;
  customer: Customer | null;
  technicianName: string;
  items: InspectionItem[];
  templateItems: TemplateItem[];
  signatures: Signature[];
  events: HighSeverityEvent[];
  ackImages: Record<string, string | null>; // signature client id -> data url
}

const TIERS = ['high', 'medium', 'low'] as const;
const LABELS = {high: 'HIGH', medium: 'MEDIUM', low: 'LOW'};
const COLORS = {high: '#B3261E', medium: '#B26A00', low: '#2E7D32'};

export function tierOf(item: InspectionItem): 'high' | 'medium' | 'low' | null {
  if (item.skipped) {
    return null;
  }
  if (item.severity) {
    return item.severity;
  }
  if (item.result_type === 'pass_fail' && item.pass === false) {
    return 'high';
  }
  return null;
}

export function findingText(item: InspectionItem, template: TemplateItem | undefined): string {
  const tier = tierOf(item);
  if (!tier) {
    return '';
  }
  let text = template?.tier_criteria?.[tier] ?? '';
  if (!text && item.result_type === 'pass_fail') {
    text = 'FAIL';
  }
  if (!text) {
    text = `Graded ${LABELS[tier]}`;
  }
  if (item.measurement_value !== null && item.measurement_value !== undefined) {
    text = `${item.measurement_value} ${item.measurement_unit ?? ''}. ${text}`;
  }
  if (item.carried_forward_from_item_id) {
    text += ' (carried forward from a prior visit)';
  }
  return text;
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Same content as the server PDF (spec 5.5), rendered from local data so the
 * technician can show the report on site with no connection. Photos are never
 * in the report. Pages in order High, Medium, Low; empty tiers are omitted.
 */
export function buildReportHtml(d: ReportData): string {
  const byKey = new Map(d.templateItems.map(t => [t.key, t]));
  const checkout = d.signatures.find(s => s.signature_type === 'visit_checkout');
  const header = `
    <div class="header">
      <b>Uptime inspection record</b><br/>
      Customer: ${esc(d.customer?.name ?? d.inspection.customer_id)}<br/>
      Machine: ${esc(d.machine.make)} ${esc(d.machine.model)} | Serial ${esc(d.machine.serial_number)} | Unique ID ${esc(d.machine.id)}<br/>
      Hour meter: ${esc(d.inspection.hour_meter_reading)} | Performed: ${esc(fmt(d.inspection.performed_at))} |
      Technician: ${esc(d.technicianName)} | Checklist ${esc(d.inspection.checklist_version)}
    </div>`;
  const footer = `
    <div class="footer">
      ${checkout ? `Signed: ${esc(checkout.signer_name)} (${esc(checkout.signer_role)}) at ${esc(fmt(checkout.signed_at))}` : 'Not yet signed'}<br/>
      <small>Uptime inspects, documents, flags and communicates. This record is not a diagnosis.</small>
    </div>`;
  const pages = TIERS.map(tier => {
    const rows = d.items.filter(i => tierOf(i) === tier).sort((a, b) => a.position - b.position);
    if (rows.length === 0) {
      return '';
    }
    const table = `
      <table>
        <thead><tr><th>Component</th><th>Finding</th><th>Technician note</th></tr></thead>
        <tbody>${rows
          .map(i => `<tr><td>${esc(i.component_name)}</td><td>${esc(findingText(i, byKey.get(i.template_item_key)))}</td><td>${esc(i.technician_note)}</td></tr>`)
          .join('')}</tbody>
      </table>`;
    const ack = tier === 'high' ? ackSection(d) : '';
    return `<section class="page">${header}<h1 style="color:${COLORS[tier]}">${LABELS[tier]} severity findings</h1>${table}${ack}${footer}</section>`;
  }).join('');
  const body = pages || `<section class="page">${header}<p>No graded findings on this inspection.</p>${footer}</section>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 16px; color: #111; }
      .page { page-break-after: always; border: 1px solid #ddd; padding: 20px; margin-bottom: 20px; background: #fff; }
      .header { font-size: 12px; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 12px; }
      .footer { font-size: 12px; border-top: 1px solid #999; padding-top: 8px; margin-top: 16px; color: #333; }
      h1 { font-size: 22px; margin: 8px 0 12px; } h2 { font-size: 15px; margin: 18px 0 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border: 1px solid #bbb; padding: 6px; vertical-align: top; text-align: left; }
      th { background: #eee; } td:first-child { width: 26%; } td:nth-child(3) { width: 24%; }
      .ack p { font-size: 13px; margin: 4px 0; } .ack img { height: 60px; display: block; margin: 6px 0 10px; }
    </style></head><body>${body}</body></html>`;
}

function ackSection(d: ReportData): string {
  if (d.events.length === 0) {
    return '<div class="ack"><h2>High severity acknowledgment</h2><p>No signed acknowledgment on file.</p></div>';
  }
  const groups = new Map<string, HighSeverityEvent[]>();
  d.events.forEach(e => groups.set(e.owner_signature_id, [...(groups.get(e.owner_signature_id) ?? []), e]));
  let html = '<div class="ack"><h2>High severity acknowledgment</h2>';
  groups.forEach((evs, sigId) => {
    const sig = d.signatures.find(s => s.client_generated_id === sigId);
    evs.forEach(ev => {
      const decision = ev.machine_out_of_service
        ? 'machine taken out of service'
        : `recheck in ${ev.recheck_interval_days} days; plan: ${esc(ev.repair_plan)}`;
      html += `<p>- ${esc(ev.component_name)}: ${decision}</p>`;
    });
    if (sig) {
      html += `<p>Acknowledged by ${esc(sig.signer_name)} (${esc(sig.signer_role)}) at ${esc(fmt(sig.signed_at))}</p>`;
      if (sig.signer_statement) {
        html += `<p><i>Owner statement: "${esc(sig.signer_statement)}"</i></p>`;
      }
      const img = d.ackImages[sigId];
      if (img) {
        html += `<img src="${img}" alt="signature"/>`;
      }
    }
  });
  return html + '</div>';
}

export function fmt(iso: string | null): string {
  if (!iso) {
    return 'n/a';
  }
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? iso : dt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
