# frozen_string_literal: true

module Api
  module V1
    class InspectionsController < BaseController
      before_action :load_inspection, except: %i[index create]
      before_action :reject_if_locked, only: %i[create_items create_signature lock]

      # GET /api/v1/inspections?machine_id=&since=
      def index
        scope = policy_scope(Inspection).includes(:machine, :technician).recent_first
        scope = scope.where(machine_id: params[:machine_id]) if params[:machine_id].present?
        scope = scope.where("inspections.updated_at > ?", since_param) if since_param
        render_collection(scope.limit(200), Serializers::InspectionSummary)
      end

      def show
        render_record(@inspection, Serializers::Inspection)
      end

      # POST /api/v1/inspections  (idempotent on client_generated_id)
      def create
        authorize Inspection
        attrs = inspection_params
        if (existing = Inspection.find_by(client_generated_id: attrs[:client_generated_id]))
          authorize existing, :show?
          return render_record(existing, Serializers::Inspection, extra: { existing: true })
        end
        machine = Machine.find(attrs[:machine_id])
        authorize machine, :show?

        inspection = nil
        alerts = []
        Inspection.transaction do
          inspection = Inspection.create!(attrs.merge(technician: current_user, customer_id: machine.customer_id,
                                                      device_id: attrs[:device_id].presence || device_id,
                                                      synced_at: Time.current))
          alerts = DiscrepancyAlert.record_for!(inspection)
          machine.update!(current_hour_meter: inspection.hour_meter_reading) if inspection.hour_meter_reading.to_i > machine.current_hour_meter.to_i
        end
        render_record(inspection, Serializers::Inspection, status: :created,
                                                            extra: { discrepancy_alert_ids: alerts.map(&:id) })
      rescue ActiveRecord::RecordNotUnique
        existing = Inspection.find_by!(client_generated_id: attrs[:client_generated_id])
        render_record(existing, Serializers::Inspection, extra: { existing: true })
      end

      # POST /api/v1/inspections/:id/items  { items: [...] }  (batch, idempotent per client_generated_id)
      def create_items
        items = params.require(:items)
        results = Inspection.transaction do
          items.map { |raw| upsert_item(raw) }
        end
        render_collection(results, Serializers::InspectionItem)
      end

      # POST /api/v1/inspections/:id/signatures
      def create_signature
        attrs = params.require(:signature).permit(:client_generated_id, :signature_type, :signer_name, :signer_role,
                                                  :signer_statement, :image_s3_key, :sha256, :signed_at, :device_id)
        if (existing = @inspection.signatures.find_by(client_generated_id: attrs[:client_generated_id]))
          return render_record(existing, Serializers::Signature, extra: { existing: true })
        end
        if attrs[:image_s3_key].present?
          HashVerifier.verify!(attrs[:image_s3_key], attrs[:sha256]) # rejects on mismatch
        end
        signature = @inspection.signatures.create!(attrs.merge(device_id: attrs[:device_id].presence || device_id))
        render_record(signature, Serializers::Signature, status: :created)
      end

      # POST /api/v1/inspections/:id/lock
      def lock
        errors = @inspection.lockable_errors
        return render json: { error: "not_lockable", details: errors }, status: :unprocessable_content if errors.any?
        locked_at = params[:locked_at].present? ? Time.zone.parse(params[:locked_at].to_s) : Time.current
        Inspection.transaction do
          @inspection.lock!(at: locked_at)
          ReportGenerator.new(@inspection).generate!
        end
        @inspection.mark_synced!
        render_record(@inspection.reload, Serializers::Inspection)
      end

      # GET /api/v1/inspections/:id/notes
      def notes
        render_collection(@inspection.notes.includes(:author_user).order(:created_at), Serializers::InspectionNote)
      end

      # POST /api/v1/inspections/:id/notes  (append only, allowed on locked inspections)
      def create_note
        attrs = params.require(:note).permit(:client_generated_id, :inspection_item_id, :body)
        if (existing = @inspection.notes.find_by(client_generated_id: attrs[:client_generated_id]))
          return render_record(existing, Serializers::InspectionNote, extra: { existing: true })
        end
        item_id = resolve_item_id(attrs[:inspection_item_id])
        note = @inspection.notes.create!(attrs.merge(inspection_item_id: item_id, author_user: current_user))
        render_record(note, Serializers::InspectionNote, status: :created)
      end

      # GET /api/v1/inspections/:id/report.pdf
      def report
        report = @inspection.report || (@inspection.locked? && ReportGenerator.new(@inspection).generate!)
        return render_error(:not_found, "report is generated when the inspection is locked") unless report
        send_data Storage.read(report.s3_key), type: "application/pdf", disposition: "inline",
                                               filename: "uptime-inspection-#{@inspection.id}.pdf"
      end

      private

      def load_inspection
        @inspection = Inspection.find(params[:id])
        authorize @inspection, action_name == "report" ? :show? : :"#{action_name}?"
      end

      def reject_if_locked
        render_locked if @inspection.locked?
      end

      def inspection_params
        params.require(:inspection).permit(:client_generated_id, :machine_id, :inspection_type, :performed_at,
                                           :completed_at, :hour_meter_reading, :device_id)
      end

      ITEM_FIELDS = %i[client_generated_id template_item_key position component_name result_type severity pass
                       measurement_value measurement_unit technician_note skipped skip_reason
                       carried_forward_from_item_id].freeze

      def upsert_item(raw)
        attrs = raw.permit(*ITEM_FIELDS, measurement_detail: {})
        existing = @inspection.items.find_by(client_generated_id: attrs[:client_generated_id])
        return existing if existing
        attrs[:carried_forward_from_item_id] = resolve_item_id(attrs[:carried_forward_from_item_id])
        @inspection.items.create!(attrs)
      end

      # Accepts a server id or a client_generated_id for an item.
      def resolve_item_id(value)
        return nil if value.blank?
        InspectionItem.where(id: value).or(InspectionItem.where(client_generated_id: value)).pick(:id) || value
      end
    end
  end
end
