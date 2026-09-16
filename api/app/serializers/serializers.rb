# frozen_string_literal: true

# Plain-Ruby JSON shapes. Each module responds to `call(record) -> Hash`.
module Serializers
  module_function

  def ts(t)
    t&.utc&.iso8601(3)
  end

  module User
    def self.call(u)
      { id: u.id, name: u.name, email: u.email, role: u.role, customer_id: u.customer_id, active: u.active,
        assigned_customer_ids: u.admin? ? nil : u.accessible_customer_ids }
    end
  end

  module Customer
    def self.call(c)
      { id: c.id, name: c.name, billing_address: c.billing_address, site_address: c.site_address,
        contact_name: c.contact_name, contact_phone: c.contact_phone, contact_email: c.contact_email,
        service_cadence: c.service_cadence, active: c.active, updated_at: Serializers.ts(c.updated_at) }
    end
  end

  module ChecklistTemplate
    def self.call(t)
      { id: t.id, machine_class: t.machine_class, drive_type: t.drive_type, has_def: t.has_def, version: t.version,
        items: t.items, published_at: Serializers.ts(t.published_at), updated_at: Serializers.ts(t.updated_at) }
    end
  end

  module Machine
    def self.call(m)
      { id: m.id, customer_id: m.customer_id, serial_number: m.serial_number, nfc_tag_id: m.nfc_tag_id,
        make: m.make, model: m.model, year: m.year, machine_class: m.machine_class, drive_type: m.drive_type,
        has_def: m.has_def, emissions_tier: m.emissions_tier, checklist_template_id: m.checklist_template_id,
        checklist_version: m.checklist_template.version, current_hour_meter: m.current_hour_meter,
        estimated_hours_per_week: m.estimated_hours_per_week, active: m.active,
        open_high_severity_count: m.high_severity_events.open.count, updated_at: Serializers.ts(m.updated_at) }
    end
  end

  module InspectionSummary
    def self.call(i)
      { id: i.id, client_generated_id: i.client_generated_id, machine_id: i.machine_id, customer_id: i.customer_id,
        technician_id: i.technician_id, technician_name: i.technician.name, checklist_template_id: i.checklist_template_id,
        checklist_version: i.checklist_version, inspection_type: i.inspection_type, status: i.status,
        performed_at: Serializers.ts(i.performed_at), completed_at: Serializers.ts(i.completed_at),
        locked_at: Serializers.ts(i.locked_at), synced_at: Serializers.ts(i.synced_at),
        hour_meter_reading: i.hour_meter_reading, device_id: i.device_id, tier_counts: i.tier_counts,
        report_available: i.report.present?, updated_at: Serializers.ts(i.updated_at) }
    end
  end

  module Inspection
    def self.call(i)
      InspectionSummary.call(i).merge(
        items: i.items.includes(:photos).map { |it| InspectionItem.call(it) },
        signatures: i.signatures.map { |s| Signature.call(s) },
        high_severity_events: HighSeverityEvent.for_inspection(i),
        report: i.report && { s3_key: i.report.s3_key, sha256: i.report.sha256, byte_size: i.report.byte_size,
                              page_count: i.report.page_count, generated_at: Serializers.ts(i.report.generated_at) }
      )
    end
  end

  module InspectionItem
    def self.call(it)
      { id: it.id, client_generated_id: it.client_generated_id, inspection_id: it.inspection_id,
        template_item_key: it.template_item_key, position: it.position, component_name: it.component_name,
        result_type: it.result_type, severity: it.severity, pass: it.pass,
        measurement_value: it.measurement_value&.to_s, measurement_unit: it.measurement_unit,
        measurement_detail: it.measurement_detail, technician_note: it.technician_note, skipped: it.skipped,
        skip_reason: it.skip_reason, carried_forward_from_item_id: it.carried_forward_from_item_id,
        photos: it.photos.map { |p| Photo.call(p) } }
    end
  end

  module Photo
    def self.call(p)
      { id: p.id, client_generated_id: p.client_generated_id, inspection_item_id: p.inspection_item_id, s3_key: p.s3_key,
        url: Storage.presign_get(p.s3_key), sha256: p.sha256, byte_size: p.byte_size, width: p.width, height: p.height,
        captured_at: Serializers.ts(p.captured_at), uploaded_at: Serializers.ts(p.uploaded_at),
        retention_state: p.retention_state }
    end
  end

  module Signature
    def self.call(s)
      { id: s.id, client_generated_id: s.client_generated_id, inspection_id: s.inspection_id,
        signature_type: s.signature_type, signer_name: s.signer_name, signer_role: s.signer_role,
        signer_statement: s.signer_statement, image_s3_key: s.image_s3_key,
        image_url: s.image_s3_key && Storage.presign_get(s.image_s3_key), sha256: s.sha256,
        signed_at: Serializers.ts(s.signed_at), device_id: s.device_id }
    end
  end

  module HighSeverityEvent
    def self.call(e)
      item = e.inspection_item
      { id: e.id, client_generated_id: e.client_generated_id, inspection_item_id: e.inspection_item_id,
        inspection_id: item.inspection_id, machine_id: e.machine_id, component_name: item.component_name,
        template_item_key: item.template_item_key, opened_at: Serializers.ts(e.opened_at),
        conversation_checklist: e.conversation_checklist, machine_out_of_service: e.machine_out_of_service,
        recheck_interval_days: e.recheck_interval_days, repair_plan: e.repair_plan, owner_signature_id: e.owner_signature_id,
        resolved_at: Serializers.ts(e.resolved_at), resolved_by_user_id: e.resolved_by_user_id,
        resolved_in_inspection_id: e.resolved_in_inspection_id, resolution_note: e.resolution_note,
        photos: item.photos.map { |p| Photo.call(p) } }
    end

    def self.for_inspection(i)
      ::HighSeverityEvent.joins(:inspection_item).where(inspection_items: { inspection_id: i.id })
                         .includes(inspection_item: :photos).map { |e| call(e) }
    end
  end

  module InspectionNote
    def self.call(n)
      { id: n.id, client_generated_id: n.client_generated_id, inspection_id: n.inspection_id,
        inspection_item_id: n.inspection_item_id, author_user_id: n.author_user_id, author_name: n.author_user.name,
        author_role: n.author_role, body: n.body, created_at: Serializers.ts(n.created_at) }
    end
  end

  module DiscrepancyAlert
    def self.call(a)
      { id: a.id, machine_id: a.machine_id, serial_number: a.machine.serial_number,
        inspection_a: InspectionSummary.call(a.inspection_a), inspection_b: InspectionSummary.call(a.inspection_b),
        reviewed_at: Serializers.ts(a.reviewed_at), created_at: Serializers.ts(a.created_at) }
    end
  end

  module ConsumableRecord
    def self.call(r)
      { id: r.id, machine_id: r.machine_id, inspection_id: r.inspection_id, consumable_type: r.consumable_type,
        changed_at: r.changed_at, hour_meter_at_change: r.hour_meter_at_change, source: r.source,
        interval_hours: r.interval_hours, note: r.note }
    end
  end

  # GET /machines/:id/history: inspections, open High events, photos index.
  module MachineHistory
    def self.call(m)
      inspections = m.inspections.includes(:technician, :report).recent_first
      photos_index = ::Photo.joins(inspection_item: :inspection).where(inspections: { machine_id: m.id })
                            .includes(inspection_item: :inspection).order("photos.captured_at DESC").limit(2000)
      {
        machine: Machine.call(m),
        inspections: inspections.map { |i| InspectionSummary.call(i) },
        open_high_severity_events: m.high_severity_events.open.includes(inspection_item: :photos).map { |e| HighSeverityEvent.call(e) },
        resolved_high_severity_events: m.high_severity_events.resolved.includes(inspection_item: :photos).map { |e| HighSeverityEvent.call(e) },
        photos: photos_index.map do |p|
          Photo.call(p).merge(inspection_id: p.inspection_item.inspection_id,
                              performed_at: Serializers.ts(p.inspection_item.inspection.performed_at),
                              template_item_key: p.inspection_item.template_item_key,
                              component_name: p.inspection_item.component_name)
        end
      }
    end
  end
end
