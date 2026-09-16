# frozen_string_literal: true

require "prawn"
require "prawn/table"

# Three page stacked severity report (spec 5.5): High, Medium, Low, in that
# order, omitting empty tiers. Photos are never in the report. The PDF is
# stored in object storage with its own SHA-256 and linked from the inspection.
class ReportGenerator
  TIERS = %w[high medium low].freeze
  TIER_LABELS = { "high" => "HIGH", "medium" => "MEDIUM", "low" => "LOW" }.freeze
  TIER_COLORS = { "high" => "B3261E", "medium" => "B26A00", "low" => "2E7D32" }.freeze

  attr_reader :inspection

  def initialize(inspection)
    @inspection = inspection
  end

  # Generates, stores and records the report. Idempotent per inspection: a
  # locked inspection never changes, so the report is generated once.
  def generate!
    return inspection.report if inspection.report

    pdf_bytes, page_count = render
    key = ObjectKeys.report(inspection.id)
    Storage.write(key, pdf_bytes, content_type: "application/pdf")
    InspectionReport.create!(
      inspection: inspection,
      s3_key: key,
      sha256: Digest::SHA256.hexdigest(pdf_bytes),
      byte_size: pdf_bytes.bytesize,
      page_count: page_count,
      generated_at: Time.current
    )
  end

  # Returns [pdf_bytes, page_count]. Renders against the inspection's own
  # checklist version, never the latest.
  def render
    items_by_tier = grouped_items
    tiers = TIERS.select { |t| items_by_tier[t].any? }
    doc = Prawn::Document.new(page_size: "LETTER", margin: [90, 36, 60, 36])
    doc.font "Helvetica"

    if tiers.empty?
      doc.text "No graded findings on this inspection.", size: 12
      tiers = [nil]
    end

    tiers.each_with_index do |tier, idx|
      doc.start_new_page unless idx.zero?
      next if tier.nil?
      draw_tier_page(doc, tier, items_by_tier[tier])
    end

    doc.repeat(:all, dynamic: true) do
      draw_header(doc)
      draw_footer(doc)
    end

    [doc.render, doc.page_count]
  end

  private

  def grouped_items
    template = inspection.checklist_template
    result = Hash.new { |h, k| h[k] = [] }
    inspection.items.where(skipped: false).each do |item|
      tier = tier_for(item)
      next unless tier
      result[tier] << [item, template.find_item(item.template_item_key)]
    end
    result
  end

  # Pass/fail items map to High on FAIL. A PASS is not a finding.
  def tier_for(item)
    return item.severity if item.severity.present?
    return "high" if item.pass_fail? && item.pass == false
    nil
  end

  def finding_text(item, template_item)
    tier = tier_for(item)
    crit = template_item && template_item["tier_criteria"]
    text = crit && crit[tier]
    text = "FAIL" if text.blank? && item.pass_fail?
    text ||= "Graded #{TIER_LABELS[tier]}"
    if item.measurement_value.present?
      text = "#{item.measurement_value.to_s.sub(/\.?0+\z/, '')} #{item.measurement_unit}. #{text}"
    end
    text += " (carried forward from a prior visit)" if item.carried_forward?
    text
  end

  def draw_tier_page(doc, tier, rows)
    doc.fill_color TIER_COLORS[tier]
    doc.text "#{TIER_LABELS[tier]} severity findings", size: 18, style: :bold
    doc.fill_color "000000"
    doc.move_down 8

    data = [["Component", "Finding", "Technician note"]]
    rows.sort_by { |item, _| item.position }.each do |item, template_item|
      data << [item.component_name, finding_text(item, template_item), item.technician_note.to_s]
    end
    doc.table(data, header: true, width: doc.bounds.width, column_widths: [150, 250]) do |t|
      t.row(0).font_style = :bold
      t.row(0).background_color = "EEEEEE"
      t.cells.size = 9
      t.cells.padding = 5
    end

    if tier == "high"
      doc.move_down 14
      draw_high_acknowledgment(doc)
    end
  end

  def draw_high_acknowledgment(doc)
    events = HighSeverityEvent.joins(:inspection_item).where(inspection_items: { inspection_id: inspection.id })
                              .includes(:owner_signature, :inspection_item).order("inspection_items.position")
    doc.text "High severity acknowledgment", size: 12, style: :bold
    if events.empty?
      doc.text "No signed acknowledgment on file.", size: 9
      return
    end
    # One signature usually covers every High item discussed in the same conversation.
    events.group_by(&:owner_signature).each do |sig, evs|
      doc.move_down 4
      evs.each do |ev|
        decision = if ev.machine_out_of_service
                     "machine taken out of service"
                   else
                     "recheck in #{ev.recheck_interval_days} days; plan: #{ev.repair_plan}"
                   end
        doc.text "- #{ev.inspection_item.component_name}: #{decision}", size: 9
      end
      doc.move_down 2
      initials = evs.map(&:owner_initials).reject(&:blank?).uniq.join(", ")
      doc.text "Acknowledged by #{sig.signer_name} (#{sig.signer_role}) at #{fmt(sig.signed_at)}#{initials.present? ? ", initialled #{initials}" : ''}", size: 9
      doc.text "Owner statement: \"#{sig.signer_statement}\"", size: 9, style: :italic if sig.signer_statement.present?
      draw_signature_image(doc, sig)
    end
  end

  def draw_signature_image(doc, sig)
    return if sig.image_s3_key.blank?
    bytes = Storage.read(sig.image_s3_key)
    doc.image StringIO.new(bytes), height: 40
  rescue Storage::NotFound, Prawn::Errors::UnsupportedImageType
    doc.text "(signature image pending upload)", size: 8
  end

  def draw_header(doc)
    m = inspection.machine
    doc.bounding_box([doc.bounds.left, doc.bounds.top + 70], width: doc.bounds.width, height: 64) do
      doc.text "Uptime inspection record", size: 10, style: :bold
      doc.text "Customer: #{inspection.customer.name}", size: 8
      doc.text "Machine: #{m.make} #{m.model} | Serial #{m.serial_number} | Unique ID #{m.id}", size: 8
      doc.text "Hour meter: #{inspection.hour_meter_reading} | Performed: #{fmt(inspection.performed_at)} | " \
               "Technician: #{inspection.technician.name} | Checklist #{inspection.checklist_version}", size: 8
      doc.text "Inspection #{inspection.id} | #{inspection.inspection_type} | locked #{fmt(inspection.locked_at)}", size: 7,
                                                                                                                       color: "555555"
      doc.stroke_horizontal_rule
    end
  end

  def draw_footer(doc)
    sig = inspection.signatures.find_by(signature_type: "visit_checkout")
    doc.bounding_box([doc.bounds.left, doc.bounds.bottom - 8], width: doc.bounds.width, height: 40) do
      doc.stroke_horizontal_rule
      doc.move_down 4
      if sig
        doc.text "Signed: #{sig.signer_name} (#{sig.signer_role}) at #{fmt(sig.signed_at)}", size: 8
      else
        doc.text "Not yet signed", size: 8
      end
      doc.text "Uptime inspects, documents, flags and communicates. This record is not a diagnosis. " \
               "Page #{doc.page_number} of #{doc.page_count}", size: 7, color: "555555"
    end
  end

  def fmt(t)
    t ? t.utc.strftime("%Y-%m-%d %H:%M UTC") : "n/a"
  end
end
